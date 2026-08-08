/**
 * Settling a month of agent commission — a decision a person makes.
 *
 * Deliberately not automated. Paying an agent is the last point at which anyone
 * looks at the numbers before money leaves, and a run that settles itself
 * removes the only check on a bad month's data. An admin opens the period, sees
 * what the ledger computed, and either pays it, pays a corrected figure, or
 * withholds it with a reason.
 */
import { prisma } from '../db';

export interface PayoutPeriod {
  year: number;
  /** 1-12. Payouts are always for a single month. */
  month: number;
}

export function periodRange({ year, month }: PayoutPeriod): { gte: Date; lt: Date } {
  return { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) };
}

const cents = (n: number) => Math.round(n * 100) / 100;

export interface AgentDue {
  agentUserId: string;
  agentName: string;
  agentEmail: string;
  /** Owed for this period, from the ledger. */
  dueAmount: number;
  entryCount: number;
  currency: string;
  /** Present once a decision has been taken for this period. */
  payout: {
    status: 'PAID' | 'REJECTED';
    systemAmount: number;
    paidAmount: number;
    reason: string | null;
    decidedBy: string | null;
    decidedAt: Date;
  } | null;
}

/**
 * Every agent with commission activity in the period, and what they are owed.
 *
 * Includes agents already settled, so the screen shows what was decided rather
 * than making a paid month look like a month with no business.
 */
