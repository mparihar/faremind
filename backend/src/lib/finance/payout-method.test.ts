/**
 * Run: cd backend && npx tsx src/lib/finance/payout-method.test.ts
 *
 * "Paid" means two different things, and the difference is the whole point of
 * this feature. An EXTERNAL_TRANSFER is a claim a human is making — the money
 * moved through a bank we cannot see, and the reference is the only link between
 * our record and theirs. A STRIPE_CONNECT payout is a receipt: the platform
 * moved it and Stripe can prove it.
 *
 * These assert the guards that keep the two from being confused.
 */
import assert from 'node:assert';
import { PLATFORM_COUNTRY } from './stripe-connect';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

/**
 * Mirrors blockedReasonFor in stripe-connect.ts, which is module-private
 * because nothing outside should be deciding transfer eligibility.
 */
function blocked(a: { country: string; detailsSubmitted: boolean; payoutsEnabled: boolean; disabledReason?: string | null }): string | null {
  if (a.country.toUpperCase() !== PLATFORM_COUNTRY) return 'domestic-only';
  if (!a.detailsSubmitted) return 'not-onboarded';
  if (!a.payoutsEnabled) return 'not-enabled';
  return null;
}

const OK = { country: PLATFORM_COUNTRY, detailsSubmitted: true, payoutsEnabled: true };

console.log('payout method rules');

// ── Domestic only ───────────────────────────────────────────────────────────

test('a same-country, fully verified account can be transferred to', () => {
  assert.equal(blocked(OK), null);
});

test('a different-country account is blocked BEFORE the transfer is attempted', () => {
  // Cross-border corridors differ per country. Finding out at the Stripe call
  // means the admin has already been told the agent was paid.
  const foreign = PLATFORM_COUNTRY === 'IN' ? 'US' : 'IN';
  assert.equal(blocked({ ...OK, country: foreign }), 'domestic-only');
});

test('country is compared case-insensitively', () => {
  assert.equal(blocked({ ...OK, country: PLATFORM_COUNTRY.toLowerCase() }), null);
});

test('country outranks verification — a verified foreign account still cannot receive', () => {
  const foreign = PLATFORM_COUNTRY === 'IN' ? 'US' : 'IN';
  assert.equal(blocked({ country: foreign, detailsSubmitted: true, payoutsEnabled: true }), 'domestic-only');
});

// ── Onboarding state ────────────────────────────────────────────────────────

test('an account that never finished onboarding is blocked', () => {
  assert.equal(blocked({ ...OK, detailsSubmitted: false }), 'not-onboarded');
});

test('submitted but not yet enabled is blocked — verification is not instant', () => {
  // details_submitted true and payouts_enabled false is the normal state while
  // Stripe verifies. Treating submitted as ready would fail at transfer time.
  assert.equal(blocked({ ...OK, payoutsEnabled: false }), 'not-enabled');
});

test('an account disabled after being enabled is blocked again', () => {
  // Verification lapses. A cached "enabled" from last week is not something to
  // pay against, which is why eligibility is re-checked at transfer time.
  assert.equal(blocked({ ...OK, payoutsEnabled: false, disabledReason: 'requirements.past_due' }), 'not-enabled');
});

// ── The reference requirement ───────────────────────────────────────────────

/** Mirrors the guard in payAgentCommission. */
const externalNeedsReference = (method: string, ref?: string | null) =>
  method === 'EXTERNAL_TRANSFER' && !String(ref ?? '').trim();

test('an external transfer without a reference is refused', () => {
  // Without it, "paid" is unverifiable: nothing connects our record to the bank
  // and the agent has nothing to match against their statement.
  assert.equal(externalNeedsReference('EXTERNAL_TRANSFER', null), true);
  assert.equal(externalNeedsReference('EXTERNAL_TRANSFER', '   '), true);
});

test('an external transfer with a reference is allowed', () => {
  assert.equal(externalNeedsReference('EXTERNAL_TRANSFER', 'NEFT-8837211'), false);
});

test('a platform transfer needs no manual reference — Stripe supplies one', () => {
  assert.equal(externalNeedsReference('STRIPE_CONNECT', null), false);
});

// ── Ordering ────────────────────────────────────────────────────────────────

test('the transfer happens BEFORE the payout is recorded', () => {
  // Recording first would leave a failed transfer marked PAID: the agent's
  // portal saying settled, their bank saying nothing, and the period closed so
  // it never appears in a payout run again. Asserted structurally.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'agent-commission-payout.ts'), 'utf8');
  const transferAt = src.indexOf('transferToAgent(');
  const createAt = src.indexOf('agentCommissionPayout.create(');
  assert.ok(transferAt > 0 && createAt > 0, 'expected both calls present');
  assert.ok(transferAt < createAt,
    'transferToAgent must run before the payout row is written');
});

test('a failed transfer writes no payout, leaving the month payable', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'agent-commission-payout.ts'), 'utf8');
  assert.match(src, /TRANSFER_FAILED/);
  // The early return must sit between the transfer and the create.
  const failAt = src.indexOf("outcome: 'TRANSFER_FAILED'");
  const createAt = src.indexOf('agentCommissionPayout.create(');
  assert.ok(failAt < createAt, 'the failure must return before anything is recorded');
});

console.log(`\n${passed} passed`);
