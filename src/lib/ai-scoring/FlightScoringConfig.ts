// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Configuration
// ═══════════════════════════════════════════════════════════════════════════════
//
// Trip-type-specific weights, modes, and constants.
// One config object per trip type controls how features are extracted
// and how the 8 scoring dimensions are weighted.

import type { ScoreWeights, ScoringTripType, ScoringMode, ScoringUserPreferences } from './FlightScoringTypes';

// ── Duration / Stops / Baggage / Schedule / Warning Modes ────────────────────

export type DurationMode = 'OUTBOUND_ONLY' | 'OUTBOUND_PLUS_RETURN';
export type StopsMode    = 'OUTBOUND_ONLY' | 'OUTBOUND_PLUS_RETURN';
export type BaggageMode  = 'OUTBOUND_ONLY' | 'FULL_ITINERARY';
export type ScheduleMode = 'OUTBOUND_ONLY' | 'OUTBOUND_AND_RETURN';
export type WarningMode  = 'SINGLE_JOURNEY' | 'CUSTOMER_IMPACT_FULL_TRIP';

// ── Trip-Type Configuration ──────────────────────────────────────────────────

export interface TripTypeConfig {
  weights: ScoreWeights;
  durationMode: DurationMode;
  stopsMode: StopsMode;
  baggageMode: BaggageMode;
  scheduleMode: ScheduleMode;
  warningMode: WarningMode;
}

export const FLIGHT_SCORING_CONFIG: Record<ScoringTripType, TripTypeConfig> = {
  ONE_WAY: {
    weights: {
      effectivePriceScore:      0.36,
      durationScore:            0.23,
      stopsScore:               0.15,
      baggageValueScore:        0.10,
      layoverScore:             0.07,
      scheduleScore:            0.04,
      fareFlexibilityScore:     0.03,
      providerReliabilityScore: 0.02,
    },
    durationMode: 'OUTBOUND_ONLY',
    stopsMode:    'OUTBOUND_ONLY',
    baggageMode:  'OUTBOUND_ONLY',
    scheduleMode: 'OUTBOUND_ONLY',
    warningMode:  'SINGLE_JOURNEY',
  },

  ROUND_TRIP: {
    weights: {
      effectivePriceScore:      0.34,
      durationScore:            0.21,
      stopsScore:               0.14,
      baggageValueScore:        0.11,
      layoverScore:             0.08,
      scheduleScore:            0.05,
      fareFlexibilityScore:     0.04,
      providerReliabilityScore: 0.03,
    },
    durationMode: 'OUTBOUND_PLUS_RETURN',
    stopsMode:    'OUTBOUND_PLUS_RETURN',
    baggageMode:  'FULL_ITINERARY',
    scheduleMode: 'OUTBOUND_AND_RETURN',
    warningMode:  'CUSTOMER_IMPACT_FULL_TRIP',
  },

  MULTI_CITY: {
    // Future: use round-trip weights as baseline
    weights: {
      effectivePriceScore:      0.34,
      durationScore:            0.21,
      stopsScore:               0.14,
      baggageValueScore:        0.11,
      layoverScore:             0.08,
      scheduleScore:            0.05,
      fareFlexibilityScore:     0.04,
      providerReliabilityScore: 0.03,
    },
    durationMode: 'OUTBOUND_PLUS_RETURN',
    stopsMode:    'OUTBOUND_PLUS_RETURN',
    baggageMode:  'FULL_ITINERARY',
    scheduleMode: 'OUTBOUND_AND_RETURN',
    warningMode:  'CUSTOMER_IMPACT_FULL_TRIP',
  },
};

// ── User Preference Weight Adjustments ───────────────────────────────────────
//
// These multipliers are applied on top of the trip-type base weights
// to shift emphasis based on what the user cares about.

export interface WeightAdjustment {
  effectivePriceScore?: number;
  durationScore?: number;
  stopsScore?: number;
  baggageValueScore?: number;
  layoverScore?: number;
  scheduleScore?: number;
  fareFlexibilityScore?: number;
  providerReliabilityScore?: number;
}

