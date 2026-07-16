'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  X, Loader2, AlertTriangle, Check, XCircle, Mail, ArrowLeft,
  ShieldAlert, CreditCard, Clock, ChevronRight,
} from 'lucide-react';
import { useManageBookingStore } from '@/store/useManageBookingStore';

interface Props {
  bookingId: string;
  onClose: () => void;
  /** Where to navigate after a successful cancellation */
  successRedirect?: string;
}

const fmt = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);

type Step = 'loading' | 'review' | 'confirming' | 'success' | 'error';

const LOADING_MESSAGES = [
  'Checking cancellation eligibility…',
  'Retrieving airline fare rules…',
  'Calculating refund estimate…',
];

export default function CancelBookingModal({ bookingId, onClose, successRedirect }: Props) {
  const router = useRouter();
  const {
    cancelQuote, cancelSuccess, cancelLoading, cancelError,
    loadCancelQuote, confirmCancel, loadBookingDetail, loadActions, loadTimeline,
    setCancelSuccess,
  } = useManageBookingStore();

  const [step, setStep] = useState<Step>('loading');
  const [msgIdx, setMsgIdx] = useState(0);
  const [refundMethodChoice, setRefundMethodChoice] = useState<'ORIGINAL_PAYMENT' | 'AIRLINE_CREDIT'>('ORIGINAL_PAYMENT');
  const [localError, setLocalError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Cycle through loading messages
  useEffect(() => {
    if (step !== 'loading') return;
    const t = setInterval(() => setMsgIdx(i => Math.min(i + 1, LOADING_MESSAGES.length - 1)), 1200);
    return () => clearInterval(t);
  }, [step]);

  // Fetch eligibility on mount
  useEffect(() => {
    mountedRef.current = true;
    loadCancelQuote(bookingId).then(() => {
      if (mountedRef.current) setStep('review');
    }).catch(() => {
      if (mountedRef.current) { setLocalError('Could not retrieve cancellation information. Please try again.'); setStep('error'); }
    });
    return () => { mountedRef.current = false; };
  }, [bookingId, loadCancelQuote]);

  // If the quote endpoint returned an error through the store
  useEffect(() => {
    if (cancelError && step === 'loading') {
      setLocalError(cancelError);
      setStep('error');
    }
  }, [cancelError, step]);

  async function handleConfirm() {
    if (!cancelQuote) return;
    setStep('confirming');
    const ok = await confirmCancel(bookingId, cancelQuote.quoteId, refundMethodChoice);
    if (!mountedRef.current) return;
    if (ok) {
      setStep('success');
      // Refresh booking state in background
      loadBookingDetail(bookingId).catch(() => {});
      loadActions(bookingId).catch(() => {});
      loadTimeline(bookingId).catch(() => {});
    } else {
      // Read the latest error from the store (it was set inside confirmCancel)
      const latestError = useManageBookingStore.getState().cancelError;
      setLocalError(latestError || 'The airline could not process your cancellation. Please contact support.');
      setStep('error');
    }
  }

  function handleDone() {
    setCancelSuccess(null);
    onClose();
    if (successRedirect) router.push(successRedirect);
  }

  const overlayClose = () => {
    if (step === 'confirming' || step === 'loading') return; // block close while processing
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={overlayClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-md bg-[#0f1525] border border-white/10 rounded-2xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Loading ─────────────────────────────── */}
        {step === 'loading' && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-full bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mb-5">
              <Loader2 className="w-6 h-6 text-[#1ABC9C] animate-spin" />
            </div>
            <p className="text-white font-bold text-lg mb-2">Checking Eligibility</p>
            <motion.p
              key={msgIdx}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-slate-400 text-sm"
            >
              {LOADING_MESSAGES[msgIdx]}
            </motion.p>
            <div className="flex gap-1.5 mt-5">
              {LOADING_MESSAGES.map((_, i) => (
                <div key={i} className={`h-1 rounded-full transition-all duration-500 ${i <= msgIdx ? 'w-6 bg-[#1ABC9C]' : 'w-1.5 bg-slate-700'}`} />
              ))}
            </div>
          </div>
        )}
        {/* ── Review (also visible during confirming) ── */}
        {(step === 'review' || step === 'confirming') && cancelQuote && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <XCircle size={15} className="text-red-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-sm">Cancel Booking</h3>
                </div>
              </div>
              <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1" disabled={step === 'confirming'}>
                <X size={17} />
              </button>
            </div>

            <div className="relative min-h-[200px] overflow-hidden">
              {/* Processing overlay */}
              {step === 'confirming' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 z-10 bg-[#0f1525]/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3 rounded-b-2xl"
                >
                  <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-red-400 animate-spin" />
                  </div>
                  <p className="text-white font-bold text-base">Processing Cancellation</p>
                  <p className="text-slate-400 text-xs">Contacting the airline — please wait…</p>
                  <p className="text-slate-600 text-[10px] mt-2">Do not close this window</p>
                </motion.div>
              )}

              <div className={`px-5 py-4 space-y-4 ${step === 'confirming' ? 'opacity-30 pointer-events-none' : ''}`}>
                {/* Booking Details */}
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">FareMind Reference</span>
                      <span className="text-white font-bold font-mono">{cancelQuote.bookingReference}</span>
                    </div>
                    {cancelQuote.airlinePnr && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Airline PNR</span>
                        <span className="text-white font-bold font-mono">{cancelQuote.airlinePnr}</span>
                      </div>
                    )}
                    {cancelQuote.route && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Route</span>
                        <span className="text-white font-medium">{cancelQuote.route}</span>
                      </div>
                    )}
                    {cancelQuote.departureDate && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Departure</span>
                        <span className="text-white font-medium">{new Date(cancelQuote.departureDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Cancellation type badge */}
                {cancelQuote.cancellationMethod === 'VOID' && (
                  <div className="flex items-center gap-2 bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-xl px-3 py-2">
                    <Shield size={13} className="text-[#1ABC9C] shrink-0" />
                    <p className="text-[#1ABC9C] text-xs font-semibold">Eligible for immediate cancellation — full amount returned</p>
                  </div>
                )}

                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      {cancelQuote.cancellationMethod === 'VOID' ? 'Cancellation Summary' : 'Refund Estimate'}
                    </p>
                    {cancelQuote.refundability && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        cancelQuote.refundability === 'FULL_REFUND'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : cancelQuote.refundability === 'PARTIAL_REFUND'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}>
                        {cancelQuote.refundability === 'FULL_REFUND'
                          ? 'Fully Refundable'
                          : cancelQuote.refundability === 'PARTIAL_REFUND'
                            ? 'Partially Refundable'
                            : 'Non-refundable'}
                      </span>
                    )}
                  </div>
                  <div className="px-4 py-3 space-y-2.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Original Fare</span>
                      <span className="text-white font-medium">{fmt(cancelQuote.originalAmount, cancelQuote.currency)}</span>
                    </div>
                    {cancelQuote.airlinePenalty > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Airline Penalty</span>
                        <span className="text-red-400 font-medium">−{fmt(cancelQuote.airlinePenalty, cancelQuote.currency)}</span>
                      </div>
                    )}
                    {(cancelQuote.supplierFee ?? 0) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Supplier Fee</span>
                        <span className="text-red-400 font-medium">−{fmt(cancelQuote.supplierFee, cancelQuote.currency)}</span>
                      </div>
                    )}
                    {cancelQuote.fareMindFee > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">FAREMIND Service Fee</span>
                        <span className="text-red-400 font-medium">−{fmt(cancelQuote.fareMindFee, cancelQuote.currency)}</span>
                      </div>
                    )}
                    <div className="border-t border-white/[0.06] pt-2.5 flex justify-between items-center">
                      <span className="text-white font-bold">Estimated Refund</span>
                      <span className={`font-black text-lg ${cancelQuote.estimatedRefund > 0 ? 'text-[#1ABC9C]' : 'text-red-400 italic'}`}>
                        {cancelQuote.estimatedRefund > 0 ? fmt(cancelQuote.estimatedRefund, cancelQuote.refundCurrency || cancelQuote.currency) : 'Non-refundable'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Payment method & timeline */}
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <CreditCard size={12} className="text-slate-500 shrink-0" />
                  <span>
                    {cancelQuote.estimatedRefund > 0
                      ? `Original Payment · ${cancelQuote.refundTimeline || '5–10 business days'}`
                      : 'No refund will be issued for this non-refundable ticket'}
                  </span>
                </div>

                {/* Warning */}
                {cancelQuote.warningMessage && (
                  <div className="flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2.5">
                    <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-amber-200/70 text-xs leading-relaxed">{cancelQuote.warningMessage}</p>
                  </div>
                )}

                {/* Confirm text */}
                <p className="text-xs text-slate-400 text-center">
                  Please confirm that you want to cancel booking <span className="text-white font-bold">{cancelQuote.bookingReference}</span>.
                </p>
              </div>

              {/* Footer buttons */}
              <div className={`flex gap-3 px-5 pb-5 ${step === 'confirming' ? 'opacity-30 pointer-events-none' : ''}`}>
                <button
                  onClick={onClose}
                  disabled={step === 'confirming'}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-slate-400 font-semibold text-sm hover:bg-white/[0.04] transition-all"
                >
                  Keep Booking
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={step === 'confirming'}
                  className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm transition-all shadow-lg shadow-red-500/20 disabled:opacity-50"
                >
                  {step === 'confirming' ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Processing…
                    </span>
                  ) : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Success ─────────────────────────────── */}
        {step === 'success' && cancelSuccess && (
          <>
            <div className="px-5 pt-6 pb-4 text-center">
              <div className="w-16 h-16 rounded-full bg-[#1ABC9C]/10 border border-[#1ABC9C]/30 flex items-center justify-center mx-auto mb-4">
                <Check size={30} className="text-[#1ABC9C]" />
              </div>
              <h3 className="text-white font-black text-xl mb-1">
                {cancelSuccess.cancellationMethod === 'VOID'
                  ? 'Booking Cancelled'
                  : 'Cancellation Submitted'}
              </h3>
              <p className="text-slate-400 text-sm">
                Ref: <span className="font-mono font-bold text-white">{cancelSuccess.bookingReference}</span>
              </p>
              {cancelSuccess.cancellationMethod === 'VOID' && (
                <p className="text-[#1ABC9C] text-xs mt-1 font-semibold">Ticket voided — immediate cancellation</p>
              )}
            </div>

            {/* Refund card */}
            <div className="mx-5 mb-4 bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-2xl p-4 text-center">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                {cancelSuccess.cancellationMethod === 'VOID' ? 'Amount Returned' : 'Estimated Refund'}
              </p>
              <p className="text-3xl font-black text-[#1ABC9C]">
                {cancelSuccess.refundAmount > 0 ? fmt(cancelSuccess.refundAmount, cancelSuccess.refundCurrency) : 'Non-refundable'}
              </p>
              {cancelSuccess.refundAmount > 0 && (
                <div className="flex items-center justify-center gap-1.5 mt-2 text-xs text-slate-400">
                  <Clock size={11} />
                  <span>{cancelSuccess.refundTimeline}</span>
                  <span>·</span>
                  <span>{cancelSuccess.refundMethod === 'AIRLINE_CREDIT' ? 'Airline Credit' : 'Original Payment Method'}</span>
                </div>
              )}
            </div>

            <p className="text-center text-xs text-slate-500 mb-4 px-5">
              A cancellation confirmation has been sent to your email.
            </p>

            {/* Action buttons */}
            <div className="px-5 pb-5 space-y-2">
              <button
                onClick={handleDone}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#1ABC9C] hover:bg-[#16a085] text-white font-bold text-sm transition-all"
              >
                Return to My Trips
                <ChevronRight size={14} />
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white text-xs font-semibold hover:bg-white/[0.04] transition-all"
                >
                  Download Receipt
                </button>
                <button
                  onClick={() => { onClose(); router.push('/support'); }}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white text-xs font-semibold hover:bg-white/[0.04] transition-all"
                >
                  <Mail size={12} />
                  Contact Support
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Error ───────────────────────────────── */}
        {step === 'error' && (
          <>
            <div className="flex items-center justify-between px-5 pt-5 pb-0">
              <h3 className="text-white font-bold">Cancellation Failed</h3>
              <button onClick={onClose} className="text-slate-500 hover:text-white p-1">
                <X size={17} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
                  <ShieldAlert size={26} className="text-red-400" />
                </div>
                <p className="text-white font-bold mb-2">Unable to Cancel</p>
                <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
                  {localError || cancelError || 'An unexpected error occurred. Please try again or contact support.'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setStep('loading'); setMsgIdx(0); setLocalError(null); loadCancelQuote(bookingId).then(() => setStep('review')).catch(() => {}); }}
                  className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-white/10 text-slate-400 font-semibold text-sm hover:bg-white/[0.04] transition-all"
                >
                  <ArrowLeft size={13} /> Try Again
                </button>
                <button
                  onClick={() => { onClose(); router.push('/support'); }}
                  className="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-[#1ABC9C] hover:bg-[#16a085] text-white font-bold text-sm transition-all"
                >
                  <Mail size={13} /> Contact Support
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
