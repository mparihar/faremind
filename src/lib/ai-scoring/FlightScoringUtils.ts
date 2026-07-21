// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Shared Utilities
// ═══════════════════════════════════════════════════════════════════════════════

import { AIRPORTS } from '@/data/airports';

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Extract the local (airport wall-clock) hour (0-23) from a provider timestamp.
 *
 * Providers (Duffel / Amadeus / Mystifly) emit LOCAL airport time. We read the
 * hour directly from the string's time component so the result is independent of
 * the server timezone and robust to offset-bearing strings ("…T09:00+05:30" → 9).
 * `new Date(iso).getHours()` is avoided because it re-projects into the server's
 * timezone, which corrupts red-eye / early-departure / late-arrival scoring when
 * the runtime is not in the airport's zone (e.g. Railway runs in UTC).
 *
 * Returns 12 (neutral midday) on parse failure.
 */
export function hourFromIso(iso: string): number {
  if (!iso) return 12;
  // Prefer the wall-clock hour encoded in the string (HH right after the "T").
  const m = /T(\d{2}):/.exec(iso);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h >= 0 && h <= 23) return h;
  }
  // Fallback for non-standard strings.
  try {
    const h = new Date(iso).getHours();
    return Number.isFinite(h) ? h : 12;
  } catch {
    return 12;
  }
}

// ── International detection ───────────────────────────────────────────────────
//
// A route is international when the departure and arrival airports are in
// different countries. Country is resolved from the shared AIRPORTS dataset,
// so non-US domestic markets (e.g. DEL↔BOM in India, LHR↔EDI in the UK) are
// correctly treated as DOMESTIC — unlike the old US-only heuristic, which
// misclassified every non-US domestic trip as international.

const AIRPORT_COUNTRY: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const a of AIRPORTS) {
    if (a.code && a.country) map[a.code.toUpperCase()] = a.country;
  }
  return map;
})();

// Fallback US domestic set — used only when an airport is absent from the
// AIRPORTS dataset and its country therefore cannot be resolved.
const DOMESTIC_US_FALLBACK = new Set([
  'ATL','BOS','CLT','DEN','DFW','DTW','EWR','FLL','HNL','IAD','IAH','JFK',
  'LAS','LAX','LGA','MCO','MIA','MSP','ORD','PHL','PHX','SAN','SEA','SFO','SLC','TPA',
  'AUS','BNA','BWI','DAL','HOU','IND','MKE','OAK','PDX','PIT','RDU','SAT','SJC','STL','SMF',
]);

export function isInternationalRoute(depAirport: string, arrAirport: string): boolean {
  const dep = (depAirport || '').toUpperCase();
  const arr = (arrAirport || '').toUpperCase();

  const depCountry = AIRPORT_COUNTRY[dep];
  const arrCountry = AIRPORT_COUNTRY[arr];

  // Preferred path: both airports known → international iff countries differ.
  if (depCountry && arrCountry) return depCountry !== arrCountry;

  // Fallback path: at least one airport is missing country data. Treat a
  // known US↔US pair as domestic; anything else as international (conservative
  // — applies the larger baggage buffer and looser stop tolerance).
  const bothUS = DOMESTIC_US_FALLBACK.has(dep) && DOMESTIC_US_FALLBACK.has(arr);
  return !bothUS;
}

/**
 * Compute the value at a given percentile (0-100) using linear interpolation.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Normalize a value within a percentile-clipped range.
 * Returns 0-1 where 1 = best (lowest for price/duration).
 */
export function clippedNorm(value: number, p5: number, p95: number): number {
  if (p95 <= p5) return 0.5;
  const clamped = Math.max(p5, Math.min(p95, value));
  return (p95 - clamped) / (p95 - p5);
}
