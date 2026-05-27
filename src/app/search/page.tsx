'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, useMemo, useRef, Suspense, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Plane, Wifi, WifiOff, Sparkles, Star, TrendingDown, Zap, ChevronDown, X } from 'lucide-react';
import { useSearchStore } from '@/store/useSearchStore';
import { usePreferencesStore, type SortPreference } from '@/store/usePreferencesStore';
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
    const windowRanges: Record<string, [number, number]> = { morning:[6,12], afternoon:[12,17], evening:[17,21], night:[21,30] };
    const [minH, maxH] = windowRanges[prefs.departureWindow] || [0, 24];
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
  const fareStore = useFareStore();

  const [showSearch, setShowSearch] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('map');
  const [sortMode, setSortMode] = useState<'cheapest' | 'fastest'>('cheapest');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
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
  const cabin = searchParams.get('cabin') || 'economy';
  const returnDateParam = searchParams.get('return') || '';
  const tripParam = searchParams.get('trip') || 'one_way';

  function fmtMonth(dateStr: string): string {
    if (!dateStr) return '';
    try { return format(new Date(dateStr), 'MMM yyyy'); } catch { return dateStr; }
  }

  const originAirport = AIRPORTS.find((a) => a.code === origin);
  const destAirport = AIRPORTS.find((a) => a.code === destination);

  useEffect(() => {
    const budgetMin = searchParams.get('budget_min');
    const budgetMax = searchParams.get('budget_max');
    const maxDuration = searchParams.get('max_duration');
    const stops = searchParams.get('stops');
    const depWindow = searchParams.get('departure_window');
    const sort = searchParams.get('sort');
    const personalized = searchParams.get('personalized');
    if (budgetMin && budgetMax) prefs.setBudget(Number(budgetMin), Number(budgetMax));
    if (maxDuration) prefs.setMaxDuration(Number(maxDuration));
    if (stops === 'nonstop' || stops === '1stop') prefs.setStops(stops);
    if (depWindow === 'morning' || depWindow === 'afternoon' || depWindow === 'evening' || depWindow === 'night') prefs.setDepartureWindow(depWindow);
    if (sort === 'cheapest' || sort === 'fastest' || sort === 'any') {
      prefs.setSort(sort as SortPreference);
    }
    if (!prefs.aiIntelligence) prefs.setAiIntelligence(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!origin || !destination || !date) return;
    setLoading(true);
    setSearchMeta(null);
    setResults([]);           // Clear one-way results
    setRoundTripOptions([]);  // Clear round-trip results
    setSelectedAirlines(new Set());
    setSelectedClasses(new Set());
    setSelectedFeatures(new Set());
    setAiAssistResult(null);

    const params = new URLSearchParams({
      origin, destination, date, adults, cabin,
      trip: tripParam,
      ...(returnDateParam ? { returnDate: returnDateParam } : {}),
    });
    fetch(`/api/search?${params}`)
      .then((data) => {
        if (data.error) {
          alert(`Search Error: ${data.error}\nDetails: ${data.details || 'Check logs'}`);
        } else if (data.roundTripOptions) {
          setRoundTripOptions(data.roundTripOptions);
        } else if (data.flights) {
          setResults(data.flights);
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
    return new Map<string, AiScoredOption<RoundTripOption>>(
      aiRTResult.ranked.map(r => [r.option.id, r])
    );
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

  // ── Filter panel options (computed from raw results, never from filtered) ──
  const CLASS_LABELS: Record<string, string> = {
    economy: 'Economy', premium_economy: 'Premium Economy', business: 'Business', first: 'First Class',
  };

  const airlineFilterOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, { count: number; min: number }>();
    if (tripParam === 'round_trip') {
      roundTripOptions.forEach(rt => rt.airlines.forEach(name => {
        const e = map.get(name) || { count: 0, min: Infinity };
        map.set(name, { count: e.count + 1, min: Math.min(e.min, rt.totalPrice) });
      }));
    } else {
      results.forEach(f => {
        const e = map.get(f.airline.name) || { count: 0, min: Infinity };
        map.set(f.airline.name, { count: e.count + 1, min: Math.min(e.min, f.totalPrice) });
      });
    }
    return Array.from(map.entries())
      .map(([name, { count, min }]) => ({ id: name, label: name, count, minPrice: isFinite(min) ? min : null }))
      .sort((a, b) => (a.minPrice ?? 0) - (b.minPrice ?? 0));
  }, [results, roundTripOptions, tripParam]);

  const classFilterOptions = useMemo<FilterOption[]>(() => {
    // Always show all standard classes; count=0 ones are shown disabled
    const ALL_CLASSES: { key: string; label: string; note?: string }[] = [
      { key: 'economy',          label: 'Economy' },
      { key: 'premium_economy',  label: 'Premium Economy' },
      { key: 'business',         label: 'Business Class' },
      { key: 'first',            label: 'First Class' },
    ];
    const map = new Map<string, { count: number; min: number }>();
    const src = tripParam === 'round_trip' ? roundTripOptions : results;
    src.forEach(item => {
      const cls = (item as { cabinClass: string }).cabinClass;
      const e = map.get(cls) || { count: 0, min: Infinity };
      map.set(cls, { count: e.count + 1, min: Math.min(e.min, item.totalPrice) });
    });
    return ALL_CLASSES.map(({ key, label, note }) => {
      const d = map.get(key);
      return { id: key, label, note, count: d?.count ?? 0, minPrice: d && isFinite(d.min) ? d.min : null };
    });
  }, [results, roundTripOptions, tripParam]);

  const featureFilterOptions = useMemo<FilterOption[]>(() => {
    type FlightLike = { baggage: { carryOn: number; checked: number }; fareRules: { refundable: boolean; changeable: boolean }; totalPrice: number };
    const defs: { key: string; label: string; test: (f: FlightLike) => boolean }[] = [
      { key: 'carryOn',    label: 'Carry-on included', test: f => (f.baggage?.carryOn ?? 0) > 0 },
      { key: 'checked',    label: 'Checked bag',        test: f => (f.baggage?.checked ?? 0) > 0 },
      { key: 'refundable', label: 'Refundable fare',    test: f => !!f.fareRules?.refundable },
      { key: 'changeable', label: 'Changes included',   test: f => !!f.fareRules?.changeable },
    ];
    const src = (tripParam === 'round_trip' ? roundTripOptions : results) as FlightLike[];
    return defs.map(({ key, label, test }): FilterOption | null => {
      const matching = src.filter(test);
      if (!matching.length) return null;
      return { id: key, label, count: matching.length, minPrice: Math.min(...matching.map(f => f.totalPrice)) };
    }).filter((x): x is FilterOption => x !== null);
  }, [results, roundTripOptions, tripParam]);

  const handleSelectFlight = (flight: UnifiedFlight) => {
    fareStore.reset();
    fareStore.setSourceFlight(flight);
    const origin = searchParams.get('origin') || flight.segments[0]?.departure.airport || '';
    const destination = searchParams.get('destination') || flight.segments[flight.segments.length - 1]?.arrival.airport || '';
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
      travelers: parseInt(adults, 10),
      currency: flight.currency || 'USD',
      origin,
      destination,
      stops: flight.stops,
      durationMinutes: flight.totalDuration,
      layoverMinutes,
    }));
    setShowFareModal(true);
  };

  // ── Apply all preferences to round-trip options ────────────────────────────
  const prefsFilteredRT = useMemo<RoundTripOption[]>(() => {
    let filtered = effectiveRT;
    if (prefs.budgetActive) {
      filtered = filtered.filter(rt => rt.totalPrice >= prefs.budgetMin && rt.totalPrice <= prefs.budgetMax);
    }
    if (prefs.maxDuration !== null) {
      filtered = filtered.filter(rt => rt.totalDurationMinutes <= prefs.maxDuration!);
    }
    if (prefs.stops === 'nonstop') {
      filtered = filtered.filter(rt => rt.totalStops === 0);
    } else if (prefs.stops === '1stop') {
      filtered = filtered.filter(rt => rt.maxStopsOneWay <= 1);
    } else if (prefs.stops === '2stop') {
      filtered = filtered.filter(rt => rt.maxStopsOneWay <= 2);
    }
    if (prefs.departureWindow) {
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

  const displayPanelRT = useMemo(() => {
    if (!aiAssistResult?.rankedIds?.length) return panelFilteredRT;
    const filtered = aiAssistResult.rankedIds
      .map(id => panelFilteredRT.find(rt => rt.id === id))
      .filter((rt): rt is RoundTripOption => rt !== undefined);
    return filtered.length > 0 ? filtered : panelFilteredRT;
  }, [panelFilteredRT, aiAssistResult]);

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
                      <span>{adults}&nbsp;PAX</span>
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
              {searchMeta && (
                <div className={`hidden sm:flex items-center gap-1.5 px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm ${
                  !searchMeta.usedMockData ? 'bg-[#1ABC9C] text-white' : 'bg-[#F97316] text-white'
                }`}>
                  {!searchMeta.usedMockData ? <><Wifi className="w-3 h-3" /> Live Duffel NDC</> : <><WifiOff className="w-3 h-3" /> Demo Data</>}
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
            />
          </div>
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
          <div className="flex flex-col items-center justify-center py-24 gap-6">
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
                      travelers: parseInt(adults, 10), currency: rt.currency || 'USD',
                      origin: rt.outboundJourney.departureAirport,
                      destination: rt.outboundJourney.arrivalAirport,
                      stops: rt.maxStopsOneWay,
                      durationMinutes: rt.outboundJourney.durationMinutes,
                      layoverMinutes: [],
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

                {/* Flexible date strip — round-trip only */}
                {tripParam === 'round_trip' && returnDateParam && (
                  <FlexibleDateStrip
                    origin={origin}
                    destination={destination}
                    departureDate={date}
                    returnDate={returnDateParam}
                    adults={adults}
                    cabin={activeCabin}
                    tripParam={tripParam}
                    currentMinPrice={panelFilteredRT[0]?.totalPrice ?? null}
                  />
                )}

                {/* Round-trip cards */}
                {tripParam === 'round_trip' && panelFilteredRT.length > 0 && (
                  <>
                    <div className="flex items-center gap-3 mb-5 pt-2">
                      <Sparkles className="w-5 h-5 text-amber-500" />
                      <h2 className="text-base font-black text-slate-800 uppercase tracking-wide">Round-trip options</h2>
                      <span className="text-xs text-slate-400 font-medium ml-auto">
                        {aiAssistResult ? `AI filtered · ${displayPanelRT.length} matches` : `AI-scored · ${Math.min(panelFilteredRT.length, 51)} of ${panelFilteredRT.length} results`}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {displayPanelRT.map((option, i) => (
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
                          scoreOverride={prefs.aiIntelligence ? aiRTMap?.get(option.id)?.aiScore : undefined}
                          isAiHighlighted={!!aiAssistResult && aiAssistResult.rankedIds[0] === option.id}
                          aiReasons={prefs.aiIntelligence ? aiRTMap?.get(option.id)?.aiReasons : undefined}
                        />
                      ))}
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
                      <Sparkles className="w-5 h-5 text-amber-500" />
                      <h2 className="text-base font-black text-slate-800 uppercase tracking-wide">Top flights for you</h2>
                      <span className="text-xs text-slate-400 font-medium ml-auto">
                        {aiAssistResult ? `AI filtered · ${displayPanelOneWay.length} matches` : `AI-scored · ${Math.min(panelFilteredOneWay.length, 51)} of ${panelFilteredOneWay.length} results`}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {displayPanelOneWay.map((flight, i) => (
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
                          />
                        </motion.div>
                      ))}
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
                      {panelFilteredRT.map((option, i) => (
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
                          scoreOverride={prefs.aiIntelligence ? aiRTMap?.get(option.id)?.aiScore : undefined}
                          isAiHighlighted={!!aiAssistResult && aiAssistResult.rankedIds[0] === option.id}
                          aiReasons={prefs.aiIntelligence ? aiRTMap?.get(option.id)?.aiReasons : undefined}
                        />
                      ))}
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
                    {displayResults.map((flight, i) => (
                      <FlightCard
                        key={flight.id}
                        flight={flight}
                        index={i}
                        onSelect={handleSelectFlight}
                        scoreOverride={prefs.aiIntelligence ? aiOneWayMap?.get(flight.id)?.aiScore : (flight as any).aiScoreDisplay ?? undefined}
                        aiReasons={aiAssistResult?.reasoning?.[flight.id] ?? (flight as any).aiReasons}
                        isAiHighlighted={!!aiAssistResult && aiAssistResult.rankedIds[0] === flight.id}
                        aiBadge={aiAssistResult?.badges?.[flight.id]}
                      />
                    ))}
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
          aiScoreOverride={prefs.aiIntelligence ? aiRTMap?.get(selectedRoundTrip.id)?.aiScore : undefined}
          aiReasonsOverride={prefs.aiIntelligence ? aiRTMap?.get(selectedRoundTrip.id)?.aiReasons : undefined}
          onClose={() => setSelectedRoundTrip(null)}
          onBook={() => {
            fareStore.reset();
            fareStore.setSourceRoundTrip(selectedRoundTrip);
            const origin = selectedRoundTrip.outboundJourney.departureAirport;
            const destination = selectedRoundTrip.outboundJourney.arrivalAirport;
            sessionStorage.setItem('fm_fare_context', JSON.stringify({
              offerId: selectedRoundTrip.providerOfferId,
              basePrice: selectedRoundTrip.totalPrice,
              travelers: parseInt(adults, 10),
              currency: selectedRoundTrip.currency || 'USD',
              origin,
              destination,
              stops: selectedRoundTrip.maxStopsOneWay,
              durationMinutes: selectedRoundTrip.outboundJourney.durationMinutes,
              layoverMinutes: [],
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
            passengers: parseInt(adults, 10),
            departureDate: date,
          }}
          onResult={setAiAssistResult}
          result={aiAssistResult}
          focusedFlightId={hoveredFlightId}
          rtMetaMap={rtMetaMap}
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
