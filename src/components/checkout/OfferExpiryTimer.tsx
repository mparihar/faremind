'use client';

import { useEffect } from 'react';
import { Clock, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOfferSessionStore } from '@/store/useOfferSessionStore';

// ─── Props ────────────────────────────────────────────────────────────────────

interface OfferExpiryTimerProps {
  onExpired?: () => void;
  onRefreshResults?: () => void;
  compact?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OfferExpiryTimer({
  onExpired,
  onRefreshResults,
  compact = false,
}: OfferExpiryTimerProps) {
  const {
    status,
    remainingSeconds,
    hydrateFromStorage,
  } = useOfferSessionStore();

  // Hydrate from sessionStorage on mount (page refresh)
  useEffect(() => {
    if (status === 'IDLE') {
      hydrateFromStorage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notify parent when expired
  useEffect(() => {
    if (status === 'EXPIRED' && onExpired) {
      onExpired();
    }
  }, [status, onExpired]);

  // Don't render if no session
  if (status === 'IDLE') return null;

  // ─── Expired State ───
  if (status === 'EXPIRED') {
    if (compact) {
      return (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
          <XCircle className="w-3.5 h-3.5" />
          <span>Expired</span>
        </div>
      );
    }

    return (
      <div className="bg-gradient-to-r from-red-500/15 to-red-600/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center flex-none">
            <XCircle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-red-400">This fare has expired</p>
            <p className="text-xs text-red-400/70 mt-0.5">
              Please refresh flight results to continue.
            </p>
          </div>
        </div>
        {onRefreshResults && (
          <button
            onClick={onRefreshResults}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors flex-none"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Results
          </button>
        )}
      </div>
    );
  }

  // ─── Warning State (≤ 3 min) ───
  if (status === 'WARNING') {
    if (compact) {
      return (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400 text-xs font-semibold animate-pulse">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>{formatCountdown(remainingSeconds)}</span>
        </div>
      );
    }

    return (
      <div className="bg-gradient-to-r from-amber-500/15 to-orange-500/10 border border-amber-500/40 rounded-xl px-4 py-3 animate-[pulse_2s_ease-in-out_infinite]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center flex-none">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-amber-400">Fare expires soon</p>
              <span className="text-lg font-bold text-amber-300 tabular-nums tracking-wider">
                {formatCountdown(remainingSeconds)}
              </span>
            </div>
            <p className="text-xs text-amber-400/70 mt-0.5">
              Please complete checkout. Prices and availability may change after this timer expires.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Active (Normal) State ───
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-500/15 text-teal-400 text-xs font-semibold">
        <Clock className="w-3.5 h-3.5" />
        <span className="tabular-nums">{formatCountdown(remainingSeconds)}</span>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-teal-500/10 to-emerald-500/10 border border-teal-500/25 rounded-xl px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center flex-none">
          <Clock className="w-5 h-5 text-teal-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-teal-300">Fare held for</p>
            <span className="text-lg font-bold text-teal-200 tabular-nums tracking-wider">
              {formatCountdown(remainingSeconds)}
            </span>
          </div>
          <p className="text-xs text-teal-400/60 mt-0.5">
            Complete booking before the timer expires to avoid price or availability changes.
          </p>
        </div>
      </div>
    </div>
  );
}
