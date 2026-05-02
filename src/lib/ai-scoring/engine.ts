// ─── AI Intelligence Scoring Engine ──────────────────────────────────────────
//
// Entry point: aiRank()
// Pipeline: qualityFilter → computeScore → applyOverride → assignLabels → sort
//
// DOES NOT modify one-way or round-trip scoring engines.
// Activates ONLY when caller passes aiIntelligence = true.

import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import type {
  AiUserPreferences,
  AiScoredOption,
  AiFilteredOut,
  AiRankResult,
  AiScoreBreakdown,
  AiSortMode,
  ScoringStats,
  NormalizedOption,
} from './types';
import { normalizeOneWay, normalizeRoundTrip } from './normalize';
import { qualityFilter } from './quality-filter';
import { computeScore } from './scorer';
import { applyOverride } from './overrides';
import { assignLabels } from './labels';

// ── Internal intermediate type ────────────────────────────────────────────────

interface Candidate<T> {
  option:        T;
  norm:          NormalizedOption;
  layoverPenalty: number;
}

// ── Sort ──────────────────────────────────────────────────────────────────────

function sortScored<T>(
  scored:  AiScoredOption<T>[],
  toNorm:  (t: T) => NormalizedOption,
  mode:    AiSortMode = 'best_value',
): AiScoredOption<T>[] {
  const copy = [...scored];
  switch (mode) {
    case 'cheapest':
      return copy.sort((a, b) => toNorm(a.option).price - toNorm(b.option).price);
    case 'fastest':
      return copy.sort((a, b) => toNorm(a.option).durationMinutes - toNorm(b.option).durationMinutes);
    case 'fewest_stops':
      return copy.sort((a, b) => {
        const sa = toNorm(a.option), sb = toNorm(b.option);
        return sa.stops !== sb.stops ? sa.stops - sb.stops : sa.price - sb.price;
      });
    default: // best_value
      return copy.sort((a, b) => b.aiScore - a.aiScore);
  }
}

// ── Core pipeline (generic, works for any T) ──────────────────────────────────

function aiRankCore<T>(
  options: T[],
  toNorm:  (t: T) => NormalizedOption,
  prefs:   AiUserPreferences,
  debug:   boolean,
): AiRankResult<T> {
  if (!options.length) return { ranked: [], filteredOut: [] };

  const allNormed = options.map(o => ({ option: o, norm: toNorm(o) }));
  const minDurationAll = Math.min(...allNormed.map(n => n.norm.durationMinutes));

  // ── Step 1: Quality filter ──────────────────────────────────────────────────
  const candidates: Candidate<T>[] = [];
  const filteredOut: AiFilteredOut<T>[] = [];

  for (const { option, norm } of allNormed) {
    const qr = qualityFilter(norm, minDurationAll);
    if (!qr.pass) {
      filteredOut.push({ option, reason: qr.reason!, filtered: true });
    } else {
      candidates.push({ option, norm, layoverPenalty: qr.layoverPenalty });
    }
  }

  if (!candidates.length) return { ranked: [], filteredOut };

  // Stats over surviving candidates (used for min/max normalization)
  const stats: ScoringStats = {
    minPrice:    Math.min(...candidates.map(c => c.norm.price)),
    maxPrice:    Math.max(...candidates.map(c => c.norm.price)),
    minDuration: Math.min(...candidates.map(c => c.norm.durationMinutes)),
    maxDuration: Math.max(...candidates.map(c => c.norm.durationMinutes)),
    avgDuration: candidates.reduce((s, c) => s + c.norm.durationMinutes, 0) / candidates.length,
  };

  // ── Steps 2 + 3: Score then override ───────────────────────────────────────
  type Interim = { c: Candidate<T>; breakdown: AiScoreBreakdown; finalScore: number; tag?: string };

  const interims: Interim[] = candidates.map(c => {
    const breakdown = computeScore(c.norm, stats, prefs);
    const { tag, scoreBonus } = applyOverride({
      price:              c.norm.price,
      durationMinutes:    c.norm.durationMinutes,
      stops:              c.norm.stops,
      score:              breakdown.finalScore,
      budget:             prefs.budget,
      avgDurationMinutes: stats.avgDuration,
      minPrice:           stats.minPrice,
    });
    const finalScore = Math.round(Math.max(0, Math.min(100, breakdown.finalScore + scoreBonus)));
    return { c, breakdown: { ...breakdown, finalScore }, finalScore, tag };
  });

  // ── Step 4: Label assignment ────────────────────────────────────────────────
  const labelMap = assignLabels(interims.map(({ c, finalScore }) => ({
    id:              c.norm.id,
    price:           c.norm.price,
    durationMinutes: c.norm.durationMinutes,
    finalScore,
  })));

  // ── Build AiScoredOption array ──────────────────────────────────────────────
  const scored: AiScoredOption<T>[] = interims.map(({ c, breakdown, finalScore, tag }) => ({
    option:         c.option,
    aiScore:        finalScore,
    labels:         labelMap.get(c.norm.id) ?? [],
    tag:            tag as AiScoredOption<T>['tag'],
    layoverPenalty: c.layoverPenalty,
    filtered:       false as const,
    scoreBreakdown: debug ? breakdown : undefined,
  }));

  // ── Step 5: Sort ────────────────────────────────────────────────────────────
  return {
    ranked:      sortScored(scored, toNorm, prefs.sortMode),
    filteredOut,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function aiRankOneWay(
  flights: UnifiedFlight[],
  prefs:   AiUserPreferences,
  debug =  false,
): AiRankResult<UnifiedFlight> {
  return aiRankCore(flights, normalizeOneWay, prefs, debug);
}

export function aiRankRoundTrip(
  options: RoundTripOption[],
  prefs:   AiUserPreferences,
  debug =  false,
): AiRankResult<RoundTripOption> {
  return aiRankCore(options, normalizeRoundTrip, prefs, debug);
}

/** Unified entry point — dispatches to the correct typed overload. */
export function aiRank(
  options:  UnifiedFlight[],
  prefs:    AiUserPreferences,
  tripType: 'oneway',
  debug?:   boolean,
): AiRankResult<UnifiedFlight>;
export function aiRank(
  options:  RoundTripOption[],
  prefs:    AiUserPreferences,
  tripType: 'roundtrip',
  debug?:   boolean,
): AiRankResult<RoundTripOption>;
export function aiRank(
  options:  UnifiedFlight[] | RoundTripOption[],
  prefs:    AiUserPreferences,
  tripType: 'oneway' | 'roundtrip',
  debug =   false,
): AiRankResult<UnifiedFlight> | AiRankResult<RoundTripOption> {
  return tripType === 'roundtrip'
    ? aiRankRoundTrip(options as RoundTripOption[], prefs, debug)
    : aiRankOneWay(options as UnifiedFlight[], prefs, debug);
}
