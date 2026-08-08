/**
 * An agent's commission account — what they have earned and what is still owed.
 *
 * Read-only by design. Commission is settled on a payout cycle, not withdrawn on
 * demand, so there is nothing here to spend or move. Showing it as a balance an
 * agent could draw on would misrepresent when the money actually arrives.
 *
 * Kept separate from the wallet endpoints for the same reason the tables are
 * separate: the wallet is the agent's own float for paying for bookings, this is
 * money FareMind owes them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withAgentServicing } from '@/lib/agent-auth';
import { commissionBalance } from '@/lib/finance/agent-commission-ledger';

export const GET = withAgentServicing(async (req: NextRequest, { agent }) => {
  const agentUserId = agent.id;
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = Number(searchParams.get('year')) || now.getFullYear();
  const monthParam = searchParams.get('month');
  const month = monthParam == null ? now.getMonth() + 1 : Number(monthParam) || 0;

  const range = month >= 1 && month <= 12
    ? { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) }
    : { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) };

  const [lifetime, period, entries] = await Promise.all([
    // Unscoped: "what am I owed" is not a question about one month.
    commissionBalance(agentUserId),
    commissionBalance(agentUserId, range),
    prisma.agentCommissionEntry.findMany({
      where: { agentUserId, earnedAt: range },
      orderBy: { earnedAt: 'desc' },
      take: 200,
      select: {
        id: true, bookingId: true, entryType: true, amount: true, currency: true,
        serviceFeeCommission: true, ancillaryCommission: true,
        serviceFeeRate: true, ancillaryRate: true,
        status: true, earnedAt: true, paidAt: true, description: true,
      },
    }).catch(() => []),
  ]);

  // The booking reference, so a line reads as a trip rather than as an id.
  const bookingIds = entries.map(e => e.bookingId).filter((b): b is string => !!b);
  const bookings = bookingIds.length > 0
    ? await prisma.masterBooking.findMany({
        where: { id: { in: bookingIds } },
        select: {
          id: true, masterBookingReference: true, originAirport: true,
          destinationAirport: true, totalAmount: true, customerName: true,
        },
      }).catch(() => [])
    : [];
  const byId = new Map(bookings.map(b => [b.id, b]));

  // Whether this month has been settled, so the agent sees "Paid on 3 Sep"
  // rather than a pile of entries they cannot tell the status of. A withheld
  // month is shown as withheld with its reason — silence there reads as a
  // system that forgot them.
  const payout = month >= 1 && month <= 12
    ? await prisma.agentCommissionPayout.findUnique({
        where: { agentUserId_periodYear_periodMonth: { agentUserId, periodYear: year, periodMonth: month } },
        select: { status: true, paidAmount: true, systemAmount: true, reason: true, decidedAt: true,
                  payoutMethod: true, paymentReference: true, stripeTransferId: true, transferStatus: true, paidOn: true },
      }).catch(() => null)
    : null;

  return NextResponse.json({
    period: { year, month },
    payout: payout ? {
      status: payout.status,
      paidAmount: Number(payout.paidAmount),
      systemAmount: Number(payout.systemAmount),
      reason: payout.reason,
      decidedAt: payout.decidedAt,
      method: payout.payoutMethod,
      paymentReference: payout.paymentReference,
      stripeTransferId: payout.stripeTransferId,
      transferStatus: payout.transferStatus,
      paidOn: payout.paidOn,
    } : null,
    /** What we owe right now, across all time. */
    pending: lifetime.pending,
    paid: lifetime.paid,
    lifetime: lifetime.lifetime,
    currency: lifetime.currency,
    /** Earned within the selected period. */
    periodEarned: period.lifetime,
    periodBookings: period.entries,
    entries: entries.map(e => ({
      ...e,
      amount: Number(e.amount),
      serviceFeeCommission: e.serviceFeeCommission == null ? null : Number(e.serviceFeeCommission),
      ancillaryCommission: e.ancillaryCommission == null ? null : Number(e.ancillaryCommission),
      serviceFeeRate: e.serviceFeeRate == null ? null : Number(e.serviceFeeRate),
      ancillaryRate: e.ancillaryRate == null ? null : Number(e.ancillaryRate),
      booking: e.bookingId ? byId.get(e.bookingId) ?? null : null,
    })),
    payoutNote: 'Commission is settled on FareMind’s monthly payout cycle.',
  });
});
