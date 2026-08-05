/**
 * Recover a PTR id from an "already in process" refusal.
 *
 * Mystifly can create the PTR and then fail the response. FME4N3CL got back
 * `Success:false, "The remote server returned an error: (500) Internal Server
 * Error."` with no PTRId — while PTR 22981 existed on their side the whole time.
 * Every retry after that answers "RefundQuote request PTR 22981 is already in
 * process", so the quote becomes unreachable: a new one cannot be raised, and
 * the id of the one that exists was never returned to us.
 *
 * The refusal itself names the id. Taking it from there converts a permanent
 * dead end into an ordinary pending quote, which ptr-quote-reconciliation
 * already polls and prices.
 */

/** The id in "RefundQuote request PTR 22981 is already in process", or null. */
export function ptrIdFromInProcessMessage(message: string | null | undefined): number | null {
  const text = String(message ?? '');
  // Both orderings seen in the wild; require the two parts to sit in the same
  // sentence so an unrelated PTR id elsewhere in a longer message is not taken.
  const m =
    /\bPTR\s+(\d{1,12})\b[^.]*?\balready in process\b/i.exec(text) ??
    /\balready in process\b[^.]*?\bPTR\s+(\d{1,12})\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
