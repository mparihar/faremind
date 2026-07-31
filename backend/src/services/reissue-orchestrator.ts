/**
 * Reissue + Collect Difference orchestrator (Mystifly).
 *
 * A staff-driven (agent/admin) reissue that:
 *   1. Quotes the reissue against a NEW FareSourceCode (fare difference + penalty),
 *      converting the provider amount to USD via the FX service.
 *   2. Adds the FareMind service fee (per ticket) → total to collect from the customer.
 *   3. Auto-charges the customer's ORIGINAL card off-session; on failure it does NOT
 *      reissue — it records a pending ServicePayment task and returns COLLECT_FAILED.
 *   4. Executes the provider reissue. If that fails after a successful charge, the
 *      charge is refunded.
 *   5. Records a ServicePayment (DATE_CHANGE) + BookingEvent.
 *
 * Logs: [Reissue][Quote], [Reissue][Collect] (Stripe), [Reissue][PTR].
 */

import { prisma } from '../lib/db';
import * as mystifly from './mystifly';
import { getAdminServiceFee } from './cancellation-orchestrator';
import { toUsd } from './fx';
import { chargeOriginalCard, refundCollectionWithAudit } from './customer-collect';
import { buildPtrPassengers } from '../lib/ptr-passengers';
import { backfillEticketsFromTripDetails } from '../lib/eticket-backfill';
import * as mbq from '../lib/manage-booking-queries';

function mfRefOf(booking: any): string | null {
  return booking?.pnrs?.find((p: any) => p.providerOrderId)?.providerOrderId
    || booking?.mystiflyMfRef
    || booking?.masterPnr
    || null;
}

/**
 * Build the `originDestinations` array Mystifly requires on a ReIssueQuote — one entry
 * per journey, from the booking loaded by getMasterBookingFull (journeys + segments).
 * Journey-level origin/destination/departure are non-nullable; the first segment is
 * read only for its cabin.
 */
function buildOriginDestinations(booking: any): mystifly.MystiflyReissueOriginDestination[] {
  const journeys = booking?.journeys || [];
  return journeys.map((j: any) => ({
    originLocationCode: j.originAirport,
    destinationLocationCode: j.destinationAirport,
    // Date at midnight, per Mystifly's ReissueQuoteRQ contract — a wall-clock time would
    // narrow the search instead of returning the whole day's options.
    departureDateTime: `${new Date(j.departureDateTime).toISOString().slice(0, 10)}T00:00:00`,
    cabinPreference: mystifly.toCabinType(j.segments?.[0]?.cabin || j.cabinSummary || 'economy'),
  }));
}

export interface ReissueQuote {
  fareDifference: number;   // USD, converted
  penalty: number;          // USD, converted
  serviceFee: number;       // USD
  totalCollect: number;     // USD (fareDifference + serviceFee)
  currency: string;         // always 'USD' for the collect
  providerCurrency: string; // provider's native currency
  ptrNumber: string;
  providerPtrId: number;    // PTRId — required to execute the reissue
  preferenceOption: number; // which quoted option these amounts belong to
  raw: any;
}

