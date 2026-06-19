/**
 * Provider Aggregation Service
 *
 * Detects duplicate itineraries across providers (Duffel, Mystifly, etc.)
 * and selects the best provider offer using business rules:
 *   1. Lower total provider fare
 *   2. Better baggage allowance
 *   3. Better cancellation/change rules
 *   4. Deterministic provider priority tie-break
 *
 * This runs BEFORE AI scoring and markup — it operates on raw provider fares.
 *
 * Integration point:
 *   orchestrator.searchFlights() → normalize → aggregateProviderOffers() → mergeAndRankFlights()
 */

import type { UnifiedFlight, AggregationMeta } from '../lib/types';

// ═══════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════

/** Fare difference threshold for considering fares "equal" */
const CLOSE_FARE_THRESHOLD_ABS = 5;     // $5
const CLOSE_FARE_THRESHOLD_PCT = 0.005; // 0.5%

/** Deterministic provider priority (lower index = higher priority) */
const PROVIDER_PRIORITY: string[] = ['duffel', 'mystifly', 'amadeus', 'other'];

// ═══════════════════════════════════════════════
// Aggregation Stats (returned alongside results)
// ═══════════════════════════════════════════════

export interface AggregationStats {
  totalOffersBeforeAggregation: number;
  totalOffersAfterAggregation: number;
  duplicateGroupsFound: number;
}

// ═══════════════════════════════════════════════
// Duplicate Key Builder
// ═══════════════════════════════════════════════

/**
 * Normalize a flight number to a consistent format for comparison.
 *
 * Duffel returns "AA1087" (no space), Mystifly returns "AA 1087" (with space).
 * This strips all whitespace and uppercases to produce "AA1087".
 */
export function normalizeFlightNumber(flightNumber: string): string {
  return flightNumber.replace(/\s+/g, '').toUpperCase();
}

/**
 * Build a stable, deterministic duplicate key for an itinerary.
 *
 * Two offers are considered the same itinerary if they match on:
 * - Trip type (inferred from segment grouping)
 * - Number of segments
 * - Per-segment: airline code, flight number, origin, destination, departure time
 * - Cabin class
 *
 * Key format example:
 *   "OW|1|AA1087-DFW-LHR-2026-07-15T08:30|economy"
 *   "RT|2|AA1087-DFW-LHR-2026-07-15T08:30+BA456-LHR-DFW-2026-07-25T12:10|economy"
 */
export function buildDuplicateKey(flight: UnifiedFlight): string {
  const segments = flight.segments;
  if (!segments || segments.length === 0) return '';

  // Infer trip type from segment structure
  // We can't perfectly determine this without slice info, but we can use
  // the existing flight data — if there's a return direction, it's round-trip
  const segCount = segments.length;

  // Build per-segment keys
  const segmentKeys = segments.map((seg) => {
    const airline = (seg.airline?.code || '').toUpperCase();
    const flightNum = normalizeFlightNumber(seg.flightNumber || '');
    const origin = (seg.departure?.airport || '').toUpperCase();
    const dest = (seg.arrival?.airport || '').toUpperCase();
    // Normalize departure time to minute precision (strip seconds/ms)
    const depTime = normalizeDateTimeToMinute(seg.departure?.time || '');

    // If any critical field is missing, include a fallback to avoid false matches
    if (!airline || !flightNum || !origin || !dest || !depTime) {
      return '';
    }

    return `${flightNum}-${origin}-${dest}-${depTime}`;
  });

  // If any segment key is empty (missing data), return empty to prevent false grouping
  if (segmentKeys.some((k) => k === '')) return '';

  const cabin = (flight.cabinClass || 'economy').toLowerCase();

  return `${segCount}|${segmentKeys.join('+')}|${cabin}`;
}

/**
 * Normalize an ISO datetime string to minute precision.
 * "2026-07-15T08:30:00.000Z" → "2026-07-15T08:30"
 * "2026-07-15T08:30" → "2026-07-15T08:30"
 */
function normalizeDateTimeToMinute(dateTime: string): string {
  if (!dateTime) return '';
  // Take only YYYY-MM-DDTHH:MM
  const match = dateTime.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return match ? match[1] : dateTime.slice(0, 16);
}

// ═══════════════════════════════════════════════
// Scoring Helpers
// ═══════════════════════════════════════════════

