// ═══════════════════════════════════════════════
// AiSeatRecommendationList
// Displays top 5 AI-recommended seats in the bot.
// AI Bot ONLY — does not affect manual booking.
// ═══════════════════════════════════════════════

'use client';

import { Armchair, Sparkles, MapPin, Loader2 } from 'lucide-react';
import type { RecommendedSeat } from '@/lib/ai-seat/ai-seat-types';

// ─── Zone / type labels ──────────────────────────────────────────────────────

const ZONE_EMOJI: Record<string, string> = { front: '🛫', middle: '✈️', rear: '🛬' };
const TYPE_EMOJI: Record<string, string> = { window: '🪟', aisle: '🚶', middle: '👤', unknown: '💺' };

function formatPrice(price: number, currency: string): string {
  if (price === 0) return 'Included';
  return `${currency === 'USD' ? '$' : currency + ' '}${price.toFixed(0)}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  seats: RecommendedSeat[];
  loading: boolean;
  error?: string | null;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  route?: string;
  passengerLabel?: string;      // e.g. "Traveler 1"
  excludeSeats?: string[];      // seat numbers to filter out (pool depletion)
  onSelect: (seat: RecommendedSeat) => void;
  onSkip: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AiSeatRecommendationList({
  seats: rawSeats,
  loading,
  error,
  fallbackUsed,
  fallbackReason,
  route,
  passengerLabel,
  excludeSeats,
  onSelect,
  onSkip,
}: Props) {
  // Filter out already-selected seats
  const seats = excludeSeats?.length
    ? rawSeats.filter(s => !excludeSeats.includes(s.seatNumber))
    : rawSeats;
  // Loading state
  if (loading) {
    return (
      <div className="space-y-2.5">
        <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Armchair className="w-4 h-4 text-[#1ABC9C]" />
            <span className="text-[14px] font-bold text-[#1ABC9C]">Live Seat Selection</span>
          </div>
          <div className="flex items-center gap-2 text-[15px] text-white/90">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1ABC9C]" />
            Checking live available seats{route ? ` for ${route}` : ''}
            {passengerLabel ? ` — ${passengerLabel}` : ''}...
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-2.5">
        <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Armchair className="w-4 h-4 text-[#1ABC9C]" />
            <span className="text-[14px] font-bold text-[#1ABC9C]">Seat Selection</span>
          </div>
          <p className="text-[15px] text-white/70 leading-relaxed">{error}</p>
        </div>
        <button
          onClick={onSkip}
          className="w-full py-2.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-[15px] font-semibold transition-all"
        >
          Continue without seat selection →
        </button>
      </div>
    );
  }

  // No seats
  if (!seats || !seats.length) {
    return (
      <div className="space-y-2.5">
        <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Armchair className="w-4 h-4 text-[#1ABC9C]" />
            <span className="text-[14px] font-bold text-[#1ABC9C]">Seat Selection</span>
          </div>
          <p className="text-[15px] text-white/70 leading-relaxed">
            No selectable seats are available right now. Your seat may be assigned by the airline later.
          </p>
        </div>
        <button
          onClick={onSkip}
          className="w-full py-2.5 rounded-xl bg-[#1ABC9C] hover:bg-emerald-500 text-white text-[15px] font-bold transition-all shadow-md shadow-[#1ABC9C]/20"
        >
          Continue →
        </button>
      </div>
    );
  }

  // Recommendation list
  return (
    <div className="space-y-2.5">
      {/* Header */}
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Armchair className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-[14px] font-bold text-[#1ABC9C]">
            AI Seat Recommendations{passengerLabel ? ` — ${passengerLabel}` : ''}
          </span>
        </div>
        <p className="text-[15px] text-white/90 leading-relaxed">
          {route
            ? <>Here are the best seats matching your preference for <span className="font-bold text-white">{route}</span>:</>
            : 'Here are the best seats matching your preference:'}
        </p>
        {fallbackUsed && fallbackReason && (
          <p className="text-[13px] text-amber-400/80 mt-1">⚡ {fallbackReason}</p>
        )}
      </div>

      {/* Seat cards */}
      <div className="space-y-1.5 px-0.5">
        {seats.map(seat => (
          <button
            key={seat.seatId}
            onClick={() => onSelect(seat)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/90 border border-slate-200/80 hover:border-[#1ABC9C]/40 hover:shadow-md transition-all text-left group"
          >
            {/* Rank badge */}
            <span className="flex-none w-7 h-7 rounded-full bg-gradient-to-br from-[#1ABC9C] to-emerald-600 text-white text-[14px] font-black flex items-center justify-center shadow-sm">
              {seat.rank}
            </span>

            {/* Seat info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[14px] font-black text-slate-800 group-hover:text-slate-900">
                  {seat.seatNumber}
                </span>
                {seat.rank === 1 && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200/50">
                    <Sparkles className="w-2.5 h-2.5 text-amber-500" />
                    <span className="text-[11px] font-bold text-amber-600">Best match</span>
                  </span>
                )}
              </div>
              <p className="text-[13px] text-slate-500 leading-snug truncate">
                {ZONE_EMOJI[seat.cabinZone] || '✈️'} {seat.reason}
              </p>
            </div>

            {/* Price */}
            <div className="flex-none text-right">
              <span className={`text-[15px] font-bold ${seat.price === 0 ? 'text-emerald-600' : 'text-[#F97316]'}`}>
                {formatPrice(seat.price, seat.currency)}
              </span>
              <div className="text-[11px] text-slate-400 font-medium">
                AI {seat.score}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Skip option */}
      <button
        onClick={onSkip}
        className="w-full py-2 rounded-xl bg-slate-50 border border-slate-200/80 hover:border-slate-300 text-slate-500 text-[14px] font-medium transition-all"
      >
        Skip seat selection — assign later
      </button>

      {/* Instruction */}
      <p className="text-[13px] text-slate-400 text-center px-1">
        <span className="font-bold text-[#1ABC9C]">Tap</span> a seat or type{' '}
        <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[12px]">1–{seats.length}</span>
      </p>
    </div>
  );
}
