/**
 * Fare Family — airline branding in, normalized tier out.
 *
 * MIRROR of backend/src/services/fare-family.ts. The two module trees do not
 * share code; keep them in lockstep — a divergence here silently changes which
 * tier a brand lands in on one surface but not the other.
 *
 * The airline owns the fare name. Mystifly returns it on
 * `ItineraryReferenceList[].FareFamily` ("ECO VALUE", "DELTA MAIN BASIC",
 * "INDIGO UPFRONT", "SMART", "BUSINESS FLEX", …) and that string is what the
 * customer sees, everywhere, unchanged — search, checkout, ticket, servicing.
 *
 * What we derive here is a private tier used only for ranking, filters,
 * analytics and upgrade logic. It is never displayed.
 *
 * Everything below is pattern + attribute inference over arbitrary text, so an
 * airline can publish a brand we have never seen ("Go Smart", "Comfort+",
 * "Premium Saver") and it still lands on a sensible tier with no code change.
 */

import type { NormalizedFareTier } from '@/lib/types';

export type { NormalizedFareTier };

export type FareTierInput = {
  /** Raw provider value — may be '' when the airline files no brand. */
  fareFamily?: string | null;
  cabinClass?: string | null;
  refundable?: boolean | null;
  changeable?: boolean | null;
  /** Checked pieces; 0 is the classic basic-economy tell. */
  checkedBags?: number | null;
};

/**
 * Brand-name signals, most specific first. `isBasicEconomy()` in
 * ranking/core/scoreComfort.ts keys off basic|light|saver — keep BASIC aligned
 * with it so the tier and the comfort score never disagree.
 */
const FLEX_PATTERNS = /\b(flex|flexi|flexible|fullflex|upfront|plus|ultra|prime)\b/;
const BASIC_PATTERNS = /\b(basic|light|lite|saver|value|special|promo|sale|handbag|hand bag)\b/;
const STANDARD_PATTERNS = /\b(standard|classic|smart|main|regular|choice|comfort|convenience)\b/;

/**
 * Fold a brand into plain lowercase words so `\b` matching is safe. Airlines
 * publish names like "Comfort+", "ECO-VALUE" and "PREMIUMECONOMY"; a literal
 * `\b…\b` against "comfort+" never matches because `+` is not a word character.
 */
