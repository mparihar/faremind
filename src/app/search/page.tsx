'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, useMemo, useRef, Suspense, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Plane, Wifi, WifiOff, Sparkles, Star, TrendingDown, Zap, ChevronDown, X, SlidersHorizontal, Clock } from 'lucide-react';
import { useOfferSessionStore } from '@/store/useOfferSessionStore';
import { useSearchStore } from '@/store/useSearchStore';
import { usePreferencesStore, type SortPreference } from '@/store/usePreferencesStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useFareStore } from '@/store/useFareStore';
import FareSelectionModal from '@/components/fare-selection/FareSelectionModal';
import { AIRPORTS } from '@/lib/mock-data';
import FlightCard from '@/components/search/FlightCard';
import SearchForm from '@/components/search/SearchForm';
import SmartPreferencesBar from '@/components/search/SmartPreferencesBar';
import MultiFlightMap from '@/components/search/MultiFlightMap';
import FlightDetail from '@/components/search/FlightDetail';
import RoundTripCard from '@/components/search/RoundTripCard';
import RoundTripDetailModal from '@/components/search/RoundTripDetailModal';
import FlexibleDateStrip from '@/components/search/FlexibleDateStrip';
import FilterPanel, { type FilterOption } from '@/components/search/FilterPanel';
import FloatingAIAssistant, { type AIAssistResult } from '@/components/search/FloatingAIAssistant';
import type { UnifiedFlight } from '@/lib/types';
import type { DnaSearchResult, DnaRankedCard } from '@/lib/services/dna-search-service';
import { trackDnaEvent } from '@/lib/analytics/dna-search-analytics';
import DnaSearchProgressBanner, { type DnaSearchStatus } from '@/components/search/DnaSearchProgressBanner';
import { OfferExpiryModals } from '@/components/checkout/OfferExpiryModals';
import type { RoundTripOption, RoundTripSortMode } from '@/lib/round-trip-types';
import { rankFlightOffers } from '@/lib/ai-scoring';
import type { AiScoredOption } from '@/lib/ai-scoring';
import { LayoutGrid, Map as MapIcon } from 'lucide-react';
import { format } from 'date-fns';

function TrackVisibility({ id, onVisible, onHidden, children }: { id: string, onVisible: (id: string) => void, onHidden: (id: string) => void, children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            onVisible(id);
          } else {
            onHidden(id);
          }
        });
      },
      { rootMargin: '-55% 0px 0px 0px', threshold: 0.7 } // offset by the 55vh sticky map
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [id, onVisible, onHidden]);
  return <div ref={ref} className="h-full">{children}</div>;
}

// ── Compact offer expiry countdown (shown in the sticky header) ───────────────
function OfferExpiryBadge() {
  const { remainingSeconds, status } = useOfferSessionStore();

  if (status === 'IDLE' || remainingSeconds <= 0) return null;

  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  const isCritical = remainingSeconds <= 60;
  const isWarning = remainingSeconds <= 300; // 5 min

  return (
    <div
      className={`hidden sm:flex items-center gap-1.5 px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm ${
        isCritical
          ? 'bg-red-500/90 text-white animate-pulse'
          : isWarning
            ? 'bg-amber-500/90 text-white'
            : 'bg-transparent border border-[#00ff41]/30 text-[#00ff41]'
      }`}
      title="These offers expire after this time — search again for fresh results"
    >
      <Clock size={11} />
      <span>Offers valid {timeStr}</span>
    </div>
  );
}

// ── Hoisted constants (avoid re-creation per render / per-call) ───────────────

const WINDOW_RANGES: Record<string, [number, number]> = { morning:[6,12], afternoon:[12,17], evening:[17,21], night:[21,30] };

const CLASS_LABELS: Record<string, string> = {
  economy: 'Economy', premium_economy: 'Premium Economy', business: 'Business', first: 'First Class',
};

function fmtMonth(dateStr: string): string {
  if (!dateStr) return '';
  try { return format(new Date(dateStr + 'T12:00:00'), 'EEE, MMM dd yyyy'); } catch { return dateStr; }
}

