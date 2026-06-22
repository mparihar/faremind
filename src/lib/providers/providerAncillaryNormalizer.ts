/**
 * Provider Ancillary Normalizer
 *
 * Converts provider-specific ancillary/service responses (Duffel, Mystifly)
 * into a unified FareMind format.
 *
 * Core rule: Customer Ancillary Price = Provider Ancillary Price.
 * No markup, no mock, no DB override.
 */

import type { DuffelOffer, DuffelService } from '@/lib/providers/duffel';

// ── Normalized Ancillary Model ─────────────────────────────────────────────────

export type AncillaryProvider = 'DUFFEL' | 'MYSTIFLY' | 'OTHER';

export type AncillaryType =
  | 'CHECKED_BAG'
  | 'EXTRA_CHECKED_BAG'
  | 'CARRY_ON'
  | 'SEAT'
  | 'MEAL'
  | 'LOUNGE_ACCESS'
  | 'PRIORITY_BOARDING'
  | 'OTHER';

export interface NormalizedAncillary {
  provider: AncillaryProvider;
  providerOfferId: string;
  providerServiceId: string;
  ancillaryType: AncillaryType;
  passengerId: string | null;
  segmentId: string | null;
  journeyId: string | null;
  airportCode: string | null;
  label: string;
  description: string;
  included: boolean;
  chargeable: boolean;
  amount: number;       // Provider price — no markup
  currency: string;
  quantity: number;
  maxQuantity: number | null;
  rawProviderData: any;
}

// ── Service Type Detection ─────────────────────────────────────────────────────

/** Patterns for detecting Priority Boarding services from provider labels */
const PRIORITY_BOARDING_PATTERNS = [
  /priority\s*board/i,
  /fast\s*board/i,
  /early\s*board/i,
  /boarding\s*priority/i,
  /group\s*board/i,
  /zone\s*upgrade/i,
  /priority\s*embark/i,
  /speedy\s*board/i,
];

/** Patterns for detecting Lounge Access services from provider labels */
const LOUNGE_ACCESS_PATTERNS = [
  /lounge\s*access/i,
  /airport\s*lounge/i,
  /business\s*lounge/i,
  /premium\s*lounge/i,
  /lounge\s*pass/i,
  /admirals?\s*club/i,
  /sky\s*club/i,
  /plaza\s*premium/i,
  /aspire\s*lounge/i,
  /centurion\s*lounge/i,
  /first\s*class\s*lounge/i,
  /vip\s*lounge/i,
];

/**
 * Detect ancillary type from a Duffel service's type field and metadata.
 * Returns the mapped AncillaryType or null if no confident match.
 */
function detectServiceType(svc: DuffelService): AncillaryType | null {
  const svcType = svc.type?.toLowerCase() ?? '';

  // Direct type matches from Duffel
  if (svcType === 'baggage') return null; // Handled separately
  if (svcType === 'seat') return 'SEAT';

  // Check metadata and type fields for premium services
  const raw = svc as any;
  const label = (raw.metadata?.name ?? raw.metadata?.label ?? svc.type ?? '').toString();

  // Priority Boarding
  if (svcType === 'priority_boarding' || svcType === 'priority_board') {
    return 'PRIORITY_BOARDING';
  }
  for (const pattern of PRIORITY_BOARDING_PATTERNS) {
    if (pattern.test(label) || pattern.test(svcType)) return 'PRIORITY_BOARDING';
  }

  // Lounge Access
  if (svcType === 'lounge_access' || svcType === 'lounge') {
    return 'LOUNGE_ACCESS';
  }
  for (const pattern of LOUNGE_ACCESS_PATTERNS) {
    if (pattern.test(label) || pattern.test(svcType)) return 'LOUNGE_ACCESS';
  }

  return null; // Uncertain — do not map
}

// ── Duffel Normalizer ──────────────────────────────────────────────────────────

/**
 * Extract included baggage from a Duffel offer's segments.
 * These are free bags already part of the fare — not purchasable services.
 */