function canonical(name: string): string {
  return name
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Cabin wins outright — a "Business Flex" is BUSINESS, not FLEX. */
function tierFromCabin(cabinClass?: string | null): NormalizedFareTier | null {
  const c = (cabinClass || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (c.includes('first')) return 'FIRST';
  if (c.includes('business')) return 'BUSINESS';
  if (c.includes('premium')) return 'PREMIUM';
  return null;
}

/**
 * Attribute fallback for brands that carry no tier signal. Real Mystifly data
 * is full of these — "RETURN", "ROUNDTRIP FARE", "REGULAR FARE" are trip-type
 * labels, not brands — and JFK-LHR returns '' outright on some fares.
 */
function tierFromAttributes(input: FareTierInput): NormalizedFareTier {
  const { refundable, changeable, checkedBags } = input;
  if (refundable === true && changeable === true) return 'FLEX';
  if (checkedBags === 0 && refundable !== true && changeable !== true) return 'BASIC';
  return 'STANDARD';
}

/**
 * Map an airline fare family to an internal tier. Display code must never call
 * this — it exists for ranking, filters, analytics and upgrade logic only.
 */
export function normalizeFareTier(input: FareTierInput): NormalizedFareTier {
  const cabinTier = tierFromCabin(input.cabinClass);
  if (cabinTier) return cabinTier;

  const name = canonical(input.fareFamily || '');
  if (name) {
    // Order matters. "Comfort+" folds to "comfort plus" and must read as FLEX,
    // not as the STANDARD signal "comfort".
    if (FLEX_PATTERNS.test(name)) return 'FLEX';
    if (BASIC_PATTERNS.test(name)) return 'BASIC';
    if (STANDARD_PATTERNS.test(name)) return 'STANDARD';
  }
  return tierFromAttributes(input);
}

/**
 * Customer-facing label. Returns the airline's own brand verbatim whenever
 * there is one. When the airline files no brand we fall back to the plain cabin
 * name — never to an invented tier name, because a made-up brand is exactly the
 * failure this module exists to prevent.
 */
export function displayFareFamily(fareFamily?: string | null, cabinClass?: string | null): string {
  const name = (fareFamily || '').trim();
  if (name) return name;
  // No brand filed. Use a controlled, obviously-generic label — never an
  // invented brand, and never the bare cabin name, which reads as though the
  // airline calls the fare that. Mystifly's v1 "lowest fare" search returns no
  // FareFamily at all, so this path is common.
  const c = (cabinClass || 'economy').toLowerCase().replace(/[\s-]+/g, '_');
  if (c.includes('first')) return 'First Class Fare';
  if (c.includes('business')) return 'Business Fare';
  if (c.includes('premium')) return 'Premium Economy Fare';
  return 'Economy Fare';
}

/**
 * Make unnamed fares in the same cabin distinguishable.
 *
 * Two brandless offers would otherwise render as two identical "Economy Fare"
 * cards. Disambiguate with provider-backed data first — the booking class is
 * real and meaningful — and fall back to an index only when nothing else
 * separates them.
 *
 * Named fares are returned untouched: the airline's brand is always the label.
 */
export function disambiguateFareLabels<T>(
  offers: T[],
  read: (o: T) => { fareFamily?: string | null; cabinClass?: string | null; bookingClass?: string | null },
): string[] {
  const base = offers.map((o) => {
    const { fareFamily, cabinClass } = read(o);
    return displayFareFamily(fareFamily, cabinClass);
  });

  // Only labels shared by more than one brandless offer need disambiguating.
  const counts = new Map<string, number>();
  base.forEach((label, i) => {
    if ((read(offers[i]).fareFamily || '').trim()) return; // airline-named — leave alone
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  const usedSuffix = new Map<string, number>();
  return base.map((label, i) => {
    const { fareFamily, bookingClass } = read(offers[i]);
    if ((fareFamily || '').trim()) return label;
    if ((counts.get(label) ?? 0) < 2) return label;

    const rbd = (bookingClass || '').trim();
    if (rbd) return `${label} – RBD ${rbd}`;

    const n = (usedSuffix.get(label) ?? 0) + 1;
    usedSuffix.set(label, n);
    return `${label} ${n}`;
  });
}

/** Cabin bucket for the fare panel's tabs. */
export function cabinBucket(cabinClass?: string | null): 'economy' | 'premium_economy' | 'business' | 'first' {
  const c = (cabinClass || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (c.includes('first')) return 'first';
  if (c.includes('business')) return 'business';
  if (c.includes('premium')) return 'premium_economy';
  return 'economy';
}

/**
 * Identity of the physical journey, independent of fare. Two offers sharing a
 * key are the same metal at different fare families — that is exactly the set
 * the fare panel shows. Mirrors Mystifly's own `GroupedItems` grouping, but
 * derived from segments so it works for any provider.
 */
export function itineraryKey(
  segments: Array<{
    flightNumber?: string | null;
    airline?: { code?: string | null } | null;
    departure?: { airport?: string | null; time?: string | null } | null;
    arrival?: { airport?: string | null } | null;
  }>,
): string {
  return (segments || [])
    .map((s) => [
      (s.airline?.code || '').toUpperCase(),
      String(s.flightNumber || ''),
      (s.departure?.airport || '').toUpperCase(),
      (s.arrival?.airport || '').toUpperCase(),
      s.departure?.time || '',
    ].join('~'))
    .join('|');
}

/**
 * Parse a provider baggage allowance ("15Kg", "0PC", "2PC", "23Kg", "SB") into
 * a comparable shape. Weight-only allowances have no piece count, so callers
 * must not read `pieces` as "no bag" when `kg > 0`.
 */
export function parseBaggageAllowance(raw?: string | null): { pieces: number | null; kg: number | null; raw: string } {
  const text = (raw || '').trim();
  if (!text) return { pieces: null, kg: null, raw: '' };
  const pc = text.match(/(\d+)\s*P/i);
  if (pc) return { pieces: parseInt(pc[1], 10), kg: null, raw: text };
  const kg = text.match(/(\d+)\s*K/i);
  if (kg) {
    const weight = parseInt(kg[1], 10);
    // A weight-based allowance above zero is one checked allowance, whatever
    // the number. The old `>= 20 ? 1 : 0` rule reported 15Kg as "no bag".
    return { pieces: weight > 0 ? 1 : 0, kg: weight, raw: text };
  }
  // "SB" (standby / small bag) and other non-numeric codes carry no allowance.
  return { pieces: null, kg: null, raw: text };
}
