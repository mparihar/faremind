'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, XCircle, Clock, RefreshCw, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOfferSessionStore } from '@/store/useOfferSessionStore';
import { useSearchStore } from '@/store/useSearchStore';

// ─── Backdrop ─────────────────────────────────────────────────────────────────

function ModalBackdrop({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 max-w-md w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        {children}
      </div>
    </div>
  );
}

// ─── Critical Toast (1 minute) ────────────────────────────────────────────────

function CriticalToast({ onDismiss }: { onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="fixed top-24 right-4 z-[250] animate-in slide-in-from-right fade-in duration-300">
      <div className="bg-amber-900/90 backdrop-blur-lg border border-amber-500/40 rounded-xl px-4 py-3 shadow-2xl max-w-xs">
        <div className="flex items-center gap-2.5">
          <Clock className="w-5 h-5 text-amber-400 flex-none" />
          <div>
            <p className="text-sm font-semibold text-amber-200">1 minute left</p>
            <p className="text-xs text-amber-300/70 mt-0.5">Complete booking now to keep this fare.</p>
          </div>
          <button
            onClick={onDismiss}
            className="text-amber-400/60 hover:text-amber-300 text-lg leading-none flex-none ml-1"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OfferExpiryModals() {
  const router = useRouter();
  const {
    status,
    remainingSeconds,
    warningShown,
    criticalWarningShown,
    searchCriteria,
    setWarningShown,
    setCriticalWarningShown,
    clearSession,
  } = useOfferSessionStore();

  const [showWarningModal, setShowWarningModal] = useState(false);
  const [showCriticalToast, setShowCriticalToast] = useState(false);
  const [showExpiredModal, setShowExpiredModal] = useState(false);

  // ─── 3-minute warning ───
  useEffect(() => {
    if (status === 'WARNING' && !warningShown && remainingSeconds <= 180 && remainingSeconds > 60) {
      setShowWarningModal(true);
      setWarningShown();
    }
  }, [status, remainingSeconds, warningShown, setWarningShown]);

  // ─── 1-minute critical warning ───
  useEffect(() => {
    if (status === 'WARNING' && !criticalWarningShown && remainingSeconds <= 60 && remainingSeconds > 0) {
      setShowCriticalToast(true);
      setCriticalWarningShown();
    }
  }, [status, remainingSeconds, criticalWarningShown, setCriticalWarningShown]);

  // ─── Expired ───
  useEffect(() => {
    if (status === 'EXPIRED') {
      setShowWarningModal(false);
      setShowCriticalToast(false);
      setShowExpiredModal(true);
    }
  }, [status]);

  // ─── Refresh flow ───
  const handleRefreshResults = useCallback(() => {
    // Re-populate search criteria if available
    if (searchCriteria) {
      const { origin, destination, departureDate, returnDate, adults, children, infants, cabinClass } = searchCriteria;
      const query = useSearchStore.getState().query;
      if (query) {
        useSearchStore.getState().setQuery({
          ...query,
          origin: origin ?? query.origin,
          destination: destination ?? query.destination,
          departureDate: departureDate ?? query.departureDate,
          returnDate: returnDate ?? query.returnDate,
          adults: adults ?? query.adults,
          children: children ?? query.children,
          infants: infants ?? query.infants,
          cabinClass: cabinClass ?? query.cabinClass,
        });
      }
    }

    clearSession();
    setShowExpiredModal(false);
    setShowWarningModal(false);

    // Navigate to search results
    router.push('/flights');
  }, [searchCriteria, clearSession, router]);

  return (
    <>
      {/* 3-minute Warning Modal */}
      {showWarningModal && (
        <ModalBackdrop onClose={() => setShowWarningModal(false)}>
          <div className="bg-[#1a1a2e] border border-amber-500/30 rounded-2xl overflow-hidden shadow-2xl">
            {/* Header bar */}
            <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-500" />

            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-500/15 flex items-center justify-center flex-none">
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-white">Fare expires soon</h3>
                  <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                    Your selected fare will expire in less than{' '}
                    <span className="text-amber-400 font-semibold">3 minutes</span>.
                    Please complete checkout to keep this price and availability.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={() => setShowWarningModal(false)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
                >
                  Continue Booking
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={handleRefreshResults}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm font-medium transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* 1-minute Critical Toast */}
      {showCriticalToast && (
        <CriticalToast onDismiss={() => setShowCriticalToast(false)} />
      )}

      {/* Expired Modal — not dismissible */}
      {showExpiredModal && (
        <ModalBackdrop>
          <div className="bg-[#1a1a2e] border border-red-500/30 rounded-2xl overflow-hidden shadow-2xl">
            {/* Header bar */}
            <div className="h-1 bg-gradient-to-r from-red-500 to-red-600" />

            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-red-500/15 flex items-center justify-center flex-none">
                  <XCircle className="w-6 h-6 text-red-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-white">Fare Expired</h3>
                  <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                    This fare is no longer available for booking. Prices and availability may have changed.
                    Please refresh flight results to get the latest fares.
                  </p>
                </div>
              </div>

              <button
                onClick={handleRefreshResults}
                className="w-full flex items-center justify-center gap-2 mt-6 px-4 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Flight Results
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </>
  );
}
