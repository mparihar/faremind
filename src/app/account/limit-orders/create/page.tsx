'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plane, DollarSign, Clock, Users, Calendar, ChevronRight, ChevronLeft,
  Target, Bell, Zap, CreditCard, Check, Loader2, AlertTriangle, X,
  UserPlus, MapPin, Shield, Search,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { AIRPORTS } from '@/data/airports';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const STEPS = [
  { label: 'Route', icon: Plane },
  { label: 'Criteria', icon: DollarSign },
  { label: 'Preferences', icon: Target },
  { label: 'Execution', icon: Zap },
  { label: 'Passengers', icon: Users },
  { label: 'Review', icon: Check },
];

const CABIN_OPTIONS = [
  { value: 'ECONOMY', label: 'Economy' },
  { value: 'PREMIUM_ECONOMY', label: 'Premium Economy' },
  { value: 'BUSINESS', label: 'Business' },
  { value: 'FIRST', label: 'First' },
];

const DURATION_OPTIONS = [
  { value: '', label: 'No limit' },
  { value: '1080', label: 'Under 18 Hours' },
  { value: '1440', label: 'Under 24 Hours' },
  { value: '1800', label: 'Under 30 Hours' },
];

const WINDOW_OPTIONS = [
  { value: '30', label: 'Within 30 Days' },
  { value: '60', label: 'Within 60 Days' },
  { value: '90', label: 'Within 90 Days' },
  { value: '180', label: 'Within 180 Days' },
];

const EXPIRY_OPTIONS = [
  { value: '7', label: '7 Days' },
  { value: '14', label: '14 Days' },
  { value: '30', label: '30 Days' },
  { value: '60', label: '60 Days' },
  { value: '90', label: '90 Days' },
  { value: '', label: 'Until Departure' },
];

const POPULAR_AIRLINES = [
  { code: 'UA', name: 'United' }, { code: 'DL', name: 'Delta' },
  { code: 'AA', name: 'American' }, { code: 'AC', name: 'Air Canada' },
  { code: 'WN', name: 'Southwest' }, { code: 'B6', name: 'JetBlue' },
  { code: 'AS', name: 'Alaska' }, { code: 'NK', name: 'Spirit' },
  { code: 'F9', name: 'Frontier' }, { code: 'WS', name: 'WestJet' },
  { code: 'BA', name: 'British Airways' }, { code: 'LH', name: 'Lufthansa' },
  { code: 'AF', name: 'Air France' }, { code: 'EK', name: 'Emirates' },
];

// ── Build city→airports map from AIRPORTS data ─────────────────────────────
interface AirportInfo { code: string; name: string; city: string; state?: string; country: string }
const CITY_AIRPORTS = new Map<string, AirportInfo[]>();
for (const a of AIRPORTS as AirportInfo[]) {
  const key = `${a.city}, ${a.state || a.country}`;
  if (!CITY_AIRPORTS.has(key)) CITY_AIRPORTS.set(key, []);
  CITY_AIRPORTS.get(key)!.push(a);
}

interface PassengerForm {
  passengerType: 'adult' | 'child' | 'infant';
  infantWithSeat: boolean;
  firstName: string; middleName: string; lastName: string;
  gender: string; dateOfBirth: string; email: string; phone: string;
  nationality: string; passportNumber: string; passportCountry: string;
  passportExpiry: string; knownTravelerNumber: string; redressNumber: string;
  isConfirmed: boolean;
}

const emptyPassenger = (type: 'adult' | 'child' | 'infant' = 'adult'): PassengerForm => ({
  passengerType: type, infantWithSeat: false,
  firstName: '', middleName: '', lastName: '',
  gender: '', dateOfBirth: '', email: '', phone: '',
  nationality: '', passportNumber: '', passportCountry: '',
  passportExpiry: '', knownTravelerNumber: '', redressNumber: '',
  isConfirmed: false,
});

