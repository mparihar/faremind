/**
 * The pre-fix checked-bag rule, kept verbatim (bug included) so the regression
 * harness can reproduce exactly what the ranking engine received before the
 * fare-family work. Mirrors src/lib/feature-flags.ts `legacyCheckedBags`.
 *
 * Original rule, from normalizer.ts and mystifly-round-trip-normalizer.ts:
 *   pieces  → that number
 *   weight  → `kg >= 20 ? 1 : 0`   ← reports a real 15Kg allowance as no bag
 *   neither → 0
 *
 * Deleted together with the RANKING_INPUT_CORRECTION flag.
 */
export function legacyCheckedBags(rawAllowance?: string | null): number {
  const text = (rawAllowance || '').trim();
  if (!text) return 0;
  const pc = text.match(/(\d+)P/i);
  if (pc) return parseInt(pc[1], 10);
  const kg = text.match(/(\d+)K/i);
  if (kg) return parseInt(kg[1], 10) >= 20 ? 1 : 0;
  return 0;
}
