/**
 * Finance summary — the numbers the admin console reports on.
 *
 * The previous version read `payment` and `booking`: the LEGACY models, replaced
 * by MasterBooking/BookingPayment when the OTA data model landed. Both tables
 * are empty, so the dashboard reported $0 revenue, $0 refunds and "No payments"
 * against real bookings and real money. It was not showing a quiet month; it was
 * reading the wrong table.
 *
 * Aggregation happens in the database. A finance page must not load every
 * booking into the browser to add up a year.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { providerIdOf } from '@/lib/providers/provider-identity';
import {
  totalsFor, emptyTotals, percentChange, refundRate,
  type BookingFinancials, type FinanceTotals,
} from '@/lib/finance/finance-math';

/**
 * Which bookings count as business done.
 *
 * A booking counts when the customer's money was actually captured — not when a
 * row was written. Failed bookings, abandoned checkouts and expired holds are
 * excluded, so the headline does not move every time reconciliation resolves
 * something. Refunds are then subtracted as their own line rather than by
 * removing the booking, because the volume genuinely happened.
 */
const COUNTED_STATUSES = ['CONFIRMED', 'TICKETED', 'COMPLETED', 'CANCEL_REQUESTED', 'CANCELLED', 'REBOOKED'];

/** Local month boundaries for a calendar year. Month is 1-12, or 0 for all. */
function periodRange(year: number, month: number): { gte: Date; lt: Date } {
  if (month >= 1 && month <= 12) {
    return { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) };
  }
  return { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) };
}

const SELECT = {
  id: true,
  createdAt: true,
  totalAmount: true,
  providerPayableTotal: true,
  markupAmount: true,
  serviceFeeAmount: true,
  travelInsuranceAmount: true,
  priceProtectionAmount: true,
  thirdPartyPayableTotal: true,
  seatServiceTotal: true,
  agentCommissionTotal: true,
  agentUserId: true,
  agentName: true,
  primaryProvider: true,
  bookingStatus: true,
} as const;

type Row = {
  id: string;
  createdAt: Date;
  agentUserId: string | null;
  agentName: string | null;
  primaryProvider: string;
} & Record<string, unknown>;

/** Prisma Decimals arrive as objects; the math module wants plain numbers. */
function toFinancials(r: Row, refund = 0): BookingFinancials {
  const num = (v: unknown) => (v == null ? 0 : Number(v));
  return {
    totalAmount: num(r.totalAmount),
    providerPayableTotal: num(r.providerPayableTotal),
    markupAmount: num(r.markupAmount),
    serviceFeeAmount: num(r.serviceFeeAmount),
    travelInsuranceAmount: num(r.travelInsuranceAmount),
    priceProtectionAmount: num(r.priceProtectionAmount),
    thirdPartyPayableTotal: num(r.thirdPartyPayableTotal),
    seatServiceTotal: num(r.seatServiceTotal),
    agentCommissionTotal: r.agentCommissionTotal == null ? null : Number(r.agentCommissionTotal),
    refundAmount: refund,
    // Not captured anywhere yet. Deliberately null, not 0 — see finance-math.
    paymentProcessingFee: null,
  };
}

