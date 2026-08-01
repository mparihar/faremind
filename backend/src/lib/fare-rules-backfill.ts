/**
 * Fare-rules backfill — correct the BookingPnr snapshot once the airline publishes it.
 *
 * BookingPnr is meant to freeze the terms the customer agreed to. It is written
 * during checkout, moments after Book — but Mystifly does not publish
 * `TripDetailsPTC_FareBreakdowns` until the ticket is issued. So at write time
 * the airline's own refund/exchange terms are usually absent, the confirm route
 * falls back to the search view, and the search view reports
 * `RefundAllowed=false` for fares the airline will in fact refund.
 *
 * Nothing corrected it afterwards, so a booking could sit permanently marked
 * non-refundable while TripDetails said:
 *
 *   AirRefundCharges   : IsRefundableBeforeDeparture   = "Yes",  charge 72.65
 *   AirExchangeCharges : IsExchangeableBeforeDeparture = "Yes",  charge 62.27
 *
 * That blocks self-service refund and change on a ticket the airline would
 * honour. Observed on FMBCCMXD.
 *
 * This runs at the ISSUED transition, when the breakdowns exist.
 */
import { prisma } from './db';
import * as mystifly from '../services/mystifly';

export interface ProviderFareRules {
  refundable: boolean;
  changeable: boolean;
  cancellationFee: number | null;
  changeFee: number | null;
}

/**
 * Read the airline's terms out of a TripDetails payload.
 *
 * Returns **null** when the breakdowns are absent, which is the whole point:
 * "we could not read it" and "the airline says no" are different answers, and
 * collapsing them is exactly the bug this file exists to fix. A caller that
 * gets null must leave the stored value alone.
 */
export function fareRulesFromTripDetails(raw: any): ProviderFareRules | null {
  try {
    const itinerary = raw?.Data?.TripDetailsResult?.TravelItinerary
      || raw?.Data?.TravelItinerary
      || raw?.TripDetailsResult?.TravelItinerary
      || raw?.TravelItinerary
      || raw;

    const breakdowns: any[] = Array.isArray(itinerary?.TripDetailsPTC_FareBreakdowns)
      ? itinerary.TripDetailsPTC_FareBreakdowns : [];
    if (breakdowns.length === 0) return null;

    const isYes = (v: any) => /^yes$/i.test(String(v ?? '').trim());
    const nums = (xs: any[]) => xs.map((n) => parseFloat(n)).filter((n) => Number.isFinite(n));

    // Permitted only when every priced passenger type permits it. The fee is the
    // worst case across them — quoting the cheapest understates the real cost.
    const refundFees = nums(breakdowns.flatMap((b) =>
      (b?.AirRefundCharges?.RefundCharges || []).flatMap((c: any) =>
        (c?.ChargesBeforeDeparture || []).map((x: any) => x?.Charges))));
    const changeFees = nums(breakdowns.flatMap((b) =>
      (b?.AirExchangeCharges?.ExchangeCharges || []).map((c: any) => c?.ChargeBeforeDeparture)));

    return {
      refundable: breakdowns.every((b) => isYes(b?.AirRefundCharges?.IsRefundableBeforeDeparture)),
      changeable: breakdowns.every((b) => isYes(b?.AirExchangeCharges?.IsExchangeableBeforeDeparture)),
      cancellationFee: refundFees.length ? Math.max(...refundFees) : null,
      changeFee: changeFees.length ? Math.max(...changeFees) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Refresh a booking's BookingPnr rows from the airline's published terms.
 *
 * Best-effort and non-throwing: a booking is not worth failing over a snapshot
 * refresh. Writes nothing when TripDetails still has no breakdowns, or when the
 * stored values already agree.
 *
 * Records a BookingEvent on any change, because a booking silently becoming
 * refundable is something support needs to be able to see.
 *
 * @param tripDetailsRaw already-fetched payload; fetched here when omitted.
 */
export async function backfillFareRulesFromTripDetails(
  bookingId: string,
  mfRef: string,
  tripDetailsRaw?: any,
): Promise<{ updated: number; rules: ProviderFareRules | null }> {
  const raw = tripDetailsRaw ?? await mystifly.getTripDetailsResilient(mfRef).catch(() => null);
  const rules = fareRulesFromTripDetails(raw);
  if (!rules) {
    console.log(`[FareRulesBackfill] ${mfRef}: no fare breakdowns yet — leaving the snapshot untouched`);
    return { updated: 0, rules: null };
  }

  const pnrs = await prisma.bookingPnr.findMany({
    where: { bookingId },
    select: { id: true, pnrCode: true, refundable: true, changeable: true, cancellationFee: true, changeFee: true },
  });

  let updated = 0;
  for (const pnr of pnrs) {
    const feeChanged = (stored: any, next: number | null) =>
      next !== null && Number(stored ?? NaN) !== next;

    const changes: Record<string, any> = {};
    if (pnr.refundable !== rules.refundable) changes.refundable = rules.refundable;
    if (pnr.changeable !== rules.changeable) changes.changeable = rules.changeable;
    if (feeChanged(pnr.cancellationFee, rules.cancellationFee)) changes.cancellationFee = rules.cancellationFee;
    if (feeChanged(pnr.changeFee, rules.changeFee)) changes.changeFee = rules.changeFee;
    if (Object.keys(changes).length === 0) continue;

    await prisma.bookingPnr.update({ where: { id: pnr.id }, data: changes });
    updated++;
    console.log(
      `[FareRulesBackfill] ${mfRef} pnr=${pnr.pnrCode}: ` +
      `refundable ${pnr.refundable}→${rules.refundable}, changeable ${pnr.changeable}→${rules.changeable}, ` +
      `refundFee ${pnr.cancellationFee ?? '-'}→${rules.cancellationFee ?? '-'}, ` +
      `changeFee ${pnr.changeFee ?? '-'}→${rules.changeFee ?? '-'}`,
    );
  }

  if (updated > 0) {
    await prisma.bookingEvent.create({
      data: {
        bookingId,
        eventType: 'FARE_RULES_REFRESHED',
        eventTitle: 'Fare rules refreshed from the airline',
        eventDescription:
          `The airline published its fare terms after ticketing: ` +
          `refundable=${rules.refundable}${rules.cancellationFee != null ? ` (fee ${rules.cancellationFee})` : ''}, ` +
          `changeable=${rules.changeable}${rules.changeFee != null ? ` (fee ${rules.changeFee})` : ''}. ` +
          `The booking snapshot was written before these were available and has been corrected.`,
        actorType: 'system',
      },
    }).catch((err) => {
      console.warn(`[FareRulesBackfill] event log failed for ${mfRef}:`, (err as Error).message);
    });
  }

  return { updated, rules };
}
