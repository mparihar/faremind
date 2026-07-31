/**
 * Admin/Support: bookings blocked by the agent wallet limit (BLOCKED_WALLET_LIMIT).
 *   GET /api/admin/blocked-bookings  → list, with the original agent + their wallet headroom
 * RBAC: SUPPORT+.
 */
import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

const n = (d: any) => (d == null ? 0 : Number(d));

export const GET = withAdmin(async () => {
  const rows = await prisma.masterBooking.findMany({
    where: { walletOverLimit: true },
    select: {
      id: true, masterBookingReference: true, masterPnr: true, customerName: true, customerEmail: true,
      originAirport: true, destinationAirport: true, departureDate: true, totalAmount: true, currency: true,
      bookingStatus: true, walletBlockStatus: true, blockedAgentUserId: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  // Attach the original agent + live wallet headroom so Support can see if it's reassignable.
  const agentIds = [...new Set(rows.map((r) => r.blockedAgentUserId).filter(Boolean) as string[])];
  const [agents, wallets] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, email: true, firstName: true, lastName: true, isActive: true } }),
    prisma.agentWallet.findMany({ where: { userId: { in: agentIds } }, select: { userId: true, walletAmount: true, utilizedAmount: true, currency: true, status: true } }),
  ]);
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const walletMap = new Map(wallets.map((w) => [w.userId, w]));

  return NextResponse.json({
    bookings: rows.map((r) => {
      const a = r.blockedAgentUserId ? agentMap.get(r.blockedAgentUserId) : null;
      const w = r.blockedAgentUserId ? walletMap.get(r.blockedAgentUserId) : null;
      const remaining = w ? Math.round((n(w.walletAmount) - n(w.utilizedAmount)) * 100) / 100 : null;
      const amount = n(r.totalAmount);
      return {
        id: r.id, reference: r.masterBookingReference, pnr: r.masterPnr,
        customerName: r.customerName, customerEmail: r.customerEmail,
        route: `${r.originAirport} → ${r.destinationAirport}`, departureDate: r.departureDate,
        amount, currency: r.currency, blockStatus: r.walletBlockStatus || 'BLOCKED_WALLET_LIMIT', createdAt: r.createdAt,
        agent: a ? { id: a.id, name: `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.email, email: a.email, active: a.isActive } : null,
        wallet: w ? { walletAmount: n(w.walletAmount), utilized: n(w.utilizedAmount), remaining, status: w.status } : null,
        reassignable: remaining != null && remaining >= amount,
      };
    }),
  });
}, 'SUPPORT');
