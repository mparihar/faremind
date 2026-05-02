'use client';

import { motion } from 'framer-motion';
import { Clock, Armchair, ChevronRight, Sparkles, Tag, Zap } from 'lucide-react';
import { cn, formatDuration, formatTime, formatPrice, getStopsLabel, getAirlineLogo } from '@/lib/utils';
import type { UnifiedFlight } from '@/lib/types';

interface FlightCardProps {
  flight: UnifiedFlight;
  index: number;
  isCompact?: boolean;
  onSelect: (flight: UnifiedFlight) => void;
}

export default function FlightCard({ flight, index, isCompact, onSelect }: FlightCardProps) {
  const firstSeg = flight.segments[0];
  const lastSeg  = flight.segments[flight.segments.length - 1];

  // totalDuration can be 0 when the provider omits the slice duration field; fall back to segment times
  const displayDuration = flight.totalDuration > 0
    ? flight.totalDuration
    : (() => {
        const dep = new Date(firstSeg.departure.time).getTime();
        const arr = new Date(lastSeg.arrival.time).getTime();
        return (arr > dep) ? Math.round((arr - dep) / 60000) : 0;
      })();

  // Use scoring engine tags when available; fall back to position for mock data
  const isBestValue = flight.tags ? flight.tags.includes('best_value') : index === 0;
  const isCheapest  = flight.tags?.includes('cheapest') ?? false;
  const isFastest   = flight.tags?.includes('fastest')  ?? false;
  const isNDC       = flight.provider === 'duffel';

  const hasTag = isBestValue || isCheapest || isFastest;

  const ringClass = isBestValue
    ? 'ring-2 ring-[#1ABC9C]/40 shadow-lg shadow-[#1ABC9C]/10'
    : isCheapest
      ? 'ring-2 ring-[#F97316]/40 shadow-lg shadow-[#F97316]/10'
      : isFastest
        ? 'ring-2 ring-[#0F172A]/40 shadow-lg shadow-[#0F172A]/10'
        : 'shadow-sm';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'glass-card-scenic p-0 overflow-hidden cursor-pointer group',
        ringClass,
        isCompact ? 'rounded-2xl' : 'rounded-3xl'
      )}
      onClick={() => onSelect(flight)}
    >
      {/* Top badges */}
      {(hasTag || isNDC) && !isCompact && (
        <div className="flex items-center gap-2 px-5 pt-4 flex-wrap">
          {isBestValue && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-[#1ABC9C] to-[#26d0ce] text-white shadow-sm">
              <Sparkles className="w-3.5 h-3.5" />
              ✨ AI Pick
            </span>
          )}
          {isCheapest && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#F97316] text-white shadow-sm">
              <Tag className="w-3.5 h-3.5" />
              Cheapest
            </span>
          )}
          {isFastest && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#0F172A] text-white shadow-sm">
              <Zap className="w-3.5 h-3.5" />
              Fastest
            </span>
          )}
          {isNDC && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter bg-slate-900 text-white shadow-sm border border-white/20">
              Direct NDC
            </span>
          )}
        </div>
      )}

      <div className={cn('p-5', (hasTag || isNDC) && !isCompact ? 'pt-3' : '')}>
        <div className="flex items-center justify-between gap-4">
          {/* Left: Airline + Route */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            {/* Airline Logo */}
            <div className="shrink-0 text-center">
              <div className="w-11 h-11 rounded-xl bg-white border border-gray-200 flex items-center justify-center overflow-hidden shadow-sm">
                <img
                  src={getAirlineLogo(flight.airline.code)}
                  alt={flight.airline.name}
                  className="w-7 h-7 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
              <p className="text-[10px] text-slate-500 text-center mt-1 font-semibold truncate">
                {firstSeg.airline.code}{firstSeg.flightNumber}
              </p>
            </div>

            {/* Route timeline */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <div className="text-left">
                  <p className="text-xl font-black text-slate-800 leading-none tracking-tight">
                    {formatTime(firstSeg.departure.time)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 font-semibold">{firstSeg.departure.airport}</p>
                </div>

                <div className="flex-1 flex flex-col items-center gap-1 px-2">
                  <div className="relative w-full h-[2px] bg-slate-200 rounded-full">
                    <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#F97316]/60 to-[#F97316] rounded-full" style={{ width: '100%' }} />
                    <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#F97316] shadow-sm" />
                  </div>
                  <p className="text-xs text-slate-500 font-medium">{formatDuration(displayDuration)}</p>
                  <p className="text-xs text-slate-400">{getStopsLabel(flight.stops)}</p>
                </div>

                <div className="text-right">
                  <p className="text-xl font-black text-slate-800 leading-none tracking-tight">
                    {formatTime(lastSeg.arrival.time)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 font-semibold">{lastSeg.arrival.airport}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Price + CTA */}
          <div className="shrink-0 text-right flex flex-col items-end gap-1.5">
            <p className="text-2xl font-black text-[#F97316] leading-none">
              {formatPrice(flight.totalPrice, flight.currency)}
            </p>
            <p className="text-xs text-slate-400 font-medium">per traveler</p>
            {!isCompact && (
              <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-[#1ABC9C] hover:brightness-110 active:scale-[0.98] shadow-sm transition-all mt-1">
                Select
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Bottom details */}
        {!isCompact && (
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-200/60">
            <span className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {formatDuration(displayDuration)}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500 font-medium capitalize">
              <Armchair className="w-3.5 h-3.5 text-slate-400" />
              {flight.cabinClass.replace('_', ' ')}
            </span>
            {flight.breakdown && (
              <span
                className="text-xs text-slate-400"
                title={`Price ${(flight.breakdown.priceScore * 100).toFixed(0)}  Duration ${(flight.breakdown.durationScore * 100).toFixed(0)}  Stops ${(flight.breakdown.stopsScore * 100).toFixed(0)}`}
              >
                Score {flight.valueScore}
              </span>
            )}
            <span className={cn(
              'ml-auto text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border',
              isNDC ? 'text-[#1ABC9C] bg-[#1ABC9C]/10 border-[#1ABC9C]/20' : 'text-slate-500 bg-slate-50 border-slate-200'
            )}>
              {isNDC ? 'NDC Connection' : 'GDS Economy'}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
