'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plane, DollarSign, Clock, Users, Calendar, ChevronRight, ChevronLeft,
  Target, Bell, Zap, CreditCard, Check, Loader2, AlertTriangle, X,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const STEPS = [
  { label: 'Route', icon: Plane },
  { label: 'Criteria', icon: DollarSign },
  { label: 'Preferences', icon: Target },
  { label: 'Execution', icon: Zap },
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

interface FormData {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  tripType: 'ONE_WAY' | 'ROUND_TRIP';
  adults: number;
  children: number;
  infants: number;
  minFare: string;
  maxFare: string;
  maxDurationMinutes: string;
  cabinClass: string;
  airlinePreferenceMode: 'ACCEPT' | 'EXCLUDE';
  airlinePreferences: string[];
  bookingWindowDays: string;
  expirationDays: string;
  executionMode: 'NOTIFY_ONLY' | 'AUTO_PURCHASE';
}

export default function CreateLimitOrderPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState<FormData>({
    origin: '', destination: '', departureDate: '', returnDate: '',
    tripType: 'ONE_WAY', adults: 1, children: 0, infants: 0,
    minFare: '', maxFare: '', maxDurationMinutes: '', cabinClass: 'ECONOMY',
    airlinePreferenceMode: 'ACCEPT', airlinePreferences: [],
    bookingWindowDays: '30', expirationDays: '30', executionMode: 'NOTIFY_ONLY',
  });

  const update = (k: keyof FormData, v: any) => setForm(p => ({ ...p, [k]: v }));

  const toggleAirline = (code: string) => {
    setForm(p => ({
      ...p,
      airlinePreferences: p.airlinePreferences.includes(code)
        ? p.airlinePreferences.filter(c => c !== code)
        : [...p.airlinePreferences, code],
    }));
  };

  const canProceed = (): boolean => {
    if (step === 0) return !!form.origin && !!form.destination && !!form.departureDate && form.origin.length === 3 && form.destination.length === 3;
    if (step === 1) return !!form.minFare && !!form.maxFare && Number(form.minFare) <= Number(form.maxFare);
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
          origin: form.origin.toUpperCase(),
          destination: form.destination.toUpperCase(),
          departureDate: form.departureDate,
          returnDate: form.returnDate || undefined,
          tripType: form.tripType,
          adults: form.adults, children: form.children, infants: form.infants,
          minFare: Number(form.minFare), maxFare: Number(form.maxFare),
          maxDurationMinutes: form.maxDurationMinutes ? Number(form.maxDurationMinutes) : undefined,
          cabinClass: form.cabinClass,
          airlinePreferenceMode: form.airlinePreferenceMode,
          airlinePreferences: form.airlinePreferences,
          bookingWindowDays: Number(form.bookingWindowDays) || 30,
          expirationDays: form.expirationDays ? Number(form.expirationDays) : undefined,
          executionMode: form.executionMode,
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

  // ── Input component ──
  const Input = ({ label, value, onChange, type = 'text', placeholder, max, required, className = '' }: any) => (
    <div className={className}>
      <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} max={max} required={required}
        className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder-slate-600 focus:border-[#1ABC9C]/40 focus:outline-none focus:ring-1 focus:ring-[#1ABC9C]/20 transition-all" />
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white mb-1">Create Limit Order</h1>
        <p className="text-slate-500 text-sm">Define your ideal flight criteria and we'll monitor prices for you.</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === step;
          const isCompleted = i < step;
          return (
            <div key={i} className="flex items-center gap-2 shrink-0">
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all ${
                isActive ? 'bg-[#1ABC9C]/15 border border-[#1ABC9C]/25 text-[#1ABC9C]'
                : isCompleted ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                : 'bg-white/[0.03] border border-white/[0.06] text-slate-600'
              }`}>
                {isCompleted ? <Check size={12} /> : <Icon size={12} />}
                <span className="text-[11px] font-bold">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <ChevronRight size={10} className="text-slate-700" />}
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

          {/* Step 0: Route */}
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

              <div className="grid grid-cols-2 gap-4">
                <Input label="Origin (IATA)" value={form.origin} onChange={(v: string) => update('origin', v.toUpperCase().slice(0, 3))} placeholder="JFK" required />
                <Input label="Destination (IATA)" value={form.destination} onChange={(v: string) => update('destination', v.toUpperCase().slice(0, 3))} placeholder="LAX" required />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Input label="Departure Date" type="date" value={form.departureDate} onChange={(v: string) => update('departureDate', v)} required />
                {form.tripType === 'ROUND_TRIP' && (
                  <Input label="Return Date" type="date" value={form.returnDate} onChange={(v: string) => update('returnDate', v)} min={form.departureDate} />
                )}
              </div>

              {/* Passengers */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Passengers</label>
                <div className="flex gap-4">
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
              </div>
            </div>
          )}

          {/* Step 1: Criteria */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><DollarSign size={16} className="text-[#1ABC9C]" /> Fare & Flight Criteria</h2>

              {/* Fare Range */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Fare Range (USD)</label>
                <div className="grid grid-cols-2 gap-4">
                  <Input label="" value={form.minFare} onChange={(v: string) => update('minFare', v)} type="number" placeholder="650" />
                  <Input label="" value={form.maxFare} onChange={(v: string) => update('maxFare', v)} type="number" placeholder="850" />
                </div>
                <p className="text-slate-600 text-[11px] mt-1">We'll match flights priced between these values.</p>
              </div>

              {/* Max Duration */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Maximum Journey Duration</label>
                <div className="grid grid-cols-2 gap-2">
                  {DURATION_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => update('maxDurationMinutes', opt.value)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${form.maxDurationMinutes === opt.value
                        ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-slate-600 text-[11px] mt-1">Total itinerary duration — direct, 1-stop, or 2-stop.</p>
              </div>

              {/* Cabin Class */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Cabin Class</label>
                <div className="grid grid-cols-2 gap-2">
                  {CABIN_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => update('cabinClass', opt.value)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${form.cabinClass === opt.value
                        ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Preferences */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><Target size={16} className="text-[#1ABC9C]" /> Airline & Timing Preferences</h2>

              {/* Airline Preference Mode */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Airline Preference</label>
                <div className="flex gap-2 mb-3">
                  {(['ACCEPT', 'EXCLUDE'] as const).map(m => (
                    <button key={m} onClick={() => update('airlinePreferenceMode', m)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${form.airlinePreferenceMode === m
                        ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white'
                      }`}>
                      {m === 'ACCEPT' ? 'Accept These Airlines' : 'Exclude These Airlines'}
                    </button>
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
                      }`}>
                      {al.code} · {al.name}
                    </button>
                  ))}
                </div>
                {form.airlinePreferences.length === 0 && (
                  <p className="text-slate-600 text-[11px] mt-2">No airlines selected — all airlines will be considered.</p>
                )}
              </div>

              {/* Booking Window */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Travel Booking Window</label>
                <div className="grid grid-cols-2 gap-2">
                  {WINDOW_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => update('bookingWindowDays', opt.value)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${form.bookingWindowDays === opt.value
                        ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Expiration */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Limit Order Expiration</label>
                <div className="grid grid-cols-3 gap-2">
                  {EXPIRY_OPTIONS.map(opt => (
                    <button key={opt.value || 'dep'} onClick={() => update('expirationDays', opt.value)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${form.expirationDays === opt.value
                        ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Execution */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><Zap size={16} className="text-[#1ABC9C]" /> Execution Mode</h2>

              <div className="space-y-3">
                {/* Notify Only */}
                <button onClick={() => update('executionMode', 'NOTIFY_ONLY')}
                  className={`w-full text-left p-5 rounded-2xl border transition-all ${form.executionMode === 'NOTIFY_ONLY'
                    ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30'
                    : 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.15]'
                  }`}>
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${form.executionMode === 'NOTIFY_ONLY' ? 'bg-[#1ABC9C]/20 text-[#1ABC9C]' : 'bg-white/[0.06] text-slate-500'}`}>
                      <Bell size={18} />
                    </div>
                    <div>
                      <h3 className="text-white font-bold text-sm mb-1">Notify Only</h3>
                      <p className="text-slate-400 text-xs leading-relaxed">
                        We'll send you an email and push notification when a matching flight is found. You complete the purchase manually.
                      </p>
                    </div>
                    {form.executionMode === 'NOTIFY_ONLY' && (
                      <Check size={16} className="text-[#1ABC9C] shrink-0 mt-1" />
                    )}
                  </div>
                </button>

                {/* Auto Purchase */}
                <button onClick={() => update('executionMode', 'AUTO_PURCHASE')}
                  className={`w-full text-left p-5 rounded-2xl border transition-all ${form.executionMode === 'AUTO_PURCHASE'
                    ? 'bg-cyan-500/10 border-cyan-500/30'
                    : 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.15]'
                  }`}>
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${form.executionMode === 'AUTO_PURCHASE' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/[0.06] text-slate-500'}`}>
                      <CreditCard size={18} />
                    </div>
                    <div>
                      <h3 className="text-white font-bold text-sm mb-1">Auto-Purchase</h3>
                      <p className="text-slate-400 text-xs leading-relaxed">
                        When criteria match, FareMind will <strong className="text-white">immediately purchase the ticket</strong> using your authorized payment method.
                      </p>
                      {form.executionMode === 'AUTO_PURCHASE' && (
                        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px]">
                          <AlertTriangle size={12} />
                          Payment authorization will be required after order creation.
                        </div>
                      )}
                    </div>
                    {form.executionMode === 'AUTO_PURCHASE' && (
                      <Check size={16} className="text-cyan-400 shrink-0 mt-1" />
                    )}
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><Check size={16} className="text-[#1ABC9C]" /> Review & Confirm</h2>

              <div className="space-y-3">
                {/* Route */}
                <div className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <Plane size={14} className="text-[#1ABC9C]" />
                  <div>
                    <p className="text-white font-bold text-sm">{form.origin} → {form.destination}</p>
                    <p className="text-slate-500 text-xs">{form.tripType === 'ROUND_TRIP' ? 'Round Trip' : 'One Way'} · {form.departureDate}{form.returnDate ? ` — ${form.returnDate}` : ''}</p>
                  </div>
                </div>

                {/* Passengers */}
                <div className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <Users size={14} className="text-[#1ABC9C]" />
                  <div>
                    <p className="text-white font-bold text-sm">{form.adults} Adult{form.adults > 1 ? 's' : ''}{form.children ? `, ${form.children} Child${form.children > 1 ? 'ren' : ''}` : ''}{form.infants ? `, ${form.infants} Infant${form.infants > 1 ? 's' : ''}` : ''}</p>
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
                    </p>
                  </div>
                </div>

                {/* Airlines */}
                {form.airlinePreferences.length > 0 && (
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <Target size={14} className="text-[#1ABC9C]" />
                    <div>
                      <p className="text-white font-bold text-sm">{form.airlinePreferenceMode === 'ACCEPT' ? 'Only' : 'Excluding'}: {form.airlinePreferences.join(', ')}</p>
                    </div>
                  </div>
                )}

                {/* Execution */}
                <div className={`flex items-center gap-3 p-4 rounded-xl border ${form.executionMode === 'AUTO_PURCHASE' ? 'bg-cyan-500/5 border-cyan-500/20' : 'bg-white/[0.03] border-white/[0.06]'}`}>
                  {form.executionMode === 'AUTO_PURCHASE' ? <Zap size={14} className="text-cyan-400" /> : <Bell size={14} className="text-amber-400" />}
                  <div>
                    <p className="text-white font-bold text-sm">{form.executionMode === 'AUTO_PURCHASE' ? 'Auto-Purchase' : 'Notify Only'}</p>
                    <p className="text-slate-500 text-xs">
                      Booking window: {form.bookingWindowDays} days · Expires: {form.expirationDays ? `${form.expirationDays} days` : 'At departure'}
                    </p>
                  </div>
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
