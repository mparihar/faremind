/**
 * Booking-level financial ledger — the rows behind every figure on the page.
 *
 * A dashboard total nobody can decompose is a number people stop trusting the
 * first time it looks wrong. Every column here is stored on the booking, not
 * recomputed, so a row explains itself: this is what the customer paid, this is
 * what went to the airline, this is what we kept, this is what the agent earned
 * and at what rate.
 *
 * `format=csv` streams the same rows for finance to reconcile offline, honouring
 * whatever filters are applied — exporting the whole table when a month is on
 * screen is how the wrong period ends up in a board pack.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { providerIdOf, providerLabel } from '@/lib/providers/provider-identity';

const COUNTED_STATUSES = ['CONFIRMED', 'TICKETED', 'COMPLETED', 'CANCEL_REQUESTED', 'CANCELLED', 'REBOOKED'];

function periodRange(year: number, month: number): { gte: Date; lt: Date } {
  if (month >= 1 && month <= 12) {
    return { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) };
  }
  return { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) };
}

const n = (v: unknown) => (v == null ? 0 : Number(v));

/** RFC4180: quote everything, double internal quotes. Names contain commas. */
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = Number(searchParams.get('year')) || now.getFullYear();
  const monthParam = searchParams.get('month');
  const month = monthParam == null ? now.getMonth() + 1 : Number(monthParam) || 0;
  const provider = providerIdOf(searchParams.get('provider'));
  const agentUserId = searchParams.get('agentUserId') || null;
  const search = (searchParams.get('q') ?? '').trim();
  const format = searchParams.get('format');
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  // CSV takes the whole filtered set; the screen takes a page.
  const limit = format === 'csv' ? 5000 : Math.min(200, Number(searchParams.get('limit')) || 50);

  const where: Prisma.MasterBookingWhereInput = {
    bookingStatus: { in: COUNTED_STATUSES as any },
    createdAt: periodRange(year, month),
  };
  if (provider) where.primaryProvider = { equals: provider, mode: 'insensitive' };
  if (agentUserId === 'AGENTS') where.agentUserId = { not: null };
  else if (agentUserId) where.agentUserId = agentUserId;
  if (search) {
    where.OR = [
      { masterBookingReference: { contains: search, mode: 'insensitive' } },
      { masterPnr: { contains: search, mode: 'insensitive' } },
      { customerName: { contains: search, mode: 'insensitive' } },
      { customerEmail: { contains: search, mode: 'insensitive' } },
      { agentName: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.masterBooking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: format === 'csv' ? 0 : (page - 1) * limit,
      take: limit,
      select: {
        id: true, masterBookingReference: true, masterPnr: true, createdAt: true,
        customerName: true, customerEmail: true,
        primaryProvider: true, agentName: true, tripType: true,
        originAirport: true, destinationAirport: true,
        totalAmount: true, currency: true, providerPayableTotal: true,
        markupAmount: true, serviceFeeAmount: true, seatServiceTotal: true,
        travelInsuranceAmount: true, priceProtectionAmount: true, thirdPartyPayableTotal: true,
        agentCommissionTotal: true, agentServiceFeeRate: true, agentAncillaryRate: true,
        bookingStatus: true, ticketingStatus: true,
      },
    }),
    prisma.masterBooking.count({ where }),
  ]);

  const refunds = rows.length > 0
    ? await prisma.bookingRefund.findMany({
        where: { bookingId: { in: rows.map(r => r.id) } },
        select: { bookingId: true, amount: true },
      }).catch(() => [])
    : [];
  const refundBy = new Map<string, number>();
  for (const r of refunds) refundBy.set(r.bookingId, (refundBy.get(r.bookingId) ?? 0) + n(r.amount));

  const ledger = rows.map(r => {
    const refund = refundBy.get(r.id) ?? 0;
    // Third-party products earn us the spread, not the premium.
    const ancillaryCommission = Math.max(0,
      n(r.travelInsuranceAmount) + n(r.priceProtectionAmount) - n(r.thirdPartyPayableTotal));
    const fareMindRevenue = n(r.serviceFeeAmount) + n(r.markupAmount) + n(r.seatServiceTotal) + ancillaryCommission;
    return {
      bookingReference: r.masterBookingReference,
      providerRef: r.masterPnr,
      bookedAt: r.createdAt,
      customer: r.customerName,
      customerEmail: r.customerEmail,
      provider: providerLabel(r.primaryProvider) ?? r.primaryProvider,
      agent: r.agentName,
      tripType: r.tripType,
      route: `${r.originAirport} → ${r.destinationAirport}`,
      currency: r.currency,
      grossAmount: n(r.totalAmount),
      providerCost: n(r.providerPayableTotal),
      serviceFee: n(r.serviceFeeAmount),
      markup: n(r.markupAmount),
      ancillary: n(r.seatServiceTotal),
      ancillaryCommission,
      agentCommission: r.agentCommissionTotal == null ? null : n(r.agentCommissionTotal),
      agentServiceFeeRate: r.agentServiceFeeRate == null ? null : n(r.agentServiceFeeRate),
      fareMindRevenue: Math.round(fareMindRevenue * 100) / 100,
      fareMindNet: Math.round((fareMindRevenue - n(r.agentCommissionTotal)) * 100) / 100,
      refundAmount: refund,
      netAmount: Math.round((n(r.totalAmount) - refund) * 100) / 100,
      bookingStatus: r.bookingStatus,
      ticketingStatus: r.ticketingStatus,
    };
  });

  if (format === 'csv') {
    const headers = [
      'Booking Reference', 'Provider Ref', 'Booked At', 'Customer', 'Email', 'Provider',
      'Agent', 'Trip Type', 'Route', 'Currency', 'Gross Amount', 'Provider Cost',
      'Service Fee', 'Markup', 'Ancillary', 'Ancillary Commission', 'Agent Commission',
      'Agent Rate %', 'FareMind Revenue', 'FareMind Net', 'Refund', 'Net Amount',
      'Booking Status', 'Ticketing Status',
    ];
    const body = ledger.map(r => [
      r.bookingReference, r.providerRef, r.bookedAt.toISOString(), r.customer, r.customerEmail,
      r.provider, r.agent, r.tripType, r.route, r.currency, r.grossAmount, r.providerCost,
      r.serviceFee, r.markup, r.ancillary, r.ancillaryCommission, r.agentCommission,
      r.agentServiceFeeRate, r.fareMindRevenue, r.fareMindNet, r.refundAmount, r.netAmount,
      r.bookingStatus, r.ticketingStatus,
    ].map(csvCell).join(','));

    const label = month === 0 ? String(year) : `${year}-${String(month).padStart(2, '0')}`;
    return new NextResponse([headers.map(csvCell).join(','), ...body].join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="faremind-finance-${label}${provider ? `-${provider}` : ''}.csv"`,
      },
    });
  }

  return NextResponse.json({
    ledger,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
}, 'FINANCE');
