/**
 * Fare ladder assembly (client side).
 *
 * A search returns every fare the airline filed as its own offer — the same
 * flight at "ECO VALUE", "CLASSIC" and "FLEX" arrives as three offers sharing
 * an `itineraryKey`. The fare panel shows exactly that set, so we collect the
 * siblings from results we already hold rather than making another provider
 * call.
 */
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';

/** Shape POSTed to the backend's `/api/fares/options`. */
export interface FareSiblingOffer {
  id: string;
  providerOfferId: string;
  airlineFareFamily: string | null;
  normalizedFareTier?: string;
  cabinClass: string;
  bookingClass: string | null;
  totalPrice: number;
  currency: string;
  seatsRemaining: number | null;
  checkedBaggageAllowance: string | null;
  cabinBaggageAllowance: string | null;
  baggage: { carryOn?: number; checked?: number } | null;
  fareRules: {
    refundable: boolean | null;
    changeable: boolean | null;
    changeFee: number | null;
    cancellationFee: number | null;
  };
}

/**
 * Fallback grouping key for providers that don't send one. Mirrors
 * backend/src/services/fare-family.ts `itineraryKey`.
 */
function localItineraryKey(f: UnifiedFlight): string {
  return (f.segments || [])
    .map((s) => [
      (f.airline?.code || '').toUpperCase(),
      String(s.flightNumber || ''),
      (s.departure?.airport || '').toUpperCase(),
      (s.arrival?.airport || '').toUpperCase(),
      s.departure?.time || '',
    ].join('~'))
    .join('|');
}

function keyOf(f: UnifiedFlight): string {
  return f.itineraryKey || localItineraryKey(f);
}

function toOffer(f: UnifiedFlight): FareSiblingOffer {
  return {
    id: f.id,
    providerOfferId: f.providerOfferId,
    airlineFareFamily: f.airlineFareFamily ?? null,
    normalizedFareTier: f.normalizedFareTier,
    cabinClass: f.cabinClass,
    bookingClass: f.bookingClass ?? null,
    totalPrice: f.totalPrice,
    currency: f.currency || 'USD',
    seatsRemaining: typeof f.seatsRemaining === 'number' ? f.seatsRemaining : null,
    checkedBaggageAllowance: f.checkedBaggageAllowance ?? null,
    cabinBaggageAllowance: f.cabinBaggageAllowance ?? null,
    baggage: f.baggage ?? null,
    fareRules: {
      refundable: f.fareRules?.refundable ?? null,
      changeable: f.fareRules?.changeable ?? null,
      changeFee: f.fareRules?.changeFee ?? null,
      cancellationFee: f.fareRules?.cancellationFee ?? null,
    },
  };
}

/**
 * Every fare available on the selected flight, cheapest first. Always includes
 * the selected offer, so a flight the airline sells at a single fare yields a
 * one-entry ladder rather than an empty panel.
 */
export function collectFareSiblings(selected: UnifiedFlight, pool: UnifiedFlight[] = []): FareSiblingOffer[] {
  // The search API groups by itinerary and attaches every fare for the journey.
  // When present that is authoritative — it covers fares the ranker placed far
  // down the list, which a scan of the currently-filtered pool would miss.
  const attached = (selected as any).fareOffers;
  if (Array.isArray(attached) && attached.length > 0) {
    return [...attached]
      .filter((o: any) => (o?.totalPrice ?? 0) > 0)
      .sort((a: any, b: any) => a.totalPrice - b.totalPrice);
  }

  const key = keyOf(selected);
  const seen = new Set<string>();
  const out: FareSiblingOffer[] = [];

  for (const f of [selected, ...(pool || [])]) {
    if (!f || keyOf(f) !== key) continue;
    // Same fare offered twice (e.g. both search versions) — keep the first.
    const dedupeKey = f.providerOfferId || f.id;
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    if (!(f.totalPrice > 0)) continue;
    seen.add(dedupeKey);
    out.push(toOffer(f));
  }

  return out.sort((a, b) => a.totalPrice - b.totalPrice);
}

// ─── Round trips ─────────────────────────────────────────────────────────────

/** Fallback key for a round-trip card, across both journeys. */
function localRoundTripKey(rt: RoundTripOption): string {
  return [rt.outboundJourney, rt.returnJourney]
    .flatMap((j) => (j?.segments || []).map((s) => [
      (s.airline?.code || '').toUpperCase(),
      String(s.flightNumber || ''),
      (s.departure?.airport || '').toUpperCase(),
      (s.arrival?.airport || '').toUpperCase(),
      s.departure?.time || '',
    ].join('~')))
    .join('|');
}

function rtKeyOf(rt: RoundTripOption): string {
  return rt.itineraryKey || localRoundTripKey(rt);
}

function rtToOffer(rt: RoundTripOption): FareSiblingOffer {
  return {
    id: rt.id,
    providerOfferId: rt.providerOfferId,
    airlineFareFamily: rt.airlineFareFamily ?? null,
    normalizedFareTier: rt.normalizedFareTier,
    cabinClass: rt.cabinClass,
    bookingClass: rt.bookingClass ?? null,
    totalPrice: rt.totalPrice,
    currency: rt.currency || 'USD',
    seatsRemaining: typeof rt.seatsRemaining === 'number' ? rt.seatsRemaining : null,
    checkedBaggageAllowance: rt.checkedBaggageAllowance ?? null,
    cabinBaggageAllowance: rt.cabinBaggageAllowance ?? null,
    baggage: rt.baggage ?? null,
    fareRules: {
      refundable: rt.fareRules?.refundable ?? null,
      changeable: rt.fareRules?.changeable ?? null,
      changeFee: rt.fareRules?.changeFee ?? null,
      cancellationFee: rt.fareRules?.cancellationFee ?? null,
    },
  };
}

/** Same as `collectFareSiblings`, for round-trip cards. */
export function collectRoundTripFareSiblings(
  selected: RoundTripOption,
  pool: RoundTripOption[] = [],
): FareSiblingOffer[] {
  // Same as above — the grouped search response is authoritative when present.
  const attached = (selected as any).fareOffers;
  if (Array.isArray(attached) && attached.length > 0) {
    return [...attached]
      .filter((o: any) => (o?.totalPrice ?? 0) > 0)
      .sort((a: any, b: any) => a.totalPrice - b.totalPrice);
  }

  const key = rtKeyOf(selected);
  const seen = new Set<string>();
  const out: FareSiblingOffer[] = [];

  for (const rt of [selected, ...(pool || [])]) {
    if (!rt || rtKeyOf(rt) !== key) continue;
    const dedupeKey = rt.providerOfferId || rt.id;
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    if (!(rt.totalPrice > 0)) continue;
    seen.add(dedupeKey);
    out.push(rtToOffer(rt));
  }

  return out.sort((a, b) => a.totalPrice - b.totalPrice);
}
