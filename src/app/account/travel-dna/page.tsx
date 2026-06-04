'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Dna, Lock, Plane, Globe, Armchair, Luggage, Shield, Clock,
  Users, Calendar, TrendingUp, Sparkles, ArrowRight, Info,
  BarChart3, RefreshCw, Check, X, ToggleLeft, ToggleRight,
  HelpCircle, Save, ChevronRight, Lock as LockIcon, UtensilsCrossed,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useTravelDnaStore } from '@/store/useTravelDnaStore';

// ─── Category Icons ─────────────────────────────────────────────────────────

const CATEGORY_ICON: Record<string, React.ElementType> = {
  airline: Plane,
  connection_airport: Globe,
  cabin: Armchair,
  stops: TrendingUp,
  departure_time: Clock,
  seat: Armchair,
  baggage: Luggage,
  meal: UtensilsCrossed,
  insurance: Shield,
  price_protection: Shield,
  fare_flexibility: RefreshCw,
  travel_party: Users,
  booking_window: Calendar,
};

// ─── Confidence Badge ────────────────────────────────────────────────────────

function ConfidenceBadge({ label }: { label: string }) {
  const colorMap: Record<string, string> = {
    'High Confidence': 'bg-[#1ABC9C]/15 text-[#1ABC9C] border-[#1ABC9C]/30',
    'Medium Confidence': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    'Learning': 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  };
  const cls = colorMap[label] || colorMap['Learning'];
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>
      {label}
    </span>
  );
}

// ─── Progress Ring ──────────────────────────────────────────────────────────

function ProgressRing({ progress, size = 90 }: { progress: number; size?: number }) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.06)" strokeWidth="5" fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#1ABC9C"
          strokeWidth="5"
          fill="none"
          strokeLinecap="round"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          style={{ strokeDasharray: circumference }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-black text-white tabular-nums">{progress}%</span>
      </div>
    </div>
  );
}

// ─── Preference Row ─────────────────────────────────────────────────────────