const MODE_ADJUSTMENTS: Record<ScoringMode, WeightAdjustment> = {
  AI_PICK: {},  // use base weights
  BEST_VALUE: {
    effectivePriceScore: 1.2,
    durationScore: 1.1,
  },
  CHEAPEST: {
    effectivePriceScore: 1.6,
    durationScore: 0.7,
    stopsScore: 0.7,
    baggageValueScore: 0.6,
  },
  FASTEST: {
    effectivePriceScore: 0.6,
    durationScore: 1.8,
    stopsScore: 1.2,
    layoverScore: 1.1,
  },
  FEWEST_STOPS: {
    stopsScore: 2.3,
    layoverScore: 0.6,
    effectivePriceScore: 0.7,
  },
  COMFORT: {
    stopsScore: 1.4,
    layoverScore: 1.5,
    scheduleScore: 1.5,
    baggageValueScore: 1.4,
    effectivePriceScore: 0.6,
  },
  FAMILY: {
    baggageValueScore: 1.8,
    layoverScore: 1.6,
    scheduleScore: 1.5,
    stopsScore: 1.3,
    effectivePriceScore: 0.7,
  },
  ELDERLY: {
    stopsScore: 1.8,
    layoverScore: 1.7,
    scheduleScore: 1.6,
    baggageValueScore: 1.3,
    effectivePriceScore: 0.7,
    durationScore: 1.2,
  },
  FLEXIBLE_FARE: {
    fareFlexibilityScore: 3.0,
    effectivePriceScore: 0.7,
    durationScore: 0.8,
  },
};

// ── International Weight Overrides ───────────────────────────────────────────
//
// International flights differ fundamentally from domestic:
//   - 1–2 stops is standard (stops less penalised)
//   - Duration varies hugely (16h vs 30h+) — high impact on traveler experience
//   - Layover quality matters more (long layovers, overnight connections)
//   - Baggage is critical (no checked bag on intl = surprise fees)
//   - Fare flexibility more valued (expensive tickets, date uncertainty)
//
// These base weights are used instead of the domestic ones when the route
// is detected as international. Mode adjustments still apply on top.

const INTERNATIONAL_BASE_WEIGHTS: Record<'ONE_WAY' | 'ROUND_TRIP', ScoreWeights> = {
  ONE_WAY: {
    // International OW: same price-dominant philosophy as RT.
    effectivePriceScore:      0.35,
    durationScore:            0.21,
    stopsScore:               0.10,
    baggageValueScore:        0.12,
    layoverScore:             0.10,
    scheduleScore:            0.04,
    fareFlexibilityScore:     0.05,
    providerReliabilityScore: 0.03,
  },
  ROUND_TRIP: {
    // International RT: price dominates — travelers expect long durations,
    // saving $500-1000 on a $2000+ ticket outweighs 10-15h extra travel.
    effectivePriceScore:      0.35,
    durationScore:            0.19,
    stopsScore:               0.10,
    baggageValueScore:        0.13,
    layoverScore:             0.10,
    scheduleScore:            0.05,
    fareFlexibilityScore:     0.05,
    providerReliabilityScore: 0.03,
  },
};

/**
 * Compute adjusted weights by applying the user's scoring mode
 * on top of the trip-type base weights. The result is re-normalized
 * to sum to 1.0.
 *
 * For international routes, uses INTERNATIONAL_BASE_WEIGHTS which
 * boost duration/layover/baggage and reduce stops penalty.
 *
 * PRICE FLOOR ENFORCEMENT:
 * After normalization, if the effective price weight falls below
 * MIN_PRICE_WEIGHT_FRACTION, it is raised to the minimum and
 * excess is redistributed proportionally from other dimensions.
 * This guarantees lower fares always have significant influence
 * regardless of which scoring mode is active.
 */
