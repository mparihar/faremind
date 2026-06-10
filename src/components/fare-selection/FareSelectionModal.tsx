'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plane, Zap, ChevronRight, Clock } from 'lucide-react';
import FareCard from '@/components/fare-selection/FareCard';
import { useFareStore, getSelectedFareOption } from '@/store/useFareStore';
import { useBookingStore } from '@/store/useBookingStore';
import { useCheckoutStore } from '@/store/useCheckoutStore';
import { useOfferSessionStore } from '@/store/useOfferSessionStore';
import type { FareSelectionPayload, PriceProtectionQuote } from '@/lib/fare-types';
import { apiFetch } from '@/lib/api-client';
import { getAirlineLogo } from '@/lib/utils';

const CABIN_LABELS: Record<string, string> = {
  economy: 'Economy',
  premium_economy: 'Premium Economy',
  business: 'Business',
  first: 'First',
};

function fmtPrice(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

function AiChip({ headline, reason, fareId, onScrollTo }: { headline: string; reason: string; fareId: string; onScrollTo: (id: string) => void }) {
  return (
    <button
      className="flex flex-col items-start gap-0.5 bg-white/80 border border-[#1ABC9C]/30 rounded-xl px-3 py-2.5 hover:border-[#1ABC9C] hover:shadow-sm transition-all text-left"
      onClick={() => onScrollTo(fareId)}
    >
      <span className="text-[10px] font-bold text-[#1ABC9C] uppercase tracking-wider flex items-center gap-1">
        <Zap size={9} strokeWidth={2.5} /> {headline}
      </span>
      <span className="text-[11px] text-slate-600 leading-snug">{reason}</span>
    </button>
  );
}

// ── Compact offer countdown timer ─────────────────────────────────────────────

function OfferTimer() {
  const { remainingSeconds, status } = useOfferSessionStore();

  if (status === 'IDLE' || remainingSeconds <= 0) return null;

  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  const isWarning = remainingSeconds <= 180;
  const isCritical = remainingSeconds <= 60;

  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold tabular-nums border transition-colors ${
        isCritical
          ? 'bg-red-50 border-red-200 text-red-600 animate-pulse'
          : isWarning
            ? 'bg-amber-50 border-amber-200 text-amber-600'
            : 'bg-teal-50 border-teal-200 text-teal-600'
      }`}
      title="Time remaining before this offer expires"
    >
      <Clock size={12} />
      {timeStr}
    </div>
  );
}

interface Props {
  onClose: () => void;
}

export default function FareSelectionModal({ onClose }: Props) {
  const router = useRouter();
  const store = useFareStore();
  const bookingStore = useBookingStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [activeCabin, setActiveCabin] = useState<string>('economy');
  const [confirming, setConfirming] = useState(false);
  const [fareContext, setFareContext] = useState<{ origin: string; destination: string; trip: string } | null>(null);

  const { travelerCount, passengerBreakdown } = useMemo(() => {
    if (typeof window === 'undefined') return { travelerCount: 1, passengerBreakdown: undefined as { adults: number; children: number; infants: number } | undefined };
    try {
      const ctx = JSON.parse(sessionStorage.getItem('fm_fare_context') || '{}');
      const count = ctx.travelers || 1;
      const breakdown = typeof ctx.adults === 'number'
        ? { adults: ctx.adults, children: ctx.children ?? 0, infants: ctx.infants ?? 0 }
        : undefined;
      return { travelerCount: count, passengerBreakdown: breakdown };
    } catch { return { travelerCount: 1, passengerBreakdown: undefined as { adults: number; children: number; infants: number } | undefined }; }
  }, []);

  // Update the offer session with this specific flight's offer ID
  // Timer was already started on the search page; this re-targets it to the selected offer
  // so checkout can track the correct providerOfferId. The startSession guard prevents
  // restarting if the same offer is already tracked.
  useEffect(() => {
    const sourceFlight = useFareStore.getState().sourceFlight;
    const sourceRoundTrip = useFareStore.getState().sourceRoundTrip;
    const offerExpiresAt = sourceFlight?.offerExpiresAt ?? sourceRoundTrip?.offerExpiresAt;
    const providerOfferId = sourceFlight?.providerOfferId ?? sourceRoundTrip?.providerOfferId;
    const providerName = sourceFlight?.provider ?? sourceRoundTrip?.provider ?? 'duffel';

    if (providerOfferId) {
      // Read search criteria from sessionStorage
      let searchCriteria: any;
      try {
        const ctx = JSON.parse(sessionStorage.getItem('fm_fare_context') || '{}');
        searchCriteria = {
          origin: ctx.origin,
          destination: ctx.destination,
          departureDate: ctx.date,
          returnDate: ctx.returnDate,
          adults: ctx.adults,
          children: ctx.children,
          infants: ctx.infants,
          cabinClass: ctx.cabin,
        };
      } catch {}

      useOfferSessionStore.getState().startSession({
        provider: providerName,
        providerOfferId,
        expiresAt: offerExpiresAt,
        searchCriteria,
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load fare options from sessionStorage context
  useEffect(() => {
    if (useFareStore.getState().payload) return;

    const raw = sessionStorage.getItem('fm_fare_context');
    if (!raw) { onClose(); return; }

    let ctx: { offerId: string; basePrice: number; travelers: number; currency: string; origin: string; destination: string; stops: number; durationMinutes?: number; layoverMinutes?: number[]; trip?: string };
    try { ctx = JSON.parse(raw); } catch { onClose(); return; }
    setFareContext({ origin: ctx.origin, destination: ctx.destination, trip: ctx.trip || 'one_way' });

    const s = useFareStore.getState;
    s().setLoading(true);
    s().setError(null);

    const layoverParam = ctx.layoverMinutes?.length ? `&layover_minutes=${ctx.layoverMinutes.join(',')}` : '';
    const tripParam = ctx.trip ? `&trip=${encodeURIComponent(ctx.trip)}` : '';
    apiFetch<FareSelectionPayload>(
      `/api/fares/options?offer_id=${encodeURIComponent(ctx.offerId)}&base_price=${ctx.basePrice}&traveler_count=${ctx.travelers}&currency=${ctx.currency}&origin=${encodeURIComponent(ctx.origin)}&destination=${encodeURIComponent(ctx.destination)}&stops=${ctx.stops}&duration_minutes=${ctx.durationMinutes ?? 0}${layoverParam}${tripParam}`
    )
      .then(data => {
        s().setPayload(data);
        // Default to cheapest fare — matches the price the user saw on the search card
        const allFaresFlat = data.fareGroups.flatMap(g => g.fares);
        const cheapestFare = [...allFaresFlat].sort((a, b) => a.totalPrice - b.totalPrice)[0];
        const defaultFare = cheapestFare ?? allFaresFlat[0];
        if (defaultFare) s().selectFare(defaultFare.id);
        if (defaultFare) {
          return apiFetch<PriceProtectionQuote>(
            `/api/price-protection/quote?fare_id=${defaultFare.id}&total_price=${defaultFare.totalPrice}&currency=${ctx.currency}`
          );
        }
      })
      .then(quote => { if (quote) s().setProtectionQuote(quote); })
      .catch(e => s().setError(e.message || 'Failed to load fare options'))
      .finally(() => s().setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectFare = useCallback(async (id: string) => {
    store.selectFare(id);
    // Clear the stale protection quote immediately so the UI doesn't flash
    // the old fare's protection fee while the new quote loads
    store.setProtectionQuote(null as any);
    const allFares = store.payload?.fareGroups.flatMap(g => g.fares) ?? [];
    const fare = allFares.find(f => f.id === id);
    if (!fare) return;
    try {
      const quote = await apiFetch<PriceProtectionQuote>(
        `/api/price-protection/quote?fare_id=${id}&total_price=${fare.totalPrice}&currency=${store.payload?.currency || 'USD'}`
      );
      store.setProtectionQuote(quote);
    } catch { /* non-critical */ }
  }, [store]);

  const selectedFare = getSelectedFareOption(store);
  const protectionFee = store.protectionQuote?.protectionFeeUsd ?? 0;
  const totalProtectionFee = protectionFee * travelerCount;
  const grandTotal = useMemo(() => {
    if (!selectedFare) return 0;
    const base = selectedFare.basePrice;
    let fareTotal: number;
    if (passengerBreakdown && travelerCount > 1) {
      const { adults, children: childCount, infants } = passengerBreakdown;
      fareTotal = adults * base + childCount * Math.round(base * 0.75) + infants * base;
      fareTotal += Math.round(base * travelerCount * 0.015);
    } else {
      fareTotal = selectedFare.totalPrice;
    }
    return fareTotal + (store.priceProtection ? totalProtectionFee : 0);
  }, [selectedFare, passengerBreakdown, travelerCount, store.priceProtection, totalProtectionFee]);

  const activeFares = useMemo(
    () => store.payload?.fareGroups.find(g => g.cabin === activeCabin)?.fares ?? [],
    [store.payload, activeCabin]
  );

  const allFares = useMemo(
    () => store.payload?.fareGroups.flatMap(g => g.fares) ?? [],
    [store.payload]
  );

  const scrollToFare = useCallback((fareId: string) => {
    const el = scrollRef.current?.querySelector(`#fare-${fareId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    handleSelectFare(fareId);
    const group = store.payload?.fareGroups.find(g => g.fares.some(f => f.id === fareId));
    if (group) setActiveCabin(group.cabin);
  }, [store.payload, handleSelectFare]);

  const handleContinue = useCallback(async () => {
    if (!selectedFare) return;
    setConfirming(true);

    // Build the fare object immediately — don't block on the API
    const fareData = {
      fareId:         selectedFare.id,
      offerId:        selectedFare.offerId,
      cabin:          selectedFare.cabin,
      name:           selectedFare.name,
      basePrice:      selectedFare.basePrice,
      totalPrice:     selectedFare.totalPrice,
      priceProtection: store.priceProtection,
      protectionFee:  store.priceProtection ? protectionFee : 0,
      grandTotal:     selectedFare.totalPrice + (store.priceProtection ? totalProtectionFee : 0),
      currency:       store.payload?.currency || 'USD',
    };

    // Write to Zustand store right now
    store.setSelectedFare(fareData);

    // Persist to sessionStorage so the itinerary page can always recover it
    try {
      sessionStorage.setItem('fm_selected_fare', JSON.stringify(fareData));
      if (store.payload)       sessionStorage.setItem('fm_fare_payload',      JSON.stringify(store.payload));
      if (store.sourceFlight)  sessionStorage.setItem('fm_source_flight',     JSON.stringify(store.sourceFlight));
      if (store.sourceRoundTrip) sessionStorage.setItem('fm_source_round_trip', JSON.stringify(store.sourceRoundTrip));
    } catch { /* storage unavailable */ }

    if (store.sourceFlight)  bookingStore.setFlight(store.sourceFlight);
    if (store.sourceRoundTrip) bookingStore.setRoundTrip(store.sourceRoundTrip);

    // Fire-and-forget backend call — update grandTotal when it responds
    apiFetch<{ grandTotal: number; sessionId: string }>('/api/booking-session/select-fare', {
      method: 'POST',
      body: JSON.stringify({
        fareId:       selectedFare.id,
        offerId:      selectedFare.offerId,
        cabin:        selectedFare.cabin,
        name:         selectedFare.name,
        basePrice:    selectedFare.basePrice,
        totalPrice:   selectedFare.totalPrice,
        priceProtection: store.priceProtection,
        currency:     store.payload?.currency || 'USD',
      }),
    }).then(session => {
      if (session?.grandTotal) {
        const updated = { ...fareData, grandTotal: session.grandTotal };
        useFareStore.getState().setSelectedFare(updated);
        try { sessionStorage.setItem('fm_selected_fare', JSON.stringify(updated)); } catch {}
      }
    }).catch(() => { /* non-critical */ });

    // Reset checkout store so the itinerary page always re-initialises from the
    // freshly selected fare above — prevents stale data from a previous session.
    useCheckoutStore.getState().reset();

    router.push('/checkout/itinerary');
    setConfirming(false);
  }, [selectedFare, store, protectionFee, bookingStore, router, onClose]);

  const { payload } = store;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 16 }}
          transition={{ duration: 0.2 }}
          className="bg-[#F8FAFC] rounded-2xl sm:rounded-[2.5rem] shadow-2xl w-full max-w-[1020px] flex flex-col overflow-hidden max-h-[100dvh] sm:max-h-[88vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Modal header ── */}
          <div className="px-4 sm:px-7 py-3 sm:py-4 bg-white border-b border-slate-100 shrink-0 flex items-center justify-between gap-3 sm:gap-4">
            {fareContext?.trip === 'round_trip' && fareContext.origin && fareContext.destination ? (
              <div className="flex items-center gap-4 min-w-0">
                {store.sourceRoundTrip && (
                  <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                    <img
                      src={getAirlineLogo(store.sourceRoundTrip.airlineCodes[0])}
                      alt=""
                      className="w-8 h-8 object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight uppercase leading-none truncate">
                    {store.sourceRoundTrip?.airlines[0] ?? 'Airline'}
                  </h2>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                      {fareContext.origin} ↔ {fareContext.destination} Round-Trip Details
                    </span>
                    <Plane className="w-3 h-3 text-slate-300" />
                    <Plane className="w-3 h-3 text-slate-300 -scale-x-100" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <Plane size={14} className="text-[#1ABC9C] shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Select your fare</p>
                  {payload && (
                    <p className="text-[13px] font-bold text-slate-800 truncate">{payload.journeySummary}</p>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 shrink-0">
              {/* Offer expiry timer */}
              <OfferTimer />
              {selectedFare && payload && (
                <div className="text-right">
                  <div className="text-xl font-bold text-[#F97316] leading-none">{fmtPrice(grandTotal, payload.currency)}</div>
                  <div className="text-[9px] text-slate-400 mt-0.5">Total</div>
                </div>
              )}
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-all"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* ── Loading ── */}
          {store.loading && (
            <div className="flex-1 flex items-center justify-center py-16">
              <div className="text-center">
                <div className="w-10 h-10 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin mx-auto mb-3" />
                <p className="text-slate-500 text-sm font-medium">Finding the best fares…</p>
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {!store.loading && (store.error || !payload) && (
            <div className="flex-1 flex items-center justify-center py-16">
              <div className="text-center max-w-xs">
                <p className="text-slate-700 font-semibold mb-2">Something went wrong</p>
                <p className="text-slate-400 text-sm mb-5">{store.error || 'No fare data available.'}</p>
                <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-semibold">
                  Close
                </button>
              </div>
            </div>
          )}

          {/* ── Content ── */}
          {!store.loading && payload && (
            <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-hide">
              <div className="px-5 py-5 space-y-5">



                {/* AI Recommendations */}
                <div className="bg-gradient-to-br from-[#1ABC9C]/8 to-emerald-50 rounded-2xl border border-[#1ABC9C]/20 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap size={13} className="text-[#1ABC9C]" strokeWidth={2.5} />
                    <span className="text-[10px] font-bold text-[#1ABC9C] uppercase tracking-wider">AI Recommendations</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <AiChip
                      headline={payload.aiRecommendations.topPick.headline}
                      reason={payload.aiRecommendations.topPick.reason}
                      fareId={payload.aiRecommendations.topPick.fareId}
                      onScrollTo={scrollToFare}
                    />
                    {payload.aiRecommendations.others.map((rec, i) => (
                      <AiChip
                        key={i}
                        headline={rec.headline}
                        reason={rec.reason}
                        fareId={rec.fareId}
                        onScrollTo={scrollToFare}
                      />
                    ))}
                  </div>
                </div>

                {/* Cabin tabs */}
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                  {payload.fareGroups.map(group => (
                    <button
                      key={group.cabin}
                      onClick={() => setActiveCabin(group.cabin)}
                      className={`flex-none px-5 py-2 rounded-xl text-sm font-semibold transition-all ${
                        activeCabin === group.cabin
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400'
                      }`}
                    >
                      {CABIN_LABELS[group.cabin] || group.label}
                    </button>
                  ))}
                </div>

                {/* Fare tiles — horizontal scroll */}
                <div
                  className="flex gap-3 pb-4 items-stretch overflow-x-auto snap-x snap-mandatory scrollbar-hide"
                >
                  {activeFares.map(fare => (
                    <div key={fare.id} id={`fare-${fare.id}`} className="flex min-w-[240px] sm:min-w-[280px] flex-1 snap-start">
                      <FareCard
                        fare={fare}
                        selected={store.selectedFareId === fare.id}
                        priceProtection={store.priceProtection}
                        protectionFee={protectionFee}
                        onSelect={() => handleSelectFare(fare.id)}
                        onToggleProtection={store.togglePriceProtection}
                        currency={payload.currency}
                        travelerCount={travelerCount}
                        passengerBreakdown={passengerBreakdown}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Sticky footer CTA ── */}
          {!store.loading && payload && selectedFare && (
            <div className="px-4 sm:px-5 py-3 sm:py-4 bg-white border-t border-slate-100 shrink-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-0.5">{selectedFare.name}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-[#F97316] leading-none">{fmtPrice(grandTotal, payload.currency)}</span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    Total
                  </span>
                </div>
                <p className="text-[9px] text-slate-400 mt-0.5">
                  {store.priceProtection ? 'incl. protection · ' : ''}+ small service fee at checkout
                </p>
              </div>
              <button
                onClick={handleContinue}
                disabled={confirming}
                className="flex items-center gap-2 px-7 py-3 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 active:scale-[0.98] text-white font-bold text-[14px] transition-all disabled:opacity-60 shadow-lg shadow-[#1ABC9C]/30 w-full sm:w-auto justify-center"
              >
                {confirming ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Confirming…
                  </span>
                ) : (
                  <>Continue <ChevronRight size={15} /></>
                )}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
