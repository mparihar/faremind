/**
 * What FareMind processed, and what FareMind actually earned.
 *
 * These are different numbers and the dashboard was conflating them: it called
 * the whole customer charge "Total Revenue". On a $2,146 ticket where $2,096
 * goes to the airline and $50 is our service fee, "revenue $2,146" is off by a
 * factor of forty. At volume that is the difference between "we sold $500,000 of
 * tickets" and "we earned $18,000", and only the second one pays salaries.
 *
 * ── The two ladders ──────────────────────────────────────────────────────────
 *
 * VOLUME — money that moved through us:
 *   Gross Booking Value   what customers paid
 *   − Refunds
 *   = Net Booking Value   transaction volume, NOT profit
 *
 * EARNINGS — money that is ours:
 *   Service fees + ancillary/insurance/protection commissions + markup
 *   = FareMind Gross Revenue
 *   − Agent commission − processing costs − FareMind-funded refunds
 *   = FareMind Net Revenue
 *
 * The airline's fare never appears in the earnings ladder. It is not ours at any
 * point; it passes through. Subtracting provider cost from GROSS BOOKING VALUE
 * and calling the result revenue is the same error in a different direction —
 * it silently treats markup as the only earning, and double-counts nothing but
 * flatters months where a fare happened to be cheap.
 */

/** Everything one booking contributes, already snapshotted at book time. */
export interface BookingFinancials {
  /** What the customer was charged in total. */
  totalAmount?: number | null;
  /** What goes to the airline/provider. Passes through; never our revenue. */
  providerPayableTotal?: number | null;
  /** Ours: fare markup. */
  markupAmount?: number | null;
  /** Ours: booking/platform service fee. */
  serviceFeeAmount?: number | null;
  /** Third-party premiums we collect — ours only to the extent of commission. */
  travelInsuranceAmount?: number | null;
  priceProtectionAmount?: number | null;
  /** What we owe onward for those products. */
  thirdPartyPayableTotal?: number | null;
  /** Paid seats and bags. */
  seatServiceTotal?: number | null;
  /** Snapshotted agent share. Null = no agent, or predates tracking. */
  agentCommissionTotal?: number | null;
  /** Refunded to the customer against this booking. */
  refundAmount?: number | null;
  /** Card processing cost, when known. Null means NOT TRACKED, not zero. */
  paymentProcessingFee?: number | null;
}

export interface FinanceTotals {
  grossBookingValue: number;
  refunds: number;
  netBookingValue: number;

  serviceFeeRevenue: number;
  markupRevenue: number;
  ancillaryRevenue: number;
  insuranceCommission: number;
  fareMindGrossRevenue: number;

  agentCommission: number;
  /** Null when nothing in the set tracked it — different from zero. */
  paymentProcessingCost: number | null;
  fareMindNetRevenue: number;

