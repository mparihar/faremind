// ═══════════════════════════════════════════════
// AiGroupSeatBlockList
// Displays top 5 group seat block options in the
// AI Board chat for multi-passenger booking.
// ═══════════════════════════════════════════════

'use client';

import { Armchair, Users, Loader2, AlertTriangle } from 'lucide-react';
import type { GroupSeatBlock } from '@/lib/ai-seat/ai-seat-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(price: number, currency: string): string {
  if (price === 0) return 'Included';
  return `${currency === 'USD' ? '$' : currency + ' '}${price.toFixed(0)}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  blocks: GroupSeatBlock[];
  loading: boolean;
  error?: string | null;
  fallbackLevel: number;
  fallbackReason?: string;
  route?: string;
  passengerCount: number;
  onSelect: (block: GroupSeatBlock) => void;
  onSkip: () => void;
  onIndividual?: () => void;   // fallback level 5: switch to per-pax flow
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AiGroupSeatBlockList({
  blocks,
  loading,
  error,
  fallbackLevel,
  fallbackReason,
  route,
  passengerCount,
  onSelect,
  onSkip,
  onIndividual,
}: Props) {
  // Loading state
  if (loading) {
    return (
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-4 py-5 text-center">
        <div className="inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-[#1ABC9C] animate-spin" />
          <span className="text-[14px] text-white/70">
            Finding group seating options for {passengerCount} travelers…
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          <span className="text-[12px] font-bold text-amber-400">Seat Map Unavailable</span>
        </div>
        <p className="text-[13px] text-white/70">{error}</p>
        <p className="text-[12px] text-white/50 mt-0.5">This airline may not support seat selection through our system. You can select seats directly with the airline after booking.</p>
        <div className="flex gap-2 mt-2">
          <button
            onClick={onSkip}
            className="flex-1 py-1.5 px-3 rounded-lg bg-white/10 text-white/60 text-[12px] font-medium hover:bg-white/15 transition-colors"
          >
            Skip seat selection
          </button>
        </div>
      </div>
    );
  }

  // Fallback level 5: no group seats — offer individual selection
  if (fallbackLevel === 5 && blocks.length === 0) {
    return (
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Users className="w-3 h-3 text-amber-400" />
          <span className="text-[12px] font-bold text-amber-400">Group Seats Unavailable</span>
        </div>
        <p className="text-[13px] text-white/70 mb-2">
          {fallbackReason || 'I could not find enough consecutive seats for your full group.'}
          {' '}I can help select seats one passenger at a time.
        </p>
        <div className="flex gap-2">
          {onIndividual && (
            <button
              onClick={onIndividual}
              className="flex-1 py-1.5 px-3 rounded-lg bg-[#1ABC9C] text-white text-[12px] font-bold hover:bg-[#1ABC9C]/90 transition-colors"
            >
              Select individually
            </button>
          )}
          <button
            onClick={onSkip}
            className="flex-1 py-1.5 px-3 rounded-lg bg-white/10 text-white/60 text-[12px] font-medium hover:bg-white/15 transition-colors"
          >
            Skip seats
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Armchair className="w-3 h-3 text-[#1ABC9C]" />
          <span className="text-[12px] font-bold text-[#1ABC9C]">Group Seating Options</span>
          {route && (
            <span className="text-[11px] text-white/40 ml-auto">{route}</span>
          )}
        </div>
        <p className="text-[13px] text-white/80 leading-relaxed">
          I found {blocks.length} group seating option{blocks.length !== 1 ? 's' : ''} for{' '}
          <span className="font-bold text-white">{passengerCount} travelers</span>.
        </p>
        {fallbackReason && fallbackLevel > 0 && fallbackLevel < 5 && (
          <p className="text-[11px] text-amber-400/80 mt-0.5">
            ⚡ {fallbackReason}
          </p>
        )}
      </div>

      {/* Block options */}
      <div className="space-y-1.5 px-0.5">
        {blocks.map((block, idx) => {
          const seatList = block.seats.map(s => s.seatNumber).join(', ');
          return (
            <button
              key={block.blockId}
              onClick={() => onSelect(block)}
              className="w-full text-left px-3 py-2.5 rounded-xl bg-white/95 border border-slate-200/80 hover:border-[#1ABC9C]/50 hover:shadow-md transition-all group"
            >
              {/* Rank + Row */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-black text-[#1ABC9C] bg-[#1ABC9C]/10 w-4 h-4 rounded-full flex items-center justify-center flex-none">
                    {idx + 1}
                  </span>
                  <span className="text-[13px] font-bold text-slate-800">
                    Row {block.rowNumbers.join(' & ')}
                  </span>
                  {block.sameRow && (
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-semibold">
                      Same row
                    </span>
                  )}
                </div>
                <span className="text-[13px] font-bold text-slate-700">
                  {formatPrice(block.totalPrice, block.currency)}
                  {block.totalPrice > 0 && (
                    <span className="text-[11px] text-slate-400 font-normal ml-0.5">total</span>
                  )}
                </span>
              </div>

              {/* Seats */}
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[12px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                  {seatList}
                </span>
              </div>

              {/* Reason / metadata */}
              <p className="text-[11px] text-slate-500 leading-tight">
                {block.reason}
              </p>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] text-slate-400">
          <span className="font-bold text-[#1ABC9C]">Tap</span> to select a group
        </p>
        <button
          onClick={onSkip}
          className="text-[11px] text-slate-400 hover:text-slate-600 underline transition-colors"
        >
          Skip seat selection
        </button>
      </div>
    </div>
  );
}
