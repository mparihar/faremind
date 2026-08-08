/**
 * Settling a month of agent commission — a decision a person makes.
 *
 * Deliberately not automated. Paying an agent is the last point at which anyone
 * looks at the numbers before money leaves, and a run that settles itself
 * removes the only check on a bad month's data. An admin opens the period, sees
 * what the ledger computed, and either pays it, pays a corrected figure, or
 * withholds it with a reason.
 */
import { prisma } from '@/lib/db';
import { transferToAgent } from './stripe-connect';

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
    method: string | null;
    paymentReference: string | null;
    stripeTransferId: string | null;
    transferStatus: string | null;
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
          method: p.payoutMethod,
          paymentReference: p.paymentReference,
          stripeTransferId: p.stripeTransferId,
          transferStatus: p.transferStatus,
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

/**
 * EXTERNAL_TRANSFER — the money moved outside the platform (bank transfer, UPI,
 *   cheque). We record that a human says it happened, and the reference is the
 *   only link between our record and the bank's.
 * STRIPE_CONNECT — the platform moved it, and Stripe's transfer id is proof.
 *
 * The distinction is kept everywhere because "paid" means two different things:
 * one is a claim, the other is a receipt.
 */
export type PayoutMethod = 'EXTERNAL_TRANSFER' | 'STRIPE_CONNECT';

export type PayoutDecision =
  | { outcome: 'PAID'; payoutId: string; paidAmount: number; entriesSettled: number; method: PayoutMethod; transferId?: string | null }
  | { outcome: 'REJECTED'; payoutId: string }
  | { outcome: 'ALREADY_DECIDED'; status: string; paidAmount: number }
  | { outcome: 'NOTHING_DUE' }
  | { outcome: 'TRANSFER_FAILED'; error: string }
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
  /** Defaults to external — the method that requires nothing of the agent. */
  method?: PayoutMethod;
  /** Bank/UPI/cheque reference. Required for an external transfer. */
  paymentReference?: string | null;
  /** When the external transfer was actually made; defaults to now. */
  paidOn?: Date | null;
}): Promise<PayoutDecision> {
  const { agentUserId, period, amountOverride, reason, decidedBy } = params;
  const method: PayoutMethod = params.method ?? 'EXTERNAL_TRANSFER';
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

  // An external transfer with no reference is an unverifiable claim. The
  // reference is the only thing linking our "paid" to the bank's record, and
  // the agent needs it to match the credit on their statement.
  if (method === 'EXTERNAL_TRANSFER' && !String(params.paymentReference ?? '').trim()) {
    return { outcome: 'INVALID', error: 'A payment reference is required for an external transfer.' };
  }

  const currency = pending[0]?.currency ?? 'USD';

  // Move the money BEFORE recording that it moved.
  //
  // Recording first and transferring after would leave a failed transfer marked
  // PAID — the agent's portal saying settled, their bank saying nothing, and the
  // period closed so it never appears in a payout run again. A transfer that
  // fails here writes no payout at all, and the month stays payable.
  let transferId: string | null = null;
  if (method === 'STRIPE_CONNECT') {
    const transfer = await transferToAgent({
      userId: agentUserId,
      amount: paidAmount,
      currency,
      // Deterministic, so a retry of the same period cannot pay twice even
      // before a payout row exists to key on.
      payoutId: `${agentUserId}-${period.year}-${String(period.month).padStart(2, '0')}`,
      description: `FareMind commission — ${period.year}-${String(period.month).padStart(2, '0')}`,
    });
    if (!transfer.ok) {
      return { outcome: 'TRANSFER_FAILED', error: transfer.error ?? 'The transfer could not be completed.' };
    }
    transferId = transfer.transferId;
  }

  const payout = await prisma.$transaction(async (tx) => {
    const p = await tx.agentCommissionPayout.create({
      data: {
        agentUserId,
        periodYear: period.year,
        periodMonth: period.month,
        systemAmount, paidAmount, currency,
        status: 'PAID',
        payoutMethod: method,
        paymentReference: params.paymentReference?.trim() || null,
        paidOn: params.paidOn ?? new Date(),
        stripeTransferId: transferId,
        // A Connect transfer is accepted here; Stripe settles it to the bank
        // over the following days, so this is not claimed as PAID at the bank.
        transferStatus: method === 'STRIPE_CONNECT' ? 'PENDING' : null,
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

  return { outcome: 'PAID', payoutId: payout.id, paidAmount, entriesSettled: pending.length, method, transferId };
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
