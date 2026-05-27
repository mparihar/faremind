// ─── 8-Component AI Scorer ───────────────────────────────────────────────────
//
// Computes a holistic 0-100 score from 8 dimensions:
//   1. Price (35%)        — min/max with percentile clipping + guardrails
//   2. Duration (22%)     — total round-trip duration
//   3. Stops (15%)        — absolute scoring (0=100, 1=85, 2=70, 3=50, 4+=30)
//   4. Layover (10%)      — per-layover penalty model
//   5. Schedule (8%)      — departure/arrival time convenience
//   6. Baggage (4%)       — carry-on + checked inclusion
//   7. Fare flexibility (3%) — refund/change conditions
//   8. Provider reliability (3%) — static base + future dynamic metrics
//
// See spec sections §3–§10 for full details.

import type { NormalizedOption, AiScoreBreakdown, AiUserPreferences, ScoringStats, WeightPreset } from './types';
import { clippedNorm } from './stats';
import { getWeights } from './weights';

// ─── 1. Price Score (§3) ─────────────────────────────────────────────────────

function scorePrice(norm: NormalizedOption, stats: ScoringStats): number {
  // Min/max normalization with percentile clipping
  let score = clippedNorm(norm.price, stats.p5Price, stats.p95Price) * 100;

  // Cheapest offer → always 100
  if (stats.minPrice > 0 && norm.price <= stats.minPrice) {
    score = 100;
  }

  // Guardrails
  if (stats.minPrice > 0) {
    const pctAbove = (norm.price - stats.minPrice) / stats.minPrice;
    if (pctAbove <= 0.03) {
      // Within 3% of cheapest → floor at 93
      score = Math.max(score, 93);
    } else if (pctAbove <= 0.05) {
      // Within 5% → floor at 88
      score = Math.max(score, 88);
    } else if (pctAbove > 0.10 && pctAbove <= 0.20) {
      // 10-20% above cheapest → moderate penalty
      const penalty = Math.min((pctAbove - 0.10) * 60, 10);
      score = Math.max(0, score - penalty);
    } else if (pctAbove > 0.20) {
      // More than 20% above cheapest → strong penalty
      const overPenalty = Math.min((pctAbove - 0.20) * 100, 25);
      score = Math.max(0, score - overPenalty);
    }
  }

  return Math.max(0, Math.min(100, score));
}

// ─── 2. Duration Score (§4) ──────────────────────────────────────────────────

function scoreDuration(norm: NormalizedOption, stats: ScoringStats): number {
  // Percentile-clipped normalization
  const score = clippedNorm(norm.durationMinutes, stats.p5Duration, stats.p95Duration) * 100;
  return Math.max(0, Math.min(100, score));
}

// ─── 3. Stops Score (§5) ─────────────────────────────────────────────────────

function scoreStops(totalStops: number, tripType?: 'one_way' | 'round_trip'): number {
  if (tripType === 'one_way') {
    // One-way scoring per spec §5
    switch (totalStops) {
      case 0:  return 100;
      case 1:  return 82;
      case 2:  return 62;
      case 3:  return 40;
      default: return 20;
    }
  }
  // Round-trip defaults
  switch (totalStops) {
    case 0:  return 100;
    case 1:  return 85;
    case 2:  return 70;
    case 3:  return 50;
    default: return 30;
  }
}

// ─── 4. Layover Score (§6) ───────────────────────────────────────────────────

function scoreLayover(norm: NormalizedOption): number {
  if (norm.layoverMinutes.length === 0) return 100; // nonstop

  let score = 100;

  for (const lv of norm.layoverMinutes) {
    if (norm.isInternational) {
      // International thresholds
      if (lv < 75) {
        score -= 25; // dangerously short
      } else if (lv < 90) {
        score -= 10; // slightly short
      } else if (lv > 480) {
        // > 8 hours: heavy penalty
        score -= 30;
      } else if (lv > 300) {
        // > 5 hours: moderate penalty
        score -= 15;
      }
    } else {
      // Domestic thresholds
      if (lv < 45) {
        score -= 25; // dangerously short
      } else if (lv < 60) {
        score -= 10; // slightly short
      } else if (lv > 480) {
        score -= 30; // > 8 hours
      } else if (lv > 300) {
        score -= 15; // > 5 hours
      }
    }

    // Overnight layover penalty (layover > 10 hours)
    if (lv > 600) {
      score -= 35;
    }
  }

  return Math.max(0, Math.min(100, score));
}

// ─── 5. Schedule Score (§7) ──────────────────────────────────────────────────

function isRedEye(depHour: number, arrHour: number): boolean {
  // Red-eye: departs late evening/night (9PM-1AM), arrives early morning
  return (depHour >= 21 || depHour < 1) && (arrHour >= 4 && arrHour <= 9);
}

function isPoorDepartureTime(hour: number): boolean {
  return hour >= 0 && hour < 6; // 12AM–6AM
}

function isPoorArrivalTime(hour: number): boolean {
  return hour >= 0 && hour < 5; // 12AM–5AM
}

function isLateArrival(hour: number): boolean {
  return hour >= 23; // 11PM+
}

