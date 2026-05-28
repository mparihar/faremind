'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Send, X, Minus, ChevronRight, Check, Bot, Plane, ArrowRight, ArrowLeft } from 'lucide-react';
import { cn, formatDuration, formatPrice, getStopsLabel } from '@/lib/utils';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import AiBookFlightFlow from './ai-booking/AiBookFlightFlow';

// ── Types ──────────────────────────────────────────────────────────────────

interface TopFlightSummary {
  airline: string;
  airlineCode: string;
  departure: string;
  arrival: string;
  price: number;
  currency: string;
  stops: number;
  durationMinutes: number;
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
  ts: number;
}

export interface AIAssistResult {
  message: string;
  rankedIds: string[];
  reasoning: Record<string, string[]>;
  badges: Record<string, string>;
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
    departureDate: string;
  };
  onResult: (result: AIAssistResult | null) => void;
  result: AIAssistResult | null;
  focusedFlightId?: string | null;
  rtMetaMap?: Map<string, RtLegMeta>;
  roundTripOptions?: RoundTripOption[];
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
  flights, context, onResult, result, focusedFlightId, rtMetaMap, roundTripOptions,
}: FloatingAIAssistantProps) {
  const [isOpen,    setIsOpen]    = useState(false);
  const [messages,  setMessages]  = useState<ChatMessage[]>([]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [bookingMode, setBookingMode] = useState(false);
  const scrollRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLInputElement>(null);

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
      const topId = data.rankedIds?.[0];
      const topFlightRaw = topId ? flights.find(f => f.id === topId) : undefined;
      const rtMeta = topId ? rtMetaMap?.get(topId) : undefined;
      const topFlight: TopFlightSummary | undefined = topFlightRaw ? {
        airline:         topFlightRaw.airline.name,
        airlineCode:     topFlightRaw.airline.code,
        departure:       topFlightRaw.segments[0]?.departure.airport ?? '',
        arrival:         topFlightRaw.segments[topFlightRaw.segments.length - 1]?.arrival.airport ?? '',
        price:           topFlightRaw.totalPrice,
        currency:        topFlightRaw.currency,
        stops:           topFlightRaw.stops,
        durationMinutes: rtMeta?.outboundDurationMinutes ?? topFlightRaw.totalDuration,
        ...(rtMeta ? {
          returnDeparture:       rtMeta.returnDeparture,
          returnArrival:         rtMeta.returnArrival,
          returnDurationMinutes: rtMeta.returnDurationMinutes,
          returnStops:           rtMeta.returnStops,
        } : {}),
      } : undefined;
      const assistantMsg: ChatMessage = {
        id:               uid(),
        role:             'assistant',
        text:             data.message,
        bullets:          topId ? data.reasoning?.[topId]?.slice(0, 4) : undefined,
        intentCategories: data.intentCategories?.slice(0, 3),
        topFlight,
        ts:               Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (e: any) {
      const errMsg: ChatMessage = {
        id:   uid(),
        role: 'assistant',
        text: 'Unable to reach FareMind AI right now. Please try again.',
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
  }

  const isEmpty = messages.length === 0;

  return (
    // Fixed bottom-left container
    <div className="fixed bottom-14 left-56 z-50 flex flex-col items-start gap-3">

      {/* ── Expanded Chat Panel ──────────────────────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{   opacity: 0, scale: 0.94,  y: 12 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="w-[380px] max-sm:w-[calc(100vw-24px)] flex flex-col rounded-2xl overflow-hidden shadow-[0_12px_48px_rgba(13,148,136,0.18),0_2px_12px_rgba(0,0,0,0.10)] border border-teal-200/60"
            style={{ maxHeight: 580, background: '#ffffff' }}
          >

            {/* Co-Pilot accent bar */}
            <div className="h-1 w-full shrink-0" style={{ background: 'linear-gradient(90deg, #007a7c 0%, #009A9C 50%, #00b5b7 100%)' }} />

            {/* Header — hidden in booking mode (AiBookFlightFlow has its own) */}
            {!bookingMode && (
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 shrink-0 bg-white">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm shrink-0 relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #007a7c 0%, #009A9C 55%, #00b5b7 100%)' }}>
                <span className="absolute inset-0 opacity-30 blur-sm"
                  style={{ background: 'radial-gradient(circle at 30% 30%, #5eead4, transparent)' }} />
                <Bot className="w-4 h-4 text-white relative z-10" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-slate-800 font-bold text-[13px] leading-none">FareMind</p>
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
                  onClick={() => setIsOpen(false)}
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
                  onExit={() => setBookingMode(false)}
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
                    onClick={() => setBookingMode(true)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all bg-gradient-to-r from-[#1ABC9C] to-emerald-500 border-[#1ABC9C]/40 text-white shadow-md shadow-[#1ABC9C]/20 hover:shadow-lg hover:shadow-[#1ABC9C]/30"
                  >
                    ✈ Book a Flight
                  </motion.button>

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
                        {msg.topFlight && (
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
              <div className="flex items-center gap-2 bg-slate-50 rounded-xl border border-slate-200 px-3.5 py-2.5 focus-within:border-[#1ABC9C]/60 focus-within:bg-white focus-within:shadow-sm transition-all">
                <Sparkles className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input); } }}
                  placeholder="Describe your travel preference…"
                  disabled={loading}
                  className="flex-1 bg-transparent text-slate-700 text-[12px] placeholder-slate-400 outline-none min-w-0 disabled:opacity-50"
                />
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
              </div>
            </div>

              </>
          )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Trigger Button ───────────────────────────────────────────────── */}
      <div className="relative">

        {/* Outer glow pulse rings */}
        {!isOpen && (
          <>
            <motion.span
              animate={{ scale: [1, 1.55], opacity: [0.22, 0] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
              className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{ background: 'linear-gradient(135deg, #0d7a72, #14b8a6)' }}
            />
            <motion.span
              animate={{ scale: [1, 1.25], opacity: [0.15, 0] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut', delay: 0.6 }}
              className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{ background: 'linear-gradient(135deg, #0d7a72, #14b8a6)' }}
            />
          </>
        )}

        <motion.button
          onClick={() => setIsOpen(v => !v)}
          title="FareMind Co-Pilot"
          whileHover={{ scale: 1.05, y: -2 }}
          whileTap={{ scale: 0.96 }}
          className="relative flex items-center gap-0 h-12 rounded-2xl text-white overflow-hidden cursor-pointer select-none"
          style={isOpen
            ? { background: 'linear-gradient(135deg, #006e70 0%, #008284 100%)', boxShadow: 'none', border: '1px solid rgba(0,154,156,0.3)' }
            : { background: 'linear-gradient(135deg, #007a7c 0%, #009A9C 45%, #00b5b7 100%)', boxShadow: '0 6px 32px rgba(0,154,156,0.50), 0 2px 8px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,154,156,0.15)' }
          }
        >
          {/* Shimmer sweep */}
          {!isOpen && (
            <motion.span
              animate={{ x: ['-130%', '230%'] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.8 }}
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-[-20deg] pointer-events-none"
            />
          )}

          {/* Orb icon area */}
          <span className="relative flex items-center justify-center w-12 h-12 shrink-0">
            {/* Inner orb glow */}
            {!isOpen && (
              <span className="absolute w-8 h-8 rounded-full opacity-40 blur-md"
                style={{ background: 'radial-gradient(circle, #66e0d0, #009A9C)' }} />
            )}
            <AnimatePresence mode="wait">
              {isOpen ? (
                <motion.span key="x"
                  initial={{ rotate: -90, opacity: 0, scale: 0.7 }}
                  animate={{ rotate: 0, opacity: 1, scale: 1 }}
                  exit={{ rotate: 90, opacity: 0, scale: 0.7 }}
                  transition={{ duration: 0.2 }}
                  className="relative flex"
                >
                  <X className="w-4 h-4 text-violet-200" />
                </motion.span>
              ) : (
                <motion.span key="bot"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="relative flex"
                >
                  <motion.span
                    animate={{ y: [0, -1.5, 0] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Bot className="w-5 h-5 text-white drop-shadow-sm" />
                  </motion.span>
                </motion.span>
              )}
            </AnimatePresence>
          </span>

          {/* Divider */}
          <span className="w-px h-6 bg-white/20 shrink-0 -ml-2" />

          {/* Label */}
          <span className="px-4">
            <span className="text-[13px] font-black tracking-tight text-white whitespace-nowrap">
              {isOpen ? 'Close' : 'FareMind AI'}
            </span>
          </span>

          {/* Active result live dot */}
          {result && !isOpen && (
            <span className="pr-3 pl-0 flex items-center">
              <motion.span
                animate={{ scale: [1, 1.5, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="w-2 h-2 rounded-full bg-white shrink-0 shadow-lg"
              />
            </span>
          )}
        </motion.button>
      </div>

    </div>
  );
}
