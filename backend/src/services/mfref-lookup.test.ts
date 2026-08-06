/**
 * Run: cd backend && npx tsx src/services/mfref-lookup.test.ts
 *
 * This lookup decides whether an ERBUK082 booking is refunded, so the three
 * outcomes have to stay distinct. The KUL-PEN attempt on 2026-08-06 is the
 * reason: the parser read a path that does not exist, returned null for every
 * booking, and the caller read null as "the carrier has no record" and refunded
 * $166. Had a booking existed, the customer would have held a live PNR they no
 * longer paid for, with nothing on our side recording it.
 *
 * The parser is exercised through the same expression the service uses; only the
 * HTTP call is left out.
 */
import assert from 'node:assert';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const NOT_A_REF = /^(no matching mfref found|not found|n\/?a|none|null)$/i;

/** Mirrors lookupMfRefFromFsc's parsing, minus the request. */
function parse(result: any): { outcome: string; mfRef?: string } {
  const inner = result?.Data?.MFRefResult ?? result?.MFRefResult ?? null;
  const raw =
    inner?.MFRef ?? inner?.MfRef ??
    result?.Data?.MFRef ?? result?.Data?.MfRef ?? result?.Data?.UniqueID ??
    result?.MFRef ?? result?.MfRef ??
    (typeof result?.Data === 'string' ? result.Data : null) ??
    (typeof result === 'string' ? result : null);
  const ref = typeof raw === 'string' ? raw.trim() : '';
  if (inner && inner.Success === false) return { outcome: 'not_found' };
  if (!ref || NOT_A_REF.test(ref)) return { outcome: 'not_found' };
  return { outcome: 'found', mfRef: ref };
}

console.log('MFRef lookup');

test('the live not-found payload is read as not_found, not as a reference', () => {
  // Exactly what the provider returned for the KUL-PEN fare.
  const r = parse({ Data: { MFRefResult: { Success: false, MFRef: 'No Matching MFRef found' } }, Success: true });
  assert.equal(r.outcome, 'not_found');
});

test('a real reference is found at the documented path', () => {
  const r = parse({ Data: { MFRefResult: { Success: true, MFRef: 'MF35566326' } }, Success: true });
  assert.equal(r.outcome, 'found');
  assert.equal(r.mfRef, 'MF35566326');
});

test('the sentinel string is never mistaken for a reference', () => {
  // Success omitted, so only the string itself can save us.
  assert.equal(parse({ Data: { MFRefResult: { MFRef: 'No Matching MFRef found' } } }).outcome, 'not_found');
  assert.equal(parse({ Data: { MFRefResult: { MFRef: 'N/A' } } }).outcome, 'not_found');
  assert.equal(parse({ Data: { MFRefResult: { MFRef: 'none' } } }).outcome, 'not_found');
});

test('Success:false wins even when a reference-shaped string is present', () => {
  const r = parse({ Data: { MFRefResult: { Success: false, MFRef: 'MF12345678' } } });
  assert.equal(r.outcome, 'not_found');
});

test('legacy shapes still resolve', () => {
  assert.equal(parse({ Data: { MFRef: 'MF999' } }).mfRef, 'MF999');
  assert.equal(parse({ MFRef: 'MF888' } as any).mfRef, 'MF888');
  assert.equal(parse({ Data: 'MF777' }).mfRef, 'MF777');
});

test('whitespace is trimmed', () => {
  assert.equal(parse({ Data: { MFRefResult: { Success: true, MFRef: '  MF35566326  ' } } }).mfRef, 'MF35566326');
});

test('an empty or shapeless payload is not_found, never a reference', () => {
  assert.equal(parse(null).outcome, 'not_found');
  assert.equal(parse({}).outcome, 'not_found');
  assert.equal(parse({ Data: null }).outcome, 'not_found');
  assert.equal(parse({ Data: { MFRefResult: { Success: true, MFRef: '' } } }).outcome, 'not_found');
});

console.log(`\n${passed} passed`);
console.log('\nNote: the third outcome, "unknown", is returned when the HTTP call itself');
console.log('throws — it cannot be produced by parsing and is covered by the route logic.');