export async function agentsDueForPeriod(period: PayoutPeriod): Promise<AgentDue[]> {
  const range = periodRange(period);

  const entries = await prisma.agentCommissionEntry.findMany({
    where: { earnedAt: range },
    select: {
      agentUserId: true, amount: true, status: true, currency: true,
      agent: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  const payouts = await prisma.agentCommissionPayout.findMany({
    where: { periodYear: period.year, periodMonth: period.month },
  });
  const payoutBy = new Map(payouts.map(p => [p.agentUserId, p]));

  const byAgent = new Map<string, AgentDue>();
  for (const e of entries) {
    let row = byAgent.get(e.agentUserId);
    if (!row) {
      const p = payoutBy.get(e.agentUserId);
      row = {
        agentUserId: e.agentUserId,
        agentName: `${e.agent?.firstName ?? ''} ${e.agent?.lastName ?? ''}`.trim() || 'Agent',
        agentEmail: e.agent?.email ?? '',
        dueAmount: 0,
        entryCount: 0,
        currency: e.currency,
        payout: p ? {
          status: p.status as 'PAID' | 'REJECTED',
          systemAmount: Number(p.systemAmount),
          paidAmount: Number(p.paidAmount),
          reason: p.reason,
          decidedBy: p.decidedBy,
          decidedAt: p.decidedAt,
        } : null,
      };
      byAgent.set(e.agentUserId, row);
    }
    // Only what is still owed counts as due. Entries already settled — this
    // period's, or an earlier reversal — must not reappear as payable.
    if (e.status !== 'PAID') row.dueAmount += Number(e.amount);
    row.entryCount += 1;
  }

  return [...byAgent.values()]
    .map(r => ({ ...r, dueAmount: cents(r.dueAmount) }))
    .sort((a, b) => b.dueAmount - a.dueAmount);
}

export type PayoutDecision =
  | { outcome: 'PAID'; payoutId: string; paidAmount: number; entriesSettled: number }
  | { outcome: 'REJECTED'; payoutId: string }
  | { outcome: 'ALREADY_DECIDED'; status: string; paidAmount: number }
  | { outcome: 'NOTHING_DUE' }
  | { outcome: 'INVALID'; error: string };

/**
 * Pay an agent for a period.
 *
 * The admin may correct the amount. When they do, the difference is written as
 * an ADJUSTMENT entry rather than quietly ignored — the ledger must still sum to
 * what was actually paid, or the agent's running balance drifts from their bank
 * statement by exactly the correction and nobody can say why.
 *
 * The unique constraint on (agent, year, month) is the double-payment guard: a
 * double-clicked button or a retried request finds the period already decided.
 */
export async function payAgentCommission(params: {
  agentUserId: string;
  period: PayoutPeriod;
  /** Omit to pay exactly what the ledger says. */
  amountOverride?: number | null;
  reason?: string | null;
  decidedBy?: string | null;
}): Promise<PayoutDecision> {
  const { agentUserId, period, amountOverride, reason, decidedBy } = params;
  const range = periodRange(period);

  const existing = await prisma.agentCommissionPayout.findUnique({
    where: { agentUserId_periodYear_periodMonth: { agentUserId, periodYear: period.year, periodMonth: period.month } },
  }).catch(() => null);
  if (existing) {
    return { outcome: 'ALREADY_DECIDED', status: existing.status, paidAmount: Number(existing.paidAmount) };
  }

  const pending = await prisma.agentCommissionEntry.findMany({
    where: { agentUserId, earnedAt: range, status: { not: 'PAID' } },
    select: { id: true, amount: true, currency: true },
  });
  if (pending.length === 0) return { outcome: 'NOTHING_DUE' };

  const systemAmount = cents(pending.reduce((s, e) => s + Number(e.amount), 0));
  const paidAmount = amountOverride == null ? systemAmount : cents(amountOverride);

  if (!Number.isFinite(paidAmount) || paidAmount < 0) {
    return { outcome: 'INVALID', error: 'Payout amount must be zero or more.' };
  }
  // A correction is a judgement call, and the person who made it has to say why
  // — six months later "$40 instead of $52" is unanswerable without it.
  if (paidAmount !== systemAmount && !String(reason ?? '').trim()) {
    return { outcome: 'INVALID', error: 'A reason is required when changing the calculated amount.' };
  }

  const currency = pending[0]?.currency ?? 'USD';

  const payout = await prisma.$transaction(async (tx) => {
    const p = await tx.agentCommissionPayout.create({
      data: {
        agentUserId,
        periodYear: period.year,
        periodMonth: period.month,
        systemAmount, paidAmount, currency,
        status: 'PAID',
        reason: reason?.trim() || null,
        entryCount: pending.length,
        decidedBy: decidedBy ?? null,
      },
    });

    await tx.agentCommissionEntry.updateMany({
      where: { id: { in: pending.map(e => e.id) } },
      data: { status: 'PAID', payoutRef: p.id, paidAt: new Date() },
    });

    // Keep the ledger equal to what left the bank.
    const delta = cents(paidAmount - systemAmount);
    if (delta !== 0) {
      await tx.agentCommissionEntry.create({
        data: {
          agentUserId,
          bookingId: null,
          entryType: 'ADJUSTMENT',
          amount: delta,
          currency,
          status: 'PAID',
          payoutRef: p.id,
          paidAt: new Date(),
          earnedAt: range.gte,
          description: `Payout adjustment — ${reason?.trim() || 'amount corrected by admin'}`,
        },
      });
    }
    return p;
  });

  return { outcome: 'PAID', payoutId: payout.id, paidAmount, entriesSettled: pending.length };
}

/**
 * Withhold a period's commission.
 *
 * The entries stay PENDING rather than being written off, so the money remains
 * owed and rolls into the next payout. Rejecting is "not this month, and here is
 * why" — turning it into a write-off would silently delete an agent's earnings
 * on one click, which is not a decision a single button should be able to make.
 */
export async function rejectAgentCommission(params: {
  agentUserId: string;
  period: PayoutPeriod;
  reason: string;
  decidedBy?: string | null;
}): Promise<PayoutDecision> {
  const { agentUserId, period, reason, decidedBy } = params;
  if (!String(reason ?? '').trim()) {
    return { outcome: 'INVALID', error: 'A reason is required to withhold a payout.' };
  }

  const existing = await prisma.agentCommissionPayout.findUnique({
    where: { agentUserId_periodYear_periodMonth: { agentUserId, periodYear: period.year, periodMonth: period.month } },
  }).catch(() => null);
  if (existing) {
    return { outcome: 'ALREADY_DECIDED', status: existing.status, paidAmount: Number(existing.paidAmount) };
  }

  const range = periodRange(period);
  const pending = await prisma.agentCommissionEntry.findMany({
    where: { agentUserId, earnedAt: range, status: { not: 'PAID' } },
    select: { amount: true, currency: true },
  });
  const systemAmount = cents(pending.reduce((s, e) => s + Number(e.amount), 0));

  const payout = await prisma.agentCommissionPayout.create({
    data: {
      agentUserId,
      periodYear: period.year,
      periodMonth: period.month,
      systemAmount,
      paidAmount: 0,
      currency: pending[0]?.currency ?? 'USD',
      status: 'REJECTED',
      reason: reason.trim(),
      entryCount: pending.length,
      decidedBy: decidedBy ?? null,
    },
  });

  return { outcome: 'REJECTED', payoutId: payout.id };
}
