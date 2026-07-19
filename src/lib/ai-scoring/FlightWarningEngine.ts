// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Warning Engine
// ═══════════════════════════════════════════════════════════════════════════════
//
// Generates structured warnings with severity-based penalties.
// Warnings are controlled adjustments, NOT the primary scoring engine.
// The base score from 8 dimensions remains the main ranking driver.

import type {
  ScoringFeatures,
  ScoringTripType,
  WarningDetail,
  WarningResult,
  WarningSeverity,
  ScoringUserPreferences,
} from './FlightScoringTypes';
import { NEGATIVE_PENALTY_MAP, AI_PICK_MIN_SCORE } from './FlightScoringConfig';

// ── Stats from the result set (needed for contextual warnings) ───────────────

export interface WarningSearchStats {
  minPrice: number;
  maxPrice: number;
  minDuration: number;
  maxDuration: number;
  minStops: number;
  hasNonstop: boolean;
}

// ── Helper to push a warning ─────────────────────────────────────────────────

function warn(
  warnings: WarningDetail[],
  code: string,
  messageOverride?: string,
): void {
  const def = NEGATIVE_PENALTY_MAP[code];
  if (!def) return;
  warnings.push({
    code,
    severity: def.severity,
    points: def.points,
    message: messageOverride ?? code,
  });
}

// ── Main warning generator ───────────────────────────────────────────────────

