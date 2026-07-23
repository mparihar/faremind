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
import { chargeOriginalCard, refundCollection } from './customer-collect';

function mfRefOf(booking: any): string | null {
  return booking?.pnrs?.find((p: any) => p.providerOrderId)?.providerOrderId
    || booking?.mystiflyMfRef
    || booking?.masterPnr
    || null;
}

export interface ReissueQuote {
  fareDifference: number;   // USD, converted
  penalty: number;          // USD, converted
  serviceFee: number;       // USD
  totalCollect: number;     // USD (fareDifference + serviceFee)
  currency: string;         // always 'USD' for the collect
  providerCurrency: string; // provider's native currency
  ptrNumber: string;
  raw: any;
}

export async function getReissueQuote(booking: any, newFareSourceCode: string): Promise<ReissueQuote> {
  const mfRef = mfRefOf(booking);
  if (!mfRef) throw Object.assign(new Error('No Mystifly reference on this booking.'), { code: 'NO_PROVIDER_ORDER' });

  const result = await mystifly.reissueQuote(mfRef, newFareSourceCode);
  const data = result?.Data || result;
  const err = data?.Errors?.[0] || result?.Error;
  if (err && (err.Code || err.code)) {
    throw Object.assign(new Error(err.Message || err.message || 'Reissue quote failed'), { code: 'REISSUE_QUOTE_FAILED' });
  }

  const providerCurrency = (data?.Currency || data?.currency || 'USD').toUpperCase();
  const rawFareDiff = parseFloat(data?.TotalAmount || data?.totalAmount || '0');
  const rawPenalty = parseFloat(data?.PenaltyAmount || data?.penaltyAmount || '0');
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
    ptrNumber: String(data?.PtrId || data?.ptrId || '') || 'N/A',
    raw: result,
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
  params: { bookingId: string; newFareSourceCode: string; forcedBy?: string },
  booking: any,
): Promise<any> {
  const { newFareSourceCode, forcedBy } = params;
  const bookingId = booking.id;
  const mfRef = mfRefOf(booking);
  if (!mfRef) throw Object.assign(new Error('No Mystifly reference on this booking.'), { code: 'NO_PROVIDER_ORDER' });

  // 1. Quote (fare difference + penalty + service fee → USD)
  const quote = await getReissueQuote(booking, newFareSourceCode);
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
    reissueResult = await mystifly.postTicketingRequest(mfRef, 'ReIssue', undefined, newFareSourceCode);
    const err = reissueResult?.Data?.Errors?.[0] || reissueResult?.Error;
    if (err && (err.Code || err.code)) throw new Error(err.Message || err.message || 'Reissue failed');
  } catch (reErr: any) {
    // Reissue failed after we charged → refund the collection
    if (chargeId) {
      try { await refundCollection(chargeId); console.log(`[Reissue][Collect] refunded ${chargeId} after reissue failure`); }
      catch (rfErr: any) { console.error(`[Reissue][Collect] CRITICAL: refund of ${chargeId} failed after reissue failure: ${rfErr.message}`); }
    }
    throw Object.assign(new Error(`Reissue failed at the provider: ${reErr.message}.${chargeId ? ' Your charge has been refunded.' : ''}`), { code: 'REISSUE_FAILED' });
  }

  const ptrNumber = String(reissueResult?.Data?.PtrId || reissueResult?.Data?.ptrId || quote.ptrNumber || 'N/A');
  console.log(`[Reissue][PTR] forcedBy=${forcedBy || 'STAFF'} bookingRef=${booking.masterBookingReference} mfRef=${mfRef} ptrNumber=${ptrNumber} executed=true collected=${quote.totalCollect} USD`);

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
      eventType: 'REISSUE_COMPLETED',
      eventTitle: 'Ticket reissued (change) + difference collected',
      eventDescription: `Reissued to a new fare. Collected $${quote.totalCollect} (fare difference $${quote.fareDifference} + service fee $${quote.serviceFee}). Provider PTR ${ptrNumber}.`,
      actorType: forcedBy?.startsWith('ADMIN') ? 'admin' : 'agent',
      payloadJson: { quote, chargeId, newFareSourceCode, ptrNumber },
    },
  }).catch(() => {});

  await prisma.masterBooking.update({
    where: { id: bookingId },
    data: { revalidatedFareSourceCode: newFareSourceCode },
  }).catch(() => {});

  return {
    success: true,
    ptrNumber,
    collected: quote.totalCollect,
    currency: 'USD',
    fareDifference: quote.fareDifference,
    penalty: quote.penalty,
    serviceFee: quote.serviceFee,
    chargeId,
    servicePaymentId: servicePayment?.id ?? null,
  };
}