function scoreFlightWithPreferences(
  flight: UnifiedFlight,
  prefs: {
    budgetActive: boolean;
    budgetMin: number;
    budgetMax: number;
    maxDuration: number | null;
    stops: string;
    departureWindow: string | null;
    sort: string;
    personalized: boolean;
  }
): number {
  if (!prefs.personalized) return flight.valueScore;
  let score = flight.valueScore;
  if (prefs.budgetActive) {
    if (flight.totalPrice >= prefs.budgetMin && flight.totalPrice <= prefs.budgetMax) score += 15;
    else if (flight.totalPrice > prefs.budgetMax) {
      const overBy = (flight.totalPrice - prefs.budgetMax) / prefs.budgetMax;
      score -= Math.min(20, overBy * 30);
    }
  }
  if (prefs.maxDuration !== null) {
    if (flight.totalDuration <= prefs.maxDuration) score += 10;
    else { const overBy = (flight.totalDuration - prefs.maxDuration) / prefs.maxDuration; score -= Math.min(15, overBy * 25); }
  }
  if (prefs.stops === 'nonstop') { if (flight.stops === 0) score += 20; else score -= 10 * flight.stops; }
  else if (prefs.stops === '1stop') { if (flight.stops <= 1) score += 10; else score -= 10; }
  if (prefs.departureWindow && flight.segments.length > 0) {
    const depHour = new Date(flight.segments[0].departure.time).getHours();
    const [minH, maxH] = WINDOW_RANGES[prefs.departureWindow] || [0, 24];
    const adj = depHour < 6 ? depHour + 24 : depHour;
    if (adj >= minH && adj < maxH) score += 12; else score -= 5;
  }
  return Math.max(0, Math.min(100, score));
}

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { results, setResults, loading, setLoading, getFilteredResults } = useSearchStore();
  const prefs = usePreferencesStore();
  const { user: authUser } = useAuthStore();
  const fareStore = useFareStore();
  const showScores = !!authUser?.isAdminViewer;

  const [showSearch, setShowSearch] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('map');
  const [sortMode, setSortMode] = useState<'cheapest' | 'fastest'>('cheapest');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(88);
  useEffect(() => {
    if (headerRef.current) setHeaderHeight(headerRef.current.offsetHeight);
  }, [showSearch]);
  const [searchMeta, setSearchMeta] = useState<{
    totalResults: number; totalTimeMs: number; usedMockData: boolean;
    providers: { provider: string; count: number; responseTimeMs: number; error: string | null; isMock: boolean }[];
  } | null>(null);
  const [selectedFlight, setSelectedFlight] = useState<UnifiedFlight | null>(null);
  const [hoveredFlightId, setHoveredFlightId] = useState<string | null>(null);

  // ── Round-trip state (only populated when tripParam === 'round_trip') ──────
  const [roundTripOptions, setRoundTripOptions] = useState<RoundTripOption[]>([]);
  const [selectedRoundTrip, setSelectedRoundTrip] = useState<RoundTripOption | null>(null);
  const [showFareModal, setShowFareModal] = useState(false);
  const [rtSortMode, setRtSortMode] = useState<RoundTripSortMode | null>(null);

  // ── Panel filter state ────────────────────────────────────────────────────
  const [selectedAirlines, setSelectedAirlines] = useState<Set<string>>(new Set());
  const [selectedClasses,  setSelectedClasses]  = useState<Set<string>>(new Set());
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set());
  const toggleAirline  = useCallback((id: string) => setSelectedAirlines(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; }), []);
  const toggleClass    = useCallback((id: string) => setSelectedClasses(p  => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; }), []);
  const toggleFeature  = useCallback((id: string) => setSelectedFeatures(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; }), []);
  const clearAllFilters = useCallback(() => { setSelectedAirlines(new Set()); setSelectedClasses(new Set()); setSelectedFeatures(new Set()); }, []);

  // ── AI Assistant bar result ───────────────────────────────────────────────
  const [aiAssistResult, setAiAssistResult] = useState<AIAssistResult | null>(null);

  // ── 🧬 DNA Search state ─────────────────────────────────────────────────
  const [dnaSearchLoading, setDnaSearchLoading] = useState(false);
  const [dnaSearchResults, setDnaSearchResults] = useState<DnaSearchResult | null>(null);
  const [dnaSearchEligible, setDnaSearchEligible] = useState<boolean | null>(null);
  // Snapshot of round-trip flights at DNA search time — used to display when DNA is active
  // This prevents ID mismatches when flights are re-fetched during the 30-60s DNA API call
  const [dnaSnapshotRT, setDnaSnapshotRT] = useState<RoundTripOption[]>([]);
  // Snapshot of AI scoring data at DNA search time — prevents ID mismatch when AI map rebuilds
  const [dnaAiSnapshotRT, setDnaAiSnapshotRT] = useState<Map<string, AiScoredOption<RoundTripOption>> | null>(null);
  const dnaSearchActive = prefs.dnaSearchActive;

  // DNA results map — keyed by cardId (matches the snapshot flight IDs)
  const dnaResultsMap = useMemo(() => {
    if (!dnaSearchResults?.results || dnaSearchResults.results.length === 0) return null;
    const map = new Map<string, DnaRankedCard>();
    for (const r of dnaSearchResults.results) {
      map.set(r.cardId, r);
    }
    return map;
  }, [dnaSearchResults]);

  // Guard: if DNA toggle is ON (persisted) but results are lost (page reload), reset the toggle
  // The user can re-trigger DNA Search manually
  useEffect(() => {
    if (dnaSearchActive && !dnaSearchResults && !dnaSearchLoading) {
      console.warn('[DNA Search] Toggle is active but results are missing — resetting toggle');
      prefs.setDnaSearchActive(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dnaSearchActive, dnaSearchResults, dnaSearchLoading]);

  // ── Filter transition spinner ─────────────────────────────────────────────
  const [isFiltering, setIsFiltering] = useState(false);
  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsMounted = useRef(false);
  useEffect(() => {
    if (!prefsMounted.current) { prefsMounted.current = true; return; }
    if (filterTimer.current) clearTimeout(filterTimer.current);
    setIsFiltering(true);
    filterTimer.current = setTimeout(() => setIsFiltering(false), 450);
    return () => { if (filterTimer.current) clearTimeout(filterTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.budgetActive, prefs.budgetMin, prefs.budgetMax, prefs.maxDuration, prefs.stops, prefs.departureWindow, prefs.sort, prefs.aiIntelligence, rtSortMode]);



  const origin = searchParams.get('origin') || '';
  const destination = searchParams.get('destination') || '';
  const date = searchParams.get('date') || '';
  const adults = searchParams.get('adults') || '1';
  const childrenParam = searchParams.get('children') || '0';
  const infantsParam = searchParams.get('infants') || '0';
  const cabin = searchParams.get('cabin') || 'economy';
  const returnDateParam = searchParams.get('return') || '';
  const tripParam = searchParams.get('trip') || 'one_way';
  const dnaAutoTrigger = searchParams.get('dna') === '1';

  const originAirport = useMemo(() => AIRPORTS.find((a) => a.code === origin), [origin]);
  const destAirport = useMemo(() => AIRPORTS.find((a) => a.code === destination), [destination]);

  useEffect(() => {
    // Defer preference hydration to avoid "state update on unmounted component" warning.
    // The zustand store updates trigger synchronous re-renders on sibling/child components
    // that may not have finished mounting yet during the initial useEffect pass.
    queueMicrotask(() => {
      const budgetMin = searchParams.get('budget_min');
      const budgetMax = searchParams.get('budget_max');
      const maxDuration = searchParams.get('max_duration');
      const stops = searchParams.get('stops');
      const depWindow = searchParams.get('departure_window');
      const sort = searchParams.get('sort');
      if (budgetMin && budgetMax) prefs.setBudget(Number(budgetMin), Number(budgetMax));
      if (maxDuration) prefs.setMaxDuration(Number(maxDuration));
      if (stops === 'nonstop' || stops === '1stop') prefs.setStops(stops);
      if (depWindow === 'morning' || depWindow === 'afternoon' || depWindow === 'evening' || depWindow === 'night') prefs.setDepartureWindow(depWindow);
      if (sort === 'cheapest' || sort === 'fastest' || sort === 'any') {
        prefs.setSort(sort as SortPreference);
      }
      if (!prefs.aiIntelligence) prefs.setAiIntelligence(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!origin || !destination || !date) return;
    setLoading(true);
    setSearchMeta(null);
    setResults([]);           // Clear one-way results
    setRoundTripOptions([]);  // Clear round-trip results
    // Clear the previous offer expiry timer so it doesn't show during loading
    // Deferred to avoid triggering re-renders on sibling components not yet mounted
    queueMicrotask(() => useOfferSessionStore.getState().clearSession());
    setSelectedAirlines(new Set());
    setSelectedClasses(new Set());
    setSelectedFeatures(new Set());
    setAiAssistResult(null);
    // Reset DNA Search state on new search — BUT NOT if:
    // 1. DNA is currently loading (login redirect can re-run search while DNA API call is in-flight)
    // 2. DNA results already exist and are active (a concurrent/duplicate search finishing
    //    should NOT wipe valid DNA results — the snapshot protects against ID mismatches)
    const hasDnaData = dnaSearchLoading || (prefs.dnaSearchActive && dnaSearchResults);
    if (!hasDnaData) {
      prefs.setDnaSearchActive(false);
      setDnaSearchResults(null);
      setDnaSearchEligible(null);
      setDnaSnapshotRT([]);
      setDnaAiSnapshotRT(null);
    }

    const params = new URLSearchParams({
      origin, destination, date, adults, cabin,
      children: childrenParam,
      infants: infantsParam,
      trip: tripParam,
      ...(returnDateParam ? { returnDate: returnDateParam } : {}),
      ...(searchParams.get('fromFlex') === '1' ? { fromFlex: '1' } : {}),
    });
    fetch(`/api/search?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          alert(`Search Error: ${data.error}\nDetails: ${data.details || 'Check logs'}`);
        } else if (data.roundTripOptions) {
          setRoundTripOptions(data.roundTripOptions);
          // Start offer expiry timer from the earliest Duffel offer timestamp
          // BUT skip if DNA Search is active — DNA re-ranks existing offers without
          // fetching new ones, so the timer should continue from the original search.
          const dnaActive = prefs.dnaSearchActive;
          const expiryTimes = (data.roundTripOptions as RoundTripOption[])
            .map((rt: RoundTripOption) => rt.offerExpiresAt)
            .filter(Boolean) as string[];
          if (expiryTimes.length > 0 && !dnaActive) {
            const earliest = expiryTimes.sort()[0];
            const firstOffer = data.roundTripOptions[0];
            useOfferSessionStore.getState().clearSession();
            useOfferSessionStore.getState().startSession({
              provider: firstOffer?.provider ?? 'duffel',
              providerOfferId: firstOffer?.providerOfferId ?? `search_${Date.now()}`,
              expiresAt: earliest,
              searchCriteria: { origin, destination, departureDate: date },
            });
            console.log(`[Search] ⏱️ Offer timer started — earliest expires: ${earliest}`);
          }
        } else if (data.flights) {
          setResults(data.flights);
          // Same guard: don't restart timer during active DNA session
          const dnaActive = prefs.dnaSearchActive;
          const expiryTimes = (data.flights as UnifiedFlight[])
            .map((f: UnifiedFlight) => f.offerExpiresAt)
            .filter(Boolean) as string[];
          if (expiryTimes.length > 0 && !dnaActive) {
            const earliest = expiryTimes.sort()[0];
            const firstFlight = data.flights[0];
            useOfferSessionStore.getState().clearSession();
            useOfferSessionStore.getState().startSession({
              provider: firstFlight?.provider ?? 'duffel',
              providerOfferId: firstFlight?.providerOfferId ?? `search_${Date.now()}`,
              expiresAt: earliest,
              searchCriteria: { origin, destination, departureDate: date },
            });
            console.log(`[Search] ⏱️ Offer timer started — earliest expires: ${earliest}`);
          }
        }
        if (data.meta) setSearchMeta(data.meta);
        if (cabin) setSelectedClasses(new Set([cabin]));
        setLoading(false);
      })
      .catch((err) => { 
        console.error('Search failed:', err); 
        alert(`Search failed: ${err.message}`);
        setLoading(false); 
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, date, adults, cabin, tripParam, returnDateParam]);

  const sortedRoundTrip = useMemo(() => {
    const copy = [...roundTripOptions];
    const mode = rtSortMode ?? 'cheapest';
    switch (mode) {
      case 'cheapest':
        copy.sort((a, b) => a.totalPrice - b.totalPrice); break;
      case 'fastest':
        copy.sort((a, b) => a.totalDurationMinutes - b.totalDurationMinutes); break;
      case 'fewest_stops':
        copy.sort((a, b) => a.totalStops - b.totalStops || a.totalPrice - b.totalPrice); break;
      case 'earliest_dep':
        copy.sort((a, b) => new Date(a.outboundJourney.departureTime).getTime() - new Date(b.outboundJourney.departureTime).getTime()); break;
      case 'latest_dep':
        copy.sort((a, b) => new Date(b.outboundJourney.departureTime).getTime() - new Date(a.outboundJourney.departureTime).getTime()); break;
      case 'earliest_arr':
        copy.sort((a, b) => new Date(a.outboundJourney.arrivalTime).getTime() - new Date(b.outboundJourney.arrivalTime).getTime()); break;
      case 'latest_arr':
        copy.sort((a, b) => new Date(b.outboundJourney.arrivalTime).getTime() - new Date(a.outboundJourney.arrivalTime).getTime()); break;
    }
    return copy;
  }, [roundTripOptions, rtSortMode]);

  const scoredResults = useMemo(() => {
    const filtered = getFilteredResults();
    if (!prefs.personalized && prefs.sort !== 'cheapest' && prefs.sort !== 'fastest') return filtered;
    const scored = filtered.map((f) => ({ ...f, valueScore: scoreFlightWithPreferences(f, prefs) }));
    switch (prefs.sort) {
      case 'cheapest': scored.sort((a, b) => a.totalPrice - b.totalPrice); break;
      case 'fastest':  scored.sort((a, b) => a.totalDuration - b.totalDuration); break;
      default:         scored.sort((a, b) => b.valueScore - a.valueScore); break;
    }
    return scored;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, prefs.budgetActive, prefs.budgetMin, prefs.budgetMax, prefs.maxDuration, prefs.stops, prefs.departureWindow, prefs.sort, prefs.personalized, prefs.aiIntelligence]);

  // ── AI Intelligence ranking ────────────────────────────────────────────────
  const aiPrefs = useMemo(() => {
    // Map UI sort mode to weight preset for the 8-component scorer
    const sortToPreset: Record<string, 'best_ai_pick' | 'cheapest' | 'fastest' | 'fewest_stops'> = {
      best_value: 'best_ai_pick',
      cheapest:   'cheapest',
      fastest:    'fastest',
      fewest_stops: 'fewest_stops',
    };
    return {
      budget:          prefs.budgetActive ? prefs.budgetMax : undefined,
      maxDuration:     prefs.maxDuration ?? undefined,
      stops:           prefs.stops,
      departureWindow: prefs.departureWindow ?? undefined,
      weightPreset:    sortToPreset[prefs.sort ?? 'best_value'] ?? 'best_ai_pick',
    };
  }, [prefs.budgetActive, prefs.budgetMax, prefs.maxDuration, prefs.stops, prefs.departureWindow, prefs.sort]);

  const aiOneWayResult = useMemo(() => {
    if (!prefs.aiIntelligence || tripParam === 'round_trip' || !scoredResults.length) return null;
    return rankFlightOffers(scoredResults, 'ONE_WAY', aiPrefs, false, selectedClasses.size > 0 ? selectedClasses : undefined);
  }, [prefs.aiIntelligence, scoredResults, aiPrefs, tripParam, selectedClasses]);

  const aiRTResult = useMemo(() => {
    if (!prefs.aiIntelligence || tripParam !== 'round_trip' || !roundTripOptions.length) return null;
    return rankFlightOffers(roundTripOptions, 'ROUND_TRIP', aiPrefs, false, selectedClasses.size > 0 ? selectedClasses : undefined);
  }, [prefs.aiIntelligence, roundTripOptions, aiPrefs, tripParam, selectedClasses]);

  const effectiveOneWay = useMemo<UnifiedFlight[]>(() => {
    if (!aiOneWayResult) return scoredResults;
    const ranked = aiOneWayResult.ranked.map(r => r.option);
    const unranked = aiOneWayResult.filteredOut.map(r => ({
      ...r.option,
      valueScore: 0,
      breakdown: undefined,
      tags: [],
    }));
    return [...ranked, ...unranked];
  }, [aiOneWayResult, scoredResults]);

  // When AI is ON and no explicit user sort, use AI ranking; otherwise use manual sort
  const effectiveRT = useMemo<RoundTripOption[]>(() => {
    if (aiRTResult && rtSortMode === null) {
      const ranked = aiRTResult.ranked.map(r => r.option);
      const unranked = aiRTResult.filteredOut.map(r => ({
        ...r.option,
        score: 0,
        scoreBreakdown: undefined,
        badges: [],
      }));
      return [...ranked, ...unranked];
    }
    return sortedRoundTrip;
  }, [aiRTResult, rtSortMode, sortedRoundTrip]);

  // Reset manual sort when AI is toggled back ON so AI takes over
  useEffect(() => {
    if (prefs.aiIntelligence) setRtSortMode(null);
  }, [prefs.aiIntelligence]);

  const aiOneWayMap = useMemo(() => {
    if (!aiOneWayResult) return null;
    return new Map<string, AiScoredOption<UnifiedFlight>>(
      aiOneWayResult.ranked.map(r => [r.option.id, r])
    );
  }, [aiOneWayResult]);

  const aiRTMap = useMemo(() => {
    if (!aiRTResult) return null;
    const map = new Map<string, AiScoredOption<RoundTripOption>>();
    // Include all ranked options (have full AI scores + reasons)
    for (const r of aiRTResult.ranked) {
      map.set(r.option.id, r);
    }
    // Include filtered-out options with stub reasons so DNA-reordered cards
    // still show AI recommendations (DNA may elevate quality-filtered options)
    for (const f of aiRTResult.filteredOut) {
      if (!map.has(f.option.id)) {
        map.set(f.option.id, {
          option: f.option,
          aiScore: 0,
          aiScoreRaw: 0,
          labels: [],
          rankingTags: [],
          aiReasons: [f.reason || 'This option did not rank highly in AI scoring'],
          layoverPenalty: 0,
          filtered: false,
        });
      }
    }
    return map;
  }, [aiRTResult]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setShowSortDropdown(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const panelFilteredOneWay = useMemo(() => {
    // Use effectiveOneWay (AI-ranked when AI is on) — not the pre-AI scoredResults
    let f = effectiveOneWay;
    if (selectedAirlines.size > 0) f = f.filter(fl => selectedAirlines.has(fl.airline.name));
    if (selectedClasses.size  > 0) f = f.filter(fl => selectedClasses.has(fl.cabinClass));
    if (selectedFeatures.size > 0) f = f.filter(fl =>
      [...selectedFeatures].some(feat =>
        feat === 'carryOn' ? fl.baggage.carryOn > 0 : feat === 'checked' ? fl.baggage.checked > 0 :
        feat === 'refundable' ? fl.fareRules.refundable : feat === 'changeable' ? fl.fareRules.changeable : false
      )
    );
    return f;
  }, [effectiveOneWay, selectedAirlines, selectedClasses, selectedFeatures]);

  const topResults = useMemo(() => {
    const copy = [...panelFilteredOneWay];
    if (!prefs.aiIntelligence) {
      if (sortMode === 'fastest') copy.sort((a, b) => a.totalDuration - b.totalDuration);
      else copy.sort((a, b) => a.totalPrice - b.totalPrice);
    }
    return copy;
  }, [panelFilteredOneWay, sortMode, prefs.aiIntelligence]);

  // When chatbot result is active: filter list view to ONLY the ranked cards, in ranked order.
  // When cleared (or 0 matches — stale IDs): fall back to topResults.
  const displayResults = useMemo(() => {
    if (!aiAssistResult?.rankedIds?.length) return topResults;
    const filtered = aiAssistResult.rankedIds
      .map(id => panelFilteredOneWay.find(f => f.id === id))
      .filter((f): f is UnifiedFlight => f !== undefined);
    return filtered.length > 0 ? filtered : topResults;
  }, [topResults, panelFilteredOneWay, aiAssistResult]);

  const airlines = useMemo(() => {
    const seen = new Map<string, string>();
    results.forEach((f) => { if (!seen.has(f.airline.code)) seen.set(f.airline.code, f.airline.name); });
    return Array.from(seen.entries()).map(([code, name]) => ({ code, name }));
  }, [results]);

  // ── Apply all preferences to round-trip options ────────────────────────────
  // (Must be defined before filter-panel option counts that depend on it)
  const prefsFilteredRT = useMemo<RoundTripOption[]>(() => {
    let filtered = effectiveRT;
    if (prefs.budgetActive) {
      filtered = filtered.filter(rt => rt.totalPrice >= prefs.budgetMin && rt.totalPrice <= prefs.budgetMax);
    }
    if (prefs.maxDuration != null) {
      filtered = filtered.filter(rt => rt.totalDurationMinutes <= prefs.maxDuration!);
    }
    if (prefs.stops === 'nonstop') {
      filtered = filtered.filter(rt => rt.totalStops === 0);
    } else if (prefs.stops === '1stop') {
      filtered = filtered.filter(rt => rt.maxStopsOneWay <= 1);
    } else if (prefs.stops === '2stop') {
      filtered = filtered.filter(rt => rt.maxStopsOneWay <= 2);
    }
    if (prefs.departureWindow != null) {
      filtered = filtered.filter(rt => {
        const h = new Date(rt.outboundJourney.departureTime).getHours();
        if (prefs.departureWindow === 'morning')   return h >= 5 && h < 12;
        if (prefs.departureWindow === 'afternoon') return h >= 12 && h < 17;
        if (prefs.departureWindow === 'evening')   return h >= 17 && h < 21;
        if (prefs.departureWindow === 'night')     return h >= 21 || h < 5;
        return true;
      });
    }
    return filtered;
  }, [effectiveRT, prefs.budgetActive, prefs.budgetMin, prefs.budgetMax, prefs.maxDuration, prefs.stops, prefs.departureWindow]);

  // ── Filter panel options (computed from prefs-filtered results) ──

  const airlineFilterOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, { count: number; min: number }>();
    if (tripParam === 'round_trip') {
      // Use prefsFilteredRT so counts reflect what's visible after budget/stops/duration filters
      prefsFilteredRT.forEach(rt => rt.airlines.forEach(name => {
        const e = map.get(name) || { count: 0, min: Infinity };
        map.set(name, { count: e.count + 1, min: Math.min(e.min, rt.totalPrice) });
      }));
    } else {
      effectiveOneWay.forEach(f => {
        const e = map.get(f.airline.name) || { count: 0, min: Infinity };
        map.set(f.airline.name, { count: e.count + 1, min: Math.min(e.min, f.totalPrice) });
      });
    }
    return Array.from(map.entries())
      .map(([name, { count, min }]) => ({ id: name, label: name, count, minPrice: isFinite(min) ? min : null }))
      .sort((a, b) => (a.minPrice ?? 0) - (b.minPrice ?? 0));
  }, [effectiveOneWay, prefsFilteredRT, tripParam]);

  const classFilterOptions = useMemo<FilterOption[]>(() => {
    // Always show all standard classes; count=0 ones are shown disabled
    const ALL_CLASSES: { key: string; label: string; note?: string }[] = [
      { key: 'economy',          label: 'Economy' },
      { key: 'premium_economy',  label: 'Premium Economy' },
      { key: 'business',         label: 'Business Class' },
      { key: 'first',            label: 'First Class' },
    ];
    const map = new Map<string, { count: number; min: number }>();
    const src = tripParam === 'round_trip' ? prefsFilteredRT : effectiveOneWay;
    src.forEach(item => {
      const cls = (item as { cabinClass: string }).cabinClass;
      const e = map.get(cls) || { count: 0, min: Infinity };
      map.set(cls, { count: e.count + 1, min: Math.min(e.min, item.totalPrice) });
    });
    return ALL_CLASSES.map(({ key, label, note }) => {
      const d = map.get(key);
      return { id: key, label, note, count: d?.count ?? 0, minPrice: d && isFinite(d.min) ? d.min : null };
    });
  }, [effectiveOneWay, prefsFilteredRT, tripParam]);

  const featureFilterOptions = useMemo<FilterOption[]>(() => {
    type FlightLike = { baggage: { carryOn: number; checked: number }; fareRules: { refundable: boolean; changeable: boolean }; totalPrice: number };
    const defs: { key: string; label: string; test: (f: FlightLike) => boolean }[] = [
      { key: 'carryOn',    label: 'Carry-on included', test: f => (f.baggage?.carryOn ?? 0) > 0 },
      { key: 'checked',    label: 'Checked bag',        test: f => (f.baggage?.checked ?? 0) > 0 },
      { key: 'refundable', label: 'Refundable fare',    test: f => !!f.fareRules?.refundable },
      { key: 'changeable', label: 'Changes included',   test: f => !!f.fareRules?.changeable },
    ];
    const src = (tripParam === 'round_trip' ? prefsFilteredRT : effectiveOneWay) as FlightLike[];
    return defs.map(({ key, label, test }): FilterOption | null => {
      const matching = src.filter(test);
      if (!matching.length) return null;
      return { id: key, label, count: matching.length, minPrice: Math.min(...matching.map(f => f.totalPrice)) };
    }).filter((x): x is FilterOption => x !== null);
  }, [effectiveOneWay, prefsFilteredRT, tripParam]);

  const handleSelectFlight = useCallback((flight: UnifiedFlight) => {
    fareStore.reset();
    fareStore.setSourceFlight(flight);
    const flightOrigin = searchParams.get('origin') || flight.segments[0]?.departure.airport || '';
    const flightDest = searchParams.get('destination') || flight.segments[flight.segments.length - 1]?.arrival.airport || '';
    // Compute layover durations between consecutive segments
    const layoverMinutes: number[] = [];
    for (let i = 1; i < flight.segments.length; i++) {
      const prevArr  = new Date(flight.segments[i - 1].arrival.time).getTime();
      const nextDep  = new Date(flight.segments[i].departure.time).getTime();
      const layover  = Math.round((nextDep - prevArr) / 60000);
      if (layover > 0) layoverMinutes.push(layover);
    }
    sessionStorage.setItem('fm_fare_context', JSON.stringify({
      offerId: flight.providerOfferId,
      basePrice: flight.totalPrice,
      providerTotalFare: (flight as any).providerTotalFare ?? flight.totalPrice,
      fareMindMarkupAmount: (flight as any).fareMindMarkupAmount ?? 0,
      travelers: parseInt(adults, 10) + parseInt(childrenParam, 10) + parseInt(infantsParam, 10),
      adults: parseInt(adults, 10),
      children: parseInt(childrenParam, 10),
      infants: parseInt(infantsParam, 10),
      currency: flight.currency || 'USD',
      origin: flightOrigin,
      destination: flightDest,
      stops: flight.stops,
      durationMinutes: flight.totalDuration,
      layoverMinutes,
      date,
      cabin,
      trip: tripParam,
      returnDate: returnDateParam,
    }));
    setShowFareModal(true);
  }, [fareStore, searchParams, adults, childrenParam, infantsParam, date, cabin, tripParam, returnDateParam]);

  const panelFilteredRT = useMemo(() => {
    let f = prefsFilteredRT;
    if (selectedAirlines.size > 0) f = f.filter(rt => rt.airlines.some(a => selectedAirlines.has(a)));
    if (selectedClasses.size  > 0) f = f.filter(rt => selectedClasses.has(rt.cabinClass));
    if (selectedFeatures.size > 0) f = f.filter(rt =>
      [...selectedFeatures].some(feat =>
        feat === 'carryOn' ? rt.baggage.carryOn > 0 : feat === 'checked' ? rt.baggage.checked > 0 :
        feat === 'refundable' ? rt.fareRules.refundable : feat === 'changeable' ? rt.fareRules.changeable : false
      )
    );
    return f;
  }, [prefsFilteredRT, selectedAirlines, selectedClasses, selectedFeatures]);

  // Derive active cabin(s) from the class filter — when the user toggles one
  // or more classes in the filter panel, the flex-date strip should show the
  // lowest fare among the selected classes.  Comma-separated for multi-select.
  const activeCabin = useMemo(() => {
    if (selectedClasses.size > 0) return [...selectedClasses].join(',');
    return cabin; // fallback to URL param when no filter is active
  }, [selectedClasses, cabin]);

  // Return-leg metadata for round trips — passed to chatbot for dual-leg display
  const rtMetaMap = useMemo(() => {
    if (tripParam !== 'round_trip' || panelFilteredRT.length === 0) return undefined;
    const map = new Map<string, { outboundDurationMinutes: number; returnDeparture: string; returnArrival: string; returnDurationMinutes: number; returnStops: number }>();
    panelFilteredRT.forEach(rt => {
      map.set(rt.id, {
        outboundDurationMinutes: rt.outboundJourney.durationMinutes,
        returnDeparture:       rt.returnJourney.departureAirport,
        returnArrival:         rt.returnJourney.arrivalAirport,
        returnDurationMinutes: rt.returnJourney.durationMinutes,
        returnStops:           rt.returnJourney.stops,
      });
    });
    return map;
  }, [panelFilteredRT, tripParam]);

  const AI_POOL_SIZE = parseInt(process.env.NEXT_PUBLIC_AI_CHATBOT_POOL_SIZE ?? '30', 10);

  // Full AI Pick pool sent to the chatbot — the chatbot re-ranks/filters within this set.
  // Pool size is controlled by NEXT_PUBLIC_AI_CHATBOT_POOL_SIZE (default: 30).
  const aiFlights = useMemo<UnifiedFlight[]>(() => {
    if (panelFilteredOneWay.length > 0) return panelFilteredOneWay.slice(0, AI_POOL_SIZE);
    return panelFilteredRT.slice(0, AI_POOL_SIZE).map(rt => ({
      id: rt.id,
      provider: rt.provider,
      providerOfferId: rt.providerOfferId,
      airline: { code: rt.airlineCodes[0] ?? 'XX', name: rt.airlines[0] ?? 'Unknown' },
      segments: rt.outboundJourney.segments,
      totalPrice: rt.totalPrice,
      currency: rt.currency,
      cabinClass: rt.cabinClass,
      fareRules: rt.fareRules,
      baggage: rt.baggage,
      totalDuration: rt.totalDurationMinutes,
      stops: rt.maxStopsOneWay,
      valueScore: rt.score ?? 50,
    }));
  }, [panelFilteredOneWay, panelFilteredRT]);

  // When chatbot result is active: show ONLY the chatbot-ranked cards in chatbot order.
  // If IDs don't match (stale result / trip-type switch), fall back to full panel.
  const displayPanelOneWay = useMemo(() => {
    if (!aiAssistResult?.rankedIds?.length) return panelFilteredOneWay;
    const filtered = aiAssistResult.rankedIds
      .map(id => panelFilteredOneWay.find(f => f.id === id))
      .filter((f): f is UnifiedFlight => f !== undefined);
    return filtered.length > 0 ? filtered : panelFilteredOneWay;
  }, [panelFilteredOneWay, aiAssistResult]);

  // 🧬 DNA-aware one-way display: DNA-scored cards first (by DNA score desc), then remaining AI-ranked
  const dnaDisplayOneWay = useMemo(() => {
    if (!dnaSearchActive || !dnaResultsMap) return displayPanelOneWay;
    const dnaScored = displayPanelOneWay.filter(f => dnaResultsMap.has(f.id));
    const nonDna = displayPanelOneWay.filter(f => !dnaResultsMap.has(f.id));
    dnaScored.sort((a, b) => {
      const dnaA = dnaResultsMap.get(a.id)?.finalDnaScore ?? 0;
      const dnaB = dnaResultsMap.get(b.id)?.finalDnaScore ?? 0;
      return dnaB - dnaA;
    });
    return [...dnaScored, ...nonDna];
  }, [displayPanelOneWay, dnaSearchActive, dnaResultsMap]);

  const displayPanelRT = useMemo(() => {
    if (!aiAssistResult?.rankedIds?.length) return panelFilteredRT;
    const filtered = aiAssistResult.rankedIds
      .map(id => panelFilteredRT.find(rt => rt.id === id))
      .filter((rt): rt is RoundTripOption => rt !== undefined);
    return filtered.length > 0 ? filtered : panelFilteredRT;
  }, [panelFilteredRT, aiAssistResult]);

  // 🧬 DNA-aware RT display: uses the SNAPSHOT flights (from when DNA search started)
  // sorted by DNA score. This guarantees IDs match the dnaResultsMap keys.
  const dnaDisplayRT = useMemo(() => {
    if (!dnaSearchActive || !dnaResultsMap || dnaSnapshotRT.length === 0) return displayPanelRT;
    // Use snapshot flights — their IDs match the map's cardIds
    const dnaScored = dnaSnapshotRT.filter(rt => dnaResultsMap.has(rt.id));
    const nonDna = dnaSnapshotRT.filter(rt => !dnaResultsMap.has(rt.id));
    dnaScored.sort((a, b) => {
      const dnaA = dnaResultsMap.get(a.id)?.finalDnaScore ?? 0;
      const dnaB = dnaResultsMap.get(b.id)?.finalDnaScore ?? 0;
      return dnaB - dnaA;
    });
    return [...dnaScored, ...nonDna];
  }, [displayPanelRT, dnaSearchActive, dnaResultsMap, dnaSnapshotRT]);

  // 🧬 DNA Search handler — placed here so all dependencies (tripParam, panelFilteredRT, panelFilteredOneWay, origin, destination, date) are initialized
  const [dnaIneligibleReason, setDnaIneligibleReason] = useState<string | null>(null);
  const [dnaSearchStatus, setDnaSearchStatus] = useState<DnaSearchStatus | null>(null);
  const [dnaSearchBannerVisible, setDnaSearchBannerVisible] = useState(false);
  const [dnaFlightCount, setDnaFlightCount] = useState(0);

  const handleDnaSearch = useCallback(async (): Promise<boolean> => {
    // If user is not signed in, redirect to login with return URL + dna=1
    if (!authUser) {
      const currentUrl = window.location.pathname + window.location.search;
      // Append dna=1 to the current search URL for auto-trigger after login
      const separator = currentUrl.includes('?') ? '&' : '?';
      const returnUrl = `${currentUrl}${separator}dna=1`;
      router.push(`/auth/login?redirect=${encodeURIComponent(returnUrl)}`);
      return false;
    }

    // If already active WITH results, toggle off instantly (user clicked to deactivate)
    if (dnaSearchActive && dnaSearchResults) {
      prefs.setDnaSearchActive(false);
      setDnaSearchResults(null);
      setDnaSnapshotRT([]);
      setDnaAiSnapshotRT(null);
      setDnaIneligibleReason(null);
      return false;
    }

    // Clear previous ineligible state so user can retry
    setDnaSearchEligible(null);
    setDnaIneligibleReason(null);
    setDnaSearchLoading(true);
    setDnaSearchStatus('initializing');
    setDnaSearchBannerVisible(true);
    trackDnaEvent('dna_search_started', { source: 'flight_page' });

    // Minimum loading time so the user sees the banner progress
    const minLoadingDelay = new Promise(r => setTimeout(r, 1500));

    try {
      // Determine which cards to send (top 50 AI-ranked)
      const cardsToSend = tripParam === 'round_trip'
        ? panelFilteredRT.slice(0, 50).map(rt => ({
            id: rt.id,
            provider: rt.provider,
            providerOfferId: rt.providerOfferId,
            airline: { code: rt.airlineCodes[0] ?? 'XX', name: rt.airlines[0] ?? 'Unknown' },
            segments: rt.outboundJourney.segments,
            totalPrice: rt.totalPrice,
            currency: rt.currency,
            cabinClass: rt.cabinClass,
            fareRules: rt.fareRules,
            baggage: rt.baggage,
            totalDuration: rt.totalDurationMinutes,
            stops: rt.maxStopsOneWay,
            valueScore: rt.score ?? 50,
          }))
        : panelFilteredOneWay.slice(0, 50);

      console.log(`[DNA Search] Sending ${cardsToSend.length} cards, userId=${authUser?.id ?? 'none'}`);
      setDnaFlightCount(cardsToSend.length);

      // Snapshot the flights being sent — used for display when DNA is active
      // This prevents ID mismatches if flights are re-fetched during the 30-60s DNA API call
      if (tripParam === 'round_trip') {
        setDnaSnapshotRT(panelFilteredRT.slice());
        // Snapshot AI data alongside flight data — prevents ID mismatch
        // when AI map rebuilds after search re-runs (e.g. login redirect)
        if (aiRTMap) {
          setDnaAiSnapshotRT(new Map(aiRTMap));
        }
      }

      // Determine if search is international based on airport codes
      // Common US major airport codes — if both are US, it's domestic
      const US_AIRPORTS = new Set([
        'ATL','LAX','ORD','DFW','DEN','JFK','SFO','SEA','LAS','MCO',
        'EWR','CLT','PHX','IAH','MIA','BOS','MSP','DTW','FLL','PHL',
        'LGA','BWI','SLC','SAN','DCA','IAD','TPA','HNL','PDX','STL',
        'MCI','RDU','SMF','SNA','AUS','CLE','OAK','SJC','IND','CVG',
        'CMH','BNA','PIT','SAT','MKE','RSW','ABQ','OMA','BUF','RIC',
        'OGG','ANC','BOI','TUS','ELP','BDL','JAX','BHM','CHS','GRR',
      ]);
      const originIsUS = US_AIRPORTS.has(origin.toUpperCase());
      const destIsUS = US_AIRPORTS.has(destination.toUpperCase());
      const isInternational = !(originIsUS && destIsUS);

      // Stage 2: matching — fire API call
      setDnaSearchStatus('matching');

      const [res] = await Promise.all([
        fetch('/api/ai/dna-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            flights: cardsToSend,
            userId: authUser?.id,
            searchSessionId: `search_${origin}_${destination}_${date}`,
            tripCategory: isInternational ? 'INTERNATIONAL' : 'DOMESTIC',
          }),
        }),
        minLoadingDelay,
      ]);

      // Stage 3: ranking — processing response
      setDnaSearchStatus('ranking');
      await new Promise(r => setTimeout(r, 800)); // Brief pause so user sees ranking stage

      const data: DnaSearchResult = await res.json();
      // Update flight count from the actual topN config in the API response
      if (data.dnaSearchTopN) setDnaFlightCount(data.dnaSearchTopN);
      console.log('[DNA Search] Response:', { eligible: data.eligible, reason: data.reason, resultCount: data.results?.length ?? 0, topN: data.dnaSearchTopN });

      if (!res.ok || !data.eligible) {
        // Don't permanently disable — keep as null so user can retry
        setDnaSearchEligible(null);
        setDnaSearchResults(null);
        const reason = data.reason || 'DNA Search is not available right now. Please try again.';
        setDnaIneligibleReason(reason);
        console.warn('[DNA Search] Not eligible:', reason);
        setDnaSearchStatus('error');
        // Auto-hide error banner after 4 seconds
        setTimeout(() => {
          setDnaSearchBannerVisible(false);
          setDnaSearchStatus(null);
          setDnaIneligibleReason(null);
        }, 4000);
        return false;
      } else {
        setDnaSearchEligible(true);
        setDnaSearchResults(data);
        prefs.setDnaSearchActive(true);
        setDnaSearchStatus('complete');
        // Debug: trace DNA mapping
        console.log('[DNA Search] ✅ Results received:', {
          resultCount: data.results.length,
          sampleCardIds: data.results.slice(0, 3).map((r: any) => r.cardId),
          sampleDnaScores: data.results.slice(0, 3).map((r: any) => r.dnaScore),
          sampleRTIds: panelFilteredRT.slice(0, 3).map(rt => rt.id),
          sampleOWIds: panelFilteredOneWay.slice(0, 3).map(f => f.id),
        });
        trackDnaEvent('dna_search_completed', {
          source: 'flight_page',
          totalResults: data.results.length,
          cached: data.cached,
        });
        // Show success for 3 seconds then hide (enough time for bar to visually reach 100%)
        setTimeout(() => {
          setDnaSearchBannerVisible(false);
          setDnaSearchStatus(null);
        }, 3000);
        return true;
      }
    } catch (err) {
      console.warn('[DNA Search] Error:', err);
      await minLoadingDelay;
      setDnaIneligibleReason('DNA Search encountered an error. Please try again.');
      setDnaSearchStatus('error');
      setTimeout(() => {
        setDnaSearchBannerVisible(false);
        setDnaSearchStatus(null);
        setDnaIneligibleReason(null);
      }, 4000);
      return false;
    } finally {
      setDnaSearchLoading(false);
    }
  }, [dnaSearchActive, dnaSearchResults, tripParam, panelFilteredRT, panelFilteredOneWay, origin, destination, date, prefs, authUser, router]);

  // 🧬 Auto-trigger DNA Search when redirected back from login with dna=1
  const dnaAutoTriggered = useRef(false);
  useEffect(() => {
    if (
      dnaAutoTrigger &&
      authUser &&
      !dnaAutoTriggered.current &&
      !loading &&
      !dnaSearchLoading &&
      !dnaSearchResults &&   // No results yet — trigger DNA search
      (results.length > 0 || roundTripOptions.length > 0)
    ) {
      dnaAutoTriggered.current = true;
      // Remove dna=1 from URL to prevent re-triggering on refresh
      const url = new URL(window.location.href);
      url.searchParams.delete('dna');
      window.history.replaceState({}, '', url.toString());
      console.log('[DNA Search] 🧬 Auto-triggering DNA Search after sign-in redirect');
      // Trigger DNA Search
      handleDnaSearch();
    }
  }, [dnaAutoTrigger, authUser, loading, dnaSearchLoading, dnaSearchResults, results, roundTripOptions, handleDnaSearch]);

  // ── Active map flight: show hovered card's polylines, or first card by default ──
  const activeMapRoundTrips = useMemo(() => {
    if (hoveredFlightId) {
      const found = panelFilteredRT.find(rt => rt.id === hoveredFlightId);
      return found ? [found] : panelFilteredRT.slice(0, 1);
    }
    return panelFilteredRT.slice(0, 1);
  }, [hoveredFlightId, panelFilteredRT]);

  const activeMapFlights = useMemo(() => {
    if (hoveredFlightId) {
      const found = panelFilteredOneWay.find(f => f.id === hoveredFlightId);
      return found ? [found] : panelFilteredOneWay.slice(0, 1);
    }
    return panelFilteredOneWay.slice(0, 1);
  }, [hoveredFlightId, panelFilteredOneWay]);

  return (
    <div className={`bg-rising-sun-image relative text-slate-900 ${viewMode === 'map' ? 'h-screen flex flex-col overflow-hidden' : 'min-h-screen'}`}>
      <div className="absolute inset-0 scenic-overlay pointer-events-none" />

      {/* Offer expiry warning & expired modals */}
      <OfferExpiryModals />




      {/* Header */}
      <div ref={headerRef} className={`bg-[#1a1a2e]/95 backdrop-blur-xl border-b border-white/[0.06] shadow-lg ${viewMode === 'map' ? 'flex-none z-40' : 'sticky top-0 z-40'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 overflow-hidden">
              <button
                onClick={() => router.push('/')}
                className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/[0.08] border border-white/[0.12] text-white/70 hover:text-white hover:bg-white/[0.14] transition-all shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 5l-7 7 7 7"/>
                </svg>
              </button>
              {/* ── Airport FIDS departure-board ── */}
              <div className="font-mono relative overflow-hidden px-2 py-1">

                {/* board header */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[8px] tracking-[0.35em] uppercase text-[#00ff41]/40 font-bold">
                    {tripParam === 'round_trip' ? '▶ departures / arrivals' : '▶ departures'}
                  </span>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00ff41] animate-pulse shadow-[0_0_6px_#00ff41]" />
                </div>

                {/* main route row */}
                <div className="flex items-center gap-3 flex-wrap">
                  {/* origin */}
                  <div className="flex flex-col leading-none">
                    <span className="text-[8px] text-[#00ff41]/40 uppercase tracking-[0.2em]">from</span>
                    <span className="text-[#00ff41] text-base sm:text-xl font-black tracking-[0.1em] sm:tracking-[0.15em] leading-tight" style={{ textShadow: '0 0 12px rgba(0,255,65,0.6)' }}>
                      {origin}
                    </span>
                    <span className="hidden sm:block text-[9px] text-[#00ff41]/55 uppercase tracking-widest mt-0.5">
                      {(originAirport?.city || origin).toUpperCase()}
                    </span>
                  </div>

                  {/* arrow */}
                  <div className="flex items-center gap-1 text-[#00ff41]/40 pb-0.5">
                    <span className="text-xs tracking-[-2px]">────</span>
                    <Plane className="w-3 h-3 text-[#00ff41]/70" style={{ filter: 'drop-shadow(0 0 4px rgba(0,255,65,0.5))' }} />
                    <span className="text-xs tracking-[-2px]">────</span>
                  </div>

                  {/* destination */}
                  <div className="flex flex-col leading-none">
                    <span className="text-[8px] text-[#00ff41]/40 uppercase tracking-[0.2em]">to</span>
                    <span className="text-[#00ff41] text-base sm:text-xl font-black tracking-[0.1em] sm:tracking-[0.15em] leading-tight" style={{ textShadow: '0 0 12px rgba(0,255,65,0.6)' }}>
                      {destination}
                    </span>
                    <span className="hidden sm:block text-[9px] text-[#00ff41]/55 uppercase tracking-widest mt-0.5">
                      {(destAirport?.city || destination).toUpperCase()}
                    </span>
                  </div>

                  {/* divider */}
                  <div className="hidden sm:block w-px h-9 bg-[#00ff41]/15 mx-1 self-center" />

                  {/* meta */}
                  <div className="hidden sm:flex flex-col gap-0.5 leading-none">
                    <div className="flex items-center gap-1.5">
                      {date && (
                        <span className="text-[#00ff41] text-xs font-bold tracking-widest" style={{ textShadow: '0 0 8px rgba(0,255,65,0.5)' }}>
                          {fmtMonth(date).toUpperCase()}
                        </span>
                      )}
                      {returnDateParam && (
                        <>
                          <span className="text-[#00ff41]/40 text-xs">›</span>
                          <span className="text-[#00ff41] text-xs font-bold tracking-widest" style={{ textShadow: '0 0 8px rgba(0,255,65,0.5)' }}>
                            {fmtMonth(returnDateParam).toUpperCase()}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-[#00ff41]/50 uppercase tracking-wider">
                      <span>{parseInt(adults, 10) + parseInt(childrenParam, 10) + parseInt(infantsParam, 10)}&nbsp;PAX</span>
                      <span className="text-[#00ff41]/25">·</span>
                      <span>{cabin.toUpperCase()}</span>
                      {tripParam === 'round_trip' && (
                        <>
                          <span className="text-[#00ff41]/25">·</span>
                          <span className="text-[#00ff41]/70 font-bold">RT</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-none">
              <OfferExpiryBadge />
              {searchMeta && (
                <div className={`hidden sm:flex items-center gap-1.5 px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm ${
                  !searchMeta.usedMockData ? 'bg-[#1ABC9C] text-white' : 'bg-[#F97316] text-white'
                }`}>
                  {!searchMeta.usedMockData ? <><Wifi className="w-3 h-3" /> Real-Time Flight Pricing</> : <><WifiOff className="w-3 h-3" /> Demo Data</>}
                </div>
              )}
              <button
                onClick={() => setShowSearch(!showSearch)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-white/[0.08] border border-white/[0.12] hover:bg-white/[0.12] transition-all"
              >
                {showSearch ? 'Hide Search' : 'Modify Search'}
              </button>
              <div className="flex items-center bg-white/5 rounded-xl p-1 border border-white/10">
                <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-[#1ABC9C] text-white shadow-lg' : 'text-white/40 hover:text-white'}`} title="List View">
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button onClick={() => setViewMode('map')} className={`p-2 rounded-lg transition-all ${viewMode === 'map' ? 'bg-[#1ABC9C] text-white shadow-lg' : 'text-white/40 hover:text-white'}`} title="Map View">
                  <MapIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {showSearch && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 overflow-hidden">
                <SearchForm
                  variant="compact"
                  initialOriginCode={origin}
                  initialOrigin={originAirport ? `${originAirport.city} (${origin})` : origin}
                  initialDestCode={destination}
                  initialDest={destAirport ? `${destAirport.city} (${destination})` : destination}
                  initialDate={date || undefined}
                  initialReturnDate={returnDateParam || undefined}
                  initialTripType={tripParam === 'round_trip' ? 'round_trip' : 'one_way'}
                  initialCabin={cabin as 'economy' | 'premium_economy' | 'business' | 'first'}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Smart Preferences Bar — list view only */}
      {viewMode !== 'map' && (
        <div className="border-b border-gray-200 bg-white relative z-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <SmartPreferencesBar
              tripType={tripParam as 'one_way' | 'round_trip'}
              rtSortMode={rtSortMode}
              onRtSortChange={setRtSortMode}
              departureDate={date}
              returnDate={returnDateParam}
              origin={origin}
              destination={destination}
              onDnaSearch={handleDnaSearch}
              dnaSearchActive={dnaSearchActive}
              dnaSearchLoading={dnaSearchLoading}
              dnaSearchEligible={dnaSearchEligible}
              dnaIneligibleReason={dnaIneligibleReason}
            />
          </div>
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center">
          <div className="flex flex-col items-center gap-6">
            <div className="w-20 h-20 border-[4px] border-black/10 border-t-black rounded-full animate-spin" />
            <div className="text-center">
              <p className="text-xl font-semibold text-black mb-1">Searching flights...</p>
              <p className="text-sm text-black/60">Fetching live fares from multiple providers</p>
            </div>
          </div>
        </div>
      ) : viewMode === 'map' ? (
        <div className="flex-1 flex flex-col md:flex-row z-10 bg-[#F8FAFC] min-h-0">
          {/* Left Side: Map (full height) with Filter Panel overlaid on top-left */}
          <div className="flex-none h-[260px] sm:h-[340px] w-full md:w-[37%] lg:w-[40%] md:h-full relative z-30 shadow-xl border-b md:border-b-0 md:border-r border-slate-200">
            <MultiFlightMap
              flights={activeMapFlights}
              roundTrips={activeMapRoundTrips}
              origin={origin}
              destination={destination}
              tripType={tripParam as 'one_way' | 'round_trip'}
              hoveredFlightId={hoveredFlightId}
              onHoverFlight={setHoveredFlightId}
              onSelectFlight={(id, _provider, _offerId, isRoundTrip) => {
                if (isRoundTrip) {
                  const rt = sortedRoundTrip.find(f => f.id === id);
                  if (rt) {
                    fareStore.reset();
                    fareStore.setSourceRoundTrip(rt);
                    sessionStorage.setItem('fm_fare_context', JSON.stringify({
                      offerId: rt.providerOfferId, basePrice: rt.totalPrice,
                      providerTotalFare: (rt as any).providerTotalFare ?? rt.totalPrice,
                      fareMindMarkupAmount: (rt as any).fareMindMarkupAmount ?? 0,
                      travelers: parseInt(adults, 10) + parseInt(childrenParam, 10) + parseInt(infantsParam, 10),
                      adults: parseInt(adults, 10),
                      children: parseInt(childrenParam, 10),
                      infants: parseInt(infantsParam, 10),
                      currency: rt.currency || 'USD',
                      origin: rt.outboundJourney.departureAirport,
                      destination: rt.outboundJourney.arrivalAirport,
                      stops: rt.maxStopsOneWay,
                      durationMinutes: rt.outboundJourney.durationMinutes,
                      layoverMinutes: [],
                      date,
                      cabin,
                      trip: tripParam,
                      returnDate: returnDateParam,
                    }));
                    setShowFareModal(true);
                  }
                } else {
                  const f = panelFilteredOneWay.find(fl => fl.id === id);
                  if (f) handleSelectFlight(f);
                }
              }}
            />

            {/* Filter Panel — absolute overlay on the left portion of the map */}
            <div className="absolute left-0 top-0 bottom-0 z-20 hidden md:flex flex-col w-[204px] bg-white/40 backdrop-blur-md border-r border-white/30 shadow-[2px_0_20px_rgba(0,0,0,0.06)]">
              <FilterPanel
                airlines={airlineFilterOptions}
                classes={classFilterOptions}
                features={featureFilterOptions}
                selectedAirlines={selectedAirlines}
                selectedClasses={selectedClasses}
                selectedFeatures={selectedFeatures}
                onToggleAirline={toggleAirline}
                onToggleClass={toggleClass}
                onToggleFeature={toggleFeature}
                onClearAll={clearAllFilters}
                loading={loading}
              />
            </div>

            {panelFilteredOneWay.length === 0 && roundTripOptions.length === 0 && !loading && (
              <div className="absolute inset-0 bg-white/20 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
                <div className="glass-panel p-8 rounded-3xl text-center max-w-sm">
                  <Plane className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-slate-800 mb-2">No flights found</h3>
                  <p className="text-sm text-slate-600">Try adjusting your filters or search criteria.</p>
                </div>
              </div>
            )}
          </div>


          {/* Cards — Right Side */}
          <div className="flex flex-col flex-1 min-h-0 w-full md:w-[63%] lg:w-[60%] md:h-full bg-[#F8FAFC]">

            {/* Sticky Preferences Bar */}
            <div className="relative z-50 flex-none border-b border-slate-200 bg-white/95 backdrop-blur-sm px-3 sm:px-4 py-2">
              <SmartPreferencesBar
                tripType={tripParam as 'one_way' | 'round_trip'}
                rtSortMode={rtSortMode}
                onRtSortChange={setRtSortMode}
                departureDate={date}
                returnDate={returnDateParam}
                origin={origin}
                destination={destination}
                onDnaSearch={handleDnaSearch}
                dnaSearchActive={dnaSearchActive}
                dnaSearchLoading={dnaSearchLoading}
                dnaSearchEligible={dnaSearchEligible}
                dnaIneligibleReason={dnaIneligibleReason}
              />
            </div>

            {/* Scrollable Cards */}
            <div className="scrollbar-light overflow-y-scroll flex-1 min-h-0 pb-20 pt-2 px-3 sm:px-4 lg:px-5 relative">
              <AnimatePresence>
                {isFiltering && (
                  <motion.div
                    key="map-filter-spinner"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="absolute inset-0 z-50 flex items-center justify-center bg-[#F8FAFC]/70 backdrop-blur-[1px] pointer-events-auto"
                  >
                    <div className="w-10 h-10 border-[3px] border-black/10 border-t-black rounded-full animate-spin" />
                  </motion.div>
                )}
              </AnimatePresence>
            <div className="w-full">

                {/* 🧬 DNA Search Progress Banner — above flexible date strip */}
                <DnaSearchProgressBanner
                  status={dnaSearchStatus ?? 'initializing'}
                  isVisible={dnaSearchBannerVisible}
                  message={dnaIneligibleReason ?? undefined}
                  flightCount={dnaFlightCount}
                />

                {/* Flexible date strip — round-trip only */}
                {tripParam === 'round_trip' && returnDateParam && (
                  <FlexibleDateStrip
                    origin={origin}
                    destination={destination}
                    departureDate={date}
                    returnDate={returnDateParam}
                    adults={adults}
                    children={childrenParam}
                    infants={infantsParam}
                    cabin={activeCabin}
                    tripParam={tripParam}
                    currentMinPrice={panelFilteredRT[0]?.totalPrice ?? null}
                  />
                )}

                {/* Round-trip cards */}
                {tripParam === 'round_trip' && panelFilteredRT.length > 0 && (
                  <>
                    <div className="flex items-center gap-3 mb-5 pt-2">
                      {dnaSearchActive ? <span className="text-lg">🧬</span> : <Sparkles className="w-5 h-5 text-amber-500" />}
                      <h2 className="text-base font-black text-slate-800 uppercase tracking-wide">
                        {dnaSearchActive ? 'DNA-Matched Round-trips' : 'Round-trip options'}
                      </h2>
                      <span className="text-xs text-slate-400 font-medium ml-auto">
                        {dnaSearchActive
                          ? `🧬 DNA-ranked · ${dnaDisplayRT.length} results`
                          : aiAssistResult ? `AI filtered · ${displayPanelRT.length} matches` : `AI-scored · ${Math.min(panelFilteredRT.length, 51)} of ${panelFilteredRT.length} results`}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {(dnaSearchActive ? dnaDisplayRT : displayPanelRT).map((option, i) => {
                        const dnaData = dnaResultsMap?.get(option.id);
                        // Use AI snapshot when DNA is active to prevent ID mismatch after search re-runs
                        const aiMap = dnaSearchActive ? (dnaAiSnapshotRT ?? aiRTMap) : aiRTMap;
                        const aiData = aiMap?.get(option.id);
                        return (
                        <RoundTripCard
                          key={option.id}
                          option={option}
                          index={i}
                          onSelect={setSelectedRoundTrip}
                          onHover={setHoveredFlightId}
                          isHovered={hoveredFlightId === option.id}
                          aiEnabled={prefs.aiIntelligence}
                          isBestAiPick={prefs.aiIntelligence && i === 0}
                          isTopAiPick={prefs.aiIntelligence && i > 0 && i < 30}
                          scoreOverride={prefs.aiIntelligence ? aiData?.aiScore : undefined}
                          isAiHighlighted={!!aiAssistResult && aiAssistResult.rankedIds[0] === option.id}
                          aiReasons={prefs.aiIntelligence ? aiData?.aiReasons : undefined}
                          dnaScore={dnaSearchActive ? dnaData?.dnaScore : undefined}
                          dnaMatchLabel={dnaSearchActive ? dnaData?.dnaMatchLabel : undefined}
                          dnaMatchReasons={dnaSearchActive && i < (dnaFlightCount || 25) ? dnaData?.matchReasons : undefined}
                          dnaMismatchReasons={dnaSearchActive && i < (dnaFlightCount || 25) ? dnaData?.mismatchReasons : undefined}
                          showScores={showScores}
                        />
                        );
                      })}
                    </div>
                  </>
                )}
                {tripParam === 'round_trip' && panelFilteredRT.length === 0 && roundTripOptions.length > 0 && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                    <Plane className="w-10 h-10 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-600">No flights match your filters</p>
                    <p className="text-xs text-slate-400">Try adjusting your filters or preferences</p>
                  </div>
                )}

                {/* One-way cards */}
                {tripParam !== 'round_trip' && panelFilteredOneWay.length > 0 && (
                  <>
                    <div className="flex items-center gap-3 mb-5 pt-4">
                      {dnaSearchActive ? <span className="text-lg">🧬</span> : <Sparkles className="w-5 h-5 text-amber-500" />}
                      <h2 className="text-base font-black text-slate-800 uppercase tracking-wide">
                        {dnaSearchActive ? 'DNA-Matched Flights' : 'Top flights for you'}
                      </h2>
                      <span className="text-xs text-slate-400 font-medium ml-auto">
                        {dnaSearchActive
                          ? `🧬 DNA-ranked · ${dnaDisplayOneWay.length} results`
                          : aiAssistResult ? `AI filtered · ${displayPanelOneWay.length} matches` : `AI-scored · ${Math.min(panelFilteredOneWay.length, 51)} of ${panelFilteredOneWay.length} results`}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {(dnaSearchActive ? dnaDisplayOneWay : displayPanelOneWay).map((flight, i) => {
                        const dnaData = dnaResultsMap?.get(flight.id);
                        return (
                        <motion.div
                          key={flight.id}
                          initial={{ opacity: 0, y: 12 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true, margin: "-40px" }}
                          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                          className={`cursor-pointer rounded-2xl transition-all duration-150 h-full ${
                            hoveredFlightId === flight.id
                              ? 'ring-2 ring-[#1ABC9C]/60 shadow-xl shadow-[#1ABC9C]/10 -translate-y-0.5'
                              : 'hover:shadow-lg hover:-translate-y-0.5'
                          }`}
                          onMouseEnter={() => setHoveredFlightId(flight.id)}
                          onMouseLeave={() => setHoveredFlightId(null)}
                          onClick={() => setSelectedFlight(flight)}
                        >
                          <FlightCard
                            flight={flight}
                            index={i}
                            onSelect={(f) => setSelectedFlight(f)}
                            scoreOverride={prefs.aiIntelligence ? aiOneWayMap?.get(flight.id)?.aiScore : (flight as any).aiScoreDisplay ?? undefined}
                            aiReasons={aiAssistResult?.reasoning?.[flight.id] ?? (flight as any).aiReasons}
                            isAiHighlighted={!!aiAssistResult && aiAssistResult.rankedIds[0] === flight.id}
                            aiBadge={aiAssistResult?.badges?.[flight.id]}
                            dnaScore={dnaSearchActive ? dnaData?.dnaScore : undefined}
                            dnaMatchLabel={dnaSearchActive ? dnaData?.dnaMatchLabel : undefined}
                            dnaMatchReasons={dnaSearchActive && i < (dnaFlightCount || 25) ? dnaData?.matchReasons : undefined}
                            dnaMismatchReasons={dnaSearchActive && i < (dnaFlightCount || 25) ? dnaData?.mismatchReasons : undefined}
                            finalDnaScore={dnaSearchActive ? dnaData?.finalDnaScore : undefined}
                            showScores={showScores}
                          />
                        </motion.div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* List view */
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
          <AnimatePresence>
            {isFiltering && (
              <motion.div
                key="list-filter-spinner"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="absolute inset-0 z-50 flex items-center justify-center bg-[#F8FAFC]/70 backdrop-blur-[1px] pointer-events-auto"
              >
                <div className="w-10 h-10 border-[3px] border-black/10 border-t-black rounded-full animate-spin" />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex gap-5 items-start">
            {/* Mobile filter button — visible below lg breakpoint in list view */}
            <div className="lg:hidden fixed bottom-6 left-4 z-50">
              <button
                onClick={() => setShowMobileFilters(true)}
                className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-[#1a1a2e] text-white text-sm font-bold shadow-2xl shadow-black/30 hover:bg-[#2a2a4e] active:scale-95 transition-all"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Filters
                {(selectedAirlines.size + selectedClasses.size + selectedFeatures.size) > 0 && (
                  <span className="w-5 h-5 rounded-full bg-[#1ABC9C] text-white text-[10px] font-bold flex items-center justify-center">
                    {selectedAirlines.size + selectedClasses.size + selectedFeatures.size}
                  </span>
                )}
              </button>
            </div>

            {/* Mobile filter drawer */}
            <AnimatePresence>
              {showMobileFilters && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] lg:hidden"
                    onClick={() => setShowMobileFilters(false)}
                  />
                  <motion.div
                    initial={{ x: '-100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '-100%' }}
                    transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                    className="fixed left-0 top-0 bottom-0 w-[280px] bg-white z-[101] shadow-2xl lg:hidden flex flex-col"
                  >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                      <h3 className="text-sm font-bold text-slate-900">Filters</h3>
                      <button
                        onClick={() => setShowMobileFilters(false)}
                        className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      <FilterPanel
                        airlines={airlineFilterOptions}
                        classes={classFilterOptions}
                        features={featureFilterOptions}
                        selectedAirlines={selectedAirlines}
                        selectedClasses={selectedClasses}
                        selectedFeatures={selectedFeatures}
                        onToggleAirline={toggleAirline}
                        onToggleClass={toggleClass}
                        onToggleFeature={toggleFeature}
                        onClearAll={() => { clearAllFilters(); setShowMobileFilters(false); }}
                        loading={loading}
                      />
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>

            {/* Filter sidebar — desktop only */}
            <div className="hidden lg:flex flex-col w-56 flex-none sticky top-24">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" style={{ height: 'calc(100vh - 7rem)' }}>
                <FilterPanel
                  airlines={airlineFilterOptions}
                  classes={classFilterOptions}
                  features={featureFilterOptions}
                  selectedAirlines={selectedAirlines}
                  selectedClasses={selectedClasses}
                  selectedFeatures={selectedFeatures}
                  onToggleAirline={toggleAirline}
                  onToggleClass={toggleClass}
                  onToggleFeature={toggleFeature}
                  onClearAll={clearAllFilters}
                  loading={loading}
                />
              </div>
            </div>

            {/* Results column */}
            <div className="flex-1 min-w-0">

              {tripParam === 'round_trip' ? (
                panelFilteredRT.length > 0 ? (
                  <div>
                    {returnDateParam && (
                      <FlexibleDateStrip
                        origin={origin}
                        destination={destination}
                        departureDate={date}
                        returnDate={returnDateParam}
                        adults={adults}
                        children={childrenParam}
                        infants={infantsParam}
                        cabin={activeCabin}
                        tripParam={tripParam}
                        currentMinPrice={panelFilteredRT[0]?.totalPrice ?? null}
                      />
                    )}
                    <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
                      <p className="text-sm text-slate-600 font-medium">
                        <span className="text-slate-800 font-bold">{panelFilteredRT.length}</span> round-trip options
                        {searchMeta?.totalTimeMs ? <span className="text-slate-400"> · {(searchMeta.totalTimeMs / 1000).toFixed(1)}s</span> : null}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {(dnaSearchActive ? dnaDisplayRT : panelFilteredRT).map((option, i) => {
                        const dnaData = dnaResultsMap?.get(option.id);
                        // Use AI snapshot when DNA is active to prevent ID mismatch after search re-runs
                        const aiMap = dnaSearchActive ? (dnaAiSnapshotRT ?? aiRTMap) : aiRTMap;
                        const aiData = aiMap?.get(option.id);
                        return (
                        <RoundTripCard
                          key={option.id}
                          option={option}
                          index={i}
                          onSelect={setSelectedRoundTrip}
                          onHover={setHoveredFlightId}
                          isHovered={hoveredFlightId === option.id}
                          aiEnabled={prefs.aiIntelligence}
                          isBestAiPick={prefs.aiIntelligence && i === 0}
                          isTopAiPick={prefs.aiIntelligence && i > 0 && i < 30}
                          scoreOverride={prefs.aiIntelligence ? aiData?.aiScore : undefined}
                          isAiHighlighted={!!aiAssistResult && aiAssistResult.rankedIds[0] === option.id}
                          aiReasons={prefs.aiIntelligence ? aiData?.aiReasons : undefined}
                          dnaScore={dnaSearchActive ? dnaData?.dnaScore : undefined}
                          dnaMatchLabel={dnaSearchActive ? dnaData?.dnaMatchLabel : undefined}
                          dnaMatchReasons={dnaSearchActive && i < (dnaFlightCount || 25) ? dnaData?.matchReasons : undefined}
                          dnaMismatchReasons={dnaSearchActive && i < (dnaFlightCount || 25) ? dnaData?.mismatchReasons : undefined}
                          showScores={showScores}
                        />
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-white/20 border border-white/40 flex items-center justify-center">
                      <Plane className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="text-lg font-semibold text-slate-800">No round-trip options found</p>
                    <p className="text-sm text-slate-600">Try different dates, cabin class, or clear filters</p>
                  </div>
                )

              ) : topResults.length > 0 ? (
                /* ── One-way list ── */
                <div>
                  <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
                    <p className="text-sm text-slate-600 font-medium">
                      Showing <span className="text-slate-800 font-bold">{topResults.length}</span> of{' '}
                      <span className="text-slate-800 font-bold">{panelFilteredOneWay.length}</span> flights
                      {searchMeta?.totalTimeMs ? <span className="text-slate-400"> · {(searchMeta.totalTimeMs / 1000).toFixed(1)}s</span> : null}
                    </p>
                    <div className="flex items-center gap-3">
                      {prefs.aiIntelligence && (
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#1ABC9C] text-white text-[11px] font-bold uppercase tracking-wider shadow-lg shadow-[#1ABC9C]/20">
                          <Sparkles className="w-3 h-3" /> AI-ranked
                        </div>
                      )}
                      <div ref={sortRef} className="relative">
                        <button
                          onClick={() => setShowSortDropdown((v) => !v)}
                          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-white border border-gray-200 text-[#0F172A] hover:border-[#1ABC9C] hover:text-[#1ABC9C] shadow-sm transition-all"
                        >
                          {sortMode === 'cheapest' && <TrendingDown className="w-4 h-4 text-green-500" />}
                          {sortMode === 'fastest'  && <Zap className="w-4 h-4 text-[#1ABC9C]" />}
                          {sortMode === 'cheapest' ? 'Cheapest' : 'Fastest'}
                          <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                        </button>
                        {showSortDropdown && (
                          <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl border border-gray-200 shadow-2xl shadow-black/10 p-3 z-50">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 pb-2">Sort results by</p>
                            {([
                              { key: 'cheapest', icon: <TrendingDown className="w-4 h-4 text-green-500" />, label: 'Cheapest', sub: 'Lowest price first' },
                              { key: 'fastest',  icon: <Zap className="w-4 h-4 text-[#1ABC9C]" />,          label: 'Fastest',  sub: 'Shortest flight time' },
                            ] as const).map(({ key, icon, label, sub }) => (
                              <button
                                key={key}
                                onClick={() => { setSortMode(key); setShowSortDropdown(false); }}
                                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all ${sortMode === key ? 'bg-[#1ABC9C]/10 border border-[#1ABC9C]/20' : 'hover:bg-gray-50'}`}
                              >
                                <div className="shrink-0">{icon}</div>
                                <div>
                                  <p className={`text-sm font-semibold ${sortMode === key ? 'text-[#1ABC9C]' : 'text-gray-800'}`}>{label}</p>
                                  <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
                                </div>
                                {sortMode === key && <span className="ml-auto w-2 h-2 rounded-full bg-[#1ABC9C] shrink-0" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {(dnaSearchActive ? dnaDisplayOneWay : displayResults).map((flight, i) => {
                      const dnaData = dnaResultsMap?.get(flight.id);
                      return (
                      <FlightCard
                        key={flight.id}
                        flight={flight}
                        index={i}
                        onSelect={handleSelectFlight}
                        scoreOverride={prefs.aiIntelligence ? aiOneWayMap?.get(flight.id)?.aiScore : (flight as any).aiScoreDisplay ?? undefined}
                        aiReasons={aiAssistResult?.reasoning?.[flight.id] ?? (flight as any).aiReasons}
                        isAiHighlighted={!!aiAssistResult && aiAssistResult.rankedIds[0] === flight.id}
                        aiBadge={aiAssistResult?.badges?.[flight.id]}
                        dnaScore={dnaSearchActive ? dnaData?.dnaScore : undefined}
                        dnaMatchLabel={dnaSearchActive ? dnaData?.dnaMatchLabel : undefined}
                        dnaMatchReasons={dnaSearchActive && i < (dnaFlightCount || 25) ? dnaData?.matchReasons : undefined}
                        dnaMismatchReasons={dnaSearchActive && i < (dnaFlightCount || 25) ? dnaData?.mismatchReasons : undefined}
                        finalDnaScore={dnaSearchActive ? dnaData?.finalDnaScore : undefined}
                        showScores={showScores}
                      />
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-white/20 border border-white/40 flex items-center justify-center">
                    <Plane className="w-8 h-8 text-slate-400" />
                  </div>
                  <p className="text-lg font-semibold text-slate-800">
                    {results.length > 0 ? 'No flights match your filters' : 'No flights found'}
                  </p>
                  <p className="text-sm text-slate-600">Try different dates, destinations, or clear filters</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Flight detail modal overlay */}
      <AnimatePresence>
        {selectedFlight && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedFlight(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ type: 'spring', damping: 26, stiffness: 240 }}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto"
            >
              <button
                onClick={() => setSelectedFlight(null)}
                className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-all shadow-sm"
              >
                <X className="w-4 h-4 text-slate-600" />
              </button>
              <FlightDetail flight={selectedFlight} />
              <div className="px-6 pb-6">
                <button
                  onClick={() => handleSelectFlight(selectedFlight)}
                  className="w-full py-4 bg-[#1ABC9C] text-white rounded-2xl font-bold text-base shadow-lg hover:brightness-110 active:scale-[0.98] transition-all"
                >
                  Select & Book Flight
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Round-trip detail modal */}
      {selectedRoundTrip && (
        <RoundTripDetailModal
          option={selectedRoundTrip}
          aiEnabled={prefs.aiIntelligence}
          isBestAiPick={prefs.aiIntelligence && panelFilteredRT[0]?.id === selectedRoundTrip.id}
          isTopAiPick={prefs.aiIntelligence && (() => { const idx = panelFilteredRT.findIndex(r => r.id === selectedRoundTrip.id); return idx > 0 && idx < 15; })()}
          aiScoreOverride={prefs.aiIntelligence ? (dnaSearchActive ? dnaAiSnapshotRT : aiRTMap)?.get(selectedRoundTrip.id)?.aiScore : undefined}
          aiReasonsOverride={prefs.aiIntelligence ? (dnaSearchActive ? dnaAiSnapshotRT : aiRTMap)?.get(selectedRoundTrip.id)?.aiReasons : undefined}
          showScores={showScores}
          onClose={() => setSelectedRoundTrip(null)}
          onBook={() => {
            fareStore.reset();
            fareStore.setSourceRoundTrip(selectedRoundTrip);
            const origin = selectedRoundTrip.outboundJourney.departureAirport;
            const destination = selectedRoundTrip.outboundJourney.arrivalAirport;
            sessionStorage.setItem('fm_fare_context', JSON.stringify({
              offerId: selectedRoundTrip.providerOfferId,
              basePrice: selectedRoundTrip.totalPrice,
              providerTotalFare: (selectedRoundTrip as any).providerTotalFare ?? selectedRoundTrip.totalPrice,
              fareMindMarkupAmount: (selectedRoundTrip as any).fareMindMarkupAmount ?? 0,
              travelers: parseInt(adults, 10) + parseInt(childrenParam, 10) + parseInt(infantsParam, 10),
              adults: parseInt(adults, 10),
              children: parseInt(childrenParam, 10),
              infants: parseInt(infantsParam, 10),
              currency: selectedRoundTrip.currency || 'USD',
              origin,
              destination,
              stops: selectedRoundTrip.maxStopsOneWay,
              durationMinutes: selectedRoundTrip.outboundJourney.durationMinutes,
              layoverMinutes: [],
              date,
              cabin,
              trip: tripParam,
              returnDate: returnDateParam,
            }));
            setSelectedRoundTrip(null);
            setShowFareModal(true);
          }}
        />
      )}

      {/* Fare selection modal */}
      {showFareModal && (
        <FareSelectionModal
          onClose={() => {
            setShowFareModal(false);
            fareStore.reset();
          }}
        />
      )}

      {/* Floating AI Assistant */}
      {!loading && aiFlights.length > 0 && (
        <FloatingAIAssistant
          flights={aiFlights}
          context={{
            origin,
            destination,
            tripType: tripParam,
            passengers: parseInt(adults, 10) + parseInt(childrenParam, 10) + parseInt(infantsParam, 10),
            adults: parseInt(adults, 10),
            children: parseInt(childrenParam, 10),
            infants: parseInt(infantsParam, 10),
            departureDate: date,
          }}
          onResult={setAiAssistResult}
          result={aiAssistResult}
          focusedFlightId={hoveredFlightId}
          rtMetaMap={rtMetaMap}
          roundTripOptions={roundTripOptions}
          onDnaSearch={handleDnaSearch}
          dnaSearchResults={dnaSearchResults}
        />
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
      </div>
    }>
      <SearchContent />
    </Suspense>
  );
}


