'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Send, X, Minus, ChevronRight, Check, Bot, Plane, ArrowRight, ArrowLeft, Mic, MicOff, MessageCircleQuestion } from 'lucide-react';
import { cn, formatDuration, formatPrice, getStopsLabel } from '@/lib/utils';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import type { DnaSearchResult, DnaRankedCard } from '@/lib/services/dna-search-service';
import { trackDnaEvent } from '@/lib/analytics/dna-search-analytics';
import AiBookFlightFlow from './ai-booking/AiBookFlightFlow';
import AiManageBookingFlow from './ai-booking/AiManageBookingFlow';
import AiContactSupportFlow from './ai-booking/AiContactSupportFlow';
import AiGeneralQueryFlow from './ai-booking/AiGeneralQueryFlow';
import { useAiBookingStore } from '@/store/useAiBookingStore';
import { useOfferSessionStore } from '@/store/useOfferSessionStore';
import { detectManageBookingIntent } from '@/lib/ai-manage-booking-utils';
import {
  isSpeechRecognitionSupported,
  startListening,
  stopListening,
  abortListening,
} from '@/services/speechRecognitionService';

// ── Types ──────────────────────────────────────────────────────────────────

interface TopFlightSummary {
  flightId: string;
  flightIndex: number;
  airline: string;
  airlineCode: string;
  departure: string;
  arrival: string;
  price: number;
  currency: string;
  stops: number;
  durationMinutes: number;
  badge?: string;
  reasons?: string[];
  // return leg (round trip only)
  returnDeparture?: string;
  returnArrival?: string;
  returnDurationMinutes?: number;
  returnStops?: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  bullets?: string[];
  intentCategories?: string[];
  topFlight?: TopFlightSummary;
  topFlights?: TopFlightSummary[];
  preferenceLabel?: string;
  ts: number;
  // 🧬 DNA Search
  dnaResults?: DnaRankedCard[];
  isDnaSearch?: boolean;
}

export interface AIAssistResult {
  message: string;
  rankedIds: string[];
  reasoning: Record<string, string[]>;
  badges: Record<string, string>;
  preferenceLabel?: string | null;
  profileId?: string | null;
  intentSummary?: string;
  intentCategories?: string[];
  reasoningFocus?: string[];
  source?: string;
}

interface RtLegMeta {
  outboundDurationMinutes: number;
  returnDeparture: string;
  returnArrival: string;
  returnDurationMinutes: number;
  returnStops: number;
}

interface FloatingAIAssistantProps {
  flights: UnifiedFlight[];
  context: {
    origin: string;
    destination: string;
    tripType: string;
    passengers: number;
    adults?: number;
    children?: number;
    infants?: number;
    departureDate: string;
  };
  onResult: (result: AIAssistResult | null) => void;
  result: AIAssistResult | null;
  focusedFlightId?: string | null;
  rtMetaMap?: Map<string, RtLegMeta>;
  roundTripOptions?: RoundTripOption[];
  onDnaSearch?: () => Promise<boolean>;
  dnaSearchResults?: DnaSearchResult | null;
}

// ── Suggestion chips ────────────────────────────────────────────────────────

const CHIPS = [
  { label: 'Best for family',          query: 'Best option for family travel with young children' },
  { label: 'Avoid stressful layovers', query: 'Fewest or most comfortable layovers' },
  { label: 'Cheapest nonstop + bags',  query: 'Cheapest nonstop with checked baggage included' },
  { label: 'Good for elderly parents', query: 'Easiest flight for elderly passengers, minimal walking' },
  { label: 'Comfortable overnight',    query: 'Best overnight flight for comfort and rest' },
  { label: 'Better baggage',           query: 'Most generous baggage allowance' },
  { label: 'Reliable airline',         query: 'Most on-time and reliable airline option' },
  { label: 'Short connections',        query: 'Quickest layovers and easiest connections' },
  { label: 'No overnight layovers',    query: 'Daytime connections only, no overnight layovers' },
];

// ── Helper ──────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2);
}

// ── Component ──────────────────────────────────────────────────────────────

