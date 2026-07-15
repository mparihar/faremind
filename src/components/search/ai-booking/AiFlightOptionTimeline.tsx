// ═══════════════════════════════════════════════
// AiFlightOptionTimeline
// Displays top 5 AI-scored flights as a vertical
// numbered timeline inside the AI chatbot.
// Shows both outbound and return legs for round trips.
// ═══════════════════════════════════════════════

'use client';

import { Plane, Clock, ArrowRight, ArrowLeft } from 'lucide-react';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import { formatDuration, formatPrice, getStopsLabel } from '@/lib/utils';

interface Props {
  flights: UnifiedFlight[];
  roundTripOptions?: RoundTripOption[];
  onSelect: (index: number) => void;
}

export default function AiFlightOptionTimeline({ flights, roundTripOptions, onSelect }: Props) {
  const top5 = flights.slice(0, 5);

  // Resolve round-trip option for a given flight
  const resolveRT = (flight: UnifiedFlight): RoundTripOption | null => {
    if (!roundTripOptions?.length) return null;
    return roundTripOptions.find(rt => rt.id === flight.id) ?? null;
  };

  if (top5.length === 0) {
    return (
      <div className="px-3 py-4 text-center">
        <p className="text-xs text-slate-400 italic">No flights available. Try searching first.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Timeline connector line */}
      <div className="absolute left-[15px] top-4 bottom-4 w-px bg-gradient-to-b from-[#1ABC9C]/60 via-[#1ABC9C]/30 to-transparent" />

      <div className="space-y-2.5">
        {top5.map((flight, idx) => {
          const firstSeg = flight.segments[0];
          const lastSeg = flight.segments[flight.segments.length - 1];
          const origin = firstSeg?.departure.airport ?? '???';
          const dest = lastSeg?.arrival.airport ?? '???';
          const airline = flight.airline.name;
          const score = flight.valueScore ?? 50;

          // Resolve return leg
          const rt = resolveRT(flight);
          const hasReturn = !!rt;

          // ── Compute badges ──
          const badges: { label: string; color: string; bg: string; border: string }[] = [];

          // Best AI Pick = rank 1 (highest score)
          if (idx === 0) {
            badges.push({ label: '🏆 Best AI Pick', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200/60' });
          } else if (score >= 70) {
            badges.push({ label: '✨ AI Pick', color: 'text-[#1ABC9C]', bg: 'bg-[#1ABC9C]/10', border: 'border-[#1ABC9C]/20' });
          }

          // From flight tags
          const flightTags = flight.tags ?? [];
          const rtBadges = rt?.badges ?? [];

          if (flightTags.includes('cheapest') || rtBadges.includes('cheapest')) {
            badges.push({ label: '💰 Cheapest', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200/60' });
          }
          if (flightTags.includes('fastest') || rtBadges.includes('fastest')) {
            badges.push({ label: '⚡ Fastest', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200/60' });
          }
          if (flightTags.includes('best_value') || rtBadges.includes('best_value')) {
            badges.push({ label: '🌟 Best Value', color: 'text-teal-700', bg: 'bg-teal-50', border: 'border-teal-200/60' });
          }
          if (rtBadges.includes('fewest_stops')) {
            badges.push({ label: '✈️ Fewest Stops', color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200/60' });
          }

          // Lower Fare badge for 'lowest' fareType
          if ((flight as any).fareType === 'lowest') {
            badges.push({ label: '🏷️ Lower Fare', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200/60' });
          }

          // Nonstop badge
          if (flight.stops === 0) {
            badges.push({ label: '🛫 Nonstop', color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200/60' });
          }

          // Flexible = refundable or changeable
          if (flight.fareRules.refundable || flight.fareRules.changeable) {
            badges.push({ label: '🔄 Flexible', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200/60' });
          }

          return (
            <button
              key={flight.id}
              onClick={() => onSelect(idx)}
              className="relative flex items-start gap-3 w-full text-left group"
            >
              {/* Numbered circle */}
              <div className="relative z-10 flex-none w-[30px] h-[30px] rounded-full bg-gradient-to-br from-[#1ABC9C] to-emerald-600 flex items-center justify-center text-white text-xs font-black shadow-md shadow-[#1ABC9C]/20 group-hover:shadow-lg group-hover:shadow-[#1ABC9C]/40 transition-shadow">
                {idx + 1}
              </div>

              {/* Card */}
              <div className="flex-1 bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200/80 p-3 group-hover:border-[#1ABC9C]/40 group-hover:shadow-md group-hover:shadow-[#1ABC9C]/10 transition-all cursor-pointer min-w-0">
                {/* Header row: airline + score */}
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[13px] font-bold text-slate-700 truncate">{airline}</span>
                  {/* Score badge removed — score used internally for ranking only */}
                </div>

                {/* Badge tags */}
                {badges.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {badges.map((b, bi) => (
                      <span
                        key={bi}
                        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${b.color} ${b.bg} ${b.border}`}
                      >
                        {b.label}
                      </span>
                    ))}
                  </div>
                )}

                {/* ── Outbound leg ── */}
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Plane className="w-2.5 h-2.5 text-[#1ABC9C] flex-none" />
                  <span className="text-[14px] font-extrabold text-slate-900">{origin}</span>
                  <ArrowRight className="w-3 h-3 text-slate-400 flex-none" />
                  <span className="text-[14px] font-extrabold text-slate-900">{dest}</span>
                  <span className="text-[12px] text-slate-400 ml-auto flex-none">{getStopsLabel(flight.stops)}</span>
                </div>
                <div className="flex items-center gap-2 mb-1 pl-[18px]">
                  <div className="flex items-center gap-1 text-slate-400">
                    <Clock className="w-2.5 h-2.5" />
                    <span className="text-[11px] font-medium">{formatDuration(hasReturn && rt ? rt.outboundJourney.durationMinutes : flight.totalDuration)}</span>
                  </div>
                  {flight.segments.length > 0 && (
                    <span className="text-[10px] text-slate-300">
                      {flight.segments.map(s => s.flightNumber).join(' → ')}
                    </span>
                  )}
                </div>

                {/* ── Return leg ── */}
                {hasReturn && rt && (
                  <>
                    <div className="border-t border-dashed border-slate-200 my-1" />
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Plane className="w-2.5 h-2.5 text-blue-400 flex-none rotate-180" />
                      <span className="text-[14px] font-extrabold text-slate-900">{rt.returnJourney.departureAirport}</span>
                      <ArrowRight className="w-3 h-3 text-slate-400 flex-none" />
                      <span className="text-[14px] font-extrabold text-slate-900">{rt.returnJourney.arrivalAirport}</span>
                      <span className="text-[12px] text-slate-400 ml-auto flex-none">{getStopsLabel(rt.returnJourney.stops)}</span>
                    </div>
                    <div className="flex items-center gap-2 pl-[18px]">
                      <div className="flex items-center gap-1 text-slate-400">
                        <Clock className="w-2.5 h-2.5" />
                        <span className="text-[11px] font-medium">{formatDuration(rt.returnJourney.durationMinutes)}</span>
                      </div>
                      {rt.returnJourney.flightNumbers.length > 0 && (
                        <span className="text-[10px] text-slate-300">
                          {rt.returnJourney.flightNumbers.join(' → ')}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {/* ── Price ── */}
                <div className="flex items-center justify-between gap-2 mt-1.5 pt-1 border-t border-slate-100">
                  <span className="text-[15px] font-black text-[#F97316]">
                    {formatPrice(hasReturn && rt ? rt.totalPrice : flight.totalPrice, flight.currency || 'USD')}
                  </span>
                  {hasReturn && (
                    <span className="text-[10px] text-slate-400 font-semibold bg-blue-50 px-1.5 py-0.5 rounded-full">
                      Round trip
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Instruction */}
      <div className="mt-3 px-1">
        <p className="text-[12px] text-slate-400 text-center">
          <span className="font-bold text-[#1ABC9C]">Tap a flight</span> or type{' '}
          <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[11px]">1–{Math.min(5, top5.length)}</span>{' '}
          to select
        </p>
      </div>
    </div>
  );
}