export async function getReissueQuote(
  booking: any,
  newFareSourceCode: string,
  preferenceOption: number = 1,
  originDestinationsOverride?: mystifly.MystiflyReissueOriginDestination[],
): Promise<ReissueQuote> {
  const mfRef = mfRefOf(booking);
  if (!mfRef) throw Object.assign(new Error('No Mystifly reference on this booking.'), { code: 'NO_PROVIDER_ORDER' });

  // Mystifly's ReIssueQuote is an OND request (reissueQuoteRequestType = None|OND|Segment)
  // and requires both `originDestinations` and `passengers` — there is no reissue-by-
  // FareSourceCode in the PTR contract. `newFareSourceCode` is retained for our own
  // records (ServicePayment / BookingEvent / revalidatedFareSourceCode) but cannot be
  // sent to the provider. Calling this with 2 args passed the FSC string into the
  // originDestinations slot and omitted passengers, so every request 500'd.
  // A caller changing the flight supplies its own routing; otherwise re-quote the
  // itinerary the booking already has.
  const originDestinations = (Array.isArray(originDestinationsOverride) && originDestinationsOverride.length > 0)
    ? originDestinationsOverride
    : buildOriginDestinations(booking);
  const passengers = buildPtrPassengers(booking);
  if (originDestinations.length === 0 || passengers.length === 0) {
    throw Object.assign(
      new Error('Cannot quote a reissue: this booking has no journeys or no passengers on file.'),
      { code: 'REISSUE_QUOTE_INCOMPLETE' },
    );
  }

  let result = await mystifly.reissueQuote(mfRef, originDestinations, passengers);

  // A stored e-ticket goes stale when the airline replaces it — most obviously after an
  // earlier reissue — and the provider then rejects the number we sent. Re-read the
  // numbers and try once more, so a booking that has been reissued before is not stuck.
  if (result?.Success === false && /e-?ticket\s*(number)?\s*(is)?\s*(wrong|invalid|incorrect|not\s*valid)/i.test(String(result?.Message || ''))) {
    console.warn(`[Reissue][Quote] ${mfRef}: provider rejected the stored e-ticket ("${result.Message}") — refreshing and retrying once.`);
    const r = await backfillEticketsFromTripDetails(booking.id, mfRef, { force: true }).catch(() => null);
    if (r && r.updated > 0) {
      const reloaded = await mbq.getMasterBookingFull(booking.id);
      const refreshed = reloaded ? buildPtrPassengers(reloaded) : passengers;
      if (refreshed.map((p) => p.eTicket).join(',') !== passengers.map((p) => p.eTicket).join(',')) {
        result = await mystifly.reissueQuote(mfRef, originDestinations, refreshed);
      }
    }
  }

  const data = result?.Data || result;
  const err = data?.Errors?.[0] || result?.Error;
  if (err && (err.Code || err.code)) {
    throw Object.assign(new Error(err.Message || err.message || 'Reissue quote failed'), { code: 'REISSUE_QUOTE_FAILED' });
  }
  if (result?.Success === false) {
    throw Object.assign(new Error(result.Message || 'Reissue quote failed'), { code: 'REISSUE_QUOTE_FAILED' });
  }

  // ReIssueQuote returns ONLY {PTRId, PTRType, MFRef, SLAInMinutes, PTRStatus} — it carries
  // no amounts. The priced options live in GetExchangeQuote (Search PTR) under
  // RequestedPreferences[].QuotedFares[]. Reading TotalAmount/PenaltyAmount off the quote
  // response yields 0 and silently drops the fare difference from the amount collected.
  const ptrId = Number(data?.PTRId ?? data?.PtrId ?? 0);
  if (!ptrId) {
    throw Object.assign(new Error('Reissue quote returned no PTR id.'), { code: 'REISSUE_QUOTE_FAILED' });
  }

  const exchange = await mystifly.getExchangeQuote(mfRef, ptrId);
  const exData = exchange?.Data || exchange;
  const preferences = Array.isArray(exData?.RequestedPreferences) ? exData.RequestedPreferences : [];
  const chosen = preferences.find((p: any) => Number(p?.Option) === preferenceOption) || preferences[0];
  const quotedFares: any[] = Array.isArray(chosen?.QuotedFares) ? chosen.QuotedFares : [];
  if (quotedFares.length === 0) {
    throw Object.assign(
      new Error('The airline returned no priced options for this reissue.'),
      { code: 'REISSUE_NO_OPTIONS' },
    );
  }

  // TotalFareDifference is the total for the whole booking, NOT a per-head amount —
  // confirmed by Mystifly. PassengerCount is informational; multiplying by it would
  // bill a 2-passenger reissue twice. Sum the rows (one per passenger type) as-is.
  const sumFares = (pick: (f: any) => any) => quotedFares.reduce(
    (s, f) => s + (parseFloat(pick(f)) || 0), 0);

  const providerCurrency = (quotedFares[0]?.Currency || data?.Currency || 'USD').toUpperCase();
  const rawFareDiff = sumFares((f) => f.TotalFareDifference);
  const rawPenalty = sumFares((f) => f.Penalty);
  const fareDifference = providerCurrency !== 'USD' ? await toUsd(rawFareDiff, providerCurrency) : rawFareDiff;
  const penalty = providerCurrency !== 'USD' ? await toUsd(rawPenalty, providerCurrency) : rawPenalty;

  const serviceFee = await getAdminServiceFee(booking);
  const totalCollect = Math.round((Math.max(0, fareDifference) + Math.max(0, serviceFee)) * 100) / 100;

  return {
    fareDifference: Math.round(fareDifference * 100) / 100,
    penalty: Math.round(penalty * 100) / 100,
    serviceFee: Math.round(serviceFee * 100) / 100,
    totalCollect,
    currency: 'USD',
    providerCurrency,
    ptrNumber: String(ptrId),
    providerPtrId: ptrId,
    preferenceOption: Number(chosen?.Option) || preferenceOption,
    raw: { quote: result, exchange },
  };
}

