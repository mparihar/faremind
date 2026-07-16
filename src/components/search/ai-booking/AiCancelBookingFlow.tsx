/**
 * AiCancelBookingFlow — Cancel booking sub-flow inside the AI Bot.
 * Shows: eligibility check → cancellation summary → confirm → success/failure.
 */

'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle, Check, XCircle, Loader2, Shield, ArrowLeft,
  Mail, CreditCard, Plane, Info,
} from 'lucide-react';
import { useManageBookingStore } from '@/store/useManageBookingStore';
import type { CancelQuoteData, CancelSuccessData } from '@/store/useManageBookingStore';
import { fmtCurrency, formatBookingDate } from '@/lib/ai-manage-booking-utils';

interface Props {
  bookingId: string;
  bookingReference: string;
  pnrCode: string | undefined;
  route: string;
  departureDate: string;
  onBack: () => void;
  onDone: () => void;
}

type CancelStep = 'loading_quote' | 'show_quote' | 'confirming' | 'success' | 'failure';

export default function AiCancelBookingFlow({
  bookingId,
  bookingReference,
  pnrCode,
  route,
  departureDate,
  onBack,
  onDone,
}: Props) {
  const store = useManageBookingStore();
  const { cancelQuote, cancelSuccess, cancelLoading, cancelError } = store;

  // Determine current step
  const step: CancelStep = cancelSuccess
    ? 'success'
    : cancelError && !cancelQuote
      ? 'failure'
      : cancelLoading && !cancelQuote
        ? 'loading_quote'
        : cancelLoading && cancelQuote
          ? 'confirming'
          : cancelQuote
            ? 'show_quote'
            : 'loading_quote';

  // Load quote on mount
  useEffect(() => {
    store.loadCancelQuote(bookingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  const handleConfirm = async () => {
    if (!cancelQuote) return;
    const success = await store.confirmCancel(bookingId, cancelQuote.quoteId, cancelQuote.refundMethod);
    if (!success && store.cancelError) {
      // Failure is handled by step detection
    }
  };

  // ── Loading Quote ──────────────────────────────────────────────────────────
  if (step === 'loading_quote') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#1ABC9C]/5 border border-[#1ABC9C]/20">
          <Loader2 className="w-4 h-4 text-[#1ABC9C] animate-spin" />
          <span className="text-[12px] font-semibold text-[#0e9e83]">
            Checking cancellation eligibility…
          </span>
        </div>
      </motion.div>
    );
  }

  // ── Failure ────────────────────────────────────────────────────────────────
  if (step === 'failure') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <div className="px-4 py-4 rounded-xl border border-red-200 bg-red-50/50 space-y-3">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-[13px] font-bold text-red-700">
              Cancellation Could Not Be Completed
            </span>
          </div>

          <div className="space-y-1.5 px-1">
            <div className="flex items-start gap-2">
              <Info className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-red-600 leading-snug">
                {cancelError || 'This booking is not eligible for online cancellation.'}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-red-600 leading-snug">
                Please contact FareMind Support for assistance.
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onBack}
          className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Booking
        </button>
      </motion.div>
    );
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (step === 'success' && cancelSuccess) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <div className="px-4 py-4 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
              <Check className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-[13px] font-bold text-emerald-700">
              {cancelSuccess.cancellationMethod === 'VOID'
                ? 'Booking Cancelled Successfully'
                : 'Cancellation & Refund Submitted'}
            </span>
          </div>

          <div className="space-y-2 bg-white rounded-lg border border-emerald-200/50 px-3 py-2.5">
            <InfoRow label="FareMind Reference" value={cancelSuccess.bookingReference} />
            {pnrCode && <InfoRow label="Airline PNR" value={pnrCode} />}
            <InfoRow label="Cancellation Type" value={cancelSuccess.cancellationMethod === 'VOID' ? 'Immediate Void' : 'Refund'} highlight />
            <InfoRow label="Status" value={cancelSuccess.cancellationMethod === 'VOID' ? 'Ticket voided' : 'Cancellation submitted'} highlight />
            <InfoRow
              label="Estimated Refund"
              value={cancelSuccess.refundAmount > 0 
                ? fmtCurrency(cancelSuccess.refundAmount, cancelSuccess.refundCurrency) 
                : 'Non-refundable'}
              bold
              highlight={cancelSuccess.refundAmount > 0}
            />
            <InfoRow label="Refund Timeline" value={cancelSuccess.refundTimeline || '5–10 business days'} />
            <InfoRow
              label="Refund Method"
              value={cancelSuccess.refundMethod === 'AIRLINE_CREDIT' ? 'Airline Credit' : 'Original Payment'}
            />
          </div>

          <div className="flex items-center gap-2 px-1">
            <Mail className="w-3 h-3 text-emerald-500" />
            <span className="text-[10px] text-emerald-600 font-medium">
              Email confirmation has been sent.
            </span>
          </div>
        </div>

        <button
          onClick={onDone}
          className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-[11px] font-bold text-white bg-gradient-to-r from-[#1ABC9C] to-emerald-500 shadow-md shadow-[#1ABC9C]/20 transition-all active:scale-[0.98]"
        >
          Done
        </button>
      </motion.div>
    );
  }

  // ── Show Quote + Confirm ───────────────────────────────────────────────────
  if ((step === 'show_quote' || step === 'confirming') && cancelQuote) {
    const q = cancelQuote;
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-1">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-[13px] font-bold text-slate-800">Cancel Booking</span>
        </div>

        {/* Summary Card */}
        <div className="px-3 py-3 rounded-xl border border-slate-200 bg-white space-y-2.5">
          <InfoRow label="FareMind Reference" value={q.bookingReference} />
          {(q.airlinePnr || pnrCode) && <InfoRow label="Airline PNR" value={q.airlinePnr || pnrCode!} />}
          <InfoRow label="Route" value={q.route || route} />
          <InfoRow label="Departure" value={formatBookingDate(q.departureDate || departureDate)} />

          {/* Void badge */}
          {q.cancellationMethod === 'VOID' && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200">
              <Shield className="w-3 h-3 text-emerald-500" />
              <span className="text-[10px] font-semibold text-emerald-600">Eligible for immediate cancellation</span>
            </div>
          )}

          {/* Refund Breakdown */}
          <div className="pt-2 border-t border-slate-100 space-y-1.5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                {q.cancellationMethod === 'VOID' ? 'Cancellation Summary' : 'Refund Estimate'}
              </p>
              {q.refundability && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                  q.refundability === 'FULL_REFUND'
                    ? 'bg-emerald-100 text-emerald-600'
                    : q.refundability === 'PARTIAL_REFUND'
                      ? 'bg-amber-100 text-amber-600'
                      : 'bg-red-100 text-red-500'
                }`}>
                  {q.refundability === 'FULL_REFUND'
                    ? 'Fully Refundable'
                    : q.refundability === 'PARTIAL_REFUND'
                      ? 'Partially Refundable'
                      : 'Non-refundable'}
                </span>
              )}
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500">Original Fare</span>
              <span className="font-semibold text-slate-700">{fmtCurrency(q.originalAmount, q.currency)}</span>
            </div>
            {q.airlinePenalty > 0 && (
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Airline Penalty</span>
                <span className="font-semibold text-red-500">-{fmtCurrency(q.airlinePenalty, q.currency)}</span>
              </div>
            )}
            {(q.supplierFee ?? 0) > 0 && (
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Supplier Fee</span>
                <span className="font-semibold text-red-500">-{fmtCurrency(q.supplierFee, q.currency)}</span>
              </div>
            )}
            {q.fareMindFee > 0 && (
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">FAREMIND Service Fee</span>
                <span className="font-semibold text-red-500">-{fmtCurrency(q.fareMindFee, q.currency)}</span>
              </div>
            )}
            <div className="flex justify-between text-[12px] pt-1 border-t border-dashed border-slate-200">
              <span className="font-bold text-slate-700">Estimated Refund</span>
              <span className={`font-black ${q.estimatedRefund > 0 ? 'text-emerald-600' : 'text-red-500 italic'}`}>
                {q.estimatedRefund > 0 ? fmtCurrency(q.estimatedRefund, q.refundCurrency || q.currency) : 'Non-refundable'}
              </span>
            </div>
          </div>

          {/* Refund Method */}
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <CreditCard className="w-3 h-3 text-slate-400" />
            <span>
              {q.estimatedRefund > 0
                ? `Original Payment · ${q.refundTimeline || '5–10 business days'}`
                : 'No refund will be issued for this non-refundable ticket'}
            </span>
          </div>
        </div>

        {/* Warning */}
        {q.warningMessage && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-700 leading-snug">{q.warningMessage}</p>
          </div>
        )}

        {/* Confirmation prompt */}
        <p className="text-[11px] text-slate-500 text-center font-medium">
          Please confirm that you want to cancel booking <span className="font-bold text-slate-700">{q.bookingReference}</span>.
        </p>

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onBack}
            disabled={step === 'confirming'}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all disabled:opacity-50"
          >
            Keep Booking
          </button>
          <button
            onClick={handleConfirm}
            disabled={step === 'confirming'}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold text-white bg-gradient-to-r from-red-500 to-red-600 shadow-md shadow-red-500/20 transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            {step === 'confirming' ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Cancelling…
              </>
            ) : (
              'Confirm Cancellation'
            )}
          </button>
        </div>

        {/* Cancel error during confirmation */}
        {cancelError && step === 'confirming' && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-red-600 leading-snug">{cancelError}</p>
          </div>
        )}
      </motion.div>
    );
  }

  return null;
}

// ── Helper: Info row ────────────────────────────────────────────────────────

function InfoRow({ label, value, bold, highlight }: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-start text-[11px]">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className={`text-right ${bold ? 'font-bold text-slate-800' : highlight ? 'font-bold text-[#1ABC9C]' : 'font-semibold text-slate-600'}`}>
        {value}
      </span>
    </div>
  );
}
