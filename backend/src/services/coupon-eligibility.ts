/**
 * What a coupon status actually tells us — and, more often, what it doesn't.
 *
 * Mystifly returns a per-segment CouponStatus with a Status code. Three distinct
 * answers arrive, and only two of them are verdicts:
 *
 *   OPEN            the coupon is unused. Refund / void / reissue are possible.
 *   USED, FLOWN…    the coupon is spent. Servicing genuinely is not possible.
 *   "N/A", ""       the airline reported nothing. This is what the Mystifly demo
 *                   endpoint returns for every segment, with Status 0.
 *
 * The old test was `/open/i.test(couponStatus)`, so "N/A" fell in with "USED"
 * and an unreported coupon was counted as closed. FM25OCTM then read "Airline
 * reports 0 of 2 coupons open — NOT valid for REFUND/VOID and REISSUE" on a
 * booking whose TripDetails says IsRefundableBeforeDeparture: "Yes", for two
 * future HK segments. The airline had not said no; it had said nothing.
 *
 * The distinction matters beyond the demo environment: once real coupon data
 * arrives, a genuinely closed coupon must still block, and it cannot do that if
 * it looks identical to silence.
 */

export type CouponState = 'open' | 'closed' | 'unknown';

/** Values that mean "the airline did not report a status". */
const UNREPORTED = /^(n\/?a|unknown|none|-|)$/i;

export function couponState(status: unknown, statusCode?: number | null): CouponState {
  const s = String(status ?? '').trim();
  if (UNREPORTED.test(s)) return 'unknown';
  if (/open/i.test(s)) return 'open';
  // A named status we do not recognise is still a statement by the airline, so
  // it counts as closed rather than silently passing as unknown.
  return 'closed';
}

export interface CouponSummary {
  /** Segments the airline positively reported as OPEN. */
  open: number;
  /** Segments the airline reported as spent/unusable. */
  closed: number;
  /** Segments with no status at all. */
  unknown: number;
  total: number;
  /** True only when the airline positively reported every segment as OPEN. */
  allOpen: boolean;
  /** True when the airline reported nothing for any segment. */
  unreported: boolean;
  /**
   * Whether servicing should be considered possible.
   *
   * Silence is not a refusal, so unknown does NOT block — a closed coupon does.
   * This stays advisory unless PTR_ENFORCE_COUPON_STATUS is on.
   */
  eligible: boolean;
}

export function summariseCoupons(
  segments: Array<{ couponStatus?: unknown; statusCode?: number | null }>,
): CouponSummary {
  const states = segments.map((sg) => couponState(sg.couponStatus, sg.statusCode));
  const open = states.filter((s) => s === 'open').length;
  const closed = states.filter((s) => s === 'closed').length;
  const unknown = states.filter((s) => s === 'unknown').length;
  const total = states.length;
  return {
    open, closed, unknown, total,
    allOpen: total > 0 && open === total,
    unreported: total > 0 && unknown === total,
    eligible: total === 0 || closed === 0,
  };
}

/** One line describing the coupon position, for a staff console. */
export function couponSummaryLabel(s: CouponSummary): string {
  if (s.total === 0) return 'No coupon information has been issued for this booking yet.';
  if (s.unreported) return 'The airline did not report coupon status for this booking.';
  if (s.allOpen) return `All ${s.total} coupons are open.`;
  if (s.closed > 0) return `${s.closed} of ${s.total} coupons are no longer open.`;
  return `${s.open} of ${s.total} coupons are open; ${s.unknown} not reported.`;
}
