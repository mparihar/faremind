/**
 * Feature flags.
 *
 * Server-side only — read at request time, not module load, so a Railway
 * variable change takes effect on redeploy without a code change.
 */

/**
 * Whether corrected provider inputs reach the search-results ranking engine.
 *
 * The fare-family work fixed two inputs that had been feeding the ranker bad
 * data for its whole life:
 *
 *   • `comfort.fareClassName` was hardcoded `undefined`, so scoreComfort()
 *     never took its basic(40) / classic(62) / flex(68) branches and every
 *     economy offer scored a flat 60.
 *   • `baggage.checked` counted a weight allowance below 20kg as zero bags, so
 *     a real 15Kg allowance scored as "no checked bag".
 *
 * Correcting these is right, but it moves scores and therefore badges on live
 * search results. This flag separates that from the airline-name display
 * change, which is safe to ship on its own.
 *
 * OFF (default): the ranker receives byte-identical inputs to today —
 *   `fareClassName: undefined` and the old baggage rule — so search rankings
 *   and badges are unchanged. Customers still see the airline's real fare
 *   family names everywhere, because display never reads this flag.
 *
 * ON: the ranker receives the corrected values.
 *
 * Set `RANKING_INPUT_CORRECTION=true` to enable. Remove this flag once the
 * corrected ranking has been signed off in production.
 */
export function rankingInputCorrectionEnabled(): boolean {
  return String(process.env.RANKING_INPUT_CORRECTION ?? '').toLowerCase() === 'true';
}

/**
 * The pre-fix checked-bag count, reproduced exactly so the flag's OFF path
 * feeds the ranker what it would have received before this change.
 *
 * The original rule lived in normalizer.ts / mystifly-round-trip-normalizer.ts:
 *   pieces  → that number
 *   weight  → `kg >= 20 ? 1 : 0`
 *   neither → 0
 *
 * Kept deliberately verbatim, bug included. It exists to prove the OFF path is
 * a true no-op, and is deleted with the flag.
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
