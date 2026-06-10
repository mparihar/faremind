'use client';

import { motion } from 'framer-motion';
import { useEffect, useState, useCallback } from 'react';
import {
  Sparkles,
  TrendingDown,
  Globe,
  Shield,
  Zap,
  ArrowRight,
  Plane,
  BarChart3,
  RefreshCcw,
  Bell,
  ChevronRight,
  Dna,
} from 'lucide-react';
import SearchForm from '@/components/search/SearchForm';
import type { SearchFormHandle } from '@/components/search/SearchForm';
import SmartPreferencesBar from '@/components/search/SmartPreferencesBar';
import { usePreferencesStore } from '@/store/usePreferencesStore';
import { useSearchStore } from '@/store/useSearchStore';
import { useVoiceStore } from '@/store/useVoiceStore';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

import Link from 'next/link';

// ─── Types ───────────────────────────────────────

interface LiveRoute {
  from: string;
  to: string;
  fromCity: string;
  toCity: string;
  price: number | null;
  currency: string;
  stops: number | null;
  duration: number | null;  // total flight minutes
  layover: number | null;   // layover minutes; null = non-stop
  isMock: boolean;
}

// ─── Helpers ─────────────────────────────────────

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function StopsLabel({ stops, duration, layover }: { stops: number; duration: number; layover: number | null }) {
  if (stops === 0) {
    return (
      <div className="flex items-center gap-2 text-[11px] font-bold text-gray-500 uppercase tracking-tight">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 shadow-sm shadow-green-200" />
        <span className="text-green-700">Non-stop</span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-500">{fmtDuration(duration)}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[11px] font-bold text-gray-500 uppercase tracking-tight">
      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0 shadow-sm shadow-orange-200" />
      <span className="text-orange-700">{stops} stop{stops > 1 ? 's' : ''}</span>
      {layover !== null && (
        <>
          <span className="text-gray-300">·</span>
          <span>{fmtDuration(layover)} lay</span>
        </>
      )}
    </div>
  );
}


// ─── Static fallback routes (shown when backend is unavailable) ──────────────

const FALLBACK_ROUTES: LiveRoute[] = [
  { from: 'JFK', to: 'LAX', fromCity: 'New York',    toCity: 'Los Angeles',  price: 189,  currency: 'USD', stops: 0, duration: 330, layover: null, isMock: true },
  { from: 'JFK', to: 'LHR', fromCity: 'New York',    toCity: 'London',       price: 449,  currency: 'USD', stops: 0, duration: 420, layover: null, isMock: true },
  { from: 'LAX', to: 'NRT', fromCity: 'Los Angeles', toCity: 'Tokyo',        price: 599,  currency: 'USD', stops: 1, duration: 660, layover: 90,   isMock: true },
  { from: 'ORD', to: 'CDG', fromCity: 'Chicago',     toCity: 'Paris',        price: 399,  currency: 'USD', stops: 0, duration: 510, layover: null, isMock: true },
  { from: 'MIA', to: 'CUN', fromCity: 'Miami',       toCity: 'Cancun',       price: 129,  currency: 'USD', stops: 0, duration: 105, layover: null, isMock: true },
  { from: 'SFO', to: 'SIN', fromCity: 'San Francisco', toCity: 'Singapore',  price: 699,  currency: 'USD', stops: 1, duration: 900, layover: 120,  isMock: true },
];

// ─── Page data constants ──────────────────────────

const FEATURES = [
  { icon: Globe,    title: 'Smarter Flight Search',  description: 'We search across multiple travel sources to help you find the best balance of price, comfort, and flexibility.',     color: 'from-brand-500 to-brand-600' },
  { icon: BarChart3, title: 'Price Intelligence',  description: 'FareMind tracks your eligible trips and alerts you when prices move in your favor.',                    color: 'from-accent-500 to-accent-600' },
  { icon: RefreshCcw, title: 'AI Flight Ranking',    description: 'FareMind intelligently ranks flight options using price, comfort, flexibility, convenience, and travel value.',                  color: 'from-success-500 to-success-600' },
  { icon: Dna,     title: 'My FareMind DNA™',         description: 'Learns your travel preferences from confirmed bookings and personalizes recommendations to match your travel style.',                       color: 'from-purple-500 to-purple-600' },
];

const STATS = [
  { value: '100+', label: 'Airlines Connected' },
  { value: '1000+',  label: 'Routes Available' },
  { value: '24/7',   label: 'AI Assistance' },
  { value: '100%',    label: 'Personalized Search' },
];

// ─── Component ───────────────────────────────────

export default function HomePage() {
  const { resetAll } = usePreferencesStore();
  const { clearResults } = useSearchStore();
  const { user } = useAuthStore();
  const [routes, setRoutes] = useState<LiveRoute[]>(FALLBACK_ROUTES);
  const [routesLoading] = useState(false);
  const [dateMode, setDateMode] = useState<'specific' | 'flexible'>('specific');
  const setSearchFormRef = useVoiceStore((s) => s.setSearchFormRef);
  // Force fresh form on every homepage visit
  const [formKey, setFormKey] = useState(() => Date.now());

  // Use callback ref so the voice store gets set immediately when SearchForm mounts
  const searchFormCallbackRef = useCallback((handle: SearchFormHandle | null) => {
    setSearchFormRef(handle);
  }, [setSearchFormRef]);

  useEffect(() => {
    resetAll();
    clearResults();
    setFormKey(Date.now()); // Force remount with fresh defaults
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Check for pending voice search from sessionStorage (cross-page navigation)
  useEffect(() => {
    const pending = sessionStorage.getItem('faremind_voice_search');
    if (!pending) return;

    // Always remove immediately to prevent stale re-application on next reload
    sessionStorage.removeItem('faremind_voice_search');

    const apply = () => {
      const ref = useVoiceStore.getState().searchFormRef;
      if (ref) {
        try {
          const data = JSON.parse(pending);
          ref.fillFromVoice(data);
          // Don't auto-trigger search — let user verify & click Search Flights
        } catch { /* ignore */ }
      }
    };

    // SearchForm ref may not be registered yet — retry after a short delay
    const ref = useVoiceStore.getState().searchFormRef;
    if (ref) {
      apply();
    } else {
      setTimeout(apply, 500);
    }
  }, []);

  useEffect(() => {
    fetch('/api/popular-routes')
      .then((r) => r.json())
      .then((data) => {
        if (data.routes?.length) setRoutes(data.routes);
      })
      .catch(() => { /* keep static fallback */ });
  }, []);

  const searchDate = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

  return (
    <div className="relative bg-rising-sun-image min-h-screen">
      <div className="absolute inset-0 scenic-overlay" />

      {/* ═══ HERO ═══ */}
      <section className="relative min-h-[80vh] flex items-start">
        {/* Decorative layer — overflow contained so blur blobs don't cause scrollbars */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-grid" />
          <div className="absolute inset-0 bg-radial-glow" />
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-500/10 rounded-full blur-[120px] animate-pulse-soft" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent-500/8 rounded-full blur-[100px] animate-pulse-soft" style={{ animationDelay: '1.5s' }} />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-16 w-full">
          <div className="text-center mb-4">
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-[#1ABC9C] text-white shadow-sm mb-4"
            >
              <Sparkles className="w-4 h-4 text-white" />
              <span className="text-[12px] font-bold tracking-wide text-white uppercase">YOUR INTELLIGENT TRAVEL CONSULTANT</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.7 }}
              className="text-4xl sm:text-5xl lg:text-[54px] font-extrabold tracking-tight text-[#1a1a2e] mb-6 leading-[1.05]"
            >
              Travel with{' '}
              <span className="text-gradient-sun">Intelligence</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.3 }}
              className="text-[15px] text-[#475569] font-medium max-w-3xl mx-auto leading-[1.6] mb-4 tracking-tight"
            >
              <span className="font-black text-white">FARE</span><span className="font-black text-[#009CA6]">MIND</span> searches across multiple airlines while AI recommends the best personalized flight for your journey.
            </motion.p>


          </div>

          {/* Search Form */}
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.2 }} className="mt-6 relative z-40">
            <SearchForm key={formKey} ref={searchFormCallbackRef} onDateModeChange={setDateMode} />
          </motion.div>




          {/* Popular Routes */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            className="mt-28 max-w-7xl mx-auto"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="px-3 py-1 rounded-full bg-[#1ABC9C] text-white text-[11px] font-bold uppercase tracking-wider shadow-lg shadow-[#1ABC9C]/20">
                  ⚡ Smart Picks Powered by AI
                </div>
              </div>
              {!routesLoading && routes.some((r) => !r.isMock) && (
                <span className="flex items-center gap-1.5 px-4 py-1 rounded-full bg-[#1ABC9C] text-white text-[10px] font-black uppercase tracking-wider shadow-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  Real-Time Flight Pricing
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {routesLoading
                ? /* Skeleton cards */
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm animate-pulse">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-100" />
                        <div className="h-3.5 bg-gray-100 rounded w-20" />
                      </div>
                      <div className="h-2.5 bg-gray-100 rounded w-16 mb-2" />
                      <div className="h-6 bg-gray-100 rounded w-24 mb-2" />
                      <div className="h-2.5 bg-gray-100 rounded w-28" />
                    </div>
                  ))
                : routes.map((route) => (
                    <Link
                      key={`${route.from}-${route.to}`}
                      href={`/search?origin=${route.from}&destination=${route.to}&date=${searchDate}&adults=1&cabin=economy&trip=one_way`}
                      className="group bg-white rounded-xl p-4 border border-gray-100 shadow-sm hover:shadow-2xl hover:border-[#1ABC9C]/30 hover:-translate-y-1 transition-all duration-300 flex flex-col min-h-[150px]"
                    >
                      {/* Route header */}
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-8 h-8 rounded-lg bg-orange-50 border border-orange-100 flex items-center justify-center shrink-0">
                          <Plane className="w-4 h-4 text-sun-orange -rotate-45" />
                        </div>
                        <p className="text-sm font-bold text-gray-900 truncate">
                          {route.from} → {route.to}
                        </p>
                      </div>

                      {/* Origin city */}
                      <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-2">
                        {route.fromCity}
                      </p>

                      {/* Price */}
                      <div className="flex items-baseline gap-1 mt-auto">
                        <span className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">from</span>
                        <span className="text-2xl font-black text-sun-orange tracking-tighter">
                          {route.price ? `$${route.price}` : '—'}
                        </span>
                      </div>

                      {/* Indicators: stops + duration/layover */}
                      {route.stops !== null && route.duration !== null ? (
                        <StopsLabel stops={route.stops} duration={route.duration} layover={route.layover} />
                      ) : (
                        <div className="h-4 bg-gray-100 rounded animate-pulse w-24" />
                      )}
                    </Link>
                  ))}
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative mt-16 bg-gradient-to-br from-[#0f1525]/90 to-[#0a0e1a]/90 backdrop-blur-xl rounded-3xl border border-[#1ABC9C]/15 p-5 sm:p-6 overflow-hidden shadow-2xl shadow-black/20"
          >
            {/* Animated border glow */}
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-[#1ABC9C]/10 via-transparent to-purple-500/10 opacity-50" />
            
            <div className="relative flex flex-col md:flex-row items-center gap-6">
              {/* Animated Interactive DNA Icon */}
              <motion.div
                whileHover={{ scale: 1.05, rotate: 2 }}
                whileTap={{ scale: 0.95 }}
                className="relative w-20 h-20 shrink-0 group cursor-pointer"
              >
                {/* Glowing Aura */}
                <div className="absolute -inset-2 bg-[#1ABC9C] rounded-[2rem] opacity-40 blur-xl group-hover:opacity-70 transition-opacity duration-500 animate-pulse" />
                
                {/* Main Card */}
                <div className="relative w-full h-full bg-[#1ABC9C] rounded-2xl flex items-center justify-center overflow-hidden shadow-xl shadow-[#1ABC9C]/25">
                  
                  {/* High Quality Generated DNA Icon */}
                  <img src="/teal_dna_icon.png" alt="Travel DNA" className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-500" />

                  {/* Floating Particles */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                    <div className="absolute top-2 left-2 w-1.5 h-1.5 rounded-full bg-white/60 animate-ping" />
                    <div className="absolute bottom-3 right-2 w-1 h-1 rounded-full bg-white/80 animate-ping" style={{ animationDelay: '0.3s' }} />
                  </div>
                </div>
              </motion.div>

              {/* Content */}
              <div className="flex-1 text-center md:text-left">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 mb-2">
                  <Sparkles className="w-3 h-3 text-[#1ABC9C]" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#1ABC9C]">
                    <span className="text-white">FARE</span><span className="text-[#009CA6]">MIND</span> DNA™
                  </span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-white mb-1 tracking-tight">
                  <span className="text-[#1ABC9C]">Your</span> genes decide your travel style.
                </h2>
                <div className="flex flex-col w-full">
                  <p className="text-sm text-slate-400 leading-relaxed text-justify mb-3">
                    <span className="font-black text-white">FARE</span><span className="font-black text-[#009CA6]">MIND</span> Travel DNA intelligently analyzes your booking behavior, preferences, and trip choices to build a comprehensive profile of your unique travel personality.
                  </p>
                  <div className="flex items-center justify-end gap-6 w-full">
                    {user ? (
                      <a
                        href="/travel-dna"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-black text-white bg-[#1ABC9C] shadow-md hover:brightness-110 transition-all"
                      >
                        <Dna className="w-3 h-3" />
                        <span>View My <span>FARE</span><span className="text-[#009CA6]">MIND</span> DNA™</span>
                        <ArrowRight className="w-3 h-3" />
                      </a>
                    ) : (
                      <a
                        href="/auth/login?redirect=/travel-dna"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-black text-white bg-[#1ABC9C] shadow-md hover:brightness-110 transition-all"
                      >
                        Sign In to Start Learning
                        <ArrowRight className="w-3 h-3" />
                      </a>
                    )}
                    <span className="text-[11px] text-slate-400">
                      <span className="font-black text-white">FARE</span><span className="font-black text-[#009CA6]">MIND</span> DNA starts learning after your first confirmed booking.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>


      {/* ═══ STATS BAR ═══ */}
      <section className="relative border-y border-white/[0.05] bg-sun-deep/40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="text-center"
              >
                <p className="text-4xl sm:text-5xl font-black text-gradient-sun mb-2 tracking-tighter leading-none">{stat.value}</p>
                <p className="text-[13px] text-slate-500 font-bold uppercase tracking-[0.1em]">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-brand-500/5 rounded-full blur-[150px]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 border border-gray-200 mb-6 shadow-sm"
            >
              <Zap className="w-3.5 h-3.5 text-[#1a1a2e]" />
              <span className="text-xs font-bold text-[#1a1a2e] uppercase tracking-wide">Intelligent Features</span>
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-4xl sm:text-5xl font-black text-[#1a1a2e] mb-6 tracking-tighter"
            >
              Not just search. Intelligence.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-lg text-gray-500 max-w-xl mx-auto"
            >
              <span className="font-black text-white">FARE</span><span className="font-black text-[#009CA6]">MIND</span> goes beyond searching — it <span className="text-black font-semibold">thinks, monitors, and acts</span> on your behalf.
            </motion.p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {FEATURES.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="glass-card-scenic p-8 group"
                >
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-5 shadow-lg group-hover:scale-110 transition-transform`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">{feature.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{feature.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <div className="relative border-y border-white/[0.05] bg-sun-deep/40 backdrop-blur-md py-4 mt-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl sm:text-5xl font-black text-[#1a1a2e] mb-2 tracking-tighter"
          >
            How <span className="text-white text-[0.75em]">FARE</span><span className="text-[#009CA6] text-[0.75em]">MIND</span> works
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-lg text-gray-800 max-w-xl mx-auto font-semibold"
          >
            Three steps to smarter flying
          </motion.p>
        </div>
      </div>

      <section className="relative py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Search Smarter',    description: "Access flight options from multiple travel sources through a single intelligent search.", icon: Globe },
              { step: '02', title: 'Travel with Intelligence',        description: <><span><span className="font-black text-white">FARE</span><span className="font-black text-[#009CA6]">MIND</span></span> AI analyzes price, comfort, flexibility, and convenience to rank the best flights for your journey.</>,      icon: Shield },
              { step: '03', title: 'Travel Your Way',  description: 'My FareMind DNA™ learns your travel style and tailors recommendations to match your preferences.',  icon: Dna },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15, duration: 0.5 }}
                  className="relative text-center"
                >
                  {i < 2 && (
                    <div className="hidden md:block absolute top-16 left-[60%] w-[80%] h-[1px] bg-gradient-to-r from-brand-500/30 to-transparent" />
                  )}
                  <div className="relative inline-flex mb-6">
                    <div className="w-16 h-16 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center">
                      <Icon className="w-7 h-7 text-sun-orange" />
                    </div>
                    <span className="absolute -top-2 -right-2 w-7 h-7 rounded-lg bg-sun-orange text-white text-xs font-bold flex items-center justify-center shadow-lg">
                      {item.step}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{item.title}</h3>
                  <p className="text-sm text-black leading-relaxed max-w-xs mx-auto">{item.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="relative py-24">
        <div className="absolute inset-0 bg-radial-glow opacity-50" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass-card-scenic p-12 sm:p-16 border-sun-gold/20"
          >
            <h2 className="text-[2rem] sm:text-[2.75rem] font-black text-[#1a1a2e] mb-1 tracking-tighter leading-tight">
              Your next adventure awaits
            </h2>
            <h3 className="text-2xl sm:text-3xl font-bold text-gray-500 mb-8 tracking-tight">
              Free Your <span className="text-[#009CA6]">Mind</span>.
            </h3>
            <p className="text-xl text-gray-500 mb-10 max-w-2xl mx-auto font-medium">
              Let <span className="font-black text-white">FARE</span><span className="font-black text-[#009CA6]">MIND</span> search, rank, and personalize the best flight options for your journey.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/auth/signup"
                className="flex items-center gap-2 px-8 py-3.5 rounded-2xl text-sm font-black text-white btn-primary-coral transition-all"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href={`/search?origin=JFK&destination=LAX&date=${searchDate}&adults=1&cabin=economy&trip=one_way`}
                className="flex items-center gap-2 px-8 py-3.5 rounded-2xl text-sm font-bold text-slate-600 bg-white/40 border border-white/60 hover:bg-white/60 transition-all"
              >
                Try a Search
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