async function recordPendingCollect(booking: any, quote: ReissueQuote, forcedBy: string | undefined, reason: string) {
  try {
    await prisma.servicePayment.create({
      data: {
        bookingId: booking.id,
        userId: booking.userId ?? null,
        serviceType: 'DATE_CHANGE',
        description: `Reissue difference to collect: fare diff $${quote.fareDifference} + service fee $${quote.serviceFee} = $${quote.totalCollect}. ${reason}`,
        amount: quote.totalCollect,
        currency: 'USD',
        status: 'PENDING',
        customerEmail: booking.customerEmail ?? 'unknown@unknown.com',
        customerName: booking.customerName ?? 'Customer',
        customerPhone: booking.pnrs?.[0]?.phone ?? null,
        requestedBy: forcedBy?.startsWith('ADMIN') ? 'ADMIN' : 'AGENT',
        notes: reason,
      },
    });
  } catch { /* best-effort */ }
}

export async function initiateReissue(
  params: {
    bookingId: string;
    newFareSourceCode: string;
    forcedBy?: string;
    preferenceOption?: number;
    originDestinations?: mystifly.MystiflyReissueOriginDestination[];
    /** Total the operator was shown and approved; abort rather than charge more. */
    expectedTotalCollect?: number;
  },
  booking: any,
): Promise<any> {
  const { newFareSourceCode, forcedBy } = params;
  const bookingId = booking.id;
  const mfRef = mfRefOf(booking);
  if (!mfRef) throw Object.assign(new Error('No Mystifly reference on this booking.'), { code: 'NO_PROVIDER_ORDER' });

  // 1. Quote (fare difference + penalty + service fee → USD)
  const quote = await getReissueQuote(booking, newFareSourceCode, params.preferenceOption ?? 1, params.originDestinations);

  // Airline pricing is live, so the amount can move between the quote the operator
  // approved and this one. Never silently charge more than was agreed.
  if (params.expectedTotalCollect != null && quote.totalCollect > params.expectedTotalCollect + 1) {
    throw Object.assign(
      new Error(`The airline price changed: the quote is now $${quote.totalCollect.toFixed(2)} but $${Number(params.expectedTotalCollect).toFixed(2)} was approved. Re-quote and confirm the new amount.`),
      { code: 'REISSUE_PRICE_CHANGED', quotedTotalCollect: quote.totalCollect, expectedTotalCollect: params.expectedTotalCollect },
    );
  }
  console.log(`[Reissue][Quote] forcedBy=${forcedBy || 'STAFF'} bookingRef=${booking.masterBookingReference} mfRef=${mfRef} ptrNumber=${quote.ptrNumber} fareDifference=${quote.fareDifference} penalty=${quote.penalty} serviceFee=${quote.serviceFee} totalCollect=${quote.totalCollect} USD (providerCcy=${quote.providerCurrency})`);

  // 2. Collect the difference from the customer (off-session on the original card)
  let chargeId: string | null = null;
  if (quote.totalCollect > 0) {
    const collect = await chargeOriginalCard(booking, quote.totalCollect, {
      description: `Reissue difference — ${booking.masterBookingReference}`,
      kind: 'reissue_collect',
    });
    if (collect.status === 'NO_SAVED_CARD') {
      await recordPendingCollect(booking, quote, forcedBy, 'No saved card available for off-session charge — collect via payment link, then retry reissue.');
      console.warn(`[Reissue][Collect] status=NO_SAVED_CARD bookingRef=${booking.masterBookingReference} amount=${quote.totalCollect}`);
      throw Object.assign(new Error('Could not auto-charge the reissue difference (no saved card on file). A payment task was created — collect the payment, then execute the reissue.'), { code: 'COLLECT_REQUIRES_PAYMENT' });
    }
    if (collect.status === 'FAILED') {
      await recordPendingCollect(booking, quote, forcedBy, `Off-session charge failed: ${collect.error}`);
      console.error(`[Reissue][Collect] status=FAILED bookingRef=${booking.masterBookingReference} amount=${quote.totalCollect}: ${collect.error}`);
      throw Object.assign(new Error(`Could not charge the reissue difference: ${collect.error}. A payment task was created — collect the payment, then retry.`), { code: 'COLLECT_FAILED' });
    }
    chargeId = collect.chargeId;
    console.log(`[Reissue][Collect] status=CHARGED paymentIntent=${chargeId} amount=${quote.totalCollect} USD bookingRef=${booking.masterBookingReference}`);
  }

  // 3. Execute the provider reissue
  let reissueResult: any;
  try {
    // Accept the quoted option: re-post with AcceptQuote=yes + the ReIssueQuote PTR id.
    // The generic postTicketingRequest body (mFRef/ptrType/NewFareSourceCode) is not a
    // valid PTR request — Mystifly 500s on it — and NewFareSourceCode is not part of the
    // contract at all.
    reissueResult = await mystifly.confirmReissue(mfRef, quote.providerPtrId, quote.preferenceOption);
    const err = reissueResult?.Data?.Errors?.[0] || reissueResult?.Error;
    if (err && (err.Code || err.code)) throw new Error(err.Message || err.message || 'Reissue failed');
    // A provider failure also arrives as an HTTP-200 envelope with Success=false and no
    // error code. Without this check the charge is kept and the booking is recorded as
    // reissued even though nothing happened at the airline.
    if (reissueResult?.Success === false) {
      throw new Error(reissueResult.Message || 'Reissue rejected by the airline');
    }
  } catch (reErr: any) {
    // Reissue failed after we charged → give the money back, with a record of it, and
    // raise a ticket if the refund itself fails rather than logging into the void.
    let reversal: { refunded: boolean; error?: string } | null = null;
    if (chargeId) {
      reversal = await refundCollectionWithAudit({
        bookingId,
        chargeId,
        amount: quote.totalCollect,
        reason: 'the airline rejected the reissue',
        eventType: 'REISSUE_REFUNDED',
        bookingRef: booking.masterBookingReference,
      });
    }
    const refundNote = !chargeId
      ? ''
      : reversal?.refunded
        ? ' Your charge has been refunded.'
        : ' IMPORTANT: the refund of your charge did not go through — support has been notified and will refund it manually.';
    throw Object.assign(new Error(`Reissue failed at the provider: ${reErr.message}.${refundNote}`), {
      code: 'REISSUE_FAILED',
      refundIssued: reversal?.refunded ?? null,
    });
  }

  // Accepting returns PTRType=ReIssue / PTRStatus=InProcess with an SLA (typically 60
  // min): the airline has NOT reissued yet. Treat this as SUBMITTED, not completed —
  // reissue-settlement advances the booking once the provider reports
  // Resolution=Reissued, and refunds the collection if it is rejected.
  const execData = reissueResult?.Data || reissueResult || {};
  const ptrNumber = String(execData?.PTRId ?? execData?.PtrId ?? quote.ptrNumber ?? 'N/A');
  const execPtrStatus = execData?.PTRStatus || 'InProcess';
  const slaInMinutes = execData?.SLAInMinutes ?? null;
  const settled = /completed/i.test(execPtrStatus);
  console.log(`[Reissue][PTR] forcedBy=${forcedBy || 'STAFF'} bookingRef=${booking.masterBookingReference} mfRef=${mfRef} ptrNumber=${ptrNumber} ptrStatus=${execPtrStatus} settled=${settled} sla=${slaInMinutes ?? '-'}min collected=${quote.totalCollect} USD`);

  // Queue fulfilment polling with the collection attached, so a later rejection refunds
  // the customer automatically.
  let settlementId: string | null = null;
  if (!settled) {
    try {
      const cr = await prisma.changeRequest.create({
        data: {
          bookingId,
          type: 'DATE_CHANGE',
          status: 'PROVIDER_PROCESSING',
          requestedBy: forcedBy || 'STAFF',
          requestedData: { newFareSourceCode, preferenceOption: quote.preferenceOption } as any,
          totalCost: quote.totalCollect,
          currency: 'USD',
          providerPtrId: String(quote.providerPtrId),
          providerMfRef: mfRef,
          providerResponse: reissueResult as any,
          collectedChargeId: chargeId ?? null,
          collectedAmount: quote.totalCollect > 0 ? quote.totalCollect : null,
          // First poll ~30 min after accept; reissue-settlement widens the back-off.
          nextCheckAt: new Date(Date.now() + 30 * 60 * 1000),
        } as any,
      });
      settlementId = cr.id;
    } catch (e) {
      console.error(`[Reissue][PTR] CRITICAL: could not queue settlement for ${bookingId} — fulfilment will not be verified: ${(e as Error).message}`);
    }
  }

  // 4. Records
  const servicePayment = await prisma.servicePayment.create({
    data: {
      bookingId,
      userId: booking.userId ?? null,
      serviceType: 'DATE_CHANGE',
      description: `Reissue: fare difference $${quote.fareDifference} + service fee $${quote.serviceFee} = $${quote.totalCollect}. New FSC applied.`,
      amount: quote.totalCollect,
      currency: 'USD',
      status: chargeId ? 'SUCCEEDED' : 'PENDING',
      stripePaymentIntentId: chargeId,
      customerEmail: booking.customerEmail ?? 'unknown@unknown.com',
      customerName: booking.customerName ?? 'Customer',
      requestedBy: forcedBy?.startsWith('ADMIN') ? 'ADMIN' : 'AGENT',
      paidAt: chargeId ? new Date() : null,
    },
  }).catch(() => null);

  await prisma.bookingEvent.create({
    data: {
      bookingId,
      // Submitted ≠ reissued. reissue-settlement writes CHANGE_CONFIRMED once the
      // provider reports Resolution=Reissued, or CHANGE_REJECTED (+ refund) if not.
      eventType: settled ? 'REISSUE_COMPLETED' : 'REISSUE_SUBMITTED',
      eventTitle: settled
        ? 'Ticket reissued (change) + difference collected'
        : 'Reissue submitted to the airline + difference collected',
      eventDescription: settled
        ? `Reissued to a new fare. Collected $${quote.totalCollect} (fare difference $${quote.fareDifference} + service fee $${quote.serviceFee}). Provider PTR ${ptrNumber}.`
        : `Reissue request accepted by the provider (PTR ${ptrNumber}, status ${execPtrStatus}${slaInMinutes ? `, SLA ~${slaInMinutes} min` : ''}). The ticket is NOT reissued yet — fulfilment is being polled and the booking updates once the airline confirms. Collected $${quote.totalCollect} (fare difference $${quote.fareDifference} + service fee $${quote.serviceFee}); it is refunded automatically if the airline rejects the reissue.`,
      actorType: forcedBy?.startsWith('ADMIN') ? 'admin' : 'agent',
      // Cast: ReissueQuote is a declared interface, so it has no index signature and
      // Prisma's InputJsonValue rejects it structurally.
      payloadJson: { quote, chargeId, newFareSourceCode, ptrNumber, execPtrStatus, settlementId } as any,
    },
  }).catch(() => {});

  // Only bind the new fare to the booking once the airline has actually reissued;
  // otherwise the booking would advertise a fare it is not yet ticketed on.
  if (settled) {
    await prisma.masterBooking.update({
      where: { id: bookingId },
      data: { revalidatedFareSourceCode: newFareSourceCode },
    }).catch(() => {});
  }

  return {
    success: true,
    ptrNumber,
    ptrStatus: execPtrStatus,
    settled,
    pendingFulfilment: !settled,
    slaInMinutes,
    settlementId,
    status: settled ? 'REISSUED' : 'SUBMITTED',
    message: settled
      ? 'Reissue completed by the provider.'
      : `Reissue submitted. The airline fulfils it${slaInMinutes ? ` within ~${slaInMinutes} minutes` : ' shortly'}; the booking updates automatically once confirmed.`,
    collected: quote.totalCollect,
    currency: 'USD',
    fareDifference: quote.fareDifference,
    penalty: quote.penalty,
    serviceFee: quote.serviceFee,
    chargeId,
    servicePaymentId: servicePayment?.id ?? null,
  };
}