export function generateWarnings(
  features: ScoringFeatures,
  tripType: ScoringTripType,
  stats: WarningSearchStats,
  prefs?: ScoringUserPreferences | null,
): WarningResult {
  const warnings: WarningDetail[] = [];
  let aiPickBlocked = false;
  let aiPickBlockReason: string | undefined;

  // ── Price warnings ──
  if (stats.minPrice > 0) {
    const pctAbove = ((features.effectiveTotalPrice - stats.minPrice) / stats.minPrice) * 100;
    if (pctAbove > 30) {
      warn(warnings, 'MUCH_HIGHER_THAN_COMPARABLE', 'Significantly higher than the cheapest comparable options');
    } else if (pctAbove > 20) {
      warn(warnings, 'HIGHER_THAN_COMPARABLE', 'Higher than most comparable options');
    } else if (pctAbove > 10) {
      warn(warnings, 'SLIGHTLY_HIGHER_PRICE', 'Slightly higher than the cheapest comparable options');
    }
  }

  // ── Baggage warnings ──
  if (features.baggage.checkedBagsIncluded === 0) {
    if (features.isInternational) {
      warn(warnings, 'NO_CHECKED_BAG_INTERNATIONAL', 'No checked baggage included — additional fee may apply');
    } else {
      warn(warnings, 'NO_CHECKED_BAG_DOMESTIC', 'No checked baggage on domestic flight');
    }
  }

  // ── Stops warnings ──
  if (stats.hasNonstop && features.totalStops === 1) {
    warn(warnings, 'ONE_STOP_WHEN_NONSTOP_EXISTS', 'Nonstop options available — this flight has 1 stop');
  }

  if (tripType === 'ROUND_TRIP') {
    // Round-trip customer-impact logic
    const outStops = features.outboundStops;
    const retStops = features.returnStops;

    if (outStops >= 3 || retStops >= 3) {
      warn(warnings, 'THREE_OR_MORE_CONNECTIONS', 'Three or more connections on one leg — complex journey');
    } else if (outStops >= 2 && retStops >= 2) {
      warn(warnings, 'THREE_OR_MORE_CONNECTIONS', 'Multiple connections both ways — demanding itinerary');
    } else if (outStops >= 2 || retStops >= 2) {
      warn(warnings, 'TWO_CONNECTIONS', 'Two connections on one leg may make the journey less convenient');
    }
    // Note: 1 stop each way for RT is normal — no warning
  } else {
    // One-way
    if (features.totalStops >= 3) {
      warn(warnings, 'THREE_OR_MORE_CONNECTIONS', `${features.totalStops} connections — longer journey with multiple stopovers`);
    } else if (features.totalStops === 2) {
      warn(warnings, 'TWO_CONNECTIONS', 'Two connections may make the journey less convenient');
    }
  }

  // ── Duration warnings ──
  if (stats.minDuration > 0) {
    const pctAbove = ((features.totalDurationMinutes - stats.minDuration) / stats.minDuration) * 100;
    if (pctAbove > 80) {
      warn(warnings, 'EXTREME_DURATION', 'Total travel time is extremely long compared to faster options');
    } else if (pctAbove > 40) {
      warn(warnings, 'SIGNIFICANTLY_LONGER_DURATION', 'Total travel time is significantly longer than faster options');
    } else if (pctAbove > 20) {
      warn(warnings, 'LONGER_THAN_FASTEST', 'Longer travel time than faster options');
    } else if (pctAbove > 10) {
      warn(warnings, 'SLIGHTLY_LONGER_THAN_FASTEST', 'Slightly longer than the fastest option');
    }
  }

  // ── Layover warnings ──
  for (const layover of features.allLayovers) {
    const thresholdTight = features.isInternational ? 75 : 45;
    const thresholdLong = features.isInternational ? 300 : 240;

    // Safety warnings always apply regardless of plausibility
    if (layover.isSelfTransfer) {
      warn(warnings, 'SELF_TRANSFER', 'Self-transfer required — collect and recheck baggage');
      aiPickBlocked = true;
      aiPickBlockReason = 'Self-transfer risk';
    }

    if (layover.requiresAirportChange) {
      warn(warnings, 'AIRPORT_CHANGE', 'Airport change required during connection');
      aiPickBlocked = true;
      aiPickBlockReason = 'Airport change required';
    }

    // Plausibility guard: skip duration-based warnings for implausible layovers
    // A single layover cannot exceed 80% of total journey duration
    if (features.totalDurationMinutes > 0 && layover.durationMinutes > features.totalDurationMinutes * 0.8) {
      continue; // implausible data — do not penalize score
    }

    if (layover.durationMinutes > 0 && layover.durationMinutes < thresholdTight) {
      warn(warnings, 'TIGHT_CONNECTION', `Tight connection (${Math.round(layover.durationMinutes)} min) — risk of missed transfer`);
      aiPickBlocked = true;
      aiPickBlockReason = 'Tight connection risk';
    } else if (layover.isOvernight || layover.durationMinutes > 600) {
      warn(warnings, 'OVERNIGHT_LAYOVER', `Overnight layover (${Math.round(layover.durationMinutes / 60)}+ hours)`);
    } else if (layover.durationMinutes > 480) {
      warn(warnings, 'LONG_LAYOVER', `Long layover of ${Math.round(layover.durationMinutes / 60)}+ hours`);
    } else if (layover.durationMinutes > thresholdLong) {
      warn(warnings, 'SLIGHTLY_LONG_LAYOVER', `${Math.round(layover.durationMinutes / 60)}+ hour layover`);
    }
  }

  // ── Schedule warnings ──
  const depHour = features.schedule.outboundDepartureHour;
  const arrHour = features.schedule.outboundArrivalHour;

  if (depHour >= 0 && depHour < 6) {
    warn(warnings, 'EARLY_MORNING_DEPARTURE', 'Early morning departure');
    if (prefs?.elderlyTraveler || prefs?.familyTravel) {
      // Extra penalty already in points — no additional warning needed
    }
  }
  if (arrHour >= 23 || (arrHour >= 0 && arrHour < 5)) {
    warn(warnings, 'LATE_NIGHT_ARRIVAL', 'Late night or early morning arrival');
  }

  // Return leg schedule
  if (features.schedule.returnDepartureHour != null) {
    const retDep = features.schedule.returnDepartureHour;
    const retArr = features.schedule.returnArrivalHour ?? 12;
    if (retDep >= 0 && retDep < 6) {
      warn(warnings, 'EARLY_MORNING_DEPARTURE', 'Early morning return departure');
    }
    if (retArr >= 23 || (retArr >= 0 && retArr < 5)) {
      warn(warnings, 'LATE_NIGHT_ARRIVAL', 'Late night return arrival');
    }
  }

  // ── Fare rules warnings ──
  if (!features.fareFlexibility.refundable && !features.fareFlexibility.changeable) {
    warn(warnings, 'NON_REFUNDABLE_NON_CHANGEABLE', 'Non-refundable and non-changeable — book only if dates are firm');
  } else if (!features.fareFlexibility.refundable) {
    warn(warnings, 'NON_REFUNDABLE', 'Non-refundable fare');
  } else if (!features.fareFlexibility.changeable) {
    warn(warnings, 'NON_CHANGEABLE', 'Non-changeable fare');
  }

  // ── Provider reliability warnings ──
  if (features.providerReliability.health) {
    const health = features.providerReliability.health;
    if (health.revalidationSuccessRate != null && health.revalidationSuccessRate < 70) {
      warn(warnings, 'PROVIDER_REVALIDATION_RISK', 'Provider may have revalidation issues');
      aiPickBlocked = true;
      aiPickBlockReason = 'Provider revalidation risk';
    }
  }

  // ── Suspicious price ──
  if (stats.minPrice > 0 && features.effectiveTotalPrice < stats.minPrice * 0.3) {
    warn(warnings, 'SUSPICIOUS_PRICE', 'Price seems unusually low — verify before booking');
    aiPickBlocked = true;
    aiPickBlockReason = 'Suspicious pricing';
  }

  // ── Compute penalties ──
  const warningPenalty = warnings.reduce((sum, w) => sum + w.points, 0);
  const compoundWarningPenalty = computeCompoundPenalty(warnings);
  const totalPenalty = warningPenalty + compoundWarningPenalty;

  return {
    warnings,
    warningPenalty,
    compoundWarningPenalty,
    totalPenalty,
    aiPickBlocked,
    aiPickBlockReason,
  };
}

// ── Compound Penalty ─────────────────────────────────────────────────────────

function computeCompoundPenalty(warnings: WarningDetail[]): number {
  const count = warnings.length;
  const majorCount = warnings.filter(w => w.severity === 'MAJOR').length;
  const criticalCount = warnings.filter(w => w.severity === 'CRITICAL').length;

  let compound = 0;

  // Base compound by warning count
  if (count >= 4) compound = 5;
  else if (count === 3) compound = 3;
  else if (count === 2) compound = 1.5;
  // 0 or 1 warning → no compound

  // Additional for major/critical stacking
  if (majorCount >= 2) compound += 2;
  if (criticalCount >= 1) compound += 5;
  if (criticalCount >= 2) compound += 8;

  return compound;
}
