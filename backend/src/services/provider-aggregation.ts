/**
 * Provider Aggregation Service
 *
 * Collects, normalizes, and merges all provider flight offers into
 * FareMind's unified inventory using APPEND-ONLY aggregation.
 *
 * NO offers are filtered, deduplicated, or removed during aggregation.
 * If Duffel and Mystifly both return the same itinerary, both are kept
 * because provider price, fare rules, baggage, ancillaries, and booking
 * behavior may differ.
 *
 * All scoring, labeling, ranking, sorting, AI recommendations, and
 * DNA Search happen AFTER aggregation and are not affected by this layer.
 *
 * Integration point:
 *   orchestrator.searchFlights() → normalize → aggregateProviderOffers() → mergeAndRankFlights()
 */

import type { UnifiedFlight } from '../lib/types';

// ═══════════════════════════════════════════════
// Aggregation Stats (returned alongside results)
// ═══════════════════════════════════════════════

export interface AggregationStats {
  totalOffersBeforeAggregation: number;
  totalOffersAfterAggregation: number;
  /** Always 0 — no duplicate removal in APPEND_ALL mode */
  duplicateGroupsFound: number;
  aggregationMode: 'APPEND_ALL';
  providerCounts: Record<string, number>;
}

// ═══════════════════════════════════════════════
// Utility Functions (kept for potential future use)
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
 * Build a stable, deterministic key for an itinerary.
 *
 * NOTE: This is kept as a utility for potential future visual grouping.
 * It is NOT used for deduplication or offer removal.
 */
export function buildDuplicateKey(flight: UnifiedFlight): string {
  const segments = flight.segments;
  if (!segments || segments.length === 0) return '';

  const segmentKeys = segments.map((seg) => {
    const flightNum = normalizeFlightNumber(seg.flightNumber || '');
    const origin = (seg.departure?.airport || '').toUpperCase();
    const dest = (seg.arrival?.airport || '').toUpperCase();
    const depTime = normalizeDateTimeToMinute(seg.departure?.time || '');

    if (!flightNum || !origin || !dest || !depTime) return '';
    return `${flightNum}-${origin}-${dest}-${depTime}`;
  });

  if (segmentKeys.some((k) => k === '')) return '';

  const cabin = (flight.cabinClass || 'economy').toLowerCase();
  return `${segments.length}|${segmentKeys.join('+')}|${cabin}`;
}

/**
 * Normalize an ISO datetime string to minute precision.
 */
function normalizeDateTimeToMinute(dateTime: string): string {
  if (!dateTime) return '';
  const match = dateTime.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return match ? match[1] : dateTime.slice(0, 16);
}

// ═══════════════════════════════════════════════
// Main Aggregation Entry Point
// ═══════════════════════════════════════════════

export interface AggregationResult {
  flights: UnifiedFlight[];
  stats: AggregationStats;
}

/**
 * Aggregate provider offers using APPEND-ONLY strategy.
 *
 * - Accepts all normalized flights from all providers
 * - Appends every offer to the unified inventory without filtering
 * - Does NOT group, deduplicate, or select winners
 * - Preserves each offer's provider identity (provider, providerOfferId)
 * - Logs per-provider counts for audit
 *
 * The downstream scoring/ranking pipeline handles presentation order.
 */
export function aggregateProviderOffers(flights: UnifiedFlight[]): AggregationResult {
  const totalBefore = flights.length;

  // Count offers per provider for audit logging
  const providerCounts: Record<string, number> = {};
  for (const flight of flights) {
    const p = flight.provider || 'unknown';
    providerCounts[p] = (providerCounts[p] || 0) + 1;
  }

  const stats: AggregationStats = {
    totalOffersBeforeAggregation: totalBefore,
    totalOffersAfterAggregation: totalBefore,
    duplicateGroupsFound: 0,
    aggregationMode: 'APPEND_ALL',
    providerCounts,
  };

  // Log aggregation summary
  const providerSummary = Object.entries(providerCounts)
    .map(([provider, count]) => `${provider}: ${count}`)
    .join(', ');

  console.log(
    `[Aggregation] APPEND_ALL: ${totalBefore} total offers (${providerSummary})`
  );

  // Return ALL flights — no filtering, no dedup, no winner selection
  return { flights: [...flights], stats };
}
