/**
 * Pending void/refund quote reconciliation.
 *
 * Mystifly prices a VoidQuote/RefundQuote asynchronously. The call returns
 * immediately with PTRStatus=InProcess, Resolution=QuoteRequested and an empty
 * quotes array; the amounts land later. Nothing watched for that, so a quote
 * that was answered five minutes after it was requested stayed "pending" until
 * an operator happened to ask again — and re-asking means a *new* PTR at the
 * provider, not a re-read of the old one.
 *
 * This polls the ones we know are outstanding and fills the amounts in.
 *
 *   1. searchPtrStatus(mfRef)          — cheap list read, has Resolution/PTRStatus
 *   2. when it flips to answered:
 *      searchPtr(type, mfRef, ptrId)   — targeted read that carries the amounts
 *
 * Deliberately conservative: if the answered response has no priced rows we can
 * recognise, the record is LEFT PENDING rather than written as zero. A quote
 * stuck pending is today's behaviour and merely inconvenient; a fabricated zero
 * is what this whole area was fixed for.
 */

import { prisma } from '../lib/db';
import * as mystifly from '../services/mystifly';
import * as mbq from '../lib/manage-booking-queries';

/** Stop polling a quote the airline has never priced. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH = 25;

/** Resolutions that mean the airline has finished with this quote. */
const ANSWERED = /quoteupdated|completed|quoted/i;
const REJECTED = /reject|declin|cancel|fail/i;

export interface PtrQuoteReconResult {
  ptrId: string;
  providerPtrId: string | null;
  outcome: 'still_pending' | 'priced' | 'rejected' | 'expired' | 'unreadable' | 'error';
  refundAmount?: number | null;
}

/** Pull the priced rows out of a PTR read, wherever the provider put them. */
export function extractQuoteRows(res: any): any[] {
  const roots = [res?.Data, res, res?.Data?.PTRDetail?.[0], res?.PTRDetail?.[0]].filter(Boolean);
  for (const r of roots) {
    for (const key of ['RefundQuotes', 'VoidQuotes', 'refundQuotes', 'voidQuotes']) {
      const rows = (r as any)?.[key];
      if (Array.isArray(rows) && rows.length > 0) return rows;
    }
  }
  return [];
}

