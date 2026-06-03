'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, X, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UnifiedFlight } from '@/lib/types';

const SUGGESTION_CHIPS = [
  { label: 'Family Friendly',    query: 'Best flights for traveling with young children' },
  { label: 'Minimal Layovers',   query: 'Fewest stops or nonstop flights only' },
  { label: 'Cheapest Nonstop',   query: 'Cheapest nonstop flight available' },
  { label: 'Better Bags',        query: 'Flights with free checked baggage included' },
  { label: 'Comfortable Return', query: 'Comfortable flight with good legroom and meal' },
  { label: 'Reliable Airline',   query: 'Most reliable and on-time airlines' },
  { label: 'Elderly Parents',    query: 'Easy flight for elderly passengers, minimal walking' },
  { label: 'Short Connections',  query: 'Short layover times, quick connections' },
];

export interface AIAssistResult {
  summary: string;
  rankedIds: string[];
  reasoning: Record<string, string>;
}

interface AIAssistantBarProps {
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
}

export default function AIAssistantBar({ flights, context, onResult, result }: AIAssistantBarProps) {
  const [query, setQuery]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [expanded, setExpanded]     = useState(true);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (result === null) {
      setQuery('');
      setActiveChip(null);
    }
  }, [result]);

  async function submit(q: string) {
    if (!q.trim() || !flights.length) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/search-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, flights, context }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'AI request failed');
      }
      const data: AIAssistResult = await res.json();
      onResult(data);
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong');
      onResult(null);
    } finally {
      setLoading(false);
    }
  }

  function handleChip(chip: typeof SUGGESTION_CHIPS[0]) {
    setActiveChip(chip.label);
    setQuery(chip.query);
    submit(chip.query);
  }

  function handleClear() {
    setQuery('');
    setActiveChip(null);
    setError(null);
    onResult(null);
  }

  return (
    <div className="border-b border-gray-200 bg-gradient-to-r from-white via-[#f0fdf9] to-white relative z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        {/* Header row */}
        <div className="flex items-center gap-3 mb-2.5">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-[#1ABC9C] to-[#0e9e83] flex items-center justify-center shadow-sm">
              <Sparkles className="w-3 h-3 text-white" />
            </div>
            <span className="text-xs font-black text-slate-700 uppercase tracking-wider">FAREMIND AI</span>
          </div>
          <span className="text-[11px] text-slate-400 hidden sm:block">Ask anything about these flights</span>
          <button
            onClick={() => setExpanded(v => !v)}
            className="ml-auto p-1 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {expanded && (
          <>
            {/* Input row */}
            <div className="flex items-center gap-2 mb-2.5">
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit(query)}
                  placeholder="e.g. Best flight for a business trip, arrives before 9pm…"
                  disabled={loading}
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#1ABC9C] focus:ring-1 focus:ring-[#1ABC9C]/30 transition-all disabled:opacity-60"
                />
                {(query || result) && !loading && (
                  <button
                    onClick={handleClear}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                onClick={() => submit(query)}
                disabled={loading || !query.trim()}
                className={cn(
                  'shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all',
                  loading || !query.trim()
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-[#1ABC9C] text-white hover:brightness-105 shadow-sm shadow-[#1ABC9C]/20'
                )}
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">{loading ? 'Analyzing…' : 'Ask'}</span>
              </button>
            </div>

            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTION_CHIPS.map(chip => (
                <button
                  key={chip.label}
                  onClick={() => handleChip(chip)}
                  disabled={loading}
                  className={cn(
                    'px-3 py-1 rounded-full text-[11px] font-semibold border transition-all',
                    activeChip === chip.label && result
                      ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/40 text-[#1ABC9C]'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-[#1ABC9C]/40 hover:text-[#1ABC9C]',
                    loading && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Loading shimmer */}
            {loading && (
              <div className="mt-3 flex items-center gap-3">
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C] animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
                <span className="text-xs text-slate-500 italic">FAREMIND AI analyzing your preferences…</span>
              </div>
            )}

            {/* Summary result */}
            {result?.summary && !loading && (
              <div className="mt-2.5 flex items-start gap-2 bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-xl px-3.5 py-2.5">
                <Sparkles className="w-3.5 h-3.5 text-[#1ABC9C] mt-0.5 shrink-0" />
                <p className="text-xs text-slate-700 leading-relaxed">{result.summary}</p>
              </div>
            )}

            {/* Error */}
            {error && !loading && (
              <p className="mt-2 text-xs text-red-500">{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
