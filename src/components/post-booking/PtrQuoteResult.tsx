'use client';

import React from 'react';
import { CheckCircle2, XCircle, Clock, RefreshCw, Loader2 } from 'lucide-react';

/**
 * The result of a void / refund / reissue quote.
 *
 * Shared by the agent and admin post-booking consoles. Those two pages are otherwise
 * near-identical copies that already drifted: the admin one still rendered the original
 * TotalAmount/PenaltyAmount keys — which match none of the three quote shapes — so every
 * quote fell through to a raw JSON dump, and its reissue button never showed an amount.
 * Keeping this in one place is what stops that happening again.
 *
 * Reissue is priced from GetExchangeQuote. TotalFareDifference already includes the
 * airline penalty, so the penalty is shown for information and never added on top.
 */

export interface PtrQuoteResultProps {
  quoteResult: any;
  /** Currency formatter supplied by the host page. */
  fmt: (n: number, c?: string) => string;
  /**
   * Re-read a quote already raised at the provider. Distinct from quoting
   * again, which would raise a second PTR just to see a number.
   */
  onRefresh?: () => void;
  refreshing?: boolean;
}

export default function PtrQuoteResult({ quoteResult, fmt, onRefresh, refreshing }: PtrQuoteResultProps) {
  if (!quoteResult) return null;

  // A reissue that could not be auto-charged is parked, not failed: the customer has been
  // asked to pay and the change goes to the airline by itself once they do. Showing this
  // as a plain red error would have staff retrying something that is already in hand.
  if (quoteResult.errorCode === 'REISSUE_PAYMENT_REQUESTED') {
    return (
      <div className="p-4 rounded-xl border mb-3 bg-amber-400/10 border-amber-400/25">
        <p className="text-amber-300 text-sm font-bold mb-1">Awaiting customer payment</p>
        <p className="text-slate-300 text-[13px]">
          {quoteResult.amountDue != null
            ? <>The customer has been asked for <span className="text-white font-bold">{fmt(quoteResult.amountDue, quoteResult.currency || 'USD')}</span>. </>
            : <>The customer has been sent a payment request. </>}
          Nothing has been charged and the ticket is unchanged. The change is sent to the airline automatically once they pay.
        </p>
        <p className="text-[11px] text-slate-400 mt-2">{quoteResult.error}</p>
        {quoteResult.servicePaymentId && (
          <p className="text-[11px] text-slate-500 mt-1 font-mono">Payment {quoteResult.servicePaymentId}</p>
        )}
      </div>
    );
  }

  if (quoteResult.error) {
    return (
      <div className="p-4 rounded-xl border mb-3 bg-red-400/10 border-red-400/20">
        <p className="text-red-400 text-sm font-semibold flex items-center gap-2">
          <XCircle size={14} /> {quoteResult.error}
        </p>
      </div>
    );
  }

  const priced = quoteResult.priced;
  const advice = quoteResult.couponAdvice;
  const q = quoteResult.quote;

  // Mystifly prices a void/refund asynchronously. Until it answers there are no
  // amounts — and summing the empty array to 0 printed "$0.00 refund" on a fare
  // the airline had said was refundable. An unanswered quote says so.
  if (quoteResult.quotePending) {
    return (
      <div className="p-4 rounded-xl border mb-3 bg-amber-400/10 border-amber-400/25">
        <p className="text-amber-300 text-sm font-bold flex items-center gap-2 mb-1">
          <Clock size={14} /> Quote requested — awaiting the airline
        </p>
        <p className="text-slate-300 text-[13px]">
          {quoteResult.pendingMessage
            || 'The airline has not priced this yet. Re-check the PTR status shortly; do not execute until an amount is returned.'}
        </p>
        <p className="text-[11px] text-slate-400 mt-2">
          Provider PTR {quoteResult.providerPtrId ?? '—'}
          {quoteResult.ptrStatus ? ` · ${quoteResult.ptrStatus}` : ''}
          {quoteResult.resolution ? ` · ${quoteResult.resolution}` : ''}
        </p>
        {onRefresh && quoteResult.ptrId && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="mt-3 flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-400/15 border border-amber-400/25 text-amber-300 text-xs font-bold hover:bg-amber-400/25 disabled:opacity-50"
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Check for the airline&apos;s price
          </button>
        )}
        <p className="text-[10px] text-slate-500 mt-2">
          This re-reads the quote already raised — it does not create another one. It is also checked automatically every couple of minutes.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl border mb-3 bg-emerald-400/10 border-emerald-400/20">
      <p className="text-emerald-400 text-sm font-bold flex items-center gap-2 mb-2">
        <CheckCircle2 size={14} /> Quote received
      </p>

      {/* Reissue — what the customer will be charged. */}
      {priced && (
        <div className="mb-3 rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Amount to collect from customer</p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Fare difference</span><span className="text-white">{fmt(priced.fareDifference, priced.currency)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Airline penalty <span className="text-[10px] text-slate-600">(included above)</span></span><span className="text-amber-400">{fmt(priced.penalty, priced.currency)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">FareMind service fee</span><span className="text-white">{fmt(priced.serviceFee, priced.currency)}</span></div>
            <div className="flex justify-between border-t border-slate-700 pt-1 mt-1 font-black text-white"><span>Total to charge</span><span>{fmt(priced.totalCollect, priced.currency)}</span></div>
          </div>
          {priced.providerCurrency && priced.providerCurrency !== priced.currency && (
            <p className="text-[10px] text-slate-500 mt-2">Converted from {priced.providerCurrency}.</p>
          )}
          {quoteResult.optionCount > 1 && (
            <p className="text-[10px] text-slate-500 mt-1">
              {quoteResult.optionCount} fare options returned; showing option {priced.preferenceOption}.
            </p>
          )}
          <p className="text-[11px] text-emerald-300/80 mt-2">
            The card is charged when you execute, before the change is sent to the airline.
          </p>
        </div>
      )}

      {quoteResult.pricingError && (
        <p className="text-amber-400 text-xs font-semibold mb-2">{quoteResult.pricingError}</p>
      )}

      {/* The airline's own verdict on whether these coupons can still be serviced.
          Advisory — the provider quotes regardless, and the demo environment reports
          every coupon as N/A. */}
      {/* A coupon the airline did not report is unknown, not closed. Presenting
          "0 of N open · NOT valid for REFUND" for an unreported ticket read as a
          refusal the airline never gave. Only a genuinely closed coupon warns. */}
      {advice?.checked && advice.closedSegments > 0 && (
        <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
          <p className="text-amber-300 text-xs font-bold">
            {advice.summary || `${advice.closedSegments} of ${advice.totalSegments} coupons are no longer open`}
          </p>
          {(advice.warnings || []).map((w: string, i: number) => (
            <p key={i} className="text-[11px] text-amber-200/80 mt-1">{w}</p>
          ))}
          <p className="text-[11px] text-slate-400 mt-1.5">
            The quote above may still be accepted by the provider, but fulfilment can fail. Verify before charging the customer.
          </p>
        </div>
      )}
      {advice?.checked && advice.unreported && (
        <p className="text-[11px] text-slate-400 mb-3">
          The airline did not report coupon status for this booking, so eligibility could not be checked.
        </p>
      )}

      {/* Void / refund figures. These are the keys the provider actually returns —
          void gives TotalVoidingFee, refund gives TotalRefundCharges/CancellationCharge. */}
      {q && !priced && (
        <div className="grid grid-cols-3 gap-3 mb-2">
          {q.TotalRefundAmount != null && (
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase">Refund Amount</p>
              <p className="text-sm font-black text-emerald-400">{fmt(q.TotalRefundAmount, q.Currency)}</p>
            </div>
          )}
          {(q.TotalVoidingFee ?? q.CancellationCharge) != null && (
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase">
                {q.TotalVoidingFee != null ? 'Voiding Fee' : 'Cancellation Charge'}
              </p>
              <p className="text-sm font-black text-amber-400">{fmt(q.TotalVoidingFee ?? q.CancellationCharge, q.Currency)}</p>
            </div>
          )}
          {q.TotalRefundCharges != null && (
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase">Total Charges</p>
              <p className="text-sm font-black text-amber-400">{fmt(q.TotalRefundCharges, q.Currency)}</p>
            </div>
          )}
        </div>
      )}

      <details className="bg-slate-900/50 border border-slate-700/30 rounded-xl mt-2">
        <summary className="px-3 py-2 text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-300 uppercase tracking-wider">Raw Response</summary>
        <pre className="px-3 pb-3 text-xs text-slate-400 font-mono overflow-x-auto max-h-48">{JSON.stringify(quoteResult, null, 2)}</pre>
      </details>
    </div>
  );
}