/** The provider PTR id as stored in a quote response we already hold. */
export function ptrIdFromStoredResponse(raw: any): number | null {
  const v = raw?.Data?.PTRId ?? raw?.Data?.PtrId ?? raw?.PTRId ?? raw?.PtrId ?? null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const sum = (rows: any[], pick: (r: any) => any) =>
  rows.reduce((s, r) => s + (parseFloat(pick(r)) || 0), 0);

async function reconcileOne(rec: any): Promise<PtrQuoteReconResult> {
  const mfRef = rec.providerUniqueId;
  let providerPtrId = rec.providerRequestId ? Number(rec.providerRequestId) : null;
  const isVoid = rec.requestType === 'VOID_QUOTE';
  const base: PtrQuoteReconResult = { ptrId: rec.id, providerPtrId: rec.providerRequestId, outcome: 'still_pending' };

  // Quotes raised before providerRequestId was persisted still carry the id in
  // the response we stored at the time. Recover it rather than abandoning them,
  // and write it back so this only happens once.
  if (!providerPtrId) {
    const recovered = ptrIdFromStoredResponse(rec.providerQuoteResponse);
    if (!recovered) return { ...base, outcome: 'unreadable' };
    providerPtrId = recovered;
    base.providerPtrId = String(recovered);
    await prisma.postTicketingRequest.update({
      where: { id: rec.id }, data: { providerRequestId: String(recovered) },
    }).catch(() => {});
  }

  try {
    const list = await mystifly.searchPtrStatus(mfRef);
    const details = list?.Data?.PTRDetail ?? list?.PTRDetail ?? [];
    const mine = (Array.isArray(details) ? details : []).find((d: any) => Number(d?.PTRId) === providerPtrId);

    const resolution = String(mine?.Resolution ?? '');
    const status = String(mine?.PTRStatus ?? '');

    if (mine && REJECTED.test(resolution)) {
      await prisma.postTicketingRequest.update({
        where: { id: rec.id },
        data: {
          status: 'FAILED', failedAt: new Date(), providerStatus: status,
          failureReason: `The airline did not price this quote (${resolution || status}).`,
        },
      });
      return { ...base, outcome: 'rejected' };
    }

    if (!mine || !ANSWERED.test(resolution + ' ' + status)) {
      if (Date.now() - new Date(rec.createdAt).getTime() > MAX_AGE_MS) {
        await prisma.postTicketingRequest.update({
          where: { id: rec.id },
          data: {
            status: 'FAILED', failedAt: new Date(), providerStatus: status || null,
            failureReason: 'The airline did not price this quote within 24 hours. Request a fresh quote.',
          },
        });
        return { ...base, outcome: 'expired' };
      }
      if (status && status !== rec.providerStatus) {
        await prisma.postTicketingRequest.update({ where: { id: rec.id }, data: { providerStatus: status } }).catch(() => {});
      }
      return base;
    }

    // Answered — read the amounts off the PTR itself. Re-running the quote here
    // would raise a second PTR at the provider, which is exactly what must not
    // happen just to read a number.
    const detail = await mystifly.searchPtr(isVoid ? 'Void' : 'Refund', mfRef, providerPtrId);
    const rows = extractQuoteRows(detail);
    if (rows.length === 0) {
      // Answered but unreadable. Leave it pending rather than invent a zero.
      console.warn(`[PtrQuoteRecon] ${mfRef} PTR ${providerPtrId} reports ${resolution || status} but returned no priced rows — leaving pending.`);
      return { ...base, outcome: 'unreadable' };
    }

    const refundAmount = sum(rows, (r) => r.TotalRefundAmount);
    const penalty = isVoid
      ? sum(rows, (r) => r.TotalVoidingFee)
      : sum(rows, (r) => r.TotalRefundCharges ?? r.CancellationCharge);
    const currency = rows[0]?.Currency || 'USD';

    await prisma.postTicketingRequest.update({
      where: { id: rec.id },
      data: {
        status: 'QUOTE_RECEIVED',
        providerStatus: status || null,
        quoteTotalAmount: refundAmount,
        quoteRefundAmount: refundAmount,
        quotePenaltyAmount: penalty,
        quoteCurrency: currency,
        providerQuoteResponse: detail as any,
      },
    });

    await mbq.createBookingEvent({
      bookingId: rec.bookingId,
      eventType: isVoid ? 'VOID_QUOTE_PRICED' : 'REFUND_QUOTE_PRICED',
      eventTitle: `${isVoid ? 'Void' : 'Refund'} quote priced by the airline`,
      eventDescription: `The airline priced PTR ${providerPtrId}: refund ${refundAmount.toFixed(2)} ${currency}, ${isVoid ? 'voiding fee' : 'charges'} ${penalty.toFixed(2)} ${currency}. It can now be executed.`,
      actorType: 'system',
      actorName: 'PTR Quote Reconciliation',
      payloadJson: { providerPtrId, refundAmount, penalty, currency },
    }).catch(() => {});

    console.log(`[PtrQuoteRecon] ${mfRef} PTR ${providerPtrId} priced: refund ${refundAmount} ${currency}`);
    return { ...base, outcome: 'priced', refundAmount };
  } catch (err) {
    console.error(`[PtrQuoteRecon] ${mfRef} PTR ${providerPtrId} poll failed:`, (err as Error).message);
    return { ...base, outcome: 'error' };
  }
}

/**
 * Reconcile one quote on demand.
 *
 * The console holds its quote in memory, so once the cron fills the amounts in
 * there is no way for an operator to see them — except by running the quote
 * again, which raises a SECOND PTR at the provider. This lets the page re-read
 * the one it already has.
 */
export async function reconcilePtrQuoteById(recordId: string): Promise<PtrQuoteReconResult | null> {
  const rec = await prisma.postTicketingRequest.findUnique({ where: { id: recordId } });
  if (!rec) return null;
  if (rec.status !== 'QUOTE_PENDING') return { ptrId: rec.id, providerPtrId: rec.providerRequestId, outcome: 'still_pending' };
  return reconcileOne(rec);
}

export async function runPtrQuoteReconciliation(): Promise<PtrQuoteReconResult[]> {
  // QUOTE_PENDING is exactly what a new unanswered quote is written as, so that
  // is the whole queue. Records from before that status existed are left alone
  // deliberately: re-polling settled rows to repair historical test data would
  // add a branch that can touch legitimate quotes, for no benefit going forward.
  const pending = await prisma.postTicketingRequest.findMany({
    where: {
      provider: 'MYSTIFLY',
      status: 'QUOTE_PENDING',
      requestType: { in: ['VOID_QUOTE', 'REFUND_QUOTE'] },
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });
  if (pending.length === 0) return [];

  const results: PtrQuoteReconResult[] = [];
  for (const rec of pending) results.push(await reconcileOne(rec));
  return results;
}
