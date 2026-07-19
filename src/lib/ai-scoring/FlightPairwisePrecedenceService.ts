// ═══════════════════════════════════════════════════════════════════════════════
// Pairwise Precedence Service — Local Refundable-Over-Changeable Ordering
// ═══════════════════════════════════════════════════════════════════════════════
//
// Per spec §7: This is a LOCAL ORDERING CONSTRAINT, not a global promotion.
//
// After the global sort by finalScore:
//   - For each qualifying refundable, locate its matched changeable comparator
//   - If the refundable ranks BELOW its comparator, MOVE it immediately above
//   - Do NOT move it above unrelated offers
//   - Do NOT change finalScore to manufacture rank
//   - Do NOT force into Top 5, Top 10, or any window
//
// This must be the LAST ordering operation before final rank assignment.

import type { ScoringFeatures, FlightScoreOutput } from './FlightScoringTypes';

export interface PairwiseCandidate {
  features: ScoringFeatures;
  score: FlightScoreOutput;
}

export interface PairwiseMove {
  refundableOfferId: string;
  changeableOfferId: string;
  fromPosition: number;
  toPosition: number;
}

/**
 * Apply local pairwise refundable-over-changeable precedence.
 *
 * Mutates the array in place by MOVING elements (splice), NOT by changing scores.
 *
 * @returns List of moves applied (for audit logging)
 */
export function applyPairwisePrecedence<T extends PairwiseCandidate>(
  sorted: T[],
  qualifiedPairs: Map<string, string>,
): PairwiseMove[] {
  const moves: PairwiseMove[] = [];

  if (qualifiedPairs.size === 0) return moves;

  for (const [refundableId, changeableId] of qualifiedPairs) {
    const refIdx = sorted.findIndex(c => c.features.offerId === refundableId);
    const chgIdx = sorted.findIndex(c => c.features.offerId === changeableId);

    if (refIdx < 0 || chgIdx < 0) continue;

    // Skip if refundable has critical warnings
    const hasCritical = sorted[refIdx].score.scoreBreakdown.warningDetails
      .some(w => w.severity === 'CRITICAL');
    if (hasCritical) continue;

    // If refundable already ranks above (lower index) its comparator, no action
    if (refIdx < chgIdx) continue;

    // Move refundable immediately above its matched changeable
    // Remove from current position, insert just before the changeable
    const [refundable] = sorted.splice(refIdx, 1);

    // After removal, the changeable's index may have shifted
    const newChgIdx = sorted.findIndex(c => c.features.offerId === changeableId);
    sorted.splice(newChgIdx, 0, refundable);

    const move: PairwiseMove = {
      refundableOfferId: refundableId,
      changeableOfferId: changeableId,
      fromPosition: refIdx + 1,
      toPosition: newChgIdx + 1,
    };
    moves.push(move);

    console.log(
      `[PairwisePrecedence] Moved $${Math.round(refundable.features.effectiveTotalPrice)} refundable ` +
      `from position ${move.fromPosition} to ${move.toPosition} ` +
      `(immediately above $${Math.round(sorted[newChgIdx + 1]?.features.effectiveTotalPrice ?? 0)} changeable). ` +
      `Score unchanged at ${refundable.score.finalScore.toFixed(2)}.`
    );
  }

  return moves;
}