interface FormData {
  // Route
  originSearch: string; destinationSearch: string;
  originCity: string; destinationCity: string;
  acceptedOrigins: string[]; acceptedDestinations: string[];
  origin: string; destination: string;
  departureDate: string; returnDate: string;
  tripType: 'ONE_WAY' | 'ROUND_TRIP';
  // Passengers
  adults: number; children: number; infants: number; infantsWithSeat: number;
  passengers: PassengerForm[];
  // Fare
  minFare: string; maxFare: string; maxDurationMinutes: string; cabinClass: string;
  // Preferences
  airlinePreferenceMode: 'ACCEPT' | 'EXCLUDE'; airlinePreferences: string[];
  bookingWindowDays: string; expirationDays: string;
  // Execution
  executionMode: 'NOTIFY_ONLY' | 'AUTO_PURCHASE';
}

export default function CreateLimitOrderPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [savedTravelers, setSavedTravelers] = useState<any[]>([]);
  const [showOriginDropdown, setShowOriginDropdown] = useState(false);
  const [showDestDropdown, setShowDestDropdown] = useState(false);

  const [form, setForm] = useState<FormData>({
    originSearch: '', destinationSearch: '',
    originCity: '', destinationCity: '',
    acceptedOrigins: [], acceptedDestinations: [],
    origin: '', destination: '',
    departureDate: '', returnDate: '',
    tripType: 'ONE_WAY',
    adults: 1, children: 0, infants: 0, infantsWithSeat: 0,
    passengers: [emptyPassenger('adult')],
    minFare: '', maxFare: '', maxDurationMinutes: '', cabinClass: 'ECONOMY',
    airlinePreferenceMode: 'ACCEPT', airlinePreferences: [],
    bookingWindowDays: '30', expirationDays: '30', executionMode: 'NOTIFY_ONLY',
  });

  const update = (k: keyof FormData, v: any) => setForm(p => ({ ...p, [k]: v }));

  // Build passenger slots whenever counts change
  useEffect(() => {
    const total = form.adults + form.children + form.infants;
    const current = form.passengers;
    const next: PassengerForm[] = [];
    let ai = 0, ci = 0, ii = 0;
    for (let i = 0; i < form.adults; i++) next.push(current.find((p, idx) => p.passengerType === 'adult' && idx === ai++) || emptyPassenger('adult'));
    for (let i = 0; i < form.children; i++) next.push(current.find((p, idx) => p.passengerType === 'child' && idx === (form.adults + ci++)) || emptyPassenger('child'));
    for (let i = 0; i < form.infants; i++) {
      const inf = current.find((p, idx) => p.passengerType === 'infant' && idx === (form.adults + form.children + ii++)) || emptyPassenger('infant');
      next.push(inf);
    }
    if (next.length !== current.length || JSON.stringify(next.map(p => p.passengerType)) !== JSON.stringify(current.map(p => p.passengerType))) {
      update('passengers', next.length > 0 ? next : [emptyPassenger('adult')]);
    }
  }, [form.adults, form.children, form.infants]);

  // Airport search
  const searchAirports = (q: string): { city: string; airports: AirportInfo[] }[] => {
    if (!q || q.length < 2) return [];
    const lower = q.toLowerCase();
    const results: { city: string; airports: AirportInfo[] }[] = [];
    // Search by airport code first
    const exactAirport = (AIRPORTS as AirportInfo[]).find(a => a.code.toLowerCase() === lower);
    if (exactAirport) {
      const cityKey = `${exactAirport.city}, ${exactAirport.state || exactAirport.country}`;
      const cityAirports = CITY_AIRPORTS.get(cityKey) || [exactAirport];
      results.push({ city: cityKey, airports: cityAirports });
      return results;
    }
    // Search by city name
    for (const [cityKey, airports] of CITY_AIRPORTS) {
      const matchesCity = cityKey.toLowerCase().includes(lower);
      const matchesAirport = airports.some(a => a.code.toLowerCase().includes(lower) || a.name.toLowerCase().includes(lower));
      if (matchesCity || matchesAirport) {
        results.push({ city: cityKey, airports });
      }
      if (results.length >= 8) break;
    }
    return results;
  };

  const selectOriginCity = (cityKey: string, airports: AirportInfo[]) => {
    setForm(p => ({
      ...p,
      originCity: cityKey,
      originSearch: cityKey,
      origin: airports[0].code,
      acceptedOrigins: airports.map(a => a.code),
    }));
    setShowOriginDropdown(false);
  };

  const selectDestCity = (cityKey: string, airports: AirportInfo[]) => {
    setForm(p => ({
      ...p,
      destinationCity: cityKey,
      destinationSearch: cityKey,
      destination: airports[0].code,
      acceptedDestinations: airports.map(a => a.code),
    }));
    setShowDestDropdown(false);
  };

  const toggleOriginAirport = (code: string) => {
    setForm(p => {
      const current = [...p.acceptedOrigins];
      if (current.includes(code)) {
        if (current.length <= 1) return p; // Must have at least 1
        const next = current.filter(c => c !== code);
        return { ...p, acceptedOrigins: next, origin: next[0] };
      }
      return { ...p, acceptedOrigins: [...current, code] };
    });
  };

  const toggleDestAirport = (code: string) => {
    setForm(p => {
      const current = [...p.acceptedDestinations];
      if (current.includes(code)) {
        if (current.length <= 1) return p;
        const next = current.filter(c => c !== code);
        return { ...p, acceptedDestinations: next, destination: next[0] };
      }
      return { ...p, acceptedDestinations: [...current, code] };
    });
  };

  const toggleAirline = (code: string) => {
    setForm(p => ({
      ...p,
      airlinePreferences: p.airlinePreferences.includes(code)
        ? p.airlinePreferences.filter(c => c !== code)
        : [...p.airlinePreferences, code],
    }));
  };

  const updatePassenger = (idx: number, field: keyof PassengerForm, value: any) => {
    setForm(p => {
      const pax = [...p.passengers];
      pax[idx] = { ...pax[idx], [field]: value };
      return { ...p, passengers: pax };
    });
  };

  const prefillPassenger = (idx: number, traveler: any) => {
    setForm(p => {
      const pax = [...p.passengers];
      pax[idx] = {
        ...pax[idx],
        firstName: traveler.firstName || '',
        middleName: traveler.middleName || '',
        lastName: traveler.lastName || '',
        gender: traveler.gender || '',
        dateOfBirth: traveler.dateOfBirth ? new Date(traveler.dateOfBirth).toISOString().split('T')[0] : '',
        email: traveler.email || '',
        phone: traveler.phone || '',
        nationality: traveler.nationality || '',
        passportNumber: traveler.passportNumber || '',
        passportCountry: traveler.passportCountry || '',
        passportExpiry: traveler.passportExpiry ? new Date(traveler.passportExpiry).toISOString().split('T')[0] : '',
        isConfirmed: false, // Customer must explicitly confirm
      };
      return { ...p, passengers: pax };
    });
  };

  const canProceed = (): boolean => {
    if (step === 0) return form.acceptedOrigins.length > 0 && form.acceptedDestinations.length > 0 && !!form.departureDate;
    if (step === 1) return !!form.minFare && !!form.maxFare && Number(form.minFare) <= Number(form.maxFare);
    if (step === 4 && form.executionMode === 'AUTO_PURCHASE') {
      // All passengers must be confirmed with required fields
      const expectedCount = form.adults + form.children + form.infants;
      return form.passengers.length >= expectedCount && form.passengers.every(p =>
        p.firstName && p.lastName && p.dateOfBirth && p.isConfirmed
      );
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!user?.id) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${BACKEND}/api/limit-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          origin: form.origin,
          destination: form.destination,
          originCity: form.originCity || undefined,
          destinationCity: form.destinationCity || undefined,
          acceptedOrigins: form.acceptedOrigins,
          acceptedDestinations: form.acceptedDestinations,
          departureDate: form.departureDate,
          returnDate: form.returnDate || undefined,
          tripType: form.tripType,
          adults: form.adults, children: form.children, infants: form.infants,
          infantsWithSeat: form.infantsWithSeat,
          minFare: Number(form.minFare), maxFare: Number(form.maxFare),
          maxDurationMinutes: form.maxDurationMinutes ? Number(form.maxDurationMinutes) : undefined,
          cabinClass: form.cabinClass,
          airlinePreferenceMode: form.airlinePreferenceMode,
          airlinePreferences: form.airlinePreferences,
          bookingWindowDays: Number(form.bookingWindowDays) || 30,
          expirationDays: form.expirationDays ? Number(form.expirationDays) : undefined,
          executionMode: form.executionMode,
          passengers: form.executionMode === 'AUTO_PURCHASE' ? form.passengers : [],
          status: 'ACTIVE',
        }),
      });
      const data = await res.json();
      if (data.success) {
        router.push('/account/limit-orders');
      } else {
        setError(data.error || 'Failed to create limit order');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  const Input = ({ label, value, onChange, type = 'text', placeholder, required, className = '', disabled }: any) => (
    <div className={className}>
      {label && <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required} disabled={disabled}
        className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder-slate-600 focus:border-[#1ABC9C]/40 focus:outline-none focus:ring-1 focus:ring-[#1ABC9C]/20 transition-all disabled:opacity-50" />
    </div>
  );

  const originResults = searchAirports(form.originSearch);
  const destResults = searchAirports(form.destinationSearch);
  const originCityAirports = form.originCity ? (CITY_AIRPORTS.get(form.originCity) || []) : [];
  const destCityAirports = form.destinationCity ? (CITY_AIRPORTS.get(form.destinationCity) || []) : [];

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white mb-1">Create Limit Order</h1>
        <p className="text-slate-500 text-sm">Define your ideal flight criteria and we'll monitor prices for you.</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-1.5 mb-8 overflow-x-auto pb-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === step;
          const isCompleted = i < step;
          return (
            <div key={i} className="flex items-center gap-1.5 shrink-0">
              <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                isActive ? 'bg-[#1ABC9C]/15 border border-[#1ABC9C]/25 text-[#1ABC9C]'
                : isCompleted ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                : 'bg-white/[0.03] border border-white/[0.06] text-slate-600'
              }`} onClick={() => i < step && setStep(i)}>
                {isCompleted ? <Check size={10} /> : <Icon size={10} />}
                <span className="text-[10px] font-bold">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <ChevronRight size={8} className="text-slate-700" />}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Step Content */}
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
          className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">

          {/* ──── Step 0: Route ──── */}
          {step === 0 && (
            <div className="space-y-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><Plane size={16} className="text-[#1ABC9C]" /> Flight Route</h2>

              {/* Trip Type */}
              <div className="flex gap-2">
                {(['ONE_WAY', 'ROUND_TRIP'] as const).map(t => (
                  <button key={t} onClick={() => update('tripType', t)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${form.tripType === t
                      ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                      : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white'
                    }`}>
                    {t === 'ONE_WAY' ? 'One Way' : 'Round Trip'}
                  </button>
                ))}
              </div>

              {/* Origin City Search */}
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Origin</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input type="text" placeholder="City or airport code..."
                      value={form.originSearch}
                      onChange={e => { update('originSearch', e.target.value); setShowOriginDropdown(true); }}
                      onFocus={() => setShowOriginDropdown(true)}
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder-slate-600 focus:border-[#1ABC9C]/40 focus:outline-none transition-all" />
                  </div>
                  {showOriginDropdown && originResults.length > 0 && (
                    <div className="absolute z-20 top-full mt-1 w-full max-h-48 overflow-y-auto bg-[#1a1f2e] border border-white/[0.12] rounded-xl shadow-xl">
                      {originResults.map(r => (
                        <button key={r.city} onClick={() => selectOriginCity(r.city, r.airports)}
                          className="w-full text-left px-4 py-2.5 hover:bg-white/[0.06] transition-colors border-b border-white/[0.04] last:border-0">
                          <p className="text-white text-xs font-bold">{r.city}</p>
                          <p className="text-slate-500 text-[10px]">{r.airports.map(a => a.code).join(', ')}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Destination</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input type="text" placeholder="City or airport code..."
                      value={form.destinationSearch}
                      onChange={e => { update('destinationSearch', e.target.value); setShowDestDropdown(true); }}
                      onFocus={() => setShowDestDropdown(true)}
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder-slate-600 focus:border-[#1ABC9C]/40 focus:outline-none transition-all" />
                  </div>
                  {showDestDropdown && destResults.length > 0 && (
                    <div className="absolute z-20 top-full mt-1 w-full max-h-48 overflow-y-auto bg-[#1a1f2e] border border-white/[0.12] rounded-xl shadow-xl">
                      {destResults.map(r => (
                        <button key={r.city} onClick={() => selectDestCity(r.city, r.airports)}
                          className="w-full text-left px-4 py-2.5 hover:bg-white/[0.06] transition-colors border-b border-white/[0.04] last:border-0">
                          <p className="text-white text-xs font-bold">{r.city}</p>
                          <p className="text-slate-500 text-[10px]">{r.airports.map(a => a.code).join(', ')}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Accepted Airport Checkboxes */}
              {(originCityAirports.length > 1 || destCityAirports.length > 1) && (
                <div className="grid grid-cols-2 gap-4">
                  {originCityAirports.length > 1 && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <MapPin size={10} className="inline mr-1" />Accepted Origin Airports
                      </label>
                      <div className="space-y-1.5">
                        {originCityAirports.map(a => (
                          <label key={a.code} className="flex items-center gap-2 cursor-pointer group">
                            <input type="checkbox" checked={form.acceptedOrigins.includes(a.code)}
                              onChange={() => toggleOriginAirport(a.code)}
                              className="rounded border-white/20 bg-white/[0.06] text-[#1ABC9C] focus:ring-[#1ABC9C]/30 w-3.5 h-3.5" />
                            <span className="text-white text-xs font-bold">{a.code}</span>
                            <span className="text-slate-500 text-[10px] truncate">{a.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {destCityAirports.length > 1 && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <MapPin size={10} className="inline mr-1" />Accepted Destination Airports
                      </label>
                      <div className="space-y-1.5">
                        {destCityAirports.map(a => (
                          <label key={a.code} className="flex items-center gap-2 cursor-pointer group">
                            <input type="checkbox" checked={form.acceptedDestinations.includes(a.code)}
                              onChange={() => toggleDestAirport(a.code)}
                              className="rounded border-white/20 bg-white/[0.06] text-[#1ABC9C] focus:ring-[#1ABC9C]/30 w-3.5 h-3.5" />
                            <span className="text-white text-xs font-bold">{a.code}</span>
                            <span className="text-slate-500 text-[10px] truncate">{a.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Selected airports badge */}
              {form.acceptedOrigins.length > 0 && form.acceptedDestinations.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1ABC9C]/5 border border-[#1ABC9C]/15 text-[11px]">
                  <Shield size={12} className="text-[#1ABC9C]" />
                  <span className="text-slate-300">
                    Matching: <strong className="text-white">{form.acceptedOrigins.join(', ')}</strong> → <strong className="text-white">{form.acceptedDestinations.join(', ')}</strong>
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Input label="Departure Date" type="date" value={form.departureDate} onChange={(v: string) => update('departureDate', v)} required />
                {form.tripType === 'ROUND_TRIP' && (
                  <Input label="Return Date" type="date" value={form.returnDate} onChange={(v: string) => update('returnDate', v)} />
                )}
              </div>

              {/* Passengers */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Passengers</label>
                <div className="flex flex-wrap gap-4">
                  {(['adults', 'children', 'infants'] as const).map(t => (
                    <div key={t} className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs capitalize">{t}</span>
                      <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-lg overflow-hidden">
                        <button onClick={() => update(t, Math.max(t === 'adults' ? 1 : 0, form[t] - 1))}
                          className="px-2.5 py-1 text-slate-400 hover:text-white text-sm font-bold transition-all">−</button>
                        <span className="px-2 text-white text-sm font-bold min-w-[24px] text-center">{form[t]}</span>
                        <button onClick={() => update(t, Math.min(9, form[t] + 1))}
                          className="px-2.5 py-1 text-slate-400 hover:text-white text-sm font-bold transition-all">+</button>
                      </div>
                    </div>
                  ))}
                </div>
                {form.infants > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.infantsWithSeat > 0}
                        onChange={e => update('infantsWithSeat', e.target.checked ? form.infants : 0)}
                        className="rounded border-white/20 bg-white/[0.06] text-[#1ABC9C] focus:ring-[#1ABC9C]/30 w-3.5 h-3.5" />
                      <span className="text-slate-400 text-xs">Infant(s) with own seat</span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ──── Step 1: Criteria ──── */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><DollarSign size={16} className="text-[#1ABC9C]" /> Fare & Flight Criteria</h2>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Fare Range (USD)</label>
                <div className="grid grid-cols-2 gap-4">
                  <Input label="" value={form.minFare} onChange={(v: string) => update('minFare', v)} type="number" placeholder="Min (e.g. 650)" />
                  <Input label="" value={form.maxFare} onChange={(v: string) => update('maxFare', v)} type="number" placeholder="Max (e.g. 850)" />
                </div>
                {form.tripType === 'ROUND_TRIP' && (
                  <p className="text-[#1ABC9C] text-[11px] mt-1 flex items-center gap-1"><Shield size={10} /> Round-trip: fare range applies to the complete itinerary (outbound + return).</p>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Maximum Journey Duration</label>
                <div className="grid grid-cols-2 gap-2">
                  {DURATION_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => update('maxDurationMinutes', opt.value)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${form.maxDurationMinutes === opt.value
                        ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white'
                      }`}>{opt.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Cabin Class</label>
                <div className="grid grid-cols-2 gap-2">
                  {CABIN_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => update('cabinClass', opt.value)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${form.cabinClass === opt.value
                        ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white'
                      }`}>{opt.label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ──── Step 2: Preferences ──── */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><Target size={16} className="text-[#1ABC9C]" /> Airline & Timing Preferences</h2>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Airline Preference</label>
                <div className="flex gap-2 mb-3">
                  {(['ACCEPT', 'EXCLUDE'] as const).map(m => (
                    <button key={m} onClick={() => update('airlinePreferenceMode', m)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${form.airlinePreferenceMode === m
                        ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white'
                      }`}>{m === 'ACCEPT' ? 'Accept These Airlines' : 'Exclude These Airlines'}</button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {POPULAR_AIRLINES.map(al => (
                    <button key={al.code} onClick={() => toggleAirline(al.code)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                        form.airlinePreferences.includes(al.code)
                          ? form.airlinePreferenceMode === 'EXCLUDE'
                            ? 'bg-red-500/15 text-red-400 border border-red-500/25'
                            : 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                          : 'bg-white/[0.04] text-slate-500 border border-white/[0.08] hover:text-white'
                      }`}>{al.code} · {al.name}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Booking Window</label>
                <div className="grid grid-cols-2 gap-2">
                  {WINDOW_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => update('bookingWindowDays', opt.value)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${form.bookingWindowDays === opt.value
                        ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white'
                      }`}>{opt.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Limit Order Expiration</label>
                <div className="grid grid-cols-3 gap-2">
                  {EXPIRY_OPTIONS.map(opt => (
                    <button key={opt.value || 'dep'} onClick={() => update('expirationDays', opt.value)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${form.expirationDays === opt.value
                        ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white'
                      }`}>{opt.label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ──── Step 3: Execution ──── */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><Zap size={16} className="text-[#1ABC9C]" /> Execution Mode</h2>
              <div className="space-y-3">
                <button onClick={() => update('executionMode', 'NOTIFY_ONLY')}
                  className={`w-full text-left p-5 rounded-2xl border transition-all ${form.executionMode === 'NOTIFY_ONLY'
                    ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30' : 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.15]'
                  }`}>
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${form.executionMode === 'NOTIFY_ONLY' ? 'bg-[#1ABC9C]/20 text-[#1ABC9C]' : 'bg-white/[0.06] text-slate-500'}`}>
                      <Bell size={18} />
                    </div>
                    <div>
                      <h3 className="text-white font-bold text-sm mb-1">Notify Only</h3>
                      <p className="text-slate-400 text-xs leading-relaxed">We'll notify you when a match is found. Passenger details can be entered at checkout.</p>
                    </div>
                    {form.executionMode === 'NOTIFY_ONLY' && <Check size={16} className="text-[#1ABC9C] shrink-0 mt-1" />}
                  </div>
                </button>
                <button onClick={() => update('executionMode', 'AUTO_PURCHASE')}
                  className={`w-full text-left p-5 rounded-2xl border transition-all ${form.executionMode === 'AUTO_PURCHASE'
                    ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.15]'
                  }`}>
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${form.executionMode === 'AUTO_PURCHASE' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/[0.06] text-slate-500'}`}>
                      <CreditCard size={18} />
                    </div>
                    <div>
                      <h3 className="text-white font-bold text-sm mb-1">Auto-Purchase</h3>
                      <p className="text-slate-400 text-xs leading-relaxed">FareMind will <strong className="text-white">immediately purchase the ticket</strong> when criteria match. Passenger details are required in the next step.</p>
                      {form.executionMode === 'AUTO_PURCHASE' && (
                        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px]">
                          <AlertTriangle size={12} /> You must provide and confirm all passenger details.
                        </div>
                      )}
                    </div>
                    {form.executionMode === 'AUTO_PURCHASE' && <Check size={16} className="text-cyan-400 shrink-0 mt-1" />}
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ──── Step 4: Passengers ──── */}
          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Users size={16} className="text-[#1ABC9C]" /> Passenger Details
              </h2>

              {form.executionMode === 'NOTIFY_ONLY' && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs">
                  <Shield size={14} />
                  <span>Notify-Only: Passenger details are optional and can be entered at checkout. Your passenger counts ({form.adults}A, {form.children}C, {form.infants}I) are already set for fare matching.</span>
                </div>
              )}

              {form.executionMode === 'AUTO_PURCHASE' && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
                  <AlertTriangle size={14} />
                  <span>Auto-Purchase: All passenger details are required and must be confirmed before activation.</span>
                </div>
              )}

              {/* Saved Travelers */}
              {savedTravelers.length > 0 && (
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Prefill from Saved Travelers</p>
                  <div className="flex flex-wrap gap-2">
                    {savedTravelers.map(t => (
                      <span key={t.id} className="text-[11px] text-slate-300 px-2 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                        {t.firstName} {t.lastName}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Passenger Forms */}
              {form.passengers.map((pax, idx) => (
                <div key={idx} className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-white font-bold text-sm">
                      Passenger {idx + 1} — <span className="capitalize text-[#1ABC9C]">{pax.passengerType}</span>
                      {pax.passengerType === 'infant' && (
                        <span className="text-slate-400 text-xs ml-2">({pax.infantWithSeat ? 'Own Seat' : 'Lap Infant'})</span>
                      )}
                    </h3>
                    {savedTravelers.length > 0 && (
                      <select onChange={e => { const t = savedTravelers.find(t => t.id === e.target.value); if (t) prefillPassenger(idx, t); }}
                        className="px-2 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-400 text-[10px] focus:outline-none appearance-none cursor-pointer">
                        <option value="">Prefill from saved...</option>
                        {savedTravelers.map(t => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
                      </select>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <Input label="First Name *" value={pax.firstName} onChange={(v: string) => updatePassenger(idx, 'firstName', v)} placeholder="Legal first name" />
                    <Input label="Middle Name" value={pax.middleName} onChange={(v: string) => updatePassenger(idx, 'middleName', v)} placeholder="Optional" />
                    <Input label="Last Name *" value={pax.lastName} onChange={(v: string) => updatePassenger(idx, 'lastName', v)} placeholder="Legal last name" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Gender {form.executionMode === 'AUTO_PURCHASE' ? '*' : ''}</label>
                      <select value={pax.gender} onChange={e => updatePassenger(idx, 'gender', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm focus:border-[#1ABC9C]/40 focus:outline-none appearance-none cursor-pointer">
                        <option value="">Select</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </div>
                    <Input label={`Date of Birth ${form.executionMode === 'AUTO_PURCHASE' ? '*' : ''}`} type="date" value={pax.dateOfBirth} onChange={(v: string) => updatePassenger(idx, 'dateOfBirth', v)} />
                    <Input label="Nationality" value={pax.nationality} onChange={(v: string) => updatePassenger(idx, 'nationality', v)} placeholder="e.g. US" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Input label="Passport Number" value={pax.passportNumber} onChange={(v: string) => updatePassenger(idx, 'passportNumber', v)} />
                    <Input label="Passport Country" value={pax.passportCountry} onChange={(v: string) => updatePassenger(idx, 'passportCountry', v)} placeholder="e.g. US" />
                    <Input label="Passport Expiry" type="date" value={pax.passportExpiry} onChange={(v: string) => updatePassenger(idx, 'passportExpiry', v)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Known Traveler #" value={pax.knownTravelerNumber} onChange={(v: string) => updatePassenger(idx, 'knownTravelerNumber', v)} placeholder="TSA PreCheck / Global Entry" />
                    <Input label="Redress #" value={pax.redressNumber} onChange={(v: string) => updatePassenger(idx, 'redressNumber', v)} placeholder="DHS Redress Number" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Email" type="email" value={pax.email} onChange={(v: string) => updatePassenger(idx, 'email', v)} />
                    <Input label="Phone" value={pax.phone} onChange={(v: string) => updatePassenger(idx, 'phone', v)} />
                  </div>

                  {/* Confirmation Checkbox */}
                  {form.executionMode === 'AUTO_PURCHASE' && (
                    <label className="flex items-center gap-2 mt-2 cursor-pointer">
                      <input type="checkbox" checked={pax.isConfirmed}
                        onChange={e => updatePassenger(idx, 'isConfirmed', e.target.checked)}
                        className="rounded border-white/20 bg-white/[0.06] text-[#1ABC9C] focus:ring-[#1ABC9C]/30 w-4 h-4" />
                      <span className="text-white text-xs font-bold">I confirm this passenger's details are correct for ticketing</span>
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ──── Step 5: Review ──── */}
          {step === 5 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><Check size={16} className="text-[#1ABC9C]" /> Review & Confirm</h2>
              {/* Route */}
              <div className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <Plane size={14} className="text-[#1ABC9C]" />
                <div>
                  <p className="text-white font-bold text-sm">{form.acceptedOrigins.join('/')} → {form.acceptedDestinations.join('/')}</p>
                  <p className="text-slate-500 text-xs">{form.tripType === 'ROUND_TRIP' ? 'Round Trip' : 'One Way'} · {form.departureDate}{form.returnDate ? ` — ${form.returnDate}` : ''}</p>
                  {form.originCity && <p className="text-slate-600 text-[10px]">{form.originCity} → {form.destinationCity}</p>}
                </div>
              </div>
              {/* Passengers */}
              <div className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <Users size={14} className="text-[#1ABC9C]" />
                <div>
                  <p className="text-white font-bold text-sm">{form.adults} Adult{form.adults > 1 ? 's' : ''}{form.children ? `, ${form.children} Child${form.children > 1 ? 'ren' : ''}` : ''}{form.infants ? `, ${form.infants} Infant${form.infants > 1 ? 's' : ''}` : ''}</p>
                  {form.executionMode === 'AUTO_PURCHASE' && form.passengers.filter(p => p.isConfirmed).length > 0 && (
                    <p className="text-emerald-400 text-[10px]">✓ {form.passengers.filter(p => p.isConfirmed).length} passenger(s) confirmed</p>
                  )}
                </div>
              </div>
              {/* Fare */}
              <div className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <DollarSign size={14} className="text-[#1ABC9C]" />
                <div>
                  <p className="text-white font-bold text-sm">{fmt(Number(form.minFare))} – {fmt(Number(form.maxFare))}</p>
                  <p className="text-slate-500 text-xs">
                    {CABIN_OPTIONS.find(c => c.value === form.cabinClass)?.label}
                    {form.maxDurationMinutes ? ` · Max ${Number(form.maxDurationMinutes) / 60}h` : ' · Any duration'}
                    {form.tripType === 'ROUND_TRIP' && ' · Total itinerary fare'}
                  </p>
                </div>
              </div>
              {/* Execution */}
              <div className={`flex items-center gap-3 p-4 rounded-xl border ${form.executionMode === 'AUTO_PURCHASE' ? 'bg-cyan-500/5 border-cyan-500/20' : 'bg-white/[0.03] border-white/[0.06]'}`}>
                {form.executionMode === 'AUTO_PURCHASE' ? <Zap size={14} className="text-cyan-400" /> : <Bell size={14} className="text-amber-400" />}
                <div>
                  <p className="text-white font-bold text-sm">{form.executionMode === 'AUTO_PURCHASE' ? 'Auto-Purchase' : 'Notify Only'}</p>
                  <p className="text-slate-500 text-xs">Window: {form.bookingWindowDays} days · Expires: {form.expirationDays ? `${form.expirationDays} days` : 'At departure'}</p>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6">
        <button onClick={() => step > 0 && setStep(step - 1)} disabled={step === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-400 text-sm font-bold hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
          <ChevronLeft size={14} /> Back
        </button>

        {step < STEPS.length - 1 ? (
          <button onClick={() => canProceed() && setStep(step + 1)} disabled={!canProceed()}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-[#1ABC9C]/20">
            Next <ChevronRight size={14} />
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={submitting}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] disabled:opacity-40 transition-all shadow-lg shadow-[#1ABC9C]/20">
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {submitting ? 'Creating...' : 'Create Limit Order'}
          </button>
        )}
      </div>
    </div>
  );
}
