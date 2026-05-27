// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Shared Utilities
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Extract hour (0-23) from an ISO 8601 timestamp. Returns 12 on parse failure.
 */
export function hourFromIso(iso: string): number {
  try { return new Date(iso).getHours(); }
  catch { return 12; }
}

/**
 * Simple heuristic to determine if a route is international.
 * Uses a known US domestic IATA code set.
 */
const DOMESTIC_US = new Set([
  'ATL','BOS','CLT','DEN','DFW','DTW','EWR','FLL','HNL','IAD','IAH','JFK',
  'LAS','LAX','LGA','MCO','MIA','MSP','ORD','PHL','PHX','SAN','SEA','SFO','SLC','TPA',
  'AUS','BNA','BWI','DAL','HOU','IND','MKE','OAK','PDX','PIT','RDU','SAT','SJC','STL','SMF',
]);

export function isInternationalRoute(depAirport: string, arrAirport: string): boolean {
  const bothUS = DOMESTIC_US.has(depAirport) && DOMESTIC_US.has(arrAirport);
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
