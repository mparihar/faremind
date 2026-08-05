'use client';

import React from 'react';
import { CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import RawResponse from './RawResponse';

/**
 * The outcome of executing a void / refund / reissue.
 *
 * Shared by the agent and admin consoles. Both previously showed a flat
 * "Operation completed successfully" for anything without an `error`, which is wrong for
 * this family of operations — most of them do not complete synchronously:
 *
 *   - a reissue that could not be auto-charged is AWAITING PAYMENT, not failed
 *   - accepting a reissue returns InProcess with an SLA; the ticket is not reissued yet
 *   - a void or refund can succeed at the provider while the customer refund fails
 *
 * Reporting any of those as plain success is how an operator walks away from something
 * still outstanding, so each gets its own state here.
 */

export interface PtrExecResultProps {
  execResult: any;
  fmt: (n: number, c?: string) => string;
}

export default function PtrExecResult({ execResult, fmt }: PtrExecResultProps) {
  if (!execResult) return null;

  // Parked on the customer's payment.
  if (execResult.awaitingPayment || execResult.errorCode === 'REISSUE_PAYMENT_REQUESTED') {
    return (
      <div className="p-4 rounded-xl border mb-3 bg-amber-400/10 border-amber-400/25">
        <p className="text-amber-300 text-sm font-bold flex items-center gap-2 mb-1">
          <Clock size={14} /> Awaiting customer payment
        </p>
        <p className="text-slate-300 text-[13px]">
          {execResult.amountDue != null
            ? <>The customer has been asked for <span className="text-white font-bold">{fmt(execResult.amountDue, execResult.currency || 'USD')}</span>. </>
            : <>The customer has been sent a payment request. </>}
          Nothing has been charged and the ticket is unchanged — the change goes to the airline automatically once they pay.
        </p>
        {execResult.error && <p className="text-[11px] text-slate-400 mt-2">{execResult.error}</p>}
        {execResult.servicePaymentId && (
          <p className="text-[11px] text-slate-500 mt-1 font-mono">Payment {execResult.servicePaymentId}</p>
        )}
      </div>
    );
  }

  // The airline repriced between quote and execute; nothing was charged.
  if (execResult.errorCode === 'REISSUE_PRICE_CHANGED') {
    return (
      <div className="p-4 rounded-xl border mb-3 bg-amber-400/10 border-amber-400/25">
        <p className="text-amber-300 text-sm font-bold flex items-center gap-2 mb-1">
          <AlertTriangle size={14} /> Price changed — nothing charged
        </p>
        <p className="text-slate-300 text-[13px]">{execResult.error}</p>
        <p className="text-[11px] text-slate-400 mt-2">Take a fresh quote and confirm the new amount with the customer.</p>
      </div>
    );
  }

  if (execResult.error) {
    return (
      <div className="p-4 rounded-xl border mb-3 bg-red-400/10 border-red-400/20">
        <p className="text-red-400 text-sm font-semibold flex items-center gap-2"><XCircle size={14} /> {execResult.error}</p>
        <RawResponse data={execResult} />
      </div>
    );
  }

  // Provider accepted but has not fulfilled yet.
  const pending = execResult.pendingFulfilment === true;
  // Void/refund succeeded at the provider but the customer's money did not move.
  const refundIssue = execResult.customerRefund && execResult.customerRefund.issued === false
    && !execResult.customerRefund.alreadyRefunded;

  return (
    <div className={`p-4 rounded-xl border mb-3 ${pending || refundIssue ? 'bg-amber-400/10 border-amber-400/25' : 'bg-emerald-400/10 border-emerald-400/20'}`}>
      <p className={`text-sm font-bold flex items-center gap-2 ${pending || refundIssue ? 'text-amber-300' : 'text-emerald-400'}`}>
        {pending ? <><Clock size={14} /> Submitted — awaiting the airline</>
          : refundIssue ? <><AlertTriangle size={14} /> Completed at the provider, with a problem</>
          : <><CheckCircle2 size={14} /> Operation completed</>}
      </p>

      {execResult.message && <p className="text-slate-300 text-[13px] mt-1">{execResult.message}</p>}

      {execResult.warning && (
        <p className="text-amber-300 text-[13px] mt-2 font-semibold">{execResult.warning}</p>
      )}

      {execResult.customerRefund?.issued && (
        <p className="text-slate-300 text-[13px] mt-2">
          Refunded <span className="text-white font-bold">{fmt(execResult.customerRefund.amount, execResult.customerRefund.currency || 'USD')}</span> to the original card.
        </p>
      )}

      {pending && execResult.slaInMinutes && (
        <p className="text-[11px] text-slate-400 mt-2">
          The airline fulfils this within about {execResult.slaInMinutes} minutes. The booking updates on its own once confirmed — no action needed.
        </p>
      )}

      <RawResponse data={execResult} />
    </div>
  );
}