  providerCost: number;
  bookings: number;
  averageBookingValue: number;
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Money rounds to cents at the point it is reported, never mid-sum. */
const cents = (v: number): number => Math.round(v * 100) / 100;

/**
 * Third-party products earn us the spread, not the premium.
 *
 * A $40 insurance premium of which $30 goes to the underwriter is $10 of ours.
 * Counting the full premium would inflate revenue by the float we are merely
 * holding on someone else's behalf.
 */
function thirdPartyCommission(b: BookingFinancials): number {
  const collected = n(b.travelInsuranceAmount) + n(b.priceProtectionAmount);
  const owed = n(b.thirdPartyPayableTotal);
  return Math.max(0, collected - owed);
}

export function totalsFor(bookings: BookingFinancials[]): FinanceTotals {
  let gbv = 0, refunds = 0, serviceFee = 0, markup = 0, ancillary = 0,
      thirdParty = 0, agent = 0, providerCost = 0, processing = 0;
  let processingTracked = false;

  for (const b of bookings) {
    gbv += n(b.totalAmount);
    refunds += n(b.refundAmount);
    serviceFee += n(b.serviceFeeAmount);
    markup += n(b.markupAmount);
    ancillary += n(b.seatServiceTotal);
    thirdParty += thirdPartyCommission(b);
    agent += n(b.agentCommissionTotal);
    providerCost += n(b.providerPayableTotal);
    if (b.paymentProcessingFee != null) {
      processing += n(b.paymentProcessingFee);
      processingTracked = true;
    }
  }

  const gross = serviceFee + markup + ancillary + thirdParty;
  // Processing cost is subtracted only where it is known. Treating "not
  // captured" as $0 would report a net revenue we have not actually earned.
  const net = gross - agent - (processingTracked ? processing : 0);

  return {
    grossBookingValue: cents(gbv),
    refunds: cents(refunds),
    netBookingValue: cents(gbv - refunds),

    serviceFeeRevenue: cents(serviceFee),
    markupRevenue: cents(markup),
    ancillaryRevenue: cents(ancillary),
    insuranceCommission: cents(thirdParty),
    fareMindGrossRevenue: cents(gross),

    agentCommission: cents(agent),
    paymentProcessingCost: processingTracked ? cents(processing) : null,
    fareMindNetRevenue: cents(net),

    providerCost: cents(providerCost),
    bookings: bookings.length,
    averageBookingValue: bookings.length > 0 ? cents(gbv / bookings.length) : 0,
  };
}

/** Zeroed totals, so a month with no data renders as $0 rather than blank. */
export function emptyTotals(): FinanceTotals {
  return totalsFor([]);
}

// ── Agent commission ────────────────────────────────────────────────────────

export interface CommissionRates {
  /** Percent of the service fee shared with the agent, e.g. 50. */
  serviceFeeRate: number;
  /** Percent of ancillary commission shared with the agent, e.g. 50. */
  ancillaryRate: number;
}

export interface AgentCommission {
  serviceFeeCommission: number;
  ancillaryCommission: number;
  total: number;
  serviceFeeRate: number;
  ancillaryRate: number;
}

/**
 * The agent's share of a booking, computed once at book time.
 *
 * Returns the rates alongside the amounts so the stored row can explain itself
 * later — "why is this $10" is answerable from the booking without knowing what
 * the config happened to say that day.
 *
 * Commission is taken from what WE earn, never from the fare. An agent booking
 * a $2,000 ticket with a $20 service fee earns a share of the $20.
 */
export function agentCommissionFor(
  b: Pick<BookingFinancials, 'serviceFeeAmount' | 'seatServiceTotal' | 'travelInsuranceAmount' | 'priceProtectionAmount' | 'thirdPartyPayableTotal'>,
  rates: CommissionRates,
): AgentCommission {
  const clamp = (r: number) => Math.min(100, Math.max(0, Number.isFinite(r) ? r : 0));
  const serviceFeeRate = clamp(rates.serviceFeeRate);
  const ancillaryRate = clamp(rates.ancillaryRate);

  const serviceFeeCommission = cents(n(b.serviceFeeAmount) * (serviceFeeRate / 100));
  const ancillaryBase = n(b.seatServiceTotal) + thirdPartyCommission(b as BookingFinancials);
  const ancillaryCommission = cents(ancillaryBase * (ancillaryRate / 100));

  return {
    serviceFeeCommission,
    ancillaryCommission,
    total: cents(serviceFeeCommission + ancillaryCommission),
    serviceFeeRate,
    ancillaryRate,
  };
}

// ── Month over month ────────────────────────────────────────────────────────

/**
 * Percentage change, or null when the comparison is meaningless.
 *
 * Null rather than 0 or Infinity when the previous period was zero: going from
 * $0 to $5,000 is not "+100%" and not "+∞", it is a first month, and a card
 * that claims a percentage there is inventing a trend from one data point.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Refunded bookings ÷ total bookings, as a percentage. */
export function refundRate(refundedBookings: number, totalBookings: number): number {
  if (!totalBookings || totalBookings <= 0) return 0;
  return Math.round((refundedBookings / totalBookings) * 1000) / 10;
}
