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
      setLocalError(cancelError || 'The airline could not process your cancellation. Please contact support.');
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

        {/* ── Review ──────────────────────────────── */}
        {step === 'review' && cancelQuote && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <XCircle size={15} className="text-red-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-sm">Cancel Booking</h3>
                  <p className="text-slate-500 text-[11px] font-mono">{cancelQuote.bookingReference}</p>
                </div>
              </div>
              <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
                <X size={17} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Refund breakdown */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Refund Estimate</p>
                  {(cancelQuote as any).fareRules && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      (cancelQuote as any).fareRules.refundable
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {(cancelQuote as any).fareRules.refundable ? 'Refundable fare' : 'Non-refundable fare'}
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
                  {cancelQuote.fareMindFee > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">FareMind Processing Fee</span>
                      <span className="text-red-400 font-medium">−{fmt(cancelQuote.fareMindFee, cancelQuote.currency)}</span>
                    </div>
                  )}
                  <div className="border-t border-white/[0.06] pt-2.5 flex justify-between items-center">
                    <span className="text-white font-bold">Estimated Refund</span>
                    <span className={`font-black text-lg ${cancelQuote.estimatedRefund > 0 ? 'text-[#1ABC9C]' : 'text-red-400'}`}>
                      {cancelQuote.estimatedRefund > 0 ? fmt(cancelQuote.estimatedRefund, cancelQuote.refundCurrency) : 'Non-refundable'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Refund method selector */}
              {cancelQuote.estimatedRefund > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Refund To</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['ORIGINAL_PAYMENT', 'AIRLINE_CREDIT'] as const).map(method => (
                      <button
                        key={method}
                        onClick={() => setRefundMethodChoice(method)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left text-xs font-semibold transition-all ${refundMethodChoice === method
                          ? 'border-[#1ABC9C] bg-[#1ABC9C]/10 text-[#1ABC9C]'
                          : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:border-white/20'}`}
                      >
                        <CreditCard size={13} />
                        {method === 'ORIGINAL_PAYMENT' ? 'Original Payment' : 'Airline Credit'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Details row */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
                  <p className="text-slate-500 mb-0.5">Refund Timeline</p>
                  <div className="flex items-center gap-1.5 text-white font-semibold">
                    <Clock size={11} className="text-[#1ABC9C]" />
                    {cancelQuote.refundTimeline}
                  </div>
                </div>
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
                  <p className="text-slate-500 mb-0.5">PNR(s)</p>
                  <div className="flex flex-wrap gap-1">
                    {cancelQuote.pnrs.slice(0, 3).map(p => (
                      <span key={p.pnrCode} className="font-mono font-bold text-white">{p.pnrCode}</span>
                    ))}
                    {cancelQuote.pnrs.length === 0 && <span className="text-slate-600">—</span>}
                  </div>
                </div>
              </div>

              {/* Warning */}
              {cancelQuote.warningMessage && (
                <div className="flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2.5">
                  <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-amber-200/70 text-xs leading-relaxed">{cancelQuote.warningMessage}</p>
                </div>
              )}
            </div>

            {/* Footer buttons */}
            <div className="flex gap-3 px-5 pb-5">
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-xl border border-white/10 text-slate-400 font-semibold text-sm hover:bg-white/[0.04] transition-all"
              >
                Keep Booking
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm transition-all shadow-lg shadow-red-500/20"
              >
                Confirm Cancellation
              </button>
            </div>
          </>
        )}

        {/* ── Confirming ──────────────────────────── */}
        {step === 'confirming' && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
              <Loader2 className="w-6 h-6 text-red-400 animate-spin" />
            </div>
            <p className="text-white font-bold text-lg mb-2">Processing Cancellation</p>
            <p className="text-slate-400 text-sm">Contacting the airline — please wait…</p>
            <p className="text-slate-600 text-xs mt-3">Do not close this window</p>
          </div>
        )}

        {/* ── Success ─────────────────────────────── */}
        {step === 'success' && cancelSuccess && (
          <>
            <div className="px-5 pt-6 pb-4 text-center">
              <div className="w-16 h-16 rounded-full bg-[#1ABC9C]/10 border border-[#1ABC9C]/30 flex items-center justify-center mx-auto mb-4">
                <Check size={30} className="text-[#1ABC9C]" />
              </div>
              <h3 className="text-white font-black text-xl mb-1">Booking Cancelled</h3>
              <p className="text-slate-400 text-sm">
                Ref: <span className="font-mono font-bold text-white">{cancelSuccess.bookingReference}</span>
              </p>
            </div>

            {/* Refund card */}
            <div className="mx-5 mb-4 bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-2xl p-4 text-center">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Estimated Refund</p>
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
                  onClick={() => { onClose(); router.push('/account/support'); }}
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
                  onClick={() => { onClose(); router.push('/account/support'); }}
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