/**
 * Compute a baggage score for comparison.
 * Higher score = better baggage allowance.
 *
 * checked bag included = +2
 * cabin bag included = +1
 */
function computeBaggageScore(flight: UnifiedFlight): number {
  const checked = flight.baggage?.checked ?? 0;
  const carryOn = flight.baggage?.carryOn ?? 0;
  return (checked * 2) + (carryOn * 1);
}

/**
 * Compute a fare rules score for comparison.
 * Higher score = better flexibility.
 *
 * refundable = +3
 * cancellationAllowed (same as refundable in current schema) = +2
 * changeable = +2
 * lower cancellation penalty = +1
 * lower change penalty = +1
 */
function computeRulesScore(flight: UnifiedFlight): number {
  const rules = flight.fareRules;
  if (!rules) return 0;

  let score = 0;
  if (rules.refundable) score += 3;
  // In current schema, refundable implies cancellation is allowed
  if (rules.refundable) score += 2;
  if (rules.changeable) score += 2;
  // Lower penalties are better — add bonus for low/zero penalties
  if (rules.cancellationFee !== undefined && rules.cancellationFee !== null) {
    if (rules.cancellationFee === 0) score += 1;
  }
  if (rules.changeFee !== undefined && rules.changeFee !== null) {
    if (rules.changeFee === 0) score += 1;
  }

  return score;
}

/**
 * Check if two fares are "close enough" to be considered equal.
 * Close = within $5 or 0.5% of the higher fare.
 */
function faresAreClose(fareA: number, fareB: number): boolean {
  const diff = Math.abs(fareA - fareB);
  const maxFare = Math.max(fareA, fareB);
  return diff <= CLOSE_FARE_THRESHOLD_ABS || diff <= maxFare * CLOSE_FARE_THRESHOLD_PCT;
}

/**
 * Get deterministic provider priority index (lower = higher priority).
 */
function getProviderPriority(provider: string): number {
  const idx = PROVIDER_PRIORITY.indexOf(provider.toLowerCase());
  return idx >= 0 ? idx : PROVIDER_PRIORITY.length; // Unknown providers get lowest priority
}

// ═══════════════════════════════════════════════
// Best Provider Selection
// ═══════════════════════════════════════════════

interface SelectionResult {
  winner: UnifiedFlight;
  losers: UnifiedFlight[];
  reason: string;
}

/**
 * Select the best provider offer from a group of duplicates.
 *
 * Priority:
 *   1. Lower totalPrice (provider fare)
 *   2. Better baggage (if fares close)
 *   3. Better fare rules (if fares and baggage close)
 *   4. Deterministic provider priority (tie-break)
 */
export function selectBestOffer(offers: UnifiedFlight[]): SelectionResult {
  if (offers.length === 1) {
    return { winner: offers[0], losers: [], reason: 'Only offer in group' };
  }

  // Sort by price ascending first
  const sorted = [...offers].sort((a, b) => a.totalPrice - b.totalPrice);
  const cheapest = sorted[0];
  const secondCheapest = sorted[1];

  // ── Priority 1: Lower fare ──
  if (!faresAreClose(cheapest.totalPrice, secondCheapest.totalPrice)) {
    const losers = sorted.slice(1);
    return {
      winner: cheapest,
      losers,
      reason: `Selected ${cheapest.provider} — lower provider fare ($${cheapest.totalPrice} vs $${secondCheapest.totalPrice})`,
    };
  }

  // ── Fares are close — Priority 2: Better baggage ──
  const withBaggageScores = sorted.map((offer) => ({
    offer,
    baggageScore: computeBaggageScore(offer),
  }));
  withBaggageScores.sort((a, b) => b.baggageScore - a.baggageScore);

  const bestBaggage = withBaggageScores[0];
  const secondBestBaggage = withBaggageScores[1];

  if (bestBaggage.baggageScore > secondBestBaggage.baggageScore) {
    const losers = withBaggageScores.slice(1).map((x) => x.offer);
    return {
      winner: bestBaggage.offer,
      losers,
      reason: `Selected ${bestBaggage.offer.provider} — better baggage allowance (score ${bestBaggage.baggageScore} vs ${secondBestBaggage.baggageScore})`,
    };
  }

  // ── Baggage equal — Priority 3: Better rules ──
  const withRulesScores = sorted.map((offer) => ({
    offer,
    rulesScore: computeRulesScore(offer),
  }));
  withRulesScores.sort((a, b) => b.rulesScore - a.rulesScore);

  const bestRules = withRulesScores[0];
  const secondBestRules = withRulesScores[1];

  if (bestRules.rulesScore > secondBestRules.rulesScore) {
    const losers = withRulesScores.slice(1).map((x) => x.offer);
    return {
      winner: bestRules.offer,
      losers,
      reason: `Selected ${bestRules.offer.provider} — better cancellation/change rules (score ${bestRules.rulesScore} vs ${secondBestRules.rulesScore})`,
    };
  }

  // ── All equal — Priority 4: Deterministic provider priority ──
  const byPriority = [...sorted].sort(
    (a, b) => getProviderPriority(a.provider) - getProviderPriority(b.provider)
  );

  return {
    winner: byPriority[0],
    losers: byPriority.slice(1),
    reason: `Selected ${byPriority[0].provider} — deterministic provider priority (fare, baggage, and rules equal)`,
  };
}

