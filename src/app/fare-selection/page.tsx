'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plane, Zap, ChevronRight } from 'lucide-react';
import FareCard from '@/components/fare-selection/FareCard';
import { useFareStore, getSelectedFareOption } from '@/store/useFareStore';
import { useBookingStore } from '@/store/useBookingStore';
import type { FareSelectionPayload, FareOption, PriceProtectionQuote } from '@/lib/fare-types';
import { apiFetch } from '@/lib/api-client';
import { usePricingConfig, computeServiceFee } from '@/hooks/usePricingConfig';

// ─── Cabin tab labels ────────────────────────────────────────────────────────

const CABIN_LABELS: Record<string, string> = {
  economy: 'Economy',
  premium_economy: 'Premium Economy',
  business: 'Business',
  first: 'First',
};

function fmtPrice(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

// ─── AI Recommendation chip ──────────────────────────────────────────────────

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

// ─── Comparison strip ─────────────────────────────────────────────────────────

function ComparisonStrip({ fares, selectedId, onSelect, currency }: {
  fares: FareOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  currency: string;
}) {
  const sorted = [...fares].sort((a, b) => a.totalPrice - b.totalPrice).slice(0, 4);
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {sorted.map(f => (
        <button
          key={f.id}
          onClick={() => onSelect(f.id)}
          className={`flex-none flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl border-2 text-center transition-all ${
            f.id === selectedId
              ? 'border-[#1ABC9C] bg-[#1ABC9C]/5'
              : 'border-slate-200 bg-white hover:border-[#1ABC9C]/40'
          }`}
        >
          <span className="text-[10px] font-semibold text-slate-500">{f.name.split(' ').slice(-1)[0]}</span>
          <span className="text-[14px] font-extrabold text-slate-900">{fmtPrice(f.totalPrice, currency)}</span>
          {f.aiBadges.length > 0 && (
            <span className="text-[9px] font-bold text-[#1ABC9C]">{f.aiBadges.includes('ai_pick') ? '★ AI Pick' : f.aiBadges[0].replace('_', ' ')}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function FareSelectionPage() {
  const router = useRouter();
  const store = useFareStore();
  const bookingStore = useBookingStore();

  const [activeCabin, setActiveCabin] = useState<string>('economy');
  const [confirming, setConfirming] = useState(false);

  const { travelerCount, passengerBreakdown } = useMemo(() => {
    if (typeof window === 'undefined') return { travelerCount: 1, passengerBreakdown: undefined };
    try {
      const ctx = JSON.parse(sessionStorage.getItem('fm_fare_context') || '{}');
      const count = ctx.travelers || 1;
      const breakdown = typeof ctx.adults === 'number'
        ? { adults: ctx.adults, children: ctx.children ?? 0, infants: ctx.infants ?? 0 }
        : undefined;
      return { travelerCount: count, passengerBreakdown: breakdown };
    } catch { return { travelerCount: 1, passengerBreakdown: undefined }; }
  }, []);

  // Load payload from sessionStorage if store is empty (browser refresh)
  useEffect(() => {
    if (store.payload) return;

    const raw = sessionStorage.getItem('fm_fare_context');
    if (!raw) { router.replace('/search'); return; }

    let ctx: { offerId: string; basePrice: number; travelers: number; currency: string; origin: string; destination: string; stops: number; trip?: string; fareRules?: { changeable?: boolean; changeFee?: number; refundable?: boolean; cancellationFee?: number }; baggage?: { carryOn?: number; checked?: number } };
    try { ctx = JSON.parse(raw); } catch { router.replace('/search'); return; }

    store.setLoading(true);
    const tripParam = ctx.trip ? `&trip=${encodeURIComponent(ctx.trip)}` : '';
    let providerParams = '';
    if (ctx.fareRules) {
      const fr = ctx.fareRules;
      if (fr.changeable !== undefined) providerParams += `&provider_changeable=${fr.changeable}`;
      if (fr.changeFee !== undefined) providerParams += `&provider_change_fee=${fr.changeFee}`;
      if (fr.refundable !== undefined) providerParams += `&provider_refundable=${fr.refundable}`;
      if (fr.cancellationFee !== undefined) providerParams += `&provider_refund_fee=${fr.cancellationFee}`;
    }
    if (ctx.baggage?.checked !== undefined) {
      providerParams += `&provider_checked_bags=${ctx.baggage.checked}`;
    }
    apiFetch<FareSelectionPayload>(
      `/api/fares/options?offer_id=${ctx.offerId}&base_price=${ctx.basePrice}&traveler_count=${ctx.travelers}&currency=${ctx.currency}&origin=${ctx.origin}&destination=${ctx.destination}&stops=${ctx.stops}${tripParam}${providerParams}`
    )
      .then(data => {
        store.setPayload(data);
        // Default select the AI pick
        const aiPickFareId = data.aiRecommendations.topPick.fareId;
        store.selectFare(aiPickFareId);
        // Default protection quote for the ai pick fare
        const aiPickFare = data.fareGroups.flatMap(g => g.fares).find(f => f.id === aiPickFareId);
        if (aiPickFare) {
          return apiFetch<PriceProtectionQuote>(`/api/price-protection/quote?fare_id=${aiPickFareId}&total_price=${aiPickFare.totalPrice}&currency=${ctx.currency}`);
        }
      })
      .then(quote => { if (quote) store.setProtectionQuote(quote); })
      .catch(e => store.setError(e.message || 'Failed to load fare options'))
      .finally(() => store.setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh protection quote when selected fare changes
  const handleSelectFare = useCallback(async (id: string) => {
    store.selectFare(id);
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
  const { serviceFee: serviceFeeConfig } = usePricingConfig();
  const grandTotal = useMemo(() => {
    if (!selectedFare) return 0;
    const base = selectedFare.basePrice;
    let fareTotal: number;
    if (travelerCount > 1) {
      fareTotal = base * travelerCount;
      fareTotal += computeServiceFee(fareTotal, travelerCount, serviceFeeConfig);
    } else {
      fareTotal = selectedFare.totalPrice;
    }
    return fareTotal + (store.priceProtection ? protectionFee : 0);
  }, [selectedFare, travelerCount, store.priceProtection, protectionFee, serviceFeeConfig]);

  // Fares in the active cabin
  const activeFares = useMemo(
    () => store.payload?.fareGroups.find(g => g.cabin === activeCabin)?.fares ?? [],
    [store.payload, activeCabin]
  );

  // All fares flat for comparison strip
  const allFares = useMemo(
    () => store.payload?.fareGroups.flatMap(g => g.fares) ?? [],
    [store.payload]
  );

  const scrollToFare = useCallback((fareId: string) => {
    const el = document.getElementById(`fare-${fareId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    handleSelectFare(fareId);
    // Switch cabin if needed
    const group = store.payload?.fareGroups.find(g => g.fares.some(f => f.id === fareId));
    if (group) setActiveCabin(group.cabin);
  }, [store.payload, handleSelectFare]);

  const handleContinue = useCallback(async () => {
    if (!selectedFare) return;
    setConfirming(true);
    try {
      const session = await apiFetch<{ grandTotal: number; sessionId: string }>('/api/booking-session/select-fare', {
        method: 'POST',
        body: JSON.stringify({
          fareId: selectedFare.id,
          offerId: selectedFare.offerId,
          cabin: selectedFare.cabin,
          name: selectedFare.name,
          basePrice: selectedFare.basePrice,
          totalPrice: selectedFare.totalPrice,
          priceProtection: store.priceProtection,
          currency: store.payload?.currency || 'USD',
        }),
      });

      store.setSelectedFare({
        fareId: selectedFare.id,
        offerId: selectedFare.offerId,
        cabin: selectedFare.cabin,
        name: selectedFare.name,
        basePrice: selectedFare.basePrice,
        totalPrice: selectedFare.totalPrice,
        priceProtection: store.priceProtection,
        protectionFee: store.priceProtection ? protectionFee : 0,
        grandTotal: session.grandTotal,
        currency: store.payload?.currency || 'USD',
        policy: selectedFare.policy,
      });

      // Sync to booking store
      if (store.sourceFlight) bookingStore.setFlight(store.sourceFlight);
      if (store.sourceRoundTrip) bookingStore.setRoundTrip(store.sourceRoundTrip);

      router.push('/checkout/itinerary');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to confirm fare';
      store.setError(msg);
    } finally {
      setConfirming(false);
    }
  }, [selectedFare, store, protectionFee, bookingStore, router]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (store.loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm font-medium">Finding the best fares for you…</p>
        </div>
      </div>
    );
  }

  if (store.error || !store.payload) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <p className="text-slate-700 font-semibold mb-2">Something went wrong</p>
          <p className="text-slate-400 text-sm mb-6">{store.error || 'No fare data available.'}</p>
          <button onClick={() => router.back()} className="px-5 py-2.5 rounded-xl bg-[#1ABC9C] text-white text-sm font-semibold">
            Go back
          </button>
        </div>
      </div>
    );
  }

  const { payload } = store;

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      {/* ── Top nav bar ── */}
      <div className="sticky top-0 z-30 bg-white border-b border-slate-100 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors text-sm font-medium"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex-1 text-center">
            <p className="text-[11px] text-slate-400 font-medium">{payload.journeySummary}</p>
          </div>
          {selectedFare && (
            <div className="text-right">
              <div className="text-[13px] font-extrabold text-slate-900">{fmtPrice(grandTotal, payload.currency)}</div>
              <div className="text-[9px] text-slate-400">per traveler</div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* ── Journey header ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-1">
            <Plane size={14} className="text-[#1ABC9C]" />
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Select your fare</span>
          </div>
          <h1 className="text-[20px] font-extrabold text-slate-900">{payload.destinationCity}</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">{payload.journeySummary}</p>

          {/* Comparison strip */}
          <div className="mt-4">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Quick compare</p>
            <ComparisonStrip
              fares={allFares}
              selectedId={store.selectedFareId}
              onSelect={(id) => { handleSelectFare(id); const group = payload.fareGroups.find(g => g.fares.some(f => f.id === id)); if (group) setActiveCabin(group.cabin); }}
              currency={payload.currency}
            />
          </div>
        </div>

        {/* ── AI Recommendations ── */}
        <div className="bg-gradient-to-br from-[#1ABC9C]/8 to-emerald-50 rounded-2xl border border-[#1ABC9C]/20 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-[#1ABC9C]" strokeWidth={2.5} />
            <span className="text-[11px] font-bold text-[#1ABC9C] uppercase tracking-wider">AI Recommendations</span>
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

        {/* ── Cabin tabs ── */}
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

        {/* ── Fare cards ── */}
        <div className="space-y-4">
          {activeFares.map(fare => (
            <div key={fare.id} id={`fare-${fare.id}`}>
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

      {/* ── Sticky footer CTA ── */}
      {selectedFare && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-100 shadow-[0_-4px_24px_rgba(0,0,0,0.07)]">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] text-slate-500 font-medium">{selectedFare.name}</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[22px] font-extrabold text-slate-900">{fmtPrice(grandTotal, payload.currency)}</span>
                <span className="text-[11px] text-slate-400">
                  {travelerCount > 1 ? `for ${travelerCount} travelers` : 'per traveler'}
                </span>
              </div>
              {store.priceProtection && (
                <p className="text-[10px] text-[#1ABC9C] font-semibold">+ Price Drop Protection included</p>
              )}
            </div>
            <button
              onClick={handleContinue}
              disabled={confirming}
              className="flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 active:scale-[0.98] text-white font-bold text-[14px] transition-all disabled:opacity-60 shadow-lg shadow-[#1ABC9C]/30"
            >
              {confirming ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Confirming…
                </span>
              ) : (
                <>Continue <ChevronRight size={16} /></>
              )}
            </button>
          </div>
        </div>
      )}
      {/* Spacer so content isn't hidden behind sticky footer */}
      <div className="h-24" />
    </div>
  );
}
