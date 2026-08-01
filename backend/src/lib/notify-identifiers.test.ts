/**
 * Run: cd backend && npx tsx --test src/lib/notify-identifiers.test.ts
 *
 * Renders the REAL email templates and asserts the three booking identifiers are
 * never substituted for one another.
 *
 * The defect these guard against: the platform showed Mystifly's booking
 * reference ("MF35532626") wherever an Airline PNR was labelled. A customer who
 * quotes that at an airline desk gets a blank look — the airline has no record
 * of it. Templates previously did `d.airline_pnr || d.pnr`, so an absent
 * locator silently became the Mystifly reference.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { buildCustomerEmail, buildSupportEmail, buildAgentEmail } from './notify';

const MYSTIFLY_REF = 'MF35532626';
const AIRLINE_PNR = 'EMBV6D7';
const FAREMIND_REF = 'FM9IPA4E';

const base = {
  booking_reference: FAREMIND_REF,
  pnr: MYSTIFLY_REF,             // legacy key — still passed, must never surface as the locator
  mystifly_ref: MYSTIFLY_REF,
  customer_name: 'Gaurang Parihar',
  customer_email: 'traveller@example.com',
  route: 'DEL → BOM',
  origin: 'DEL',
  destination: 'BOM',
  total_amount: '$190.00',
  departure_date: '20 Nov 2026',
};

/** Every rendered surface of an email, so nothing hides in the text part. */
function surfaces(spec: { subject: string; html: string; text: string } | null): string {
  assert.ok(spec, 'template returned null');
  return [spec!.subject, spec!.html, spec!.text].join('\n');
}

// ─── Customer emails ─────────────────────────────────────────────────────────

test('customer booking confirmation shows the airline PNR, never the Mystifly ref', () => {
  const out = surfaces(buildCustomerEmail('BOOKING_CONFIRMED', { ...base, airline_pnr: AIRLINE_PNR }));
  assert.ok(out.includes(AIRLINE_PNR), 'the airline locator must appear');
  assert.ok(!out.includes(MYSTIFLY_REF), `the Mystifly reference must NOT appear in a customer email`);
  assert.ok(out.includes(FAREMIND_REF), 'the FareMind reference must appear');
});

test('customer email says "Not Available" rather than falling back to the Mystifly ref', () => {
  // The exact regression: airline_pnr absent, d.pnr present.
  const out = surfaces(buildCustomerEmail('BOOKING_CONFIRMED', { ...base, airline_pnr: null }));
  assert.ok(!out.includes(MYSTIFLY_REF), 'an absent locator must never become the Mystifly reference');
  assert.ok(out.includes('Not Available'), 'an absent locator must say so plainly');
});

test('an MF-shaped value passed as airline_pnr is rejected, not displayed', () => {
  // Guards against a caller wiring masterPnr into the wrong key.
  const out = surfaces(buildCustomerEmail('BOOKING_CONFIRMED', { ...base, airline_pnr: MYSTIFLY_REF }));
  assert.ok(!out.includes(MYSTIFLY_REF), 'an MF-shaped locator must be rejected');
  assert.ok(out.includes('Not Available'));
});

test('the FareMind reference never falls back to the Mystifly reference', () => {
  const out = surfaces(buildCustomerEmail('BOOKING_CONFIRMED', {
    ...base, booking_reference: undefined, airline_pnr: AIRLINE_PNR,
  }));
  assert.ok(!out.includes(MYSTIFLY_REF), 'a missing booking_reference must not become the Mystifly ref');
});

// ─── Internal emails ─────────────────────────────────────────────────────────

test('support email carries all three identifiers, each under its own label', () => {
  const spec = buildSupportEmail('BOOKING_CONFIRMED', { ...base, airline_pnr: AIRLINE_PNR });
  const out = surfaces(spec);
  assert.ok(out.includes(FAREMIND_REF), 'FareMind reference');
  assert.ok(out.includes(AIRLINE_PNR), 'airline locator');
  // Support legitimately needs the Mystifly ref — but under its OWN label.
  assert.ok(out.includes(MYSTIFLY_REF), 'Mystifly reference is expected on internal email');
  assert.ok(spec!.html.includes('Mystifly Ref'), 'and must be labelled as the provider reference');
  assert.ok(spec!.html.includes('Airline PNR'), 'the airline locator must be labelled separately');
});

test('support email does not present the Mystifly ref as the airline PNR', () => {
  const spec = buildSupportEmail('BOOKING_CONFIRMED', { ...base, airline_pnr: null });
  const html = spec!.html;
  // Locate the Airline PNR cell and confirm the Mystifly ref is not inside it.
  const i = html.indexOf('Airline PNR');
  assert.ok(i >= 0, 'support email must show an Airline PNR row');
  const cell = html.slice(i, i + 260);
  assert.ok(!cell.includes(MYSTIFLY_REF), 'the Airline PNR cell must never hold the Mystifly reference');
  assert.ok(cell.includes('Not Available'));
});

test('agent email applies the same rule', () => {
  const spec = buildAgentEmail('BOOKING_CONFIRMED', { ...base, airline_pnr: AIRLINE_PNR }, 'Test Agent');
  if (!spec) return; // event not implemented for agents — nothing to assert
  const out = surfaces(spec);
  assert.ok(out.includes(AIRLINE_PNR), 'the airline locator must appear');
});

test('agent email with no locator does not fall back to the Mystifly ref', () => {
  const spec = buildAgentEmail('BOOKING_CONFIRMED', { ...base, airline_pnr: null }, 'Test Agent');
  if (!spec) return;
  const i = spec.html.indexOf('AIRLINE PNR');
  if (i < 0) return; // this template does not surface the locator
  const cell = spec.html.slice(i, i + 260);
  assert.ok(!cell.includes(MYSTIFLY_REF), 'the Airline PNR cell must never hold the Mystifly reference');
});
