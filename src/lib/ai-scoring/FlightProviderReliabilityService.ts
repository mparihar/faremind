// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Provider Reliability Service
// ═══════════════════════════════════════════════════════════════════════════════
//
// Static defaults for now. Interface designed for future dynamic metrics
// from the database (search success rate, booking success rate, etc.).

import type { ProviderHealthSummary } from './FlightScoringTypes';

const PROVIDER_BASE_SCORES: Record<string, number> = {
  duffel:   95,
  mystifly: 90,
};

/**
 * Get the reliability score for a provider. Returns 0-100.
 * Uses dynamic health metrics when available, falls back to static defaults.
 */
export function getProviderReliabilityScore(
  providerCode: string,
  health?: ProviderHealthSummary,
): number {
  // If we have dynamic health data, compute a weighted score
  if (health) {
    const weights = {
      searchSuccessRate: 0.2,
      revalidationSuccessRate: 0.3,
      bookingSuccessRate: 0.4,
      latency: 0.1,
    };

    let dynamicScore = 0;
    let totalWeight = 0;

    if (health.searchSuccessRate != null) {
      dynamicScore += health.searchSuccessRate * weights.searchSuccessRate;
      totalWeight += weights.searchSuccessRate;
    }
    if (health.revalidationSuccessRate != null) {
      dynamicScore += health.revalidationSuccessRate * weights.revalidationSuccessRate;
      totalWeight += weights.revalidationSuccessRate;
    }
    if (health.bookingSuccessRate != null) {
      dynamicScore += health.bookingSuccessRate * weights.bookingSuccessRate;
      totalWeight += weights.bookingSuccessRate;
    }
    if (health.apiLatencyMs != null) {
      // Latency: 0ms = 100, 5000ms+ = 0
      const latencyScore = Math.max(0, 100 - (health.apiLatencyMs / 50));
      dynamicScore += latencyScore * weights.latency;
      totalWeight += weights.latency;
    }

    if (totalWeight > 0) {
      return Math.round(dynamicScore / totalWeight);
    }
  }

  // Fall back to static base scores
  return PROVIDER_BASE_SCORES[providerCode.toLowerCase()] ?? 80;
}
