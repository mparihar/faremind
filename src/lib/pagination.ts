/**
 * Paging, decided once for the whole admin console.
 *
 * The tables had four different page sizes — 10, 20, 25, 100 — so how much you
 * saw depended on which screen you were on, and every one of them shipped its
 * own prev/next pair.
 */

/**
 * Rows per page across the console.
 *
 * Ten fits the viewport at the sizes this console is used at, which keeps the
 * pagination controls on screen. Twenty-five ran the table well past the fold,
 * so you had to scroll through every row to reach the thing that moves you off
 * them.
 */
export const ADMIN_PAGE_SIZE = 10;

/**
 * Which page numbers to show, windowed around the current one.
 *
 * A smaller page size means more pages, and prev/next alone puts page 6 five
 * clicks away. First and last are always present so either end is one click
 * off; the middle slides.
 *
 * The width is constant as the window slides. At either end one ellipsis is
 * absent, which frees a slot — spent on another page number rather than letting
 * the control narrow and the buttons shift under the cursor mid-click.
 *
 * A gap is only drawn where it hides more than one page: an ellipsis standing
 * in for a single page is worse than the page itself.
 */
export function pageWindow(current: number, total: number, span = 5): (number | '…')[] {
  if (total <= 0) return [];
  if (total <= span + 2) return Array.from({ length: total }, (_, i) => i + 1);

  const half = Math.floor(span / 2);
  let start = Math.max(2, current - half);
  let end = Math.min(total - 1, start + span - 1);
  start = Math.max(2, end - span + 1);

  if (start === 2) end = Math.min(total - 1, end + 1);
  if (end === total - 1) start = Math.max(2, start - 1);

  const out: (number | '…')[] = [1];
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

/** "Showing 11–20 of 143" — the range actually on screen. */
export function pageRangeLabel(page: number, limit: number, total: number): string {
  if (total <= 0) return 'No results';
  const from = Math.min((page - 1) * limit + 1, total);
  const to = Math.min(page * limit, total);
  return `Showing ${from}–${to} of ${total.toLocaleString()}`;
}
