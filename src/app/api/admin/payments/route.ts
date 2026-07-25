/**
 * Admin/Support: unified payments dashboard across ALL payment purposes
 * (BOOKING_PAYMENT | AGENT_WALLET_RECHARGE | OTHER_PAYMENT).
 *   GET /api/admin/payments?purpose=&status=&search=&from=&to=
 * RBAC: SUPPORT+ (finance detail via existing service-payments/finance pages).
 */
import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

const n = (d: any) => (d == null ? 0 : Number(d));

export const GET = withAdmin(async (req) => {
  const url = new URL(req.url);
  const purpose = url.searchParams.get('purpose') || undefined;
  const status = url.searchParams.get('status') || undefined;
  const search = url.searchParams.get('search')?.trim();
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const where: any = {};
  if (purpose) where.paymentPurpose = purpose;
  if (status) where.status = status;
  if (search) where.OR = [
    { customerEmail: { contains: search, mode: 'insensitive' } },
    { customerName: { contains: search, mode: 'insensitive' } },
    { stripePaymentIntentId: { contains: search, mode: 'insensitive' } },
    { description: { contains: search, mode: 'insensitive' } },
  ];
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999Z`);
  }

  const [rows, totals] = await Promise.all([
    prisma.servicePayment.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 300,
      include: { booking: { select: { masterBookingReference: true } } },
    }),
    prisma.servicePayment.groupBy({ by: ['paymentPurpose', 'status'], where, _count: { _all: true }, _sum: { amount: true } }),
  ]);

  return NextResponse.json({
    payments: rows.map((p) => ({
      id: p.id, purpose: p.paymentPurpose, status: p.status, amount: n(p.amount), currency: p.currency,
      serviceType: p.serviceType, description: p.description,
      customerName: p.customerName, customerEmail: p.customerEmail, requestedBy: p.requestedBy,
      bookingRef: p.booking?.masterBookingReference || null, agentId: p.agentId, walletId: p.walletId,
      paymentRequestId: p.paymentRequestId, supportCaseId: p.supportCaseId, autoRecharge: p.autoRecharge,
      stripePaymentIntentId: p.stripePaymentIntentId, paidAt: p.paidAt, failedAt: p.failedAt,
      failureReason: p.failureReason, createdAt: p.createdAt,
    })),
    summary: totals.map((t) => ({ purpose: t.paymentPurpose, status: t.status, count: t._count._all, sum: n(t._sum.amount) })),
  });
}, 'SUPPORT');