export function normalizeDuffelIncludedBaggage(offer: DuffelOffer): NormalizedAncillary[] {
  const result: NormalizedAncillary[] = [];
  const firstSlice = offer.slices?.[0];
  const firstSeg = firstSlice?.segments?.[0];
  const paxBaggages = firstSeg?.passengers?.[0]?.baggages;

  if (!paxBaggages) return result;

  for (const bag of paxBaggages) {
    if (bag.quantity <= 0) continue;

    const isCarryOn = bag.type === 'carry_on';
    result.push({
      provider: 'DUFFEL',
      providerOfferId: offer.id,
      providerServiceId: `included-${bag.type}`,
      ancillaryType: isCarryOn ? 'CARRY_ON' : 'CHECKED_BAG',
      passengerId: null,
      segmentId: firstSeg?.id ?? null,
      journeyId: firstSlice?.id ?? null,
      airportCode: null,
      label: isCarryOn
        ? `${bag.quantity}× carry-on included`
        : `${bag.quantity}× checked bag included`,
      description: isCarryOn
        ? 'Carry-on baggage included with your fare'
        : 'Checked baggage included with your fare',
      included: true,
      chargeable: false,
      amount: 0,
      currency: offer.total_currency,
      quantity: bag.quantity,
      maxQuantity: bag.quantity,
      rawProviderData: bag,
    });
  }

  return result;
}

/**
 * Extract purchasable baggage services from a Duffel offer's `available_services`.
 * These are paid add-ons with provider-set prices.
 *
 * Duffel `available_services` have:
 *  - id: service ID (needed for order creation)
 *  - type: "baggage" | other
 *  - total_amount: price string (e.g. "40.00")
 *  - total_currency: "USD" etc.
 *  - maximum_quantity: max purchasable
 *  - passenger_ids?: string[] (which passengers this applies to)
 *  - segment_ids?: string[] (which segments)
 *  - metadata?: { type: "checked", designation: "first" | "second" }
 */
export function normalizeDuffelBagServices(offer: DuffelOffer): NormalizedAncillary[] {
  const services = offer.available_services;
  if (!services || services.length === 0) return [];

  // Build a lookup: segmentId → "ORD → DEL" route label
  const segmentRouteMap = new Map<string, string>();
  for (const slice of offer.slices ?? []) {
    for (const seg of slice.segments ?? []) {
      const origin = seg.origin?.iata_code ?? '';
      const dest = seg.destination?.iata_code ?? '';
      if (origin && dest) {
        segmentRouteMap.set(seg.id, `${origin} → ${dest}`);
      }
    }
  }

  const result: NormalizedAncillary[] = [];

  for (const svc of services) {
    // Only normalize baggage services
    if (svc.type !== 'baggage') continue;

    const amount = parseFloat(svc.total_amount);
    if (isNaN(amount)) continue;

    const raw = svc as any;
    const metadata = raw.metadata ?? {};
    const bagType = metadata.type ?? 'checked';
    const designation = metadata.designation; // "first", "second", etc.

    const passengerId = raw.passenger_ids?.[0] ?? null;
    const segmentId = raw.segment_ids?.[0] ?? null;

    // Resolve segment to route label (e.g., "ORD → DEL")
    const routeLabel = segmentId ? segmentRouteMap.get(segmentId) : null;

    // Determine label
    let label = 'Add checked bag';
    let description = 'Extra checked baggage';
    if (designation === 'first') {
      label = 'Add 1st checked bag';
      description = '1st checked bag · 23 kg (50 lbs)';
    } else if (designation === 'second') {
      label = 'Add 2nd checked bag';
      description = '2nd checked bag · 23 kg (50 lbs)';
    } else if (designation === 'third') {
      label = 'Add 3rd checked bag';
      description = '3rd checked bag · 23 kg (50 lbs)';
    }

    // Append route label to distinguish outbound vs return
    if (routeLabel) {
      label = `${label} · ${routeLabel}`;
      description = `${description} · ${routeLabel}`;
    }

    // Weight info from metadata if available
    if (metadata.maximum_weight_kg) {
      description = `${description.split('·')[0]}· ${metadata.maximum_weight_kg} kg${routeLabel ? ` · ${routeLabel}` : ''}`;
    }

    result.push({
      provider: 'DUFFEL',
      providerOfferId: offer.id,
      providerServiceId: svc.id,
      ancillaryType: 'EXTRA_CHECKED_BAG',
      passengerId,
      segmentId,
      journeyId: null,
      airportCode: null,
      label,
      description,
      included: false,
      chargeable: amount > 0,
      amount,
      currency: svc.total_currency,
      quantity: 1,
      maxQuantity: svc.maximum_quantity ?? 1,
      rawProviderData: svc,
    });
  }

  return result;
}

/**
 * Extract premium services (Lounge Access, Priority Boarding) from Duffel offer.
 * Only returns services the provider actually offers — no mocks.
 */