// ═══════════════════════════════════════════════
// Main Aggregation Entry Point
// ═══════════════════════════════════════════════

export interface AggregationResult {
  flights: UnifiedFlight[];
  stats: AggregationStats;
}

/**
 * Aggregate provider offers: detect duplicates and select the best provider
 * for each unique itinerary.
 *
 * - Groups flights by duplicate key
 * - For groups with 1 offer: pass through unchanged
 * - For groups with 2+ offers: select best, attach aggregation metadata to winner
 * - Flights with missing key data are never grouped (kept as separate offers)
 *
 * Returns the de-duplicated array of UnifiedFlight with aggregation metadata attached
 * to winners from duplicate groups.
 */
export function aggregateProviderOffers(flights: UnifiedFlight[]): AggregationResult {
  if (flights.length === 0) {
    return { flights: [], stats: { totalOffersBeforeAggregation: 0, totalOffersAfterAggregation: 0, duplicateGroupsFound: 0 } };
  }

  const totalBefore = flights.length;

  // Group by duplicate key
  const groups = new Map<string, UnifiedFlight[]>();
  const ungrouped: UnifiedFlight[] = []; // Flights with empty/missing key data

  for (const flight of flights) {
    const key = buildDuplicateKey(flight);
    if (!key) {
      // Missing critical fields — don't risk grouping, keep as separate offer
      ungrouped.push(flight);
      continue;
    }

    const existing = groups.get(key);
    if (existing) {
      existing.push(flight);
    } else {
      groups.set(key, [flight]);
    }
  }

  const result: UnifiedFlight[] = [];
  let duplicateGroupsFound = 0;

  for (const [key, group] of groups) {
    if (group.length === 1) {
      // Unique itinerary — pass through
      result.push(group[0]);
      continue;
    }

    // Duplicate group — select best
    duplicateGroupsFound++;
    const { winner, losers, reason } = selectBestOffer(group);

    // Build fare map for all providers in this group
    const duplicateProviderFares: Record<string, number> = {};
    for (const offer of group) {
      duplicateProviderFares[offer.provider] = offer.totalPrice;
    }

    // Attach aggregation metadata to the winner
    const meta: AggregationMeta = {
      duplicateKey: key,
      selectedProvider: winner.provider,
      duplicateProviders: losers.map((l) => l.provider),
      selectionReason: reason,
      duplicateOfferIds: losers.map((l) => l.providerOfferId),
      selectedProviderFare: winner.totalPrice,
      duplicateProviderFares,
    };

    winner.aggregationMeta = meta;

    console.log(
      `[Aggregation] Duplicate group (${group.length} offers): ${key} → ${reason}`
    );

    result.push(winner);
  }

  // Add ungrouped flights (those with missing key fields)
  result.push(...ungrouped);

  const stats: AggregationStats = {
    totalOffersBeforeAggregation: totalBefore,
    totalOffersAfterAggregation: result.length,
    duplicateGroupsFound,
  };

  if (duplicateGroupsFound > 0) {
    console.log(
      `[Aggregation] Summary: ${totalBefore} offers → ${result.length} after dedup (${duplicateGroupsFound} duplicate groups resolved)`
    );
  }

  return { flights: result, stats };
}