export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = Number(searchParams.get('year')) || now.getFullYear();
  const monthParam = searchParams.get('month');
  // Absent means the current month; an explicit 0 or "all" means the whole year.
  const month = monthParam == null ? now.getMonth() + 1 : Number(monthParam) || 0;
  const provider = providerIdOf(searchParams.get('provider'));
  const agentUserId = searchParams.get('agentUserId') || null;

  // Built imperatively: a spread of ternaries produces a union Prisma cannot
  // narrow to a single where-input.
  const scope: Prisma.MasterBookingWhereInput = {
    bookingStatus: { in: COUNTED_STATUSES as any },
  };
  if (provider) scope.primaryProvider = { equals: provider, mode: 'insensitive' };
  if (agentUserId === 'AGENTS') scope.agentUserId = { not: null };
  else if (agentUserId) scope.agentUserId = agentUserId;

  const yearRange = periodRange(year, 0);

  const [yearRows, refundRows] = await Promise.all([
    prisma.masterBooking.findMany({
      where: { ...scope, createdAt: yearRange },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
    }) as unknown as Promise<Row[]>,
    // Refunds actually issued. booking_refunds is the servicing path; the
    // failure-audit path is where a failed booking's money is returned, and a
    // dashboard reading only one of them under-reports refunds.
    prisma.bookingRefund.findMany({
      where: { createdAt: yearRange, status: { in: ['COMPLETED', 'PROCESSING', 'INITIATED'] } },
      select: { bookingId: true, amount: true, createdAt: true },
    }).catch(() => []),
  ]);

  const refundByBooking = new Map<string, number>();
  for (const r of refundRows) {
    refundByBooking.set(r.bookingId, (refundByBooking.get(r.bookingId) ?? 0) + Number(r.amount ?? 0));
  }

  // Failed bookings are refunded through the failure-audit path, not through
  // BookingRefund — the booking never got far enough to have a cancellation.
  // Reading only one source under-reports refunds by exactly the money we give
  // back when a booking dies, which is the case most worth seeing.
  const auditRefunds = await prisma.bookingFailureAudit.aggregate({
    where: {
      createdAt: yearRange,
      refundStatus: { in: ['REFUND_ISSUED', 'ALREADY_REFUNDED'] },
      ...(provider ? { provider: { equals: provider, mode: 'insensitive' } } : {}),
    },
    _sum: { refundAmount: true },
    _count: true,
  }).catch(() => ({ _sum: { refundAmount: null }, _count: 0 }));

  const failedBookingRefunds = Number(auditRefunds._sum.refundAmount ?? 0);

  // ── Monthly series, so the chart and the KPI cards agree by construction ──
  const monthly: FinanceTotals[] = [];
  for (let m = 1; m <= 12; m++) {
    const { gte, lt } = periodRange(year, m);
    const rows = yearRows.filter((r) => r.createdAt >= gte && r.createdAt < lt);
    monthly.push(rows.length === 0 ? emptyTotals() : totalsFor(rows.map((r) => toFinancials(r, refundByBooking.get(r.id) ?? 0))));
  }

  const inPeriod = (() => {
    const { gte, lt } = periodRange(year, month);
    return yearRows.filter((r) => r.createdAt >= gte && r.createdAt < lt);
  })();

  const current = inPeriod.length === 0 ? emptyTotals() : totalsFor(inPeriod.map((r) => toFinancials(r, refundByBooking.get(r.id) ?? 0)));

  // Previous month, for the comparison line. December of the prior year is a
  // real previous month; the chart's January must not compare against itself.
  const previous = month >= 2 ? monthly[month - 2]
    : month === 1
      ? await (async () => {
          const prev = periodRange(year - 1, 12);
          const rows = await prisma.masterBooking.findMany({
            where: { ...scope, createdAt: prev }, select: SELECT,
          }) as unknown as Row[];
          return rows.length === 0 ? emptyTotals() : totalsFor(rows.map((r) => toFinancials(r, refundByBooking.get(r.id) ?? 0)));
        })()
      : emptyTotals();

  const change = (pick: (t: FinanceTotals) => number) =>
    month === 0 ? null : percentChange(pick(current), pick(previous));

  // ── Provider breakdown ──
  const byProvider = new Map<string, Row[]>();
  for (const r of inPeriod) {
    const key = providerIdOf(r.primaryProvider) ?? 'unknown';
    if (!byProvider.has(key)) byProvider.set(key, []);
    byProvider.get(key)!.push(r);
  }
  const providers = [...byProvider.entries()].map(([id, rows]) => ({
    provider: id,
    ...totalsFor(rows.map((r) => toFinancials(r, refundByBooking.get(r.id) ?? 0))),
  })).sort((a, b) => b.grossBookingValue - a.grossBookingValue);

  // ── Agent breakdown ──
  const byAgent = new Map<string, { name: string; rows: Row[] }>();
  for (const r of inPeriod) {
    if (!r.agentUserId) continue;
    if (!byAgent.has(r.agentUserId)) byAgent.set(r.agentUserId, { name: r.agentName ?? 'Agent', rows: [] });
    byAgent.get(r.agentUserId)!.rows.push(r);
  }
  const agents = [...byAgent.entries()].map(([id, { name, rows }]) => ({
    agentUserId: id,
    agentName: name,
    ...totalsFor(rows.map((r) => toFinancials(r, refundByBooking.get(r.id) ?? 0))),
  })).sort((a, b) => b.grossBookingValue - a.grossBookingValue);

  const refundedInPeriod = inPeriod.filter((r) => refundByBooking.has(r.id)).length;

  return NextResponse.json({
    period: { year, month },
    filters: { provider, agentUserId },
    totals: current,
    change: {
      grossBookingValue: change((t) => t.grossBookingValue),
      netBookingValue: change((t) => t.netBookingValue),
      fareMindGrossRevenue: change((t) => t.fareMindGrossRevenue),
      fareMindNetRevenue: change((t) => t.fareMindNetRevenue),
      bookings: change((t) => t.bookings),
    },
    monthly: monthly.map((t, i) => ({ month: i + 1, ...t })),
    providers,
    agents,
    refunds: {
      // Both sources, so the figure is what customers actually got back.
      total: Math.round((current.refunds + failedBookingRefunds) * 100) / 100,
      onBookings: current.refunds,
      onFailedBookings: failedBookingRefunds,
      refundedBookings: refundedInPeriod + auditRefunds._count,
      rate: refundRate(refundedInPeriod, current.bookings),
    },
    // Said out loud rather than rendered as $0, which would read as "free".
    notTracked: ['paymentProcessingCost'],
  });
}, 'FINANCE');
