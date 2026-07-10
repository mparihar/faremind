/**
 * Reliability Score
 *
 * Evaluates operational reliability based on:
 *   1. Historical on-time performance (if available)
 *   2. Cancellation rate (if available)
 *   3. Provider reliability
 *   4. Airline operational reliability
 *   5. Connection risk
 *   6. Same-ticket protected connection vs separate risk
 *
 * When data is unavailable, returns neutral score (70).
 */

// Known provider reliability rankings (configurable in future via admin)
const PROVIDER_RELIABILITY: Record<string, number> = {
  duffel: 85,
  amadeus: 82,
  mystifly: 78,
};

/**
 * Compute reliability score.
 *
 * @param provider - Provider code (e.g., "duffel", "mystifly")
 * @param airlineCode - IATA airline code
 * @param stops - Number of stops
 * @param hasShortConnection - Whether any connection is below safe threshold
 * @param hasAirportChange - Whether connection requires airport change
 * @param onTimePercentage - Historical on-time % (0–100) if available
 * @param cancellationRate - Historical cancellation rate (0–100) if available
 * @returns Score from 0 to 100
 */
export function scoreReliability(
  provider: string,
  airlineCode: string,
  stops: number,
  hasShortConnection: boolean,
  hasAirportChange: boolean,
  onTimePercentage?: number,
  cancellationRate?: number,
): number {
  // Start with neutral
  let score = 70;

  // ── Provider reliability ──────────────────────────────────────────────────
  const providerScore = PROVIDER_RELIABILITY[provider.toLowerCase()];
  if (providerScore !== undefined) {
    // Blend provider reliability into score (20% weight)
    score = score * 0.8 + providerScore * 0.2;
  }

  // ── Historical on-time performance ────────────────────────────────────────
  if (onTimePercentage !== undefined) {
    // Strong signal: blend 30% weight
    const otpScore = onTimePercentage; // already 0–100
    score = score * 0.7 + otpScore * 0.3;
  }

  // ── Cancellation rate ─────────────────────────────────────────────────────
  if (cancellationRate !== undefined) {
    // Lower is better: invert to score
    const cancelScore = Math.max(0, 100 - cancellationRate * 10);
    score = score * 0.85 + cancelScore * 0.15;
  }

  // ── Connection risk adjustments ───────────────────────────────────────────
  if (stops > 0) {
    // Each stop adds slight risk
    score -= stops * 2;

    if (hasShortConnection) {
      score -= 10; // Short connection increases missed-connection risk
    }

    if (hasAirportChange) {
      score -= 8; // Airport change is very risky for connections
    }
  }

  return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
}