export function normalizeDuffelPremiumServices(offer: DuffelOffer): NormalizedAncillary[] {
  const services = offer.available_services;
  if (!services || services.length === 0) return [];

  const result: NormalizedAncillary[] = [];

  for (const svc of services) {
    // Skip baggage (handled separately) and seats
    if (svc.type === 'baggage') continue;

    const detectedType = detectServiceType(svc);
    if (!detectedType) continue; // Unknown service — skip (don't show uncertain items)

    const amount = parseFloat(svc.total_amount);
    if (isNaN(amount)) continue;

    const raw = svc as any;
    const passengerId = raw.passenger_ids?.[0] ?? null;
    const segmentId = raw.segment_ids?.[0] ?? null;
    const isIncluded = amount === 0;

    // Derive airport code from segment if available
    let airportCode: string | null = null;
    if (detectedType === 'LOUNGE_ACCESS' && segmentId) {
      // Try to find origin airport of the segment for lounge display
      for (const slice of offer.slices ?? []) {
        for (const seg of slice.segments ?? []) {
          if (seg.id === segmentId) {
            airportCode = seg.origin?.iata_code ?? null;
            break;
          }
        }
        if (airportCode) break;
      }
    }

    let label: string;
    let description: string;

    switch (detectedType) {
      case 'PRIORITY_BOARDING':
        label = 'Priority Boarding';
        description = 'Board earlier and settle in sooner.';
        break;
      case 'LOUNGE_ACCESS':
        label = airportCode ? `Lounge Access at ${airportCode}` : 'Lounge Access';
        description = 'Relax before your flight with eligible lounge access.';
        break;
      default:
        label = raw.metadata?.name ?? svc.type ?? 'Add-on';
        description = raw.metadata?.description ?? 'Provider add-on service';
    }

    result.push({
      provider: 'DUFFEL',
      providerOfferId: offer.id,
      providerServiceId: svc.id,
      ancillaryType: detectedType,
      passengerId,
      segmentId,
      journeyId: null,
      airportCode,
      label,
      description,
      included: isIncluded,
      chargeable: !isIncluded,
      amount,
      currency: svc.total_currency,
      quantity: 1,
      maxQuantity: svc.maximum_quantity ?? 1,
      rawProviderData: svc,
    });
  }

  return result;
}

/**
 * Combine included + purchasable baggage from a Duffel offer.
 */
export function normalizeDuffelAllBaggage(offer: DuffelOffer): NormalizedAncillary[] {
  return [
    ...normalizeDuffelIncludedBaggage(offer),
    ...normalizeDuffelBagServices(offer),
  ];
}

/**
 * Normalize ALL ancillaries from a Duffel offer (bags + premium services).
 */
export function normalizeDuffelAllAncillaries(offer: DuffelOffer): {
  baggage: NormalizedAncillary[];
  premiumServices: NormalizedAncillary[];
} {
  return {
    baggage: normalizeDuffelAllBaggage(offer),
    premiumServices: normalizeDuffelPremiumServices(offer),
  };
}

// ── Mystifly Normalizer (Stub) ─────────────────────────────────────────────────

/**
 * Mystifly ancillary normalization — stub.
 * Mystifly's demo API has limited ancillary support.
 * Returns empty array until API endpoints are confirmed.
 */
export function normalizeMystiflyAncillaries(_response: any): NormalizedAncillary[] {
  // TODO: Wire up when Mystifly provides ancillary pricing API
  return [];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Sum selected ancillary amounts (no markup applied).
 */
export function sumAncillaryAmount(ancillaries: NormalizedAncillary[]): number {
  return ancillaries
    .filter(a => a.chargeable && !a.included)
    .reduce((sum, a) => sum + a.amount * a.quantity, 0);
}

/**
 * Group ancillaries by type for display.
 */
export function groupByType(
  ancillaries: NormalizedAncillary[],
): Record<AncillaryType, NormalizedAncillary[]> {
  const groups: Record<string, NormalizedAncillary[]> = {};
  for (const a of ancillaries) {
    if (!groups[a.ancillaryType]) groups[a.ancillaryType] = [];
    groups[a.ancillaryType].push(a);
  }
  return groups as Record<AncillaryType, NormalizedAncillary[]>;
}

/** Check if an ancillary is a premium service (lounge/boarding) */
export function isPremiumService(type: AncillaryType): boolean {
  return type === 'LOUNGE_ACCESS' || type === 'PRIORITY_BOARDING';
}
