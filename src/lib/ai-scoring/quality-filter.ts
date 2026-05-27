import type { NormalizedOption } from './types';

const MIN_LAYOVER_MINUTES  = 45;   // hard: remove options with shorter layovers
const LONG_LAYOVER_MINUTES = 360;  // soft: penalise layovers beyond 6 h
const MAX_DURATION_FACTOR  = 2;    // hard: remove if duration > 2× fastest

export interface QualityResult {
  pass:           boolean;
  reason?:        string;
  layoverPenalty: number; // 0-1 accumulated penalty for long layovers
}

export function qualityFilter(
  norm:               NormalizedOption,
  minDurationMinutes: number,
): QualityResult {
  // Hard rule 0 — invalid offers (no price or no duration)
  if (norm.price <= 0 || norm.durationMinutes <= 0) {
    return { pass: false, reason: 'Invalid offer (missing price or duration)', layoverPenalty: 0 };
  }

  // Hard rule 1 — short layovers
  for (const lv of norm.layoverMinutes) {
    if (lv < MIN_LAYOVER_MINUTES) {
      return { pass: false, reason: `Layover too short (${Math.round(lv)} min)`, layoverPenalty: 0 };
    }
  }

  // Hard rule 2 — excessive duration
  if (norm.durationMinutes > minDurationMinutes * MAX_DURATION_FACTOR) {
    return { pass: false, reason: 'Total duration exceeds 2× fastest option', layoverPenalty: 0 };
  }

  // Soft rule — penalise long layovers cumulatively, cap at 1
  let layoverPenalty = 0;
  for (const lv of norm.layoverMinutes) {
    if (lv > LONG_LAYOVER_MINUTES) {
      layoverPenalty += Math.min(0.5, ((lv - LONG_LAYOVER_MINUTES) / LONG_LAYOVER_MINUTES) * 0.3);
    }
  }
  layoverPenalty = Math.min(1, layoverPenalty);

  return { pass: true, layoverPenalty };
}