export function getAdjustedWeights(
  tripType: ScoringTripType,
  prefs?: ScoringUserPreferences | null,
  isInternational?: boolean,
): ScoreWeights {
  // Select base weights: international or domestic
  let base: ScoreWeights;
  if (isInternational && (tripType === 'ONE_WAY' || tripType === 'ROUND_TRIP')) {
    base = { ...INTERNATIONAL_BASE_WEIGHTS[tripType] };
  } else {
    base = { ...FLIGHT_SCORING_CONFIG[tripType].weights };
  }

  const mode = prefs?.mode ?? 'AI_PICK';
  const adj = MODE_ADJUSTMENTS[mode] ?? {};

  // Apply multipliers
  const raw: ScoreWeights = {
    effectivePriceScore:      base.effectivePriceScore      * (adj.effectivePriceScore ?? 1),
    durationScore:            base.durationScore            * (adj.durationScore ?? 1),
    stopsScore:               base.stopsScore               * (adj.stopsScore ?? 1),
    baggageValueScore:        base.baggageValueScore        * (adj.baggageValueScore ?? 1),
    layoverScore:             base.layoverScore             * (adj.layoverScore ?? 1),
    scheduleScore:            base.scheduleScore            * (adj.scheduleScore ?? 1),
    fareFlexibilityScore:     base.fareFlexibilityScore     * (adj.fareFlexibilityScore ?? 1),
    providerReliabilityScore: base.providerReliabilityScore * (adj.providerReliabilityScore ?? 1),
  };

  // Normalize to sum = 1.0
  const sum =
    raw.effectivePriceScore + raw.durationScore + raw.stopsScore +
    raw.baggageValueScore + raw.layoverScore + raw.scheduleScore +
    raw.fareFlexibilityScore + raw.providerReliabilityScore;

  if (sum <= 0) return base; // safety

  let normalized: ScoreWeights = {
    effectivePriceScore:      raw.effectivePriceScore / sum,
    durationScore:            raw.durationScore / sum,
    stopsScore:               raw.stopsScore / sum,
    baggageValueScore:        raw.baggageValueScore / sum,
    layoverScore:             raw.layoverScore / sum,
    scheduleScore:            raw.scheduleScore / sum,
    fareFlexibilityScore:     raw.fareFlexibilityScore / sum,
    providerReliabilityScore: raw.providerReliabilityScore / sum,
  };

  // ── Price Weight Floor Enforcement ────────────────────────────────────────
  // If the normalized price weight fell below the minimum, raise it and
  // proportionally redistribute the excess from non-price dimensions.
  if (normalized.effectivePriceScore < MIN_PRICE_WEIGHT_FRACTION) {
    const deficit = MIN_PRICE_WEIGHT_FRACTION - normalized.effectivePriceScore;
    const nonPriceSum =
      normalized.durationScore + normalized.stopsScore +
      normalized.baggageValueScore + normalized.layoverScore +
      normalized.scheduleScore + normalized.fareFlexibilityScore +
      normalized.providerReliabilityScore;

    if (nonPriceSum > 0) {
      const scale = (nonPriceSum - deficit) / nonPriceSum;
      normalized = {
        effectivePriceScore:      MIN_PRICE_WEIGHT_FRACTION,
        durationScore:            normalized.durationScore * scale,
        stopsScore:               normalized.stopsScore * scale,
        baggageValueScore:        normalized.baggageValueScore * scale,
        layoverScore:             normalized.layoverScore * scale,
        scheduleScore:            normalized.scheduleScore * scale,
        fareFlexibilityScore:     normalized.fareFlexibilityScore * scale,
        providerReliabilityScore: normalized.providerReliabilityScore * scale,
      };
    }
  }

  return normalized;
}

// ── Negative Penalty Map ─────────────────────────────────────────────────────

export interface PenaltyDef {
  severity: 'MINOR' | 'MEDIUM' | 'MAJOR' | 'CRITICAL';
  points: number;
}

