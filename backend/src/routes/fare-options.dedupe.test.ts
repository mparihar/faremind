/**
 * Run: cd backend && npx tsx --test src/routes/fare-options.dedupe.test.ts
 *
 * Mystifly returns the same product twice — same journey, same price, same
 * baggage, same rules — under two FareSourceCodes, sometimes one carrying the
 * airline's brand and one carrying none. Every dedupe upstream keys on the
 * FareSourceCode, so both survived and the panel offered "Economy Fare 1" and
 * "Economy Fare 2" with nothing to choose between them.
 *
 * Observed on DEL-YYZ: two offers at $2741.40, one branded STANDARD, one blank.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { __testing } from './fare-options';

const { dedupeIndistinguishable } = __testing;

const offer = (o: Partial<any>): any => ({
  providerOfferId: `FSC-${Math.random().toString(36).slice(2, 8)}`,
  cabinClass: 'economy',
  totalPrice: 2741.4,
  checkedBaggageAllowance: '1PC',
  cabinBaggageAllowance: '7KG',
  fareRules: { refundable: false, changeable: true, cancellationFee: null, changeFee: 0 },
  ...o,
});

test('two offers a customer cannot tell apart collapse to one', () => {
  const out = dedupeIndistinguishable([
    offer({ airlineFareFamily: 'STANDARD' }),
    offer({ airlineFareFamily: '' }),
  ]);
  assert.equal(out.length, 1);
});

test('the branded copy is the one kept — same fare, more information', () => {
  const blankFirst = dedupeIndistinguishable([
    offer({ airlineFareFamily: '' }),
    offer({ airlineFareFamily: 'STANDARD' }),
  ]);
  assert.equal(blankFirst[0].airlineFareFamily, 'STANDARD');

  const brandFirst = dedupeIndistinguishable([
    offer({ airlineFareFamily: 'STANDARD' }),
    offer({ airlineFareFamily: '' }),
  ]);
  assert.equal(brandFirst[0].airlineFareFamily, 'STANDARD');
});

test('a different price is a real alternative and is kept', () => {
  const out = dedupeIndistinguishable([
    offer({ totalPrice: 2741.4 }),
    offer({ totalPrice: 2890.0 }),
  ]);
  assert.equal(out.length, 2);
});

test('a different baggage allowance is a real alternative', () => {
  const out = dedupeIndistinguishable([
    offer({ checkedBaggageAllowance: '1PC' }),
    offer({ checkedBaggageAllowance: '2PC' }),
  ]);
  assert.equal(out.length, 2);
});

test('different refund or change terms are real alternatives', () => {
  const refund = dedupeIndistinguishable([
    offer({ fareRules: { refundable: false, changeable: true, cancellationFee: null, changeFee: 0 } }),
    offer({ fareRules: { refundable: true, changeable: true, cancellationFee: 50, changeFee: 0 } }),
  ]);
  assert.equal(refund.length, 2);

  const fee = dedupeIndistinguishable([
    offer({ fareRules: { refundable: false, changeable: true, cancellationFee: null, changeFee: 0 } }),
    offer({ fareRules: { refundable: false, changeable: true, cancellationFee: null, changeFee: 75 } }),
  ]);
  assert.equal(fee.length, 2);
});

test('two genuinely different brands at the same price both survive', () => {
  // Same money, different products — the airline is offering a real choice
  // only if something else differs; here the baggage does.
  const out = dedupeIndistinguishable([
    offer({ airlineFareFamily: 'ECO VALUE', checkedBaggageAllowance: '0KG' }),
    offer({ airlineFareFamily: 'ECO FLEX', checkedBaggageAllowance: '1PC' }),
  ]);
  assert.equal(out.length, 2);
});

test('a real ladder is left completely alone', () => {
  const ladder = [
    offer({ airlineFareFamily: 'FLY LIGHT', totalPrice: 400, checkedBaggageAllowance: '0KG' }),
    offer({ airlineFareFamily: 'FLY WITH CHECKED BAG', totalPrice: 525, checkedBaggageAllowance: '25KG' }),
    offer({ airlineFareFamily: 'FLY PRO', totalPrice: 529, checkedBaggageAllowance: '0KG' }),
    offer({ airlineFareFamily: 'FLY GRANDE', totalPrice: 687, checkedBaggageAllowance: '25KG' }),
  ];
  assert.equal(dedupeIndistinguishable(ladder).length, 4);
});

test('a single offer and an empty list are handled', () => {
  assert.equal(dedupeIndistinguishable([offer({})]).length, 1);
  assert.equal(dedupeIndistinguishable([]).length, 0);
});
