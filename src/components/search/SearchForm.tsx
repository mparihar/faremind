'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  Calendar,
  Users,
  ArrowRightLeft,
  ChevronDown,
  Plane,
  Loader2,
  Star,
  TrendingDown,
  Zap,
  DollarSign,
  Clock,
  X,
  Sparkles,
  Check,
} from 'lucide-react';
import { cn, getTomorrow, getNextWeek } from '@/lib/utils';
import { AIRPORTS } from '@/lib/mock-data';
import { useSearchStore } from '@/store/useSearchStore';
import { usePreferencesStore } from '@/store/usePreferencesStore';
import type { CabinClass, TripType } from '@/lib/types';
import SmartPreferencesBar from '@/components/search/SmartPreferencesBar';

const CABIN_OPTIONS: { value: CabinClass; label: string }[] = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium Economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First Class' },
];

interface FlexMonth {
  year: number;
  month: number;
  label: string;
  date: string;
  price: number | null;
  currency: string;
  stops: number | null;
  duration: number | null;
  layover: number | null;
  isMock: boolean;
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function stopsLabel(stops: number): string {
  return stops === 0 ? 'Non-stop' : stops === 1 ? '1 stop' : `${stops} stops`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function lastDayOfMonth(year: number, month: number): string {
  // month is 1-indexed; JS new Date(y, m, 0) with 1-indexed m returns last day of that month
  const d = new Date(year, month, 0);
  return `${year}-${pad2(month)}-${pad2(d.getDate())}`;
}

type FlexSortMode = 'value' | 'cheapest' | 'fastest';

const FLEX_WEIGHTS: Record<FlexSortMode, { price: number; duration: number; stops: number }> = {
  value:    { price: 0.5, duration: 0.3, stops: 0.2 },
  cheapest: { price: 0.8, duration: 0.1, stops: 0.1 },
  fastest:  { price: 0.1, duration: 0.7, stops: 0.2 },
};

function normalizeFlex(v: number, min: number, max: number): number {
  if (max === min) return 1;
  return (max - v) / (max - min); // inverted: lower raw = higher score
}

function sortFlexMonths(months: FlexMonth[], mode: FlexSortMode): FlexMonth[] {
  const valid = months.filter((m) => m.price !== null && m.duration !== null && m.stops !== null);
  const empty = months.filter((m) => m.price === null || m.duration === null || m.stops === null);
  if (valid.length === 0) return months;

  const w = FLEX_WEIGHTS[mode];
  const prices = valid.map((m) => m.price!);
  const durs   = valid.map((m) => m.duration!);
  const stops  = valid.map((m) => m.stops!);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minD = Math.min(...durs),   maxD = Math.max(...durs);
  const minS = Math.min(...stops),  maxS = Math.max(...stops);

  return [
    ...valid
      .map((m) => ({
        m,
        score:
          w.price    * normalizeFlex(m.price!,    minP, maxP) +
          w.duration * normalizeFlex(m.duration!, minD, maxD) +
          w.stops    * normalizeFlex(m.stops!,    minS, maxS),
      }))
      .sort((a, b) => b.score - a.score)
      .map((s) => s.m),
    ...empty,
  ];
}

interface SearchFormProps {
  variant?: 'hero' | 'compact';
  onDateModeChange?: (mode: 'specific' | 'flexible') => void;
  initialOrigin?: string;
  initialOriginCode?: string;
  initialDest?: string;
  initialDestCode?: string;
  initialDate?: string;
  initialReturnDate?: string;
  initialTripType?: TripType;
  initialCabin?: CabinClass;
}

export default function SearchForm({
  variant = 'hero',
  onDateModeChange,
  initialOrigin = '',
  initialOriginCode = '',
  initialDest = '',
  initialDestCode = '',
  initialDate,
  initialReturnDate,
  initialTripType,
  initialCabin,
}: SearchFormProps) {
  const router = useRouter();
  const { setQuery, setLoading, loading } = useSearchStore();
  const prefs = usePreferencesStore();

  const [origin, setOrigin] = useState(initialOrigin);
  const [destination, setDestination] = useState(initialDest);
  const [originCode, setOriginCode] = useState(initialOriginCode);
  const [destCode, setDestCode] = useState(initialDestCode);
  const [departureDate, setDepartureDate] = useState(initialDate ?? getTomorrow());
  const [returnDate, setReturnDate] = useState(initialReturnDate ?? getNextWeek());
  const [passengers, setPassengers] = useState({ adults: 1, children: 0, infants: 0 });
  const [cabinClass, setCabinClass] = useState<CabinClass>(initialCabin ?? 'economy');
  const [tripType, setTripType] = useState<TripType>(initialTripType ?? 'round_trip');
  const [dateMode, setDateMode] = useState<'specific' | 'flexible'>('specific');

  const [showOriginDropdown, setShowOriginDropdown] = useState(false);
  const [showDestDropdown, setShowDestDropdown] = useState(false);
  const [showPassengers, setShowPassengers] = useState(false);
  const [showCabin, setShowCabin] = useState(false);
  const [originError, setOriginError] = useState(false);
  const [destError, setDestError] = useState(false);

  const [flexMonths, setFlexMonths] = useState<FlexMonth[]>([]);
  const [flexLoading, setFlexLoading] = useState(false);
  const [activeFlexDropdown, setActiveFlexDropdown] = useState<string | null>(null);
  const [flexBudgetRange, setFlexBudgetRange] = useState<[number, number]>([0, 2000]);
  const [flexOutbound, setFlexOutbound] = useState<FlexMonth | null>(null);
  const [flexReturn, setFlexReturn] = useState<FlexMonth | null>(null);
  const [flexStep, setFlexStep] = useState<'outbound' | 'return'>('outbound');
  const [appliedFlexOutbound, setAppliedFlexOutbound] = useState<FlexMonth | null>(null);
  const [appliedFlexReturn, setAppliedFlexReturn] = useState<FlexMonth | null>(null);
  const [showFlexDatePicker, setShowFlexDatePicker] = useState(false);
  const [tempDepDate, setTempDepDate] = useState('');
  const [tempRetDate, setTempRetDate] = useState('');

  // Tag each month with filter pass/fail — keep original calendar order always
  type TaggedMonth = FlexMonth & { passesFilter: boolean };
  const displayMonths = useMemo((): TaggedMonth[] => {
    return flexMonths.map((m) => {
      if (m.price === null) return { ...m, passesFilter: false };
      let ok = true;
      if (prefs.budgetActive) ok = ok && m.price >= prefs.budgetMin && m.price <= prefs.budgetMax;
      if (prefs.maxDuration !== null && m.duration !== null) ok = ok && m.duration <= prefs.maxDuration;
      if (m.stops !== null) {
        if (prefs.stops === 'nonstop') ok = ok && m.stops === 0;
        if (prefs.stops === '1stop')   ok = ok && m.stops <= 1;
      }
      return { ...m, passesFilter: ok };
    });
  }, [flexMonths, prefs.budgetActive, prefs.budgetMin, prefs.budgetMax, prefs.maxDuration, prefs.stops]);

  const originRef = useRef<HTMLDivElement>(null);
  const destRef = useRef<HTMLDivElement>(null);
  const passRef = useRef<HTMLDivElement>(null);
  const cabinRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (originRef.current && !originRef.current.contains(e.target as Node)) setShowOriginDropdown(false);
      if (destRef.current && !destRef.current.contains(e.target as Node)) setShowDestDropdown(false);
      if (passRef.current && !passRef.current.contains(e.target as Node)) setShowPassengers(false);
      if (cabinRef.current && !cabinRef.current.contains(e.target as Node)) setShowCabin(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch flexible month prices — starts from departure date's month, returns 12 months in calendar order
  useEffect(() => {
    if (dateMode !== 'flexible' || !originCode || !destCode || originCode === destCode) return;
    setFlexLoading(true);
    setFlexMonths([]);
    setFlexOutbound(null);
    setFlexReturn(null);
    setFlexStep('outbound');
    fetch(`/api/flexible-search?origin=${originCode}&destination=${destCode}&adults=${passengers.adults}&cabin=${cabinClass}&startDate=${departureDate}&tripType=${tripType}`)
      .then((r) => {
        if (!r.ok) {
          console.warn(`[FlexSearch] API returned ${r.status}`);
          return { months: [] };
        }
        return r.json();
      })
      .then((data) => { setFlexMonths(data.months ?? []); })
      .catch((err) => { console.error('[FlexSearch] Fetch error:', err); setFlexMonths([]); })
      .finally(() => setFlexLoading(false));
  }, [dateMode, originCode, destCode, passengers.adults, cabinClass, departureDate, tripType]);

  // Reset flex selections when trip type changes
  useEffect(() => {
    setFlexOutbound(null);
    setFlexReturn(null);
    setFlexStep('outbound');
  }, [tripType]);

  const filteredAirports = useCallback((query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored = AIRPORTS.map((a) => {
      const code = a.code.toLowerCase();
      const city = a.city.toLowerCase();
      const name = a.name.toLowerCase();
      const country = a.country.toLowerCase();
      const state = (a.state ?? '').toLowerCase();
      if (code === q) return { a, score: 100 };
      if (code.startsWith(q)) return { a, score: 90 };
      if (city === q) return { a, score: 80 };
      if (city.startsWith(q)) return { a, score: 70 };
      if (name.startsWith(q)) return { a, score: 60 };
      if (city.includes(q)) return { a, score: 50 };
      if (name.includes(q)) return { a, score: 40 };
      if (state.includes(q) || country.includes(q)) return { a, score: 30 };
      return { a, score: -1 };
    }).filter((x) => x.score >= 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 10).map((x) => x.a);
  }, []);

  const handleSwap = () => {
    setOrigin(destination);
    setDestination(origin);
    setOriginCode(destCode);
    setDestCode(originCode);
    setOriginError(false);
    setDestError(false);
  };

  const handleSearch = () => {
    const hasOriginError = origin.trim().length > 0 && !originCode;
    const hasDestError = destination.trim().length > 0 && !destCode;
    setOriginError(hasOriginError || (!originCode && !origin.trim()));
    setDestError(hasDestError || (!destCode && !destination.trim()));
    if (!originCode || !destCode || !departureDate) return;

    const query = {
      origin: originCode,
      destination: destCode,
      departureDate,
      returnDate: tripType === 'round_trip' ? returnDate : undefined,
      passengers,
      cabinClass,
      tripType,
    };

    setQuery(query);
    setLoading(true);

    const params = new URLSearchParams({
      origin: originCode,
      destination: destCode,
      date: departureDate,
      ...(tripType === 'round_trip' && returnDate ? { return: returnDate } : {}),
      adults: passengers.adults.toString(),
      children: passengers.children.toString(),
      infants: passengers.infants.toString(),
      cabin: cabinClass,
      trip: tripType,
    });

    const prefQP = prefs.toQueryParams();
    Object.entries(prefQP).forEach(([key, val]) => {
      if (val) params.set(key, val);
    });

    if (prefs.sort === 'any') {
      params.set('sort', 'value');
      prefs.setSort('value');
    }

    router.push(`/search?${params.toString()}`);
  };

  // Flex month tile click — one-way: single select; round trip: two-step outbound → return
  const handleFlexMonthClick = (month: FlexMonth) => {
    if (tripType === 'one_way') {
      setFlexOutbound(month);
      return;
    }
    if (flexStep === 'outbound') {
      setFlexOutbound(month);
      setFlexReturn(null);
      setFlexStep('return');
    } else {
      if (flexOutbound && month.date < flexOutbound.date) {
        // picked earlier than outbound — restart selection from this month
        setFlexOutbound(month);
        setFlexReturn(null);
        setFlexStep('return');
      } else {
        setFlexReturn(month);
      }
    }
  };

  const handleFlexApply = () => {
    if (!originCode || !destCode || !flexOutbound) return;
    // Store confirmed months in separate state — do NOT touch departureDate/returnDate here,
    // as that would re-trigger the flex useEffect and wipe the flexOutbound/flexReturn selections
    setAppliedFlexOutbound(flexOutbound);
    setAppliedFlexReturn(tripType === 'round_trip' ? flexReturn : null);
    setTempDepDate(`${flexOutbound.year}-${pad2(flexOutbound.month)}-01`);
    setTempRetDate(tripType === 'round_trip' && flexReturn ? `${flexReturn.year}-${pad2(flexReturn.month)}-01` : '');
    setShowFlexDatePicker(true);
  };

  const handleConfirmFlexDates = () => {
    if (!tempDepDate || !originCode || !destCode) return;
    // Now safe to write dates — we also switch to 'specific' so the useEffect won't fire
    setDepartureDate(tempDepDate);
    if (tripType === 'round_trip' && tempRetDate) setReturnDate(tempRetDate);
    setDateMode('specific');
    onDateModeChange?.('specific');
    setShowFlexDatePicker(false);
    setAppliedFlexOutbound(null);
    setAppliedFlexReturn(null);
  };

  const canApplyFlex = tripType === 'one_way' ? !!flexOutbound : !!(flexOutbound && flexReturn);

  const totalPassengers = passengers.adults + passengers.children + passengers.infants;
  const isCompact = variant === 'compact';

  const gridCols = isCompact
    ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]'
    : tripType === 'round_trip'
      ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_1fr_1fr_auto_auto]'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_1fr_auto_auto]';

  return (
    <div className={cn('w-full', isCompact ? '' : 'max-w-7xl mx-auto')}>
      <div className={cn(
        'bg-white/80 backdrop-blur-xl shadow-2xl shadow-black/5 border border-white/60',
        isCompact ? 'p-2 rounded-xl' : 'px-4 py-3 rounded-2xl'
      )}>

        {/* Top controls row */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          {/* Left: Trip type + Cabin */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-xl bg-gray-100 p-1">
              {(['round_trip', 'one_way'] as TripType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setTripType(type)}
                  className={cn(
                    'px-5 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                    tripType === type ? 'bg-[#1a1a2e] text-white shadow-md' : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  {type === 'round_trip' ? 'Round Trip' : 'One Way'}
                </button>
              ))}
            </div>

            <div ref={cabinRef} className="relative">
              <button
                onClick={() => setShowCabin(!showCabin)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 transition-all"
              >
                {CABIN_OPTIONS.find((c) => c.value === cabinClass)?.label}
                <ChevronDown className="w-4 h-4 opacity-60" />
              </button>
              {showCabin && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute top-full mt-2 left-0 w-52 bg-white rounded-2xl border border-gray-200 p-2 z-50 shadow-xl"
                >
                  {CABIN_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setCabinClass(opt.value); setShowCabin(false); }}
                      className={cn(
                        'w-full text-left px-4 py-2.5 rounded-xl text-sm transition-all',
                        cabinClass === opt.value ? 'bg-orange-50 text-orange-600 font-semibold' : 'text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </div>
          </div>

          {/* Right: Specific dates / Flexible */}
          <div className="flex rounded-xl bg-gray-100 p-1 shrink-0">
            <button
              onClick={() => { setDateMode('specific'); onDateModeChange?.('specific'); }}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                dateMode === 'specific' ? 'bg-[#0F172A] text-white shadow-md' : 'text-gray-500 hover:text-[#0F172A]'
              )}
            >
              Specific dates
            </button>
            <button
              disabled={!originCode || !destCode}
              onClick={() => { setDateMode('flexible'); onDateModeChange?.('flexible'); setShowFlexDatePicker(false); setAppliedFlexOutbound(null); setAppliedFlexReturn(null); }}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                dateMode === 'flexible' ? 'bg-[#0F172A] text-white shadow-md' : 'text-gray-500 hover:text-[#0F172A]',
                (!originCode || !destCode) ? 'opacity-50 cursor-not-allowed hover:text-gray-500' : ''
              )}
              title={(!originCode || !destCode) ? "Please select origin and destination first" : ""}
            >
              Flexible
            </button>
          </div>
        </div>

        {/* Search inputs row */}
        <div className={cn('grid gap-2', gridCols)}>

          {/* Origin */}
          <div ref={originRef} className="relative">
            <div className="relative">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#F97316]" />
              <input
                type="text"
                placeholder="Where from?"
                value={origin}
                onChange={(e) => { setOrigin(e.target.value); setOriginCode(''); setOriginError(false); setShowOriginDropdown(true); }}
                onFocus={() => {
                  if (originCode) { setOrigin(''); setOriginCode(''); }
                  setOriginError(false);
                  setShowOriginDropdown(true);
                }}
                className={`w-full pl-11 pr-4 py-2.5 rounded-xl bg-gray-50 text-[#0F172A] placeholder-gray-500 text-[15px] font-semibold focus:outline-none focus:ring-4 focus:bg-white transition-all shadow-sm ${originError ? 'border-2 border-red-400 focus:border-red-400 focus:ring-red-100' : 'border border-gray-200 focus:border-[#F97316] focus:ring-[#F97316]/10'}`}
              />
            </div>
            {originError && (
              <p className="absolute -bottom-5 left-1 text-xs text-red-500 font-medium">Select an airport from the list</p>
            )}
            {showOriginDropdown && origin.length >= 1 && (() => {
              const results = filteredAirports(origin);
              return (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute top-full mt-2 left-0 min-w-[360px] bg-white rounded-2xl border border-gray-200/80 p-2 z-[200] shadow-2xl shadow-black/15 ring-1 ring-black/5 max-h-80 overflow-y-auto"
                >
                  {results.map((airport) => {
                    const location = [airport.city, airport.state, airport.country].filter(Boolean).join(', ');
                    return (
                      <button
                        key={airport.code}
                        onClick={() => { setOrigin(`${airport.city}${airport.state ? ', ' + airport.state : ''} (${airport.code})`); setOriginCode(airport.code); setShowOriginDropdown(false); }}
                        className="w-full text-left px-4 py-3 rounded-xl hover:bg-orange-50 transition-all group"
                      >
                        <p className="text-base font-bold text-[#F97316] group-hover:text-orange-600">{airport.code}</p>
                        <p className="text-sm font-semibold text-[#0F172A] mt-0.5 leading-tight">{airport.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{location}</p>
                      </button>
                    );
                  })}
                  {results.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">No airports found for &quot;{origin}&quot;</p>
                  )}
                </motion.div>
              );
            })()}
          </div>

          {/* Swap Button */}
          {!isCompact && (
            <div className="hidden lg:flex items-center justify-center">
              <button
                onClick={handleSwap}
                className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-[#1ABC9C] hover:border-[#1ABC9C]/30 transition-all shadow-md active:scale-90"
              >
                <ArrowRightLeft className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Destination */}
          <div ref={destRef} className="relative">
            <div className="relative">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1ABC9C]" />
              <input
                type="text"
                placeholder="Where to?"
                value={destination}
                onChange={(e) => { setDestination(e.target.value); setDestCode(''); setDestError(false); setShowDestDropdown(true); }}
                onFocus={() => {
                  if (destCode) { setDestination(''); setDestCode(''); }
                  setDestError(false);
                  setShowDestDropdown(true);
                }}
                className={`w-full pl-11 pr-4 py-2.5 rounded-xl bg-gray-50 text-[#0F172A] placeholder-gray-500 text-[15px] font-semibold focus:outline-none focus:ring-4 focus:bg-white transition-all shadow-sm ${destError ? 'border-2 border-red-400 focus:border-red-400 focus:ring-red-100' : 'border border-gray-200 focus:border-[#1ABC9C] focus:ring-[#1ABC9C]/10'}`}
              />
            </div>
            {destError && (
              <p className="absolute -bottom-5 left-1 text-xs text-red-500 font-medium">Select an airport from the list</p>
            )}
            {showDestDropdown && destination.length >= 1 && (() => {
              const results = filteredAirports(destination);
              return (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute top-full mt-2 left-0 min-w-[360px] bg-white rounded-2xl border border-gray-200/80 p-2 z-[200] shadow-2xl shadow-black/15 ring-1 ring-black/5 max-h-80 overflow-y-auto"
                >
                  {results.map((airport) => {
                    const location = [airport.city, airport.state, airport.country].filter(Boolean).join(', ');
                    return (
                      <button
                        key={airport.code}
                        onClick={() => { setDestination(`${airport.city}${airport.state ? ', ' + airport.state : ''} (${airport.code})`); setDestCode(airport.code); setShowDestDropdown(false); }}
                        className="w-full text-left px-4 py-3 rounded-xl hover:bg-teal-50 transition-all group"
                      >
                        <p className="text-base font-bold text-[#1ABC9C] group-hover:text-teal-600">{airport.code}</p>
                        <p className="text-sm font-semibold text-[#0F172A] mt-0.5 leading-tight">{airport.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{location}</p>
                      </button>
                    );
                  })}
                  {results.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">No airports found for &quot;{destination}&quot;</p>
                  )}
                </motion.div>
              );
            })()}
          </div>

          {/* Departure date */}
          <div className="relative">
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="date"
              value={departureDate}
              onChange={(e) => {
                const newDep = e.target.value;
                setDepartureDate(newDep);
                // If return date exists and is before the new departure date, push return date forward
                if (returnDate && newDep > returnDate) {
                  setReturnDate(newDep);
                }
              }}
              min={getTomorrow()}
              className="w-full pl-12 pr-4 py-2.5 rounded-xl bg-gray-50 border border-gray-100 text-gray-900 text-[15px] font-semibold focus:outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-100 focus:bg-white transition-all shadow-sm"
            />
          </div>

          {/* Return date */}
          {tripType === 'round_trip' && (
            <div className={cn(
              'relative rounded-xl transition-all duration-300',
              dateMode === 'flexible' && flexOutbound && !flexReturn
                ? 'ring-2 ring-orange-400 ring-offset-1 shadow-lg shadow-orange-200/60 animate-pulse-soft'
                : ''
            )}>
              <Calendar className={cn(
                'absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none transition-colors',
                dateMode === 'flexible' && flexOutbound && !flexReturn ? 'text-orange-400' : 'text-gray-400'
              )} />
              {dateMode === 'flexible' && flexOutbound && !flexReturn && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-orange-500 pointer-events-none">
                  Select ↓
                </span>
              )}
              <input
                type="date"
                value={returnDate}
                onChange={(e) => {
                  const newRet = e.target.value;
                  if (newRet >= departureDate) {
                    setReturnDate(newRet);
                  }
                }}
                min={departureDate}
                className={cn(
                  'w-full pl-12 pr-4 py-2.5 rounded-xl text-[15px] font-semibold focus:outline-none transition-all shadow-sm',
                  dateMode === 'flexible' && flexOutbound && !flexReturn
                    ? 'bg-orange-50 border border-orange-300 text-orange-700'
                    : 'bg-gray-50 border border-gray-100 text-gray-900 focus:border-orange-300 focus:ring-4 focus:ring-orange-100 focus:bg-white'
                )}
              />
            </div>
          )}

          {/* Passengers */}
          <div ref={passRef} className="relative">
            <button
              onClick={() => setShowPassengers(!showPassengers)}
              className="w-full flex items-center gap-3 pl-5 pr-4 py-2.5 rounded-xl bg-gray-50 border border-gray-100 text-[15px] font-semibold text-gray-900 hover:bg-white transition-all shadow-sm"
            >
              <Users className="w-5 h-5 text-gray-400 shrink-0" />
              <span>{totalPassengers} Traveler{totalPassengers > 1 ? 's' : ''}</span>
              <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" />
            </button>
            {showPassengers && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-full mt-2 right-0 w-64 bg-white rounded-2xl border border-gray-200 p-4 z-50 shadow-xl"
              >
                {[
                  { key: 'adults' as const, label: 'Adults', sub: '12+' },
                  { key: 'children' as const, label: 'Children', sub: '2–11' },
                  { key: 'infants' as const, label: 'Infants', sub: 'Under 2' },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                      <p className="text-xs text-gray-400">{item.sub}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setPassengers((p: typeof passengers) => ({ ...p, [item.key]: Math.max(item.key === 'adults' ? 1 : 0, p[item.key] - 1) }))}
                        className="w-8 h-8 rounded-lg bg-gray-100 border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-200 transition-all flex items-center justify-center text-lg font-bold"
                      >−</button>
                      <span className="w-5 text-center text-sm font-bold text-gray-800">{passengers[item.key]}</span>
                      <button
                        onClick={() => setPassengers((p: typeof passengers) => ({ ...p, [item.key]: Math.min(9, p[item.key] + 1) }))}
                        className="w-8 h-8 rounded-lg bg-gray-100 border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-200 transition-all flex items-center justify-center text-lg font-bold"
                      >+</button>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </div>

          {/* Search Button */}
          <div className="flex items-center">
            {(() => {
              const specificReady = dateMode === 'specific' && !!originCode && !!destCode && originCode !== destCode;
              const enabled = specificReady;
              return (
                <button
                  onClick={handleSearch}
                  disabled={!enabled}
                  className={cn(
                    'w-full lg:w-auto px-8 py-2.5 rounded-xl text-base font-black text-white transition-all flex items-center justify-center gap-3 whitespace-nowrap shadow-xl active:scale-[0.98]',
                    enabled
                      ? 'bg-[#1ABC9C] hover:brightness-110 shadow-[#1ABC9C]/30'
                      : 'bg-gray-300 text-gray-100 cursor-not-allowed shadow-none'
                  )}
                >
                  <Plane className={cn('w-5 h-5', loading ? 'animate-pulse' : 'rotate-[-30deg]')} />
                  Search Flights
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Flexible Month Grid */}
      <AnimatePresence>
        {dateMode === 'flexible' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="mt-3 bg-white rounded-[28px] shadow-xl border border-gray-200/80 p-6"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  {showFlexDatePicker
                    ? 'Step 3 — Pick exact dates'
                    : tripType === 'round_trip'
                      ? flexStep === 'outbound'
                        ? 'Step 1 — Select outbound month'
                        : 'Step 2 — Select return month'
                      : 'Select a month'}
                </h3>
                {showFlexDatePicker && appliedFlexOutbound ? (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Choose specific dates within your selected months
                  </p>
                ) : originCode && destCode ? (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {originCode} → {destCode} · {tripType === 'round_trip' ? 'Round trip' : 'One way'} · tap a month card to select
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-0.5">Enter origin and destination above to load prices</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {tripType === 'round_trip' && (flexOutbound || flexReturn) && (
                  <button
                    onClick={() => { setFlexOutbound(null); setFlexReturn(null); setFlexStep('outbound'); }}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-all"
                  >
                    <X className="w-3 h-3" /> Reset
                  </button>
                )}
                {flexLoading && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading…
                  </div>
                )}
              </div>
            </div>

            {/* ── Embedded Preferences Bar ── */}
            {!showFlexDatePicker && (
              <SmartPreferencesBar
                isEmbedded
                className="mb-5 pb-4 border-b border-gray-100"
                tripType={tripType === 'multi_city' ? undefined : tripType}
              />
            )}

            {showFlexDatePicker && appliedFlexOutbound ? (
              <div className="flex flex-col items-center py-4 max-w-lg mx-auto">
                {/* Month summary pills */}
                <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-orange-50 border border-orange-200">
                    <Plane className="w-3.5 h-3.5 text-orange-500 -rotate-45 shrink-0" />
                    <div>
                      <p className="text-[10px] text-orange-500 font-bold uppercase tracking-wide leading-none">Outbound</p>
                      <p className="text-sm font-bold text-gray-900">{appliedFlexOutbound.label} {appliedFlexOutbound.year}</p>
                    </div>
                  </div>
                  {tripType === 'round_trip' && appliedFlexReturn && (
                    <>
                      <ArrowRightLeft className="w-4 h-4 text-gray-300 shrink-0" />
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200">
                        <Plane className="w-3.5 h-3.5 text-blue-500 rotate-45 shrink-0" />
                        <div>
                          <p className="text-[10px] text-blue-500 font-bold uppercase tracking-wide leading-none">Return</p>
                          <p className="text-sm font-bold text-gray-900">{appliedFlexReturn.label} {appliedFlexReturn.year}</p>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Date inputs */}
                <div className={cn('grid gap-5 w-full', tripType === 'round_trip' && appliedFlexReturn ? 'grid-cols-2' : 'grid-cols-1 max-w-xs mx-auto')}>
                  {/* Departure */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Departure date</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-400 pointer-events-none" />
                      <input
                        type="date"
                        value={tempDepDate}
                        min={`${appliedFlexOutbound.year}-${pad2(appliedFlexOutbound.month)}-01`}
                        max={lastDayOfMonth(appliedFlexOutbound.year, appliedFlexOutbound.month)}
                        onChange={(e) => {
                          setTempDepDate(e.target.value);
                          // clear return if same month and now before departure
                          if (tempRetDate && appliedFlexReturn &&
                              appliedFlexReturn.year === appliedFlexOutbound.year &&
                              appliedFlexReturn.month === appliedFlexOutbound.month &&
                              e.target.value > tempRetDate) {
                            setTempRetDate('');
                          }
                        }}
                        className="w-full pl-10 pr-3 py-3 rounded-xl bg-orange-50 border-2 border-orange-200 text-gray-900 text-sm font-semibold focus:outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100 transition-all"
                      />
                    </div>
                    <p className="text-[11px] text-gray-400">Any date in {appliedFlexOutbound.label} {appliedFlexOutbound.year}</p>
                  </div>

                  {/* Return */}
                  {tripType === 'round_trip' && appliedFlexReturn && (
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Return date</label>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 pointer-events-none" />
                        <input
                          type="date"
                          value={tempRetDate}
                          min={
                            appliedFlexReturn.year === appliedFlexOutbound.year &&
                            appliedFlexReturn.month === appliedFlexOutbound.month && tempDepDate
                              ? tempDepDate
                              : `${appliedFlexReturn.year}-${pad2(appliedFlexReturn.month)}-01`
                          }
                          max={lastDayOfMonth(appliedFlexReturn.year, appliedFlexReturn.month)}
                          onChange={(e) => setTempRetDate(e.target.value)}
                          className="w-full pl-10 pr-3 py-3 rounded-xl bg-blue-50 border-2 border-blue-200 text-gray-900 text-sm font-semibold focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 transition-all"
                        />
                      </div>
                      <p className="text-[11px] text-gray-400">Any date in {appliedFlexReturn.label} {appliedFlexReturn.year}</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 mt-6 w-full">
                  <button
                    onClick={() => setShowFlexDatePicker(false)}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-gray-200 transition-all shrink-0"
                  >
                    <ChevronDown className="w-4 h-4 rotate-90" />
                    Back
                  </button>
                  <button
                    onClick={handleConfirmFlexDates}
                    disabled={!tempDepDate || (tripType === 'round_trip' && !!appliedFlexReturn && !tempRetDate)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black text-white transition-all shadow-lg active:scale-[0.98]',
                      tempDepDate && (tripType !== 'round_trip' || !appliedFlexReturn || tempRetDate)
                        ? 'bg-[#1ABC9C] hover:brightness-110 shadow-[#1ABC9C]/30'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                    )}
                  >
                    <Plane className="w-4 h-4 rotate-[-30deg]" />
                    Confirm Dates &amp; Search
                  </button>
                </div>
              </div>
            ) : (!originCode || !destCode) ? (
              <div className="text-center py-10">
                <Plane className="w-8 h-8 text-gray-200 mx-auto mb-3 -rotate-45" />
                <p className="text-sm text-gray-400">Select your origin and destination to see monthly prices</p>
              </div>
            ) : originCode === destCode ? (
              <div className="text-center py-10">
                <Plane className="w-8 h-8 text-orange-200 mx-auto mb-3 -rotate-45" />
                <p className="text-sm font-semibold text-orange-500">Origin and destination must be different</p>
                <p className="text-xs text-gray-400 mt-1">Change one of the airports above to see best value months</p>
              </div>
            ) : flexLoading ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="bg-gray-100 rounded-2xl h-32 animate-pulse" />
                ))}
              </div>
            ) : displayMonths.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <p className="text-sm">No pricing data available for this route</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {(() => {
                    const passing    = displayMonths.filter((m) => m.passesFilter && m.price !== null);
                    const badgeFor = (m: typeof displayMonths[0]): { label: string; cls: string } | null => {
                      if (!m.price || !m.passesFilter || !m.monthlyBadges?.length) return null;
                      
                      const primaryBadge = m.monthlyBadges[0];
                      if (primaryBadge === 'AI Pick') {
                        return { label: '✨ AI Pick', cls: 'bg-[#1ABC9C] text-white shadow-sm shadow-[#1ABC9C]/20' };
                      }
                      if (primaryBadge === 'Cheapest') {
                        return { label: 'Cheapest', cls: 'bg-green-500 text-white shadow-sm' };
                      }
                      if (primaryBadge === 'Fastest') {
                        return { label: 'Fastest', cls: 'bg-blue-500 text-white shadow-sm' };
                      }
                      return { label: primaryBadge, cls: 'bg-gray-500 text-white shadow-sm' };
                    };

                    // No months pass → show clear feedback with hints
                    if (passing.length === 0) {
                      // Compute available minimums so user knows what to set
                      const allWithData = displayMonths.filter(m => m.price !== null);
                      const minDur  = allWithData.length ? Math.min(...allWithData.map(m => m.duration ?? Infinity)) : null;
                      const minPrice = allWithData.length ? Math.min(...allWithData.map(m => m.price!)) : null;
                      const minStops = allWithData.length ? Math.min(...allWithData.map(m => m.stops ?? Infinity)) : null;

                      const hints: string[] = [];
                      if (prefs.maxDuration !== null && minDur !== null && minDur !== Infinity)
                        hints.push(`Shortest flight: ${fmtDuration(minDur)} — try ≤ ${Math.ceil(minDur / 60)}h`);
                      if (prefs.budgetActive && minPrice !== null)
                        hints.push(`Cheapest month: $${minPrice}`);
                      if (prefs.stops !== 'any' && minStops !== null && minStops !== Infinity)
                        hints.push(`Fewest stops available: ${minStops}`);

                      return (
                        <div key="no-results" className="col-span-full text-center py-10">
                          <p className="text-sm font-semibold text-gray-600">No months match your filters</p>
                          {hints.map((h, i) => (
                            <p key={i} className="text-xs text-gray-400 mt-1">{h}</p>
                          ))}
                          <button onClick={() => prefs.resetAll()} className="mt-4 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#1ABC9C] hover:brightness-110 transition-all">
                            Clear all filters
                          </button>
                        </div>
                      );
                    }

                    return displayMonths.map((month) => {
                      const isOutbound = flexOutbound?.date === month.date;
                      const isReturn   = flexReturn?.date === month.date;
                      // "Too early" = return step, month is before selected outbound — dim but keep visible as context
                      const tooEarly = tripType === 'round_trip' && flexStep === 'return' && flexOutbound && month.date < flexOutbound.date;

                      // Hide months that fail preference filters (unless selected or too-early context)
                      if (!month.passesFilter && !isOutbound && !isReturn && !tooEarly) return null;

                      const badge  = badgeFor(month);
                      const dimmed = !!tooEarly; // only dim for "too early", not for filter misses

                      const ringCls = isOutbound
                        ? 'bg-orange-50 border-orange-400 shadow-md ring-2 ring-orange-300 cursor-pointer'
                        : isReturn
                          ? 'bg-blue-50 border-blue-400 shadow-md ring-2 ring-blue-300 cursor-pointer'
                          : dimmed
                            ? 'bg-gray-50 border-gray-100 opacity-40 cursor-not-allowed'
                            : badge?.label === '✨ AI Pick'
                              ? 'bg-[#f0fdf4] border-[#1ABC9C] hover:shadow-md cursor-pointer ring-1 ring-[#1ABC9C]/50'
                            : badge?.label === 'Cheapest'
                              ? 'bg-green-50 border-green-200 hover:shadow-md cursor-pointer'
                            : badge?.label === 'Fastest'
                              ? 'bg-blue-50 border-blue-200 hover:shadow-md cursor-pointer'
                            : 'bg-gray-50 border-gray-200 hover:border-orange-300 hover:bg-white hover:shadow-md cursor-pointer';

                      const priceCls = isOutbound ? 'text-orange-600'
                        : isReturn                ? 'text-blue-600'
                        : badge?.label === '✨ AI Pick'  ? 'text-[#1ABC9C]'
                        : badge?.label === 'Cheapest'   ? 'text-green-600'
                        : badge?.label === 'Fastest'    ? 'text-blue-600'
                        : 'text-gray-700';

                      // Selection label overrides badge
                      const selLabel = isOutbound ? { label: 'Outbound ✓', cls: 'bg-orange-500 text-white' }
                        : isReturn ? { label: 'Return ✓', cls: 'bg-blue-500 text-white' }
                        : null;
                      const displayBadge = selLabel ?? badge;

                      return (
                        <button
                          key={month.date}
                          onClick={() => !dimmed && month.price && handleFlexMonthClick(month)}
                          disabled={dimmed || !month.price}
                          className={cn('relative text-left p-3 rounded-2xl border transition-all', ringCls)}
                        >
                          {displayBadge && (
                            <span className={cn('absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight', displayBadge.cls)}>
                              {displayBadge.label}
                            </span>
                          )}
                          <p className="text-[10px] text-gray-400 font-medium leading-none">{month.year}</p>
                          <p className="text-sm font-bold text-gray-900 mt-1 leading-tight">{month.label}</p>
                          {month.price ? (
                            <>
                              <p className={cn('text-xs font-bold mt-1', priceCls)}>from ${month.price}</p>
                              <div className="flex flex-wrap gap-1 mt-2">
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600">${month.price}</span>
                                {month.stops !== null && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700">{stopsLabel(month.stops)}</span>
                                )}
                                {month.duration !== null && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700">{fmtDuration(month.duration)}</span>
                                )}
                              </div>
                            </>
                          ) : (
                            <p className="text-[10px] text-gray-400 mt-1">No flights</p>
                          )}
                        </button>
                      );
                    });
                  })()}
                </div>

                {/* ── Apply Bar ── */}
                <AnimatePresence>
                  {(flexOutbound || flexReturn) && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{ duration: 0.2 }}
                      className="mt-5 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-3"
                    >
                      {/* Outbound pill */}
                      {flexOutbound && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-orange-50 border border-orange-200">
                          <Plane className="w-3.5 h-3.5 text-orange-500 -rotate-45 shrink-0" />
                          <div>
                            <p className="text-[10px] text-orange-500 font-bold uppercase tracking-wide leading-none">Outbound</p>
                            <p className="text-xs font-bold text-gray-900">{flexOutbound.label} {flexOutbound.year}</p>
                            {flexOutbound.price && <p className="text-[10px] text-orange-600 font-semibold">from ${flexOutbound.price}</p>}
                          </div>
                          <button onClick={() => { setFlexOutbound(null); setFlexReturn(null); setFlexStep('outbound'); }} className="ml-1 text-gray-300 hover:text-gray-500 transition-all">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {/* Arrow between legs */}
                      {tripType === 'round_trip' && flexOutbound && (
                        <ArrowRightLeft className="w-4 h-4 text-gray-300 shrink-0" />
                      )}

                      {/* Return pill */}
                      {tripType === 'round_trip' && (
                        flexReturn ? (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200">
                            <Plane className="w-3.5 h-3.5 text-blue-500 rotate-45 shrink-0" />
                            <div>
                              <p className="text-[10px] text-blue-500 font-bold uppercase tracking-wide leading-none">Return</p>
                              <p className="text-xs font-bold text-gray-900">{flexReturn.label} {flexReturn.year}</p>
                              {flexReturn.price && <p className="text-[10px] text-blue-600 font-semibold">from ${flexReturn.price}</p>}
                            </div>
                            <button onClick={() => { setFlexReturn(null); setFlexStep('return'); }} className="ml-1 text-gray-300 hover:text-gray-500 transition-all">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border border-dashed border-gray-300">
                            <Plane className="w-3.5 h-3.5 text-gray-300 rotate-45 shrink-0" />
                            <p className="text-xs text-gray-400 font-medium">Select return month</p>
                          </div>
                        )
                      )}

                      {/* Total estimate + hint to use main Search Flights button */}
                      <div className="ml-auto flex items-center gap-3">
                        {canApplyFlex && flexOutbound?.price && (
                          <div className="text-right">
                            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Est. from</p>
                            <p className="text-lg font-black text-gray-900">
                              ${(flexOutbound.price ?? 0) + (flexReturn?.price ?? 0)}
                            </p>
                          </div>
                        )}
                        {canApplyFlex ? (
                          <button
                            onClick={handleFlexApply}
                            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#F97316] hover:bg-orange-600 active:scale-[0.97] text-white text-sm font-bold shadow-lg shadow-orange-500/30 transition-all"
                          >
                            <Check className="w-4 h-4" />
                            Apply
                          </button>
                        ) : tripType === 'round_trip' && flexOutbound && !flexReturn ? (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-50 border border-dashed border-orange-300">
                            <span className="text-xs font-semibold text-orange-600">Select return month above ↑</span>
                          </div>
                        ) : null}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
