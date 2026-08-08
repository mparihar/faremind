/**
 * Run: cd backend && npx tsx src/lib/page-window.test.ts
 *
 * Mirrors pageWindow in src/app/admin/bookings/page.tsx. Halving the page size
 * to 10 doubled the page count, so direct page numbers replaced prev/next —
 * and a windowed pager is where off-by-ones live: a first or last page that
 * cannot be reached, or a gap hiding a page the window should have shown.
 */
import assert from 'node:assert';

function pageWindow(current: number, total: number, span = 5): (number | '…')[] {
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

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const nums = (w: (number | '…')[]) => w.filter((x): x is number => x !== '…');

console.log('page window');

test('40 bookings at 10 a page is 4 pages, all shown', () => {
  assert.deepEqual(pageWindow(1, 4), [1, 2, 3, 4]);
});

test('a single page shows just itself', () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
});

test('no pages yields nothing rather than a stray [1]', () => {
  assert.deepEqual(pageWindow(1, 0), []);
});

test('small counts are never elided', () => {
  for (let t = 1; t <= 7; t++) {
    assert.equal(pageWindow(1, t).includes('…'), false, `${t} pages should not elide`);
    assert.equal(nums(pageWindow(1, t)).length, t);
  }
});

test('first and last are always reachable, whatever the current page', () => {
  // The whole point of the window: the ends stay one click away.
  for (const current of [1, 2, 25, 49, 50]) {
    const w = pageWindow(current, 50);
    assert.equal(w[0], 1, `page 1 missing at current=${current}`);
    assert.equal(w[w.length - 1], 50, `last page missing at current=${current}`);
  }
});

test('the current page is always in the window', () => {
  // Otherwise nothing is highlighted and the pager looks broken.
  for (let current = 1; current <= 50; current++) {
    assert.ok(nums(pageWindow(current, 50)).includes(current), `current=${current} not shown`);
  }
});

test('a gap only ever hides more than one page', () => {
  // An ellipsis standing in for a single page is worse than the page itself.
  for (let current = 1; current <= 50; current++) {
    const w = pageWindow(current, 50);
    for (let i = 1; i < w.length - 1; i++) {
      if (w[i] !== '…') continue;
      const before = w[i - 1] as number;
      const after = w[i + 1] as number;
      assert.ok(after - before > 1, `gap at current=${current} hides nothing`);
    }
  }
});

test('page numbers are strictly ascending with no repeats', () => {
  for (let current = 1; current <= 50; current++) {
    const n = nums(pageWindow(current, 50));
    for (let i = 1; i < n.length; i++) {
      assert.ok(n[i] > n[i - 1], `not ascending at current=${current}: ${n.join(',')}`);
    }
  }
});

test('the window stays a constant width as it slides', () => {
  // A pager that changes width as you page through it jitters under the cursor.
  const widths = new Set<number>();
  for (let current = 1; current <= 50; current++) widths.add(pageWindow(current, 50).length);
  assert.equal(widths.size, 1, `widths varied: ${[...widths].join(',')}`);
});

test('near the start it opens out rather than padding with a gap', () => {
  assert.deepEqual(pageWindow(1, 50), [1, 2, 3, 4, 5, 6, 7, '…', 50]);
});

test('near the end it opens out the other way', () => {
  assert.deepEqual(pageWindow(50, 50), [1, '…', 44, 45, 46, 47, 48, 49, 50]);
});

test('in the middle it is gapped on both sides', () => {
  assert.deepEqual(pageWindow(25, 50), [1, '…', 23, 24, 25, 26, 27, '…', 50]);
});

console.log(`\n${passed} passed`);
