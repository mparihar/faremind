// ─── Weight Presets ───────────────────────────────────────────────────────────
//
// Configurable weight presets for the 8-component scoring formula.
// Total weights MUST sum to 1.00 for each preset.
//
// These can be overridden from admin settings in the future.

import type { WeightPreset, WeightPresetName } from './types';

// ── Round-Trip Weight Presets ─────────────────────────────────────────────────

export const WEIGHT_PRESETS: Record<WeightPresetName, WeightPreset> = {
  /**
   * Default holistic ranking — balanced across all factors.
   * Price is most important but not dominant.
   */
  best_ai_pick: {
    price:               0.35,
    duration:            0.22,
    stops:               0.15,
    layover:             0.10,
    schedule:            0.08,
    baggage:             0.04,
    fareFlexibility:     0.03,
    providerReliability: 0.03,
  },

  /**
   * Price-heavy — for users who care primarily about saving money.
   */
  cheapest: {
    price:               0.55,
    duration:            0.15,
    stops:               0.10,
    layover:             0.07,
    schedule:            0.05,
    baggage:             0.03,
    fareFlexibility:     0.03,
    providerReliability: 0.02,
  },

  /**
   * Speed-heavy — for users who want the shortest total travel time.
   */
  fastest: {
    price:               0.20,
    duration:            0.40,
    stops:               0.18,
    layover:             0.10,
    schedule:            0.05,
    baggage:             0.03,
    fareFlexibility:     0.02,
    providerReliability: 0.02,
  },

  /**
   * Stops-heavy — for users who want minimal connections.
   */
  fewest_stops: {
    price:               0.25,
    duration:            0.18,
    stops:               0.35,
    layover:             0.08,
    schedule:            0.06,
    baggage:             0.03,
    fareFlexibility:     0.03,
    providerReliability: 0.02,
  },

  /**
   * Flexibility-heavy — for users who want refundable/changeable fares.
   */
  flexible_fare: {
    price:               0.25,
    duration:            0.18,
    stops:               0.12,
    layover:             0.08,
    schedule:            0.07,
    baggage:             0.05,
    fareFlexibility:     0.22,
    providerReliability: 0.03,
  },

  /**
   * Best Value — price + speed emphasis.
   */
  best_value: {
    price:               0.42,
    duration:            0.25,
    stops:               0.15,
    layover:             0.08,
    schedule:            0.04,
    baggage:             0.03,
    fareFlexibility:     0.02,
    providerReliability: 0.01,
  },
};

// ── International Weight Presets ──────────────────────────────────────────────
//
// International flights: duration and layover quality matter more.
// Stops matter less (1–2 stops is normal on international routes).
// Baggage and fare flexibility are more important.

export const INTERNATIONAL_WEIGHT_PRESETS: Record<WeightPresetName, WeightPreset> = {
  best_ai_pick: {
    price:               0.30,
    duration:            0.28,
    stops:               0.10,
    layover:             0.12,
    schedule:            0.08,
    baggage:             0.05,
    fareFlexibility:     0.04,
    providerReliability: 0.03,
  },

  cheapest: {
    price:               0.50,
    duration:            0.18,
    stops:               0.08,
    layover:             0.09,
    schedule:            0.05,
    baggage:             0.04,
    fareFlexibility:     0.04,
    providerReliability: 0.02,
  },

  fastest: {
    price:               0.18,
    duration:            0.42,
    stops:               0.12,
    layover:             0.12,
    schedule:            0.06,
    baggage:             0.04,
    fareFlexibility:     0.03,
    providerReliability: 0.03,
  },

  fewest_stops: {
    price:               0.22,
    duration:            0.20,
    stops:               0.30,
    layover:             0.10,
    schedule:            0.06,
    baggage:             0.04,
    fareFlexibility:     0.05,
    providerReliability: 0.03,
  },

  flexible_fare: {
    price:               0.22,
    duration:            0.20,
    stops:               0.08,
    layover:             0.10,
    schedule:            0.07,
    baggage:             0.06,
    fareFlexibility:     0.24,
    providerReliability: 0.03,
  },

  best_value: {
    price:               0.38,
    duration:            0.28,
    stops:               0.12,
    layover:             0.10,
    schedule:            0.04,
    baggage:             0.04,
    fareFlexibility:     0.03,
    providerReliability: 0.01,
  },
};

// ── One-Way Weight Presets ────────────────────────────────────────────────────
//
// One-way flights: users care more about price and duration since
// there is no return-leg complexity.

export const ONE_WAY_WEIGHT_PRESETS: Record<WeightPresetName, WeightPreset> = {
  best_ai_pick: {
    price:               0.38,
    duration:            0.24,
    stops:               0.16,
    layover:             0.09,
    schedule:            0.06,
    baggage:             0.03,
    fareFlexibility:     0.02,
    providerReliability: 0.02,
  },

  cheapest: {
    price:               0.60,
    duration:            0.14,
    stops:               0.10,
    layover:             0.06,
    schedule:            0.04,
    baggage:             0.02,
    fareFlexibility:     0.02,
    providerReliability: 0.02,
  },

  fastest: {
    price:               0.22,
    duration:            0.42,
    stops:               0.16,
    layover:             0.08,
    schedule:            0.05,
    baggage:             0.03,
    fareFlexibility:     0.02,
    providerReliability: 0.02,
  },

  fewest_stops: {
    price:               0.25,
    duration:            0.18,
    stops:               0.38,
    layover:             0.08,
    schedule:            0.05,
    baggage:             0.02,
    fareFlexibility:     0.02,
    providerReliability: 0.02,
  },

  flexible_fare: {
    price:               0.28,
    duration:            0.18,
    stops:               0.12,
    layover:             0.07,
    schedule:            0.05,
    baggage:             0.05,
    fareFlexibility:     0.23,
    providerReliability: 0.02,
  },

  best_value: {
    price:               0.42,
    duration:            0.25,
    stops:               0.15,
    layover:             0.08,
    schedule:            0.04,
    baggage:             0.03,
    fareFlexibility:     0.02,
    providerReliability: 0.01,
  },
};

/**
 * Resolve a preset name to its weight values.
 * Falls back to best_ai_pick if the name is unknown.
 *
 * For international routes, uses INTERNATIONAL_WEIGHT_PRESETS which
 * prioritize duration and layover quality over stops count.
 *
 * @param preset - The weight preset name
 * @param tripType - 'one_way' or 'round_trip' (defaults to round_trip for backward compat)
 * @param isInternational - Whether the route is international
 */
export function getWeights(
  preset?: WeightPresetName | null,
  tripType?: 'one_way' | 'round_trip',
  isInternational?: boolean,
): WeightPreset {
  const presetName = preset ?? 'best_ai_pick';

  // International routes use international-specific weights
  if (isInternational) {
    return INTERNATIONAL_WEIGHT_PRESETS[presetName] ?? INTERNATIONAL_WEIGHT_PRESETS.best_ai_pick;
  }

  const presets = tripType === 'one_way' ? ONE_WAY_WEIGHT_PRESETS : WEIGHT_PRESETS;
  return presets[presetName] ?? presets.best_ai_pick;
}
