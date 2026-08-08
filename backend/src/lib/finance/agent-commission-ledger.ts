/**
 * The agent's commission account.
 *
 * An agent earns a share of what FareMind earns — never of the airline fare.
 * The money is accrued when the customer's payment is captured, held as PENDING,
 * and settled on a payout cycle. Until then it is visible and countable but not
 * spendable, which is why it lives here and not in AgentWallet: that wallet is
 * the agent's own float for paying for bookings, and mixing the two would let
 * them book flights with commission nobody has settled yet.
 *
 * Append-only. The balance is the sum of the entries, never a stored column —
 * a running total drifts the first time two writes race, and "why is my balance
 * $840" has to be answerable booking by booking.
 */
import { prisma } from '../db';
import type { Prisma } from '../../../../src/generated/prisma/client';
import type { AgentCommission } from './finance-math';

export type CommissionEntryType = 'ACCRUED' | 'REVERSED' | 'PAID_OUT' | 'ADJUSTMENT';

export interface CommissionBalance {
  /** Earned and not yet paid out — what we owe today. */
  pending: number;
  /** Settled in past payout runs. */
  paid: number;
  /** Everything ever earned, net of reversals. */
  lifetime: number;
  currency: string;
  entries: number;
}

/**
 * Credit an agent for a booking whose payment has been captured.
 *
 * Idempotent on bookingId: the unique constraint means a retried confirm, a
 * duplicated webhook or a replayed transaction cannot pay the same commission
 * twice. A booking that already has an entry is left exactly as it was.
 *
 * `tx` lets the caller run this inside the booking transaction, so a booking
 * that rolls back cannot leave a commission credit behind.
 */