function PreferenceRow({
  item,
  category,
  onAccurate,
  onNotMe,
  isPending,
}: {
  item: { id?: string; label: string; score: number; confidenceLabel: string; userValidated: boolean; rejectedByUser: boolean };
  category: string;
  onAccurate: () => void;
  onNotMe: () => void;
  isPending: boolean;
}) {
  const Icon = CATEGORY_ICON[category] || BarChart3;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-4 py-3 px-4 border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.02] transition-all"
    >
      {/* Left: Icon + Label */}
      <div className="flex items-center gap-3 min-w-[640px]">
        <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
          <Icon size={14} className="text-slate-400" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-white truncate">{item.label} Preferred</p>
            <span className="text-xs font-black text-[#1ABC9C] tabular-nums">{item.score}%</span>
          </div>
          <ConfidenceBadge label={item.confidenceLabel} />
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3 shrink-0">
        <button className="flex items-center gap-1 text-slate-500 hover:text-slate-300 transition-colors">
          <span className="text-[11px] font-medium">Why this?</span>
          <Info size={11} />
        </button>
        <button
          onClick={onAccurate}
          disabled={isPending}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
            item.userValidated
              ? 'bg-[#1ABC9C]/20 text-[#1ABC9C] border border-[#1ABC9C]/40'
              : 'bg-transparent text-[#1ABC9C] border border-[#1ABC9C]/30 hover:bg-[#1ABC9C]/10'
          }`}
        >
          <Check size={11} />
          Accurate
        </button>
        <button
          onClick={onNotMe}
          disabled={isPending}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-transparent text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-all"
        >
          <X size={11} />
          Not Me
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function TravelDnaPage() {
  const router = useRouter();
  const { user, sessionToken, loadSession } = useAuthStore();
  const { profile, loading, fetchProfile, submitFeedback, feedbackPending } = useTravelDnaStore();
  const [activeTab, setActiveTab] = useState<'domestic' | 'international'>('international');
  const [personalizationOn, setPersonalizationOn] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (user && sessionToken) {
      fetchProfile(sessionToken);
    }
  }, [user, sessionToken, fetchProfile]);

  // ── Not logged in ──────────────────────────────────────────────────────────

  if (!user) {
    return (
      <div className="py-20 text-center">
        <div className="max-w-md mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-[#1ABC9C]/20 to-[#1ABC9C]/5 border border-[#1ABC9C]/20 flex items-center justify-center mb-8 shadow-xl shadow-[#1ABC9C]/10">
              <Lock className="w-8 h-8 text-[#1ABC9C]" />
            </div>

            <h1 className="text-3xl font-black text-white mb-4 tracking-tight">
              Sign in to unlock your <span className="text-[#1ABC9C]">Travel DNA</span>
            </h1>
            <p className="text-slate-400 text-base max-w-md mx-auto mb-10 leading-relaxed">
              Travel DNA learns from your past bookings to personalize future flight recommendations.
            </p>

            <Link
              href="/auth/login?redirect=/account/travel-dna"
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white bg-[#1ABC9C] shadow-lg shadow-[#1ABC9C]/25 hover:brightness-110 transition-all"
            >
              Sign In to Start Learning
              <ArrowRight className="w-4 h-4" />
            </Link>

            <p className="mt-12 text-xs text-slate-600 max-w-sm mx-auto">
              Travel DNA is built from your confirmed bookings only. We do not use random searches or browsing behavior.
            </p>
          </motion.div>
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto mb-4">
            <Dna className="w-6 h-6 text-[#1ABC9C] animate-pulse" />
          </div>
          <p className="text-sm text-slate-400 font-medium">Analyzing your travel history...</p>
        </div>
      </div>
    );
  }

  // ── Feature disabled ──────────────────────────────────────────────────────

  if (!profile.enabled) {
    return (
      <div className="py-20 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-6">
          <Dna className="w-7 h-7 text-slate-500" />
        </div>
        <h1 className="text-2xl font-black text-white mb-3">My <span className="text-white">FARE</span><span style={{ color: '#009CA6' }}>MIND</span> DNA™ is currently unavailable</h1>
        <p className="text-slate-400 text-sm">Check back soon — we&apos;re working on personalized travel intelligence.</p>
      </div>
    );
  }

  // ── Profile Data ──────────────────────────────────────────────────────────

  const domesticProfile = profile.profiles.domestic;
  const intlProfile = profile.profiles.international;
  const activeProfile = activeTab === 'domestic' ? domesticProfile : intlProfile;

  const tabLabel = activeTab === 'domestic' ? 'Domestic' : 'International';
  const isActive = activeProfile?.status === 'ACTIVE';
  const confirmedCount = activeProfile?.confirmedBookingCount ?? 0;
  const requiredCount = activeProfile?.minBookingsRequired ??
    (activeTab === 'domestic' ? profile.domesticRequiredBookings : profile.internationalRequiredBookings);
  const confidenceScore = activeProfile?.confidenceScore ?? Math.min(100, Math.round((confirmedCount / requiredCount) * 100));
  const remainingBookings = Math.max(0, requiredCount - confirmedCount);

  // Flatten preferences for display — deduplicate by category+label
  const allPreferences: Array<{ category: string; item: typeof activeProfile extends undefined ? never : any }> = [];
  if (isActive && activeProfile?.preferences) {
    const seen = new Set<string>();
    for (const [cat, items] of Object.entries(activeProfile.preferences)) {
      for (const item of items) {
        const dedupKey = `${cat}:${item.label}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          allPreferences.push({ category: cat, item });
        }
      }
    }
    // Sort by score descending
    allPreferences.sort((a, b) => (b.item.score ?? 0) - (a.item.score ?? 0));
  }

  async function handleSavePreferences() {
    setSavingPrefs(true);
    // Slight delay to give visual feedback
    await new Promise(r => setTimeout(r, 600));
    setSavingPrefs(false);
    setPrefsSaved(true);
    setTimeout(() => setPrefsSaved(false), 3000);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="relative pt-6 pb-16">
      <div className="relative">
        {/* ─── Header ───────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl font-black text-white tracking-tight mb-1">
            My <span className="text-white">FARE</span><span style={{ color: '#009CA6' }}>MIND</span> DNA™
          </h1>
          <p className="text-base text-slate-400">
            {profile.message}
          </p>
        </motion.div>

        {/* ─── Tabs ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="flex border-b border-white/[0.06] mb-8"
        >
          {/* Domestic Tab */}
          <button
            onClick={() => setActiveTab('domestic')}
            className={`flex items-center gap-2.5 px-6 py-3.5 text-base font-bold transition-all border-b-2 -mb-px ${
              activeTab === 'domestic'
                ? 'text-[#1ABC9C] border-[#1ABC9C]'
                : 'text-slate-500 border-transparent hover:text-slate-300'
            }`}
          >
            <Plane size={18} />
            <div className="text-left">
              <p className="leading-none">Domestic DNA</p>
              <p className="text-xs font-normal mt-0.5 opacity-60">Your domestic travel preferences</p>
            </div>
          </button>

          {/* International Tab */}
          <button
            onClick={() => setActiveTab('international')}
            className={`flex items-center gap-2.5 px-6 py-3.5 text-base font-bold transition-all border-b-2 -mb-px ${
              activeTab === 'international'
                ? 'text-[#1ABC9C] border-[#1ABC9C]'
                : 'text-slate-500 border-transparent hover:text-slate-300'
            }`}
          >
            <Globe size={18} />
            <div className="text-left">
              <p className="leading-none">International DNA</p>
              <p className="text-xs font-normal mt-0.5 opacity-60">Your international travel preferences</p>
            </div>
          </button>
        </motion.div>

        {/* ─── Stats Cards ──────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-3 gap-4 mb-8"
        >
          {/* Confidence Score */}
          {profile.showConfidenceScore && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <p className="text-sm font-bold text-slate-400">Confidence Score</p>
                <Info size={12} className="text-slate-600" />
              </div>
              <div className="flex items-center gap-4">
                <ProgressRing progress={confidenceScore} size={80} />
                <p className="text-sm text-slate-500 leading-relaxed">
                  {confidenceScore >= 80
                    ? 'Your DNA is well established with every trip.'
                    : confidenceScore >= 50
                    ? 'Your DNA is getting stronger with every trip.'
                    : 'Your DNA is starting to form — keep booking!'}
                </p>
              </div>
            </div>
          )}

          {/* Bookings Required */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-sm font-bold text-slate-400">Bookings Required</p>
              <Info size={12} className="text-slate-600" />
            </div>
            <p className="text-3xl font-black text-[#009CA6] tabular-nums mb-1">{remainingBookings}</p>
            <p className="text-sm text-slate-500 leading-relaxed">
              {remainingBookings === 0
                ? 'Your DNA threshold has been met!'
                : `${remainingBookings} more confirmed booking${remainingBookings > 1 ? 's' : ''} to complete your DNA.`}
            </p>
          </div>

          {/* Personalization Toggle */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-sm font-bold text-slate-400">Personalization</p>
              <Info size={12} className="text-slate-600" />
            </div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                {personalizationOn ? 'ON' : 'OFF'}
              </span>
              <button onClick={() => setPersonalizationOn(!personalizationOn)}>
                {personalizationOn ? (
                  <ToggleRight size={32} className="text-[#1ABC9C]" />
                ) : (
                  <ToggleLeft size={32} className="text-slate-600" />
                )}
              </button>
            </div>
            <p className="text-sm text-slate-500 leading-relaxed">
              Use your DNA to personalize flight recommendations.
            </p>
          </div>
        </motion.div>

        {/* ─── LEARNING STATE ───────────────────────────────────── */}
        {!isActive && profile.showLearningState && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-gradient-to-r from-amber-500/[0.08] to-amber-600/[0.04] border border-amber-500/20 rounded-2xl py-3 px-4 mb-8"
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-white font-bold text-base mb-2">
                  FAREMIND DNA™ is still learning your {tabLabel.toLowerCase()} travel style.
                </h3>
                <p className="text-slate-400 text-sm mb-4 leading-relaxed">
                  You have completed <span className="text-white font-bold">{confirmedCount}</span> of{' '}
                  <span className="text-white font-bold">{requiredCount}</span> required confirmed bookings.
                  Once the requirement is met, your personalized preferences will appear here.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ─── ACTIVE STATE — Preferences List ──────────────────── */}
        {isActive && allPreferences.length > 0 && (
          <>
            {/* Section Header */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="flex items-start justify-between mb-4"
            >
              <div>
                <h2 className="text-lg font-black text-white mb-0.5">
                  What FareMind Has Learned About Your {tabLabel} Travel
                </h2>
                <p className="text-xs text-slate-500">
                  We&apos;ve identified these preferences from your confirmed {tabLabel.toLowerCase()} bookings.
                </p>
              </div>
              <p className="text-xs text-slate-500 mt-1 shrink-0">
                Review and validate your preferences.
              </p>
            </motion.div>

            {/* Preferences Table */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden"
            >
              {allPreferences.map(({ category, item }, i) => (
                <PreferenceRow
                  key={item.id || `${category}-${item.label}-${i}`}
                  item={item}
                  category={category}
                  isPending={feedbackPending.has(item.id || '')}
                  onAccurate={() => {
                    if (item.id) submitFeedback(item.id, 'accurate', sessionToken);
                  }}
                  onNotMe={() => {
                    if (item.id) submitFeedback(item.id, 'not_me', sessionToken);
                  }}
                />
              ))}
              {/* Save Bar — text left, button right, inside table */}
              <div className="flex items-center justify-between px-5 py-4 border-t border-white/[0.06] pr-[730px]">
                <p className="text-xs text-slate-400">
                  Your feedback helps us improve your DNA profile and provide better recommendations.
                </p>
                <button
                  onClick={handleSavePreferences}
                  disabled={savingPrefs}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all shrink-0 ml-4 ${
                    prefsSaved
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white shadow-lg shadow-[#1ABC9C]/20'
                  }`}
                >
                  {prefsSaved ? (
                    <><Check size={14} /> Saved</>
                  ) : savingPrefs ? (
                    <><RefreshCw size={14} className="animate-spin" /> Saving…</>
                  ) : (
                    <><Save size={14} /> Save Preferences</>
                  )}
                </button>
              </div>
            </motion.div>
          </>
        )}

        {/* No preferences yet (active but empty) */}
        {isActive && allPreferences.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-12 text-center mb-8"
          >
            <Dna className="w-10 h-10 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400 text-sm font-medium">
              Your {tabLabel.toLowerCase()} FAREMIND DNA™ is ready.
            </p>
            <p className="text-slate-600 text-xs mt-1">
              These preferences are learned from your confirmed bookings.
            </p>
          </motion.div>
        )}

        {/* ─── Privacy Footer ───────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex items-center justify-between bg-white/[0.02] border border-white/[0.04] rounded-2xl px-5 py-3.5"
        >
          <div className="flex items-center gap-2.5">
            <LockIcon size={14} className="text-slate-600" />
            <p className="text-xs text-slate-500">
              Your data is private and secure. We build FAREMIND DNA from your confirmed bookings only.
              Searches and browsing activity are not used in Phase 1.
            </p>
          </div>
          <Link href="#" className="flex items-center gap-1 text-[#1ABC9C] text-xs font-semibold shrink-0 hover:underline">
            Learn more about privacy <ArrowRight size={11} />
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