function scoreSchedule(norm: NormalizedOption): number {
  let score = 100;

  const depHour = norm.departureHour;
  const arrHour = norm.arrivalHour;

  // Outbound schedule
  if (isRedEye(depHour, arrHour)) score -= 10;
  if (isPoorDepartureTime(depHour)) score -= 8;
  if (isLateArrival(arrHour)) score -= 8;
  if (isPoorArrivalTime(arrHour)) {
    // For international long-haul, reduce this penalty (early morning arrival is common)
    score -= norm.isInternational ? 6 : 12;
  }

  // Return schedule (if round-trip)
  if (norm.returnDepartureHour != null && norm.returnArrivalHour != null) {
    const retDep = norm.returnDepartureHour;
    const retArr = norm.returnArrivalHour;

    if (isRedEye(retDep, retArr)) score -= 10;
    if (isPoorDepartureTime(retDep)) score -= 8;
    if (isLateArrival(retArr)) score -= 8;
    if (isPoorArrivalTime(retArr)) {
      score -= norm.isInternational ? 6 : 12;
    }
  }

  return Math.max(0, Math.min(100, score));
}

// ─── 6. Baggage Score (§8) ───────────────────────────────────────────────────

function scoreBaggage(norm: NormalizedOption): number {
  const hasCarryOn = norm.baggageCarryOn > 0;
  const hasChecked = norm.baggageChecked > 0;

  let score: number;

  if (hasCarryOn && hasChecked) {
    score = 100; // Both included
  } else if (hasCarryOn && !hasChecked) {
    score = 75;  // Carry-on only
  } else if (!hasCarryOn && !hasChecked) {
    score = 50;  // Personal item only / no info
  } else {
    score = 60;  // Unusual: checked but no carry-on stated
  }

  // International penalty: checked bag matters more
  if (norm.isInternational && !hasChecked) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

// ─── 7. Fare Flexibility Score (§9) ──────────────────────────────────────────

function scoreFareFlexibility(norm: NormalizedOption): number {
  if (norm.refundable && norm.changeable) return 100;
  if (!norm.refundable && norm.changeable) return 70;
  if (!norm.refundable && !norm.changeable) return 30;
  // Refundable but not changeable (unusual)
  if (norm.refundable && !norm.changeable) return 80;
  return 55; // Unknown / fallback
}

// ─── 8. Provider Reliability Score (§10) ─────────────────────────────────────

const PROVIDER_BASE_SCORES: Record<string, number> = {
  duffel:   95,
  mystifly: 90,
};

function scoreProviderReliability(providerCode: string): number {
  return PROVIDER_BASE_SCORES[providerCode.toLowerCase()] ?? 80;
}

// ─── Composite Scorer ────────────────────────────────────────────────────────

export function computeScore(
  norm:     NormalizedOption,
  stats:    ScoringStats,
  prefs:    AiUserPreferences,
  tripType?: 'one_way' | 'round_trip',
): AiScoreBreakdown {
  const weights = getWeights(prefs.weightPreset, tripType);

  const priceScoreVal              = scorePrice(norm, stats);
  const durationScoreVal           = scoreDuration(norm, stats);
  const stopsScoreVal              = scoreStops(norm.stops, tripType);
  const layoverScoreVal            = scoreLayover(norm);
  const scheduleScoreVal           = scoreSchedule(norm);
  const baggageScoreVal            = scoreBaggage(norm);
  const fareFlexibilityScoreVal    = scoreFareFlexibility(norm);
  const providerReliabilityVal     = scoreProviderReliability(norm.providerCode);

  // Weighted composite
  let base =
    priceScoreVal              * weights.price +
    durationScoreVal           * weights.duration +
    stopsScoreVal              * weights.stops +
    layoverScoreVal            * weights.layover +
    scheduleScoreVal           * weights.schedule +
    baggageScoreVal            * weights.baggage +
    fareFlexibilityScoreVal    * weights.fareFlexibility +
    providerReliabilityVal     * weights.providerReliability;

  // Soft constraint: budget — penalise offers over budget
  if (prefs.budget && prefs.budget > 0 && norm.price > prefs.budget) {
    const overPct = (norm.price - prefs.budget) / prefs.budget;
    const budgetPenalty = Math.min(overPct * 30, 25); // up to 25 point penalty
    base = Math.max(0, base - budgetPenalty);
  }

  // Soft constraint: max duration
  if (prefs.maxDuration && prefs.maxDuration > 0 && norm.durationMinutes > prefs.maxDuration) {
    const overPct = (norm.durationMinutes - prefs.maxDuration) / prefs.maxDuration;
    const durationPenalty = Math.min(overPct * 25, 20);
    base = Math.max(0, base - durationPenalty);
  }

  // Soft constraint: nonstop preference
  if (prefs.stops === 'nonstop' && norm.stops > 0) {
    base *= 0.6; // Heavy penalty for non-nonstop when user wants nonstop
  } else if (prefs.stops === '1stop' && norm.stops > 1) {
    base *= 0.75;
  } else if (prefs.stops === '2stop' && norm.stops > 2) {
    base *= 0.80;
  }

  const finalScore = Math.max(0, Math.min(100, base));

  return {
    priceScore:               Math.round(priceScoreVal),
    durationScore:            Math.round(durationScoreVal),
    stopsScore:               Math.round(stopsScoreVal),
    layoverScore:             Math.round(layoverScoreVal),
    scheduleScore:            Math.round(scheduleScoreVal),
    baggageScore:             Math.round(baggageScoreVal),
    fareFlexibilityScore:     Math.round(fareFlexibilityScoreVal),
    providerReliabilityScore: Math.round(providerReliabilityVal),
    finalScore:               Math.round(finalScore * 100) / 100, // keep 2 decimals for tie-breaking
    weights,
  };
}