export const NEGATIVE_PENALTY_MAP: Record<string, PenaltyDef> = {
  // Price
  SLIGHTLY_HIGHER_PRICE:           { severity: 'MINOR',    points: 1.5 },
  HIGHER_THAN_COMPARABLE:          { severity: 'MINOR',    points: 2   },
  MUCH_HIGHER_THAN_COMPARABLE:     { severity: 'MEDIUM',   points: 4   },

  // Baggage
  BAGGAGE_UNCLEAR:                 { severity: 'MINOR',    points: 1.5 },
  NO_CHECKED_BAG_DOMESTIC:         { severity: 'MEDIUM',   points: 3   },
  NO_CHECKED_BAG_INTERNATIONAL:    { severity: 'MEDIUM',   points: 5   },
  PAID_BAGGAGE_ONLY:               { severity: 'MEDIUM',   points: 4   },

  // Stops
  ONE_STOP_WHEN_NONSTOP_EXISTS:    { severity: 'MINOR',    points: 1.5 },
  TWO_CONNECTIONS:                 { severity: 'MEDIUM',   points: 4   },
  THREE_OR_MORE_CONNECTIONS:       { severity: 'MAJOR',    points: 7   },

  // Duration
  SLIGHTLY_LONGER_THAN_FASTEST:    { severity: 'MINOR',    points: 1.5 },
  LONGER_THAN_FASTEST:             { severity: 'MEDIUM',   points: 3.5 },
  SIGNIFICANTLY_LONGER_DURATION:   { severity: 'MAJOR',    points: 6   },
  EXTREME_DURATION:                { severity: 'MAJOR',    points: 9   },

  // Layover
  SLIGHTLY_LONG_LAYOVER:           { severity: 'MINOR',    points: 2   },
  LONG_LAYOVER:                    { severity: 'MEDIUM',   points: 4   },
  OVERNIGHT_LAYOVER:               { severity: 'MAJOR',    points: 7   },
  TIGHT_CONNECTION:                { severity: 'CRITICAL', points: 14  },
  AIRPORT_CHANGE:                  { severity: 'CRITICAL', points: 15  },
  SELF_TRANSFER:                   { severity: 'CRITICAL', points: 16  },

  // Fare rules
  NON_REFUNDABLE:                  { severity: 'MEDIUM',   points: 3   },
  NON_CHANGEABLE:                  { severity: 'MEDIUM',   points: 3   },
  NON_REFUNDABLE_NON_CHANGEABLE:   { severity: 'MAJOR',    points: 6   },
  FARE_RULES_UNKNOWN:              { severity: 'MINOR',    points: 1.5 },

  // Schedule
  EARLY_MORNING_DEPARTURE:         { severity: 'MINOR',    points: 1.5 },
  LATE_NIGHT_ARRIVAL:              { severity: 'MINOR',    points: 2   },
  VERY_INCONVENIENT_TIME:          { severity: 'MEDIUM',   points: 4   },

  // Provider
  PROVIDER_REVALIDATION_RISK:      { severity: 'CRITICAL', points: 15  },
  LOW_DATA_CONFIDENCE:             { severity: 'MEDIUM',   points: 4   },
  SUSPICIOUS_PRICE:                { severity: 'CRITICAL', points: 16  },
};

// ── AI Recommendation Limits ─────────────────────────────────────────────────

export const DEFAULT_AI_RECOMMENDATION_LIMIT = 51;
export const DEFAULT_DEEP_EXPLANATION_LIMIT  = 20;
export const DEFAULT_CHATBOT_CONTEXT_LIMIT   = 51;
export const MAX_AI_RECOMMENDATION_LIMIT     = 100;

// ── AI Pick Thresholds ───────────────────────────────────────────────────────

export const AI_PICK_MIN_SCORE = 85;

// ── Price Precedence Configuration ───────────────────────────────────────────
//
// Algorithmic price enforcement: ensures lower fares always take precedence.
//
// MIN_PRICE_WEIGHT_FRACTION: After mode-specific weight adjustments and
// normalization, the effective price weight is guaranteed to never fall
// below this fraction. If it does, the algorithm redistributes weight
// proportionally from non-price dimensions. This is NOT a hardcoded
// per-mode override — it applies universally across all scoring modes.
//
// PRICE_PRECEDENCE_PENALTY: When an offer's effective price exceeds the
// cheapest offer by more than `thresholdPct`, an additional penalty is
// applied: min((pctAbove - thresholdPct) × rate, cap). This penalty is
// applied AFTER the weighted composite, so it cannot be overcome by high
// scores in other dimensions like baggage or fare flexibility.
//
export const MIN_PRICE_WEIGHT_FRACTION = 0.30;

export const PRICE_PRECEDENCE_PENALTY = {
  /** % above cheapest where the extra penalty begins (0.15 = 15%) */
  thresholdPct: 0.15,
  /** Penalty points per 100% over threshold */
  rate: 50,
  /** Maximum penalty points */
  cap: 25,
};

// ── Estimated Bag Costs (fallback when provider doesn't supply) ──────────────

export const ESTIMATED_BAG_COSTS = {
  domestic: {
    checkedBagPerPiece: 35,
    carryOnIfNotIncluded: 0,
  },
  international: {
    checkedBagPerPiece: 75,
    carryOnIfNotIncluded: 0,
  },
};

// ── Refundability config has been moved to FlightRefundabilityRule.ts ─────────
// See: REFUNDABILITY_CONFIG in FlightRefundabilityRule.ts