export default function FloatingAIAssistant({
  flights, context, onResult, result, focusedFlightId, rtMetaMap, roundTripOptions, onDnaSearch, dnaSearchResults,
}: FloatingAIAssistantProps) {
  const [isOpen,    setIsOpen]    = useState(false);
  const [messages,  setMessages]  = useState<ChatMessage[]>([]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [bookingMode, setBookingMode] = useState(false);
  const [manageBookingMode, setManageBookingMode] = useState(false);
  const [manageBookingIntent, setManageBookingIntent] = useState<'cancel' | 'update_passenger' | 'manage' | null>(null);
  const [supportMode, setSupportMode] = useState(false);
  const [generalQueryMode, setGeneralQueryMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceSupported] = useState(() => typeof window !== 'undefined' && isSpeechRecognitionSupported());
  const scrollRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const aiBookingReset = useAiBookingStore((s) => s.reset);
  const offerSessionClear = useOfferSessionStore((s) => s.clearSession);

  // Detect agent mode for positioning
  const [isAgentMode, setIsAgentMode] = useState(false);
  useEffect(() => {
    try { setIsAgentMode(!!sessionStorage.getItem('agentBookingContext')); } catch {}
  }, []);

  /** Reset the AI booking flow — clears stale flight/fare/timer state */
  const resetBookingFlow = useCallback(() => {
    aiBookingReset();
    offerSessionClear();
  }, [aiBookingReset, offerSessionClear]);

  // ── Auto-reset when search results change (new search performed) ──────────
  const searchFingerprint = flights.slice(0, 5).map(f => f.id).join('|');
  const prevFingerprint = useRef(searchFingerprint);
  useEffect(() => {
    if (prevFingerprint.current !== searchFingerprint && prevFingerprint.current !== '') {
      // New search detected — clear chat history and reset AI filter
      setMessages([]);
      setActiveChip(null);
      setInput('');
      onResult(null);
    }
    prevFingerprint.current = searchFingerprint;
  }, [searchFingerprint, onResult]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  // Contextual reasoning when card is hovered (non-persisted, shown inline)
  const contextualReasoning = focusedFlightId && result?.reasoning?.[focusedFlightId]
    ? result.reasoning[focusedFlightId]
    : null;

  const submit = useCallback(async (q: string) => {
    if (!q.trim() || !flights.length || loading) return;

    // 🎧 Contact Support intent detection
    const supportPhrases = ['contact support', 'i need help', 'help me', 'support request', 'speak to support', 'talk to support', 'customer support', 'raise a ticket', 'create a ticket', '__CONTACT_SUPPORT__'];
    const isSupportIntent = supportPhrases.some(p => q.toLowerCase().includes(p)) || q === '__CONTACT_SUPPORT__';
    if (isSupportIntent) {
      setSupportMode(true);
      return;
    }

    // ❓ General Queries intent detection
    const queryPhrases = ['general query', 'general question', 'i have a question', 'ask a question', 'travel question', 'baggage question', 'visa question', 'transit question', 'what is', 'how does', 'can i', 'do i need', '__GENERAL_QUERY__'];
    const isQueryIntent = queryPhrases.some(p => q.toLowerCase().includes(p)) || q === '__GENERAL_QUERY__';
    if (isQueryIntent && !flights.length) {
      setGeneralQueryMode(true);
      return;
    }

    // ✈️ Manage Booking intent detection
    const mbIntent = detectManageBookingIntent(q);
    if (mbIntent) {
      setManageBookingIntent(mbIntent);
      setManageBookingMode(true);
      return;
    }

    // 🧬 DNA Search command detection
    const dnaCommands = ['dna search', 'dna matches', 'my dna', 'matching my dna', 'run dna', 'search using my dna', '__DNA_SEARCH__'];
    const isDnaCommand = dnaCommands.some(cmd => q.toLowerCase().includes(cmd)) || q === '__DNA_SEARCH__';

    if (isDnaCommand && onDnaSearch) {
      const userMsg: ChatMessage = {
        id: uid(), role: 'user', text: q === '__DNA_SEARCH__' ? '🧬 Run DNA Search' : q.trim(), ts: Date.now(),
      };
      setMessages(prev => [...prev.slice(-6), userMsg]);
      setInput('');
      setLoading(true);
      trackDnaEvent('dna_search_started', { source: 'chatbot' });

      try {
        const success = await onDnaSearch();
        if (success) {
          // DNA search succeeded — show analyzing message
          const assistantMsg: ChatMessage = {
            id: uid(),
            role: 'assistant',
            text: '🧬 Analyzing your Travel DNA profile against these flights...',
            isDnaSearch: true,
            ts: Date.now(),
          };
          setMessages(prev => [...prev, assistantMsg]);
        } else {
          // DNA search not eligible — user is being redirected to sign in by the parent handler
          const errMsg: ChatMessage = {
            id: uid(), role: 'assistant',
            text: '🔐 Redirecting you to sign in to activate your FareMind DNA...',
            ts: Date.now(),
          };
          setMessages([errMsg]);
          // Clear messages after 2s (redirect may happen before this)
          setTimeout(() => {
            setMessages([]);
            setActiveChip(null);
          }, 2000);
        }
      } catch (err) {
        // Network/unexpected error — show error then reset to main screen
        const reason = err instanceof Error ? err.message : 'Unable to run DNA Search right now.';
        const errMsg: ChatMessage = {
          id: uid(), role: 'assistant',
          text: `⚠️ ${reason}`,
          ts: Date.now(),
        };
        setMessages([errMsg]);
        setTimeout(() => {
          setMessages([]);
          setActiveChip(null);
        }, 3000);
      } finally {
        setLoading(false);
      }
      return;
    }

    const userMsg: ChatMessage = { id: uid(), role: 'user', text: q.trim(), ts: Date.now() };
    setMessages(prev => [...prev.slice(-6), userMsg]); // keep max 8 msgs
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/intent-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q.trim(), flights, context }),
      });
      const data: AIAssistResult & { error?: string } = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'AI error');

      onResult(data);

      // Build top 5 flight summaries
      const top5Ids = (data.rankedIds ?? []).slice(0, 5);
      const topFlights: TopFlightSummary[] = top5Ids
        .map(fId => {
          const flightIndex = flights.findIndex(f => f.id === fId);
          const flight = flightIndex >= 0 ? flights[flightIndex] : null;
          if (!flight) return null;
          const rtMeta = rtMetaMap?.get(fId);
          return {
            flightId:        fId,
            flightIndex,
            airline:         flight.airline.name,
            airlineCode:     flight.airline.code,
            departure:       flight.segments[0]?.departure.airport ?? '',
            arrival:         flight.segments[flight.segments.length - 1]?.arrival.airport ?? '',
            price:           flight.totalPrice,
            currency:        flight.currency,
            stops:           flight.stops,
            durationMinutes: rtMeta?.outboundDurationMinutes ?? flight.totalDuration,
            badge:           data.badges?.[fId],
            reasons:         data.reasoning?.[fId]?.slice(0, 3),
            ...(rtMeta ? {
              returnDeparture:       rtMeta.returnDeparture,
              returnArrival:         rtMeta.returnArrival,
              returnDurationMinutes: rtMeta.returnDurationMinutes,
              returnStops:           rtMeta.returnStops,
            } : {}),
          } as TopFlightSummary;
        })
        .filter(Boolean) as TopFlightSummary[];

      const assistantMsg: ChatMessage = {
        id:               uid(),
        role:             'assistant',
        text:             data.message,
        bullets:          topFlights.length > 0 ? undefined : (top5Ids[0] ? data.reasoning?.[top5Ids[0]]?.slice(0, 4) : undefined),
        intentCategories: data.intentCategories?.slice(0, 3),
        topFlights:       topFlights.length > 0 ? topFlights : undefined,
        topFlight:        topFlights[0], // backward compat
        preferenceLabel:  data.preferenceLabel ?? undefined,
        ts:               Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (e: any) {
      const errMsg: ChatMessage = {
        id:   uid(),
        role: 'assistant',
        text: 'Unable to reach FAREMIND AI right now. Please try again.',
        ts:   Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }, [flights, context, onResult, loading]);

  function handleChip(chip: typeof CHIPS[0]) {
    setActiveChip(chip.label);
    setInput(chip.query);
    submit(chip.query);
  }

  function handleClear() {
    setMessages([]);
    setActiveChip(null);
    setInput('');
    onResult(null);
    // Also reset booking flow if it was active
    if (bookingMode) {
      setBookingMode(false);
      resetBookingFlow();
    }
    // Reset manage-booking flow if it was active
    if (manageBookingMode) {
      setManageBookingMode(false);
      setManageBookingIntent(null);
    }
    // Reset support flow if it was active
    if (supportMode) {
      setSupportMode(false);
    }
    // Reset general query flow if it was active
    if (generalQueryMode) {
      setGeneralQueryMode(false);
    }
  }

  /** User selects a flight from the top 5 AI recommendations → enter booking mode */
  function handleBookFromRecommendation(flightIndex: number) {
    resetBookingFlow(); // Ensure fresh start
    setBookingMode(true);
    // The AiBookFlightFlow will show flights and the user can tap the one at this index.
    // We use a tiny delay so the booking flow mounts first, then auto-select.
    setTimeout(() => {
      // Dispatch a custom event the booking flow can pick up
      window.dispatchEvent(new CustomEvent('ai-auto-select-flight', { detail: { flightIndex } }));
    }, 300);
  }

  /** Toggle voice recording for the chatbot input */
  async function handleMicToggle() {
    if (isRecording) {
      stopListening();
      setIsRecording(false);
      return;
    }

    setIsRecording(true);
    try {
      const result = await startListening((interim) => {
        setInput(interim);
      });
      setIsRecording(false);
      if (result.transcript.trim()) {
        setInput(result.transcript.trim());
        submit(result.transcript.trim());
      }
    } catch {
      setIsRecording(false);
    }
  }

  // Clean up recording if panel closes
  useEffect(() => {
    if (!isOpen && isRecording) {
      abortListening();
      setIsRecording(false);
    }
  }, [isOpen, isRecording]);

  const isEmpty = messages.length === 0;

  return (
    // Fixed bottom-left container
    <div className="fixed z-50 flex flex-col items-start gap-3 bottom-4 sm:bottom-6 left-4 sm:left-6">

      {/* ── Expanded Chat Panel ──────────────────────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{   opacity: 0, scale: 0.94,  y: 12 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="w-[calc(100vw-2rem)] sm:w-[420px] md:w-[440px] max-sm:fixed max-sm:inset-2 max-sm:w-auto flex flex-col rounded-2xl overflow-hidden shadow-[0_12px_48px_rgba(13,148,136,0.18),0_2px_12px_rgba(0,0,0,0.10)] border border-teal-200/60"
            style={{ minHeight: 'min(580px, calc(100dvh - 6rem))', maxHeight: 'min(750px, calc(100dvh - 4rem))', background: '#ffffff' }}
          >

            {/* Co-Pilot accent bar */}
            <div className="h-1 w-full shrink-0" style={{ background: 'linear-gradient(90deg, #007a7c 0%, #009A9C 50%, #00b5b7 100%)' }} />

            {/* Header — hidden in booking/manage-booking/support mode (they have their own) */}
            {!bookingMode && !manageBookingMode && !supportMode && !generalQueryMode && (
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 shrink-0 bg-white">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm shrink-0 relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #007a7c 0%, #009A9C 55%, #00b5b7 100%)' }}>
                <span className="absolute inset-0 opacity-30 blur-sm"
                  style={{ background: 'radial-gradient(circle at 30% 30%, #5eead4, transparent)' }} />
                <Bot className="w-4 h-4 text-white relative z-10" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-slate-800 font-bold text-[13px] leading-none">FARE<span style={{ color: '#009CA6' }}>MIND</span></p>
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider text-white"
                    style={{ background: 'linear-gradient(90deg, #007a7c, #009A9C)' }}>AI</span>
                </div>
                <p className="text-slate-400 text-[11px] font-medium mt-0.5 truncate">
                  {loading ? 'Analyzing your preferences…' : 'Your intelligent travel consultant'}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {messages.length > 0 && (
                  <button
                    onClick={handleClear}
                    title="Clear chat and reset flight cards"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-red-500 hover:bg-red-50 border border-slate-200 hover:border-red-200 transition-all"
                  >
                    <Minus className="w-3 h-3" />
                    Clear
                  </button>
                )}
                <button
                  onClick={() => {
                    if (bookingMode) {
                      setBookingMode(false);
                      resetBookingFlow();
                    }
                    if (manageBookingMode) {
                      setManageBookingMode(false);
                      setManageBookingIntent(null);
                    }
                    if (supportMode) {
                      setSupportMode(false);
                    }
                    if (generalQueryMode) {
                      setGeneralQueryMode(false);
                    }
                    setIsOpen(false);
                  }}
                  title="Close"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            )}

            {/* ── Booking Mode ── */}
            {bookingMode ? (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #f0fdfb 0%, #f8fffe 100%)' }}>
                <AiBookFlightFlow
                  flights={flights}
                  roundTripOptions={roundTripOptions}
                  searchPassengers={context.passengers}
                  searchAdults={context.adults}
                  searchChildren={context.children}
                  searchInfants={context.infants}
                  onExit={() => {
                    setBookingMode(false);
                    resetBookingFlow();
                  }}
                />
              </div>
            ) : manageBookingMode ? (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #f0fdfb 0%, #f8fffe 100%)' }}>
                <AiManageBookingFlow
                  preselectedAction={manageBookingIntent}
                  onExit={() => {
                    setManageBookingMode(false);
                    setManageBookingIntent(null);
                  }}
                />
              </div>
            ) : supportMode ? (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #f0fdfb 0%, #f8fffe 100%)' }}>
                <AiContactSupportFlow
                  onExit={() => setSupportMode(false)}
                />
              </div>
            ) : generalQueryMode ? (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <AiGeneralQueryFlow
                  onExit={() => setGeneralQueryMode(false)}
                  onContactSupport={() => {
                    setGeneralQueryMode(false);
                    setSupportMode(true);
                  }}
                />
              </div>
            ) : (
              <>

            {/* Scrollable body */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0"
              style={{ background: 'linear-gradient(180deg, #f0fdfb 0%, #f8fffe 100%)', scrollbarWidth: 'none' }}
            >

              {/* Active AI filter banner */}
              <AnimatePresence>
                {result && !isEmpty && (
                  <motion.div
                    key="filter-active"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/30"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <motion.span
                        animate={{ scale: [1, 1.3, 1], opacity: [0.7, 1, 0.7] }}
                        transition={{ duration: 1.8, repeat: Infinity }}
                        className="w-2 h-2 rounded-full bg-[#1ABC9C] shrink-0"
                      />
                      <span className="text-[11px] font-semibold text-[#0e9e83] truncate">AI filter active on flight cards</span>
                    </div>
                    <button
                      onClick={handleClear}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-red-500 hover:bg-red-50 border border-red-200 transition-all"
                    >
                      <X className="w-3 h-3" />
                      Reset
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Welcome / empty state */}
              {isEmpty && !loading && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 }}
                  className="text-center pt-2 pb-1"
                >
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center mx-auto mb-3 relative overflow-hidden shadow-sm"
                    style={{ background: 'linear-gradient(135deg, #007a7c 0%, #009A9C 50%, #00b5b7 100%)' }}>
                    <span className="absolute inset-0 opacity-25 blur-sm"
                      style={{ background: 'radial-gradient(circle at 30% 30%, #5eead4, transparent)' }} />
                    <Bot className="w-5 h-5 text-white relative z-10" />
                  </div>
                  <p className="text-slate-700 font-bold text-[13px] mb-1">What matters most for your trip?</p>
                  <p className="text-slate-400 text-[11px]">Pick a suggestion or type your own below</p>
                </motion.div>
              )}

              {/* Suggestion chips — shown only on empty state */}
              {isEmpty && !loading && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  className="flex flex-wrap gap-1.5 justify-center pb-1"
                >
                  {/* ✈ Book a Flight — special action chip */}
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      resetBookingFlow(); // Ensure fresh start every time
                      setBookingMode(true);
                    }}
                    className="px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all bg-gradient-to-r from-[#1ABC9C] to-emerald-500 border-[#1ABC9C]/40 text-white shadow-md shadow-[#1ABC9C]/20 hover:shadow-lg hover:shadow-[#1ABC9C]/30"
                  >
                    ✈ Book a Flight
                  </motion.button>

                  {/* ✈️ Manage Booking — special action chip */}
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      setManageBookingIntent('manage');
                      setManageBookingMode(true);
                    }}
                    className="px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all bg-gradient-to-r from-teal-500 to-cyan-600 border-teal-400/40 text-white shadow-md shadow-teal-500/20 hover:shadow-lg hover:shadow-teal-500/30"
                  >
                    📋 Manage Booking
                  </motion.button>

                  {/* 🧬 DNA Search — special action chip (hidden for agents) */}
                  {onDnaSearch && !isAgentMode && (
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleChip({ label: '🧬 DNA Search', query: '__DNA_SEARCH__' })}
                      className="px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all bg-gradient-to-r from-emerald-500 to-teal-600 border-emerald-400/40 text-white shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/30"
                    >
                      🧬 DNA Search
                    </motion.button>
                  )}

                  {CHIPS.map(chip => (
                    <motion.button
                      key={chip.label}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleChip(chip)}
                      style={activeChip === chip.label ? { background: 'linear-gradient(135deg, #1d4ed8, #7c3aed, #c026d3)' } : {}}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all',
                        activeChip === chip.label
                          ? 'border-teal-400 text-white shadow-sm'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-teal-400 hover:text-teal-700 hover:bg-teal-50/60 shadow-sm',
                      )}
                    >
                      {chip.label}
                    </motion.button>
                  ))}

                  {/* 🎧 Contact Support */}
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setSupportMode(true)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all bg-gradient-to-r from-[#009CA6] to-[#007a7c] border-[#009CA6]/40 text-white shadow-md shadow-[#009CA6]/20 hover:shadow-lg hover:shadow-[#009CA6]/30"
                  >
                    🎧 Contact Support
                  </motion.button>

                  {/* ❓ General Queries — at the end of all options */}
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setGeneralQueryMode(true)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all bg-gradient-to-r from-violet-500 to-indigo-600 border-violet-400/40 text-white shadow-md shadow-violet-500/20 hover:shadow-lg hover:shadow-violet-500/30"
                  >
                    <MessageCircleQuestion className="w-3.5 h-3.5 inline-block -mt-px" /> General Queries
                  </motion.button>
                </motion.div>
              )}

              {/* Chat messages */}
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  {msg.role === 'user' ? (
                    <div className="max-w-[78%] px-3.5 py-2.5 rounded-2xl rounded-tr-sm bg-gradient-to-br from-[#1ABC9C] to-[#0e9e83] text-white text-[12px] font-medium leading-relaxed shadow-sm">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="max-w-[92%] space-y-1.5">
                      <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-white border border-slate-200 text-slate-700 text-[12px] leading-relaxed shadow-sm">
                        <div className="flex items-start gap-2 mb-1">
                          <Sparkles className="w-3 h-3 text-[#1ABC9C] shrink-0 mt-0.5" />
                          <p className="text-slate-700">{msg.text}</p>
                        </div>
                        {msg.bullets && msg.bullets.length > 0 && (
                          <div className="space-y-1.5 mt-2.5 pt-2.5 border-t border-slate-100">
                            {msg.bullets.map((b, i) => (
                              <div key={i} className="flex items-start gap-2">
                                <Check className="w-3 h-3 text-[#1ABC9C] shrink-0 mt-0.5" />
                                <span className="text-[11px] text-slate-600 leading-relaxed">{b}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {msg.topFlight && !msg.topFlights && (
                          <div className="mt-2.5 pt-2.5 border-t border-slate-100">
                            <p className="text-[9px] font-black uppercase tracking-widest text-[#1ABC9C] mb-1.5">Top recommendation</p>
                            <div className="px-3 py-2.5 rounded-xl bg-gradient-to-r from-[#1ABC9C]/8 to-[#1ABC9C]/4 border border-[#1ABC9C]/25 space-y-2">
                              {/* Airline + price header */}
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <div className="w-5 h-5 rounded-md bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-sm">
                                    <Plane className="w-2.5 h-2.5 text-[#1ABC9C]" />
                                  </div>
                                  <p className="text-[11px] font-bold text-slate-800 truncate">{msg.topFlight.airline}</p>
                                </div>
                                <p className="text-[13px] font-black text-[#F97316] shrink-0">
                                  {formatPrice(msg.topFlight.price, msg.topFlight.currency)}
                                  {msg.topFlight.returnDeparture && <span className="text-[9px] font-semibold text-slate-400 ml-1">RT</span>}
                                </p>
                              </div>
                              {/* Outbound leg */}
                              <div className="flex items-center gap-1.5 text-[10px]">
                                <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
                                <span className="font-semibold text-slate-700">{msg.topFlight.departure} → {msg.topFlight.arrival}</span>
                                <span className="ml-auto text-slate-400 shrink-0">{getStopsLabel(msg.topFlight.stops)} · {formatDuration(msg.topFlight.durationMinutes)}</span>
                              </div>
                              {/* Return leg (round trip only) */}
                              {msg.topFlight.returnDeparture && (
                                <div className="flex items-center gap-1.5 text-[10px]">
                                  <ArrowLeft className="w-3 h-3 text-[#1ABC9C] shrink-0" />
                                  <span className="font-semibold text-slate-700">{msg.topFlight.returnDeparture} → {msg.topFlight.returnArrival}</span>
                                  <span className="ml-auto text-slate-400 shrink-0">{getStopsLabel(msg.topFlight.returnStops ?? 0)} · {formatDuration(msg.topFlight.returnDurationMinutes ?? 0)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {msg.intentCategories && msg.intentCategories.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2.5 pt-2 border-t border-slate-100">
                            {msg.intentCategories.map((cat) => (
                              <span
                                key={cat}
                                className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#1ABC9C]/10 text-[#0e9e83] border border-[#1ABC9C]/25 capitalize"
                              >
                                {cat.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Top 5 Recommendations — selectable cards */}
                      {msg.topFlights && msg.topFlights.length > 0 && (
                        <div className="space-y-1.5 mt-1.5">
                          <p className="text-[9px] font-black uppercase tracking-widest text-[#1ABC9C] px-1">
                            Top {msg.topFlights.length} for {msg.preferenceLabel || 'Your Preference'} — tap to book
                          </p>
                          {msg.topFlights.map((tf, idx) => (
                            <motion.button
                              key={tf.flightId}
                              whileHover={{ scale: 1.01 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => handleBookFromRecommendation(tf.flightIndex)}
                              className={cn(
                                'w-full text-left px-3 py-2.5 rounded-xl border transition-all group cursor-pointer',
                                idx === 0
                                  ? 'bg-gradient-to-r from-[#1ABC9C]/10 to-[#1ABC9C]/5 border-[#1ABC9C]/30 shadow-sm'
                                  : 'bg-white border-slate-200 hover:border-[#1ABC9C]/40 hover:bg-[#1ABC9C]/5'
                              )}
                            >
                              {/* Rank + Airline + Price */}
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className={cn(
                                    'w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black shrink-0',
                                    idx === 0
                                      ? 'bg-[#1ABC9C] text-white'
                                      : 'bg-slate-100 text-slate-500'
                                  )}>{idx + 1}</span>
                                  <p className="text-[11px] font-bold text-slate-800 truncate">{tf.airline}</p>
                                  {tf.badge && (
                                    <span className="px-1.5 py-0.5 rounded-md text-[8px] font-bold uppercase tracking-wider bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/20 shrink-0">
                                      {tf.badge}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[12px] font-black text-[#F97316] shrink-0">
                                  {formatPrice(tf.price, tf.currency)}
                                  {tf.returnDeparture && <span className="text-[8px] font-semibold text-slate-400 ml-0.5">RT</span>}
                                </p>
                              </div>
                              {/* Route + Duration */}
                              <div className="flex items-center gap-1.5 text-[10px]">
                                <ArrowRight className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                                <span className="font-semibold text-slate-600">{tf.departure} → {tf.arrival}</span>
                                <span className="ml-auto text-slate-400 shrink-0">{getStopsLabel(tf.stops)} · {formatDuration(tf.durationMinutes)}</span>
                              </div>
                              {/* Return leg */}
                              {tf.returnDeparture && (
                                <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
                                  <ArrowLeft className="w-2.5 h-2.5 text-[#1ABC9C] shrink-0" />
                                  <span className="font-semibold text-slate-600">{tf.returnDeparture} → {tf.returnArrival}</span>
                                  <span className="ml-auto text-slate-400 shrink-0">{getStopsLabel(tf.returnStops ?? 0)} · {formatDuration(tf.returnDurationMinutes ?? 0)}</span>
                                </div>
                              )}
                              {/* AI reasons */}
                              {tf.reasons && tf.reasons.length > 0 && (
                                <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5 pt-1 border-t border-slate-100">
                                  {tf.reasons.map((r, ri) => (
                                    <div key={ri} className="flex items-start gap-1">
                                      <Check className="w-2.5 h-2.5 text-[#1ABC9C] shrink-0 mt-0.5" />
                                      <span className="text-[9px] text-slate-500 leading-snug">{r}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </motion.button>
                          ))}
                        </div>
                      )}

                      {/* 🧬 DNA Search Results — show top 5 DNA matches */}
                      {msg.isDnaSearch && dnaSearchResults?.results && dnaSearchResults.results.length > 0 && (
                        <div className="space-y-1.5 mt-1.5">
                          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 px-1">
                            🧬 Top {Math.min(5, dnaSearchResults.results.length)} DNA Matches
                          </p>
                          {dnaSearchResults.results.slice(0, 5).map((dr, idx) => {
                            const flight = flights.find(f => f.id === dr.cardId);
                            if (!flight) return null;
                            return (
                              <motion.div
                                key={dr.cardId}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: idx * 0.08 }}
                                className={cn(
                                  'w-full text-left px-3 py-2.5 rounded-xl border transition-all',
                                  idx === 0
                                    ? 'bg-gradient-to-r from-emerald-500/10 to-emerald-500/5 border-emerald-400/30 shadow-sm'
                                    : 'bg-white border-slate-200'
                                )}
                              >
                                {/* Rank + Airline + DNA Score */}
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className={cn(
                                      'w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black shrink-0',
                                      idx === 0 ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'
                                    )}>{idx + 1}</span>
                                    <p className="text-[11px] font-bold text-slate-800 truncate">{flight.airline.name}</p>
                                    <span className={cn(
                                      'px-1.5 py-0.5 rounded-md text-[8px] font-bold uppercase tracking-wider shrink-0',
                                      dr.dnaScore >= 90
                                        ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-400/20'
                                        : dr.dnaScore >= 80
                                          ? 'bg-teal-500/15 text-teal-600 border border-teal-400/20'
                                          : 'bg-slate-100 text-slate-500 border border-slate-200'
                                    )}>
                                      🧬 {dr.dnaScore >= 90 ? 'Excellent Match' : dr.dnaScore >= 80 ? 'Strong Match' : 'Match'}
                                    </span>
                                  </div>
                                  <p className="text-[12px] font-black text-[#F97316] shrink-0">
                                    {formatPrice(flight.totalPrice, flight.currency)}
                                  </p>
                                </div>
                                {/* DNA Match Reasons */}
                                {dr.matchReasons.length > 0 && (
                                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 pt-1 border-t border-slate-100">
                                    {dr.matchReasons.slice(0, 3).map((r, ri) => (
                                      <div key={ri} className="flex items-start gap-1">
                                        <Check className="w-2.5 h-2.5 text-emerald-500 shrink-0 mt-0.5" />
                                        <span className="text-[9px] text-slate-500 leading-snug">{r}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </motion.div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}

              {/* Loading typing indicator */}
              {loading && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-start"
                >
                  <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-white border border-slate-200 flex items-center gap-2 shadow-sm">
                    <Sparkles className="w-3 h-3 text-[#1ABC9C]" />
                    <div className="flex items-center gap-1">
                      {[0, 1, 2].map(i => (
                        <motion.span
                          key={i}
                          animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.2 }}
                          className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C] inline-block"
                        />
                      ))}
                    </div>
                    <span className="text-[11px] text-slate-400 italic">Analyzing…</span>
                  </div>
                </motion.div>
              )}

              {/* Contextual card insight */}
              <AnimatePresence>
                {contextualReasoning && result && !loading && (
                  <motion.div
                    key="contextual"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className="px-3.5 py-2.5 rounded-xl bg-[#1ABC9C]/8 border border-[#1ABC9C]/25 space-y-1"
                  >
                    {contextualReasoning!.map((reason, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <ChevronRight className="w-3 h-3 text-[#1ABC9C] shrink-0 mt-0.5" />
                        <span className="text-[11px] text-[#0e9e83] leading-relaxed font-medium">{reason}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Input row */}
            <div className="px-4 pb-4 pt-3 border-t border-slate-100 shrink-0 bg-white">
              {/* Recording indicator */}
              <AnimatePresence>
                {isRecording && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-red-50 border border-red-200"
                  >
                    <motion.span
                      animate={{ scale: [1, 1.4, 1], opacity: [0.6, 1, 0.6] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                      className="w-2 h-2 rounded-full bg-red-500 shrink-0"
                    />
                    <span className="text-[11px] font-semibold text-red-600">Listening… tap mic to stop</span>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="flex items-center gap-2 bg-slate-50 rounded-xl border border-slate-200 px-3.5 py-2.5 focus-within:border-[#1ABC9C]/60 focus-within:bg-white focus-within:shadow-sm transition-all">
                <Sparkles className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input); } }}
                  placeholder={isRecording ? 'Listening…' : 'Describe your travel preference…'}
                  disabled={loading}
                  className="flex-1 bg-transparent text-slate-700 text-[12px] placeholder-slate-400 outline-none min-w-0 disabled:opacity-50"
                />
                {/* Send button */}
                <motion.button
                  whileHover={!loading && input.trim() ? { scale: 1.1 } : {}}
                  whileTap={!loading && input.trim() ? { scale: 0.92 } : {}}
                  onClick={() => submit(input)}
                  disabled={loading || !input.trim()}
                  className={cn(
                    'shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all',
                    loading || !input.trim()
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-gradient-to-br from-[#1ABC9C] to-[#0e9e83] text-white shadow-md shadow-[#1ABC9C]/25 cursor-pointer',
                  )}
                >
                  {loading
                    ? <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin inline-block" />
                    : <Send className="w-3 h-3" />
                  }
                </motion.button>
                {/* Voice mic button — same animated icon as hero Travel Assistant */}
                {voiceSupported && (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.92 }}
                    onClick={handleMicToggle}
                    disabled={loading}
                    title={isRecording ? 'Stop recording' : 'Voice input'}
                    className={cn(
                      'shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all relative',
                      isRecording
                        ? 'text-red-500 ring-2 ring-red-400/40 bg-red-50'
                        : loading
                          ? 'text-slate-300 cursor-not-allowed'
                          : 'text-slate-400 hover:text-[#1ABC9C] cursor-pointer',
                    )}
                  >
                    {isRecording ? (
                      <Mic className="w-5 h-5 animate-pulse" />
                    ) : (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="relative z-10">
                        <rect x="3" y="9" width="2" height="6" rx="1" fill="currentColor">
                          <animate attributeName="height" values="6;10;6" dur="1.2s" repeatCount="indefinite" />
                          <animate attributeName="y" values="9;7;9" dur="1.2s" repeatCount="indefinite" />
                        </rect>
                        <rect x="7.5" y="7" width="2" height="10" rx="1" fill="currentColor">
                          <animate attributeName="height" values="10;4;10" dur="0.9s" repeatCount="indefinite" />
                          <animate attributeName="y" values="7;10;7" dur="0.9s" repeatCount="indefinite" />
                        </rect>
                        <rect x="12" y="5" width="2" height="14" rx="1" fill="currentColor">
                          <animate attributeName="height" values="14;6;14" dur="1.1s" repeatCount="indefinite" />
                          <animate attributeName="y" values="5;9;5" dur="1.1s" repeatCount="indefinite" />
                        </rect>
                        <rect x="16.5" y="8" width="2" height="8" rx="1" fill="currentColor">
                          <animate attributeName="height" values="8;14;8" dur="1.4s" repeatCount="indefinite" />
                          <animate attributeName="y" values="8;5;8" dur="1.4s" repeatCount="indefinite" />
                        </rect>
                        <rect x="21" y="10" width="2" height="4" rx="1" fill="currentColor">
                          <animate attributeName="height" values="4;10;4" dur="0.8s" repeatCount="indefinite" />
                          <animate attributeName="y" values="10;7;10" dur="0.8s" repeatCount="indefinite" />
                        </rect>
                      </svg>
                    )}
                  </motion.button>
                )}
              </div>
            </div>

              </>
          )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Trigger Button — unified teal style ───────────────────────── */}
      <div className="relative">
        <AnimatePresence>
          {!isOpen && (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              whileHover={{ scale: 1.05, y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setIsOpen(true)}
              className="relative flex items-center gap-2.5 h-11 pl-3 pr-4 rounded-2xl text-white overflow-visible cursor-pointer select-none backdrop-blur-xl"
              style={{
                background: 'linear-gradient(135deg, rgba(10,20,35,0.85) 0%, rgba(15,25,45,0.90) 100%)',
                border: '1px solid rgba(0,180,190,0.35)',
                boxShadow: '0 0 24px rgba(0,180,190,0.20), 0 4px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
              }}
              title="FareMind AI Assistant"
            >
              {/* Outer glow pulse */}
              <span className="absolute -inset-[2px] rounded-2xl pointer-events-none"
                style={{ animation: 'aiGlowPulse 3s ease-in-out infinite', boxShadow: '0 0 18px rgba(0,180,190,0.30), 0 0 36px rgba(0,180,190,0.12)' }} />

              {/* Shimmer sweep */}
              <motion.span
                animate={{ x: ['-130%', '230%'] }}
                transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', repeatDelay: 2.5 }}
                className="absolute inset-0 rounded-2xl bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[-20deg] pointer-events-none"
              />

              {/* Icon with teal glow */}
              <span className="relative flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
                style={{ background: 'linear-gradient(135deg, #009CA6 0%, #00b8b8 100%)' }}>
                <motion.span
                  animate={{ y: [0, -1, 0] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="relative flex"
                >
                  <Bot className="w-3.5 h-3.5 text-white" />
                </motion.span>
              </span>

              {/* Label */}
              <span className="text-[12px] font-extrabold tracking-wide whitespace-nowrap">
                <span className="text-white">FARE</span><span style={{ color: '#2ee8d6' }}>MIND</span>
                <span className="text-white/50 ml-1 font-semibold text-[10px]">AI</span>
              </span>

              {/* Active result live dot */}
              {result && (
                <motion.span
                  animate={{ scale: [1, 1.5, 1], opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                  className="w-2 h-2 rounded-full bg-[#2ee8d6] shrink-0 ml-1"
                />
              )}
            </motion.button>
          )}
        </AnimatePresence>

        {/* Close button when panel is open */}
        <AnimatePresence>
          {isOpen && (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              whileHover={{ scale: 1.05, y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                if (bookingMode) { setBookingMode(false); resetBookingFlow(); }
                if (manageBookingMode) { setManageBookingMode(false); setManageBookingIntent(null); }
                if (supportMode) { setSupportMode(false); }
                setIsOpen(false);
              }}
              className="relative flex items-center gap-2.5 h-11 pl-3 pr-4 rounded-2xl text-white overflow-visible cursor-pointer select-none backdrop-blur-xl"
              style={{
                background: 'linear-gradient(135deg, rgba(10,20,35,0.85) 0%, rgba(15,25,45,0.90) 100%)',
                border: '1px solid rgba(0,180,190,0.35)',
                boxShadow: '0 0 24px rgba(0,180,190,0.20), 0 4px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
              }}
              title="Close AI Assistant"
            >
              <span className="relative flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
                style={{ background: 'linear-gradient(135deg, #009CA6 0%, #00b8b8 100%)' }}>
                <X className="w-3.5 h-3.5 text-white" />
              </span>
              <span className="text-[12px] font-extrabold tracking-wide whitespace-nowrap text-white/70">Close</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