export async function accrueCommission(params: {
  agentUserId: string;
  bookingId: string;
  bookingReference?: string | null;
  commission: AgentCommission;
  currency?: string;
  /** When the payment was captured. Drives which payout period this falls in. */
  earnedAt?: Date;
  /** Run inside the caller's transaction so a rolled-back booking credits nothing. */
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const { agentUserId, bookingId, bookingReference, commission, currency = 'USD' } = params;

  // Nothing earned is not an entry. A $0 row would clutter the agent's
  // statement with bookings that paid them nothing.
  if (!agentUserId || !bookingId || commission.total <= 0) return;

  const client: Prisma.TransactionClient | typeof prisma = params.tx ?? prisma;
  try {
    await client.agentCommissionEntry.create({
      data: {
        agentUserId,
        bookingId,
        entryType: 'ACCRUED' satisfies CommissionEntryType,
        amount: commission.total,
        currency,
        serviceFeeCommission: commission.serviceFeeCommission,
        ancillaryCommission: commission.ancillaryCommission,
        serviceFeeRate: commission.serviceFeeRate,
        ancillaryRate: commission.ancillaryRate,
        status: 'PENDING',
        earnedAt: params.earnedAt ?? new Date(),
        description: bookingReference ? `Commission on booking ${bookingReference}` : 'Booking commission',
      },
    });
  } catch (err) {
    // A duplicate is the guard working, not a failure. Anything else is logged
    // and swallowed: commission must never be the reason a paid booking fails
    // to persist — it is recoverable from the booking, a lost booking is not.
    const code = (err as { code?: string })?.code;
    if (code === 'P2002') return;
    console.error(`[AgentCommission] accrual failed for booking ${bookingId}: ${(err as Error).message}`);
  }
}

/**
 * Take commission back when the booking it was earned on is refunded.
 *
 * Written as an opposing entry rather than by deleting the accrual: the agent's
 * statement has to show that they earned it and that it was reversed, and why.
 * Deleting would make a disputed payout impossible to reconstruct.
 *
 * Only reverses what is still PENDING. Commission already paid out is a debt
 * question, not a ledger correction, and is left for a human — silently
 * clawing back settled money from a future payout is how agents stop trusting
 * the number.
 */
export async function reverseCommission(params: {
  bookingId: string;
  reason: string;
}): Promise<{ reversed: number; alreadyPaid: boolean }> {
  const { bookingId, reason } = params;

  const original = await prisma.agentCommissionEntry.findUnique({ where: { bookingId } })
    .catch(() => null);
  if (!original || original.entryType !== 'ACCRUED') return { reversed: 0, alreadyPaid: false };

  if (original.status === 'PAID') {
    // Already settled, so there is nothing to take back from a future payout
    // without an explicit decision. This used to be a console warning and
    // nothing else — money owed back to FareMind, visible to nobody, on a line
    // in a log that scrolls away. It is now a ticket someone has to close.
    const amount = Number(original.amount);
    console.warn(
      `[AgentCommission] booking ${bookingId} was refunded but its commission ` +
      `(${amount}) is already paid out — raising for manual settlement.`,
    );

    const agent = await prisma.user.findUnique({
      where: { id: original.agentUserId },
      select: { email: true, firstName: true, lastName: true },
    }).catch(() => null);
    const booking = await prisma.masterBooking.findUnique({
      where: { id: bookingId },
      select: { masterBookingReference: true, customerName: true },
    }).catch(() => null);
    const agentName = `${agent?.firstName ?? ''} ${agent?.lastName ?? ''}`.trim() || 'Agent';

    await prisma.supportTicket.create({
      data: {
        subject: `Commission recovery: ${agentName} — ${original.currency} ${amount.toFixed(2)} already paid`,
        description: [
          `Booking ${booking?.masterBookingReference ?? bookingId} was refunded (${reason}).`,
          '',
          `The agent's commission of ${original.currency} ${amount.toFixed(2)} on this booking was ALREADY PAID OUT,`,
          'so it could not be reversed against a future payout automatically.',
          '',
          `Agent: ${agentName}${agent?.email ? ` (${agent.email})` : ''}`,
          `Customer: ${booking?.customerName ?? 'n/a'}`,
          '',
          'Decide whether to recover this from the next payout or write it off,',
          'and record the decision here. Nothing has been deducted automatically —',
          'clawing settled money back without telling the agent is how they stop',
          'trusting the figure.',
        ].join('\n'),
        priority: 'HIGH',
        status: 'OPEN',
        category: 'Refund',
        channel: 'SYSTEM',
        bookingRef: booking?.masterBookingReference ?? undefined,
        ticketType: 'COMMISSION_RECOVERY',
        queue: 'MANUAL_REFUND_REQUIRED',
        customerName: agentName,
        customerEmail: agent?.email ?? 'unknown@faremind.ai',
      } as any,
    }).catch((e) => console.error(`[AgentCommission] recovery ticket failed: ${e.message}`));

    return { reversed: 0, alreadyPaid: true };
  }

  const amount = Number(original.amount);
  await prisma.agentCommissionEntry.create({
    data: {
      agentUserId: original.agentUserId,
      bookingId: null,   // the unique slot belongs to the accrual
      entryType: 'REVERSED' satisfies CommissionEntryType,
      amount: -amount,
      currency: original.currency,
      status: 'PENDING',
      earnedAt: new Date(),
      description: `Reversal — ${reason}`,
    },
  }).catch((e) => console.error(`[AgentCommission] reversal failed: ${e.message}`));

  return { reversed: amount, alreadyPaid: false };
}

/** What an agent is owed, optionally within one period. */
export async function commissionBalance(
  agentUserId: string,
  range?: { gte: Date; lt: Date },
): Promise<CommissionBalance> {
  const entries = await prisma.agentCommissionEntry.findMany({
    where: { agentUserId, ...(range ? { earnedAt: range } : {}) },
    select: { amount: true, status: true, currency: true },
  }).catch(() => []);

  let pending = 0, paid = 0, lifetime = 0;
  for (const e of entries) {
    const amt = Number(e.amount);
    lifetime += amt;
    if (e.status === 'PAID') paid += amt;
    else pending += amt;
  }

  const cents = (n: number) => Math.round(n * 100) / 100;
  return {
    pending: cents(pending),
    paid: cents(paid),
    lifetime: cents(lifetime),
    currency: entries[0]?.currency ?? 'USD',
    entries: entries.length,
  };
}
