// ─── Score Overrides (DEPRECATED) ────────────────────────────────────────────
//
// This module is no longer used by the ranking engine.
// Tag assignment and score adjustments have been moved to:
//   - src/lib/ai-scoring/tags.ts (tag assignment)
//   - src/lib/ai-scoring/scorer.ts (8-component scoring)
//
// Kept for reference only. Will be removed in a future cleanup.

export interface OverrideInput {
  price:              number;
  durationMinutes:    number;
  stops:              number;
  score:              number;
  budget?:            number | null;
  avgDurationMinutes: number;
  minPrice:           number;
}

export interface OverrideResult {
  tag?:       string;
  scoreBonus: number;
}

export function applyOverride(_input: OverrideInput): OverrideResult {
  return { scoreBonus: 0 };
}
