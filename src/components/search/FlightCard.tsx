'use client';

import { motion } from 'framer-motion';
import { Clock, Armchair, ChevronRight, Sparkles, Tag, Zap, Check, X } from 'lucide-react';
import { cn, formatDuration, formatTime, formatPrice, getStopsLabel, getAirlineLogo } from '@/lib/utils';
import type { UnifiedFlight } from '@/lib/types';

interface FlightCardProps {
  flight: UnifiedFlight;
  index: number;
  isCompact?: boolean;
  onSelect: (flight: UnifiedFlight) => void;
  scoreOverride?: number;
  aiReasons?: string[];
  isAiHighlighted?: boolean;
  aiBadge?: string;
}

export default function FlightCard({ flight, index, isCompact, onSelect, scoreOverride, aiReasons, isAiHighlighted, aiBadge }: FlightCardProps) {
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

  // Use scoring engine tags when available
  const isBestValue = flight.tags?.includes('best_value') ?? false;
  const isCheapest  = flight.tags?.includes('cheapest') ?? false;
  const isFastest   = flight.tags?.includes('fastest')  ?? false;
  const isNDC       = flight.provider === 'duffel';
  const isMystifly  = flight.provider === 'mystifly';

  const hasTag = isBestValue || isCheapest || isFastest;

  const ringClass = isAiHighlighted
    ? 'ring-2 ring-[#1ABC9C]/60 shadow-lg shadow-[#1ABC9C]/15'
    : isBestValue
      ? 'ring-2 ring-[#1ABC9C]/40 shadow-lg shadow-[#1ABC9C]/10'
      : isCheapest
        ? 'ring-2 ring-[#F97316]/40 shadow-lg shadow-[#F97316]/10'
        : isFastest
          ? 'ring-2 ring-[#0F172A]/40 shadow-lg shadow-[#0F172A]/10'
          : 'shadow-sm';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      animate={isAiHighlighted
        ? {
            boxShadow: [
              '0 0 0 0px rgba(26,188,156,0)',
              '0 0 0 6px rgba(26,188,156,0.35)',
              '0 0 0 0px rgba(26,188,156,0)',
            ],
          }
        : undefined}
      transition={isAiHighlighted
        ? { delay: index * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1],
            boxShadow: { duration: 1.6, repeat: 2, ease: 'easeInOut', delay: 0.4 } }
        : { delay: index * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'glass-card-scenic p-0 overflow-hidden cursor-pointer group',
        ringClass,
        isCompact ? 'rounded-2xl' : 'rounded-3xl'
      )}
      onClick={() => onSelect(flight)}
    >
      {/* AI Top Pick banner — prominent strip when AI highlights this card */}
      {isAiHighlighted && !isCompact && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#0a5252] via-[#0d9488] to-[#14b8a6]"
        >
          <Sparkles className="w-3.5 h-3.5 text-white shrink-0" />
          <span className="text-white text-[11px] font-black uppercase tracking-wider">
            FareMind AI Top Recommendation
          </span>
          {aiBadge && (
            <span className="ml-auto px-2 py-0.5 rounded-full bg-white/20 text-white text-[10px] font-bold">
              {aiBadge}
            </span>
          )}
        </motion.div>
      )}

      {/* Top badges */}
      {(hasTag || isNDC || (aiBadge && !isAiHighlighted) || flight.fareRules.refundable || flight.fareRules.changeable) && !isCompact && (
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
          {(flight.fareRules.refundable || flight.fareRules.changeable) && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-600 text-white shadow-sm">
              🔄 Flexible
            </span>
          )}
          {isNDC && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter bg-slate-900 text-white shadow-sm border border-white/20">
              Direct NDC
            </span>
          )}
          {aiBadge && !isAiHighlighted && (
            <motion.span
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-[#1ABC9C]/15 to-[#1ABC9C]/5 border border-[#1ABC9C]/40 text-[#1ABC9C] shadow-sm shadow-[#1ABC9C]/10"
            >
              <Sparkles className="w-3 h-3" />
              {aiBadge}
            </motion.span>
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
          <div className="flex items-center gap-2 sm:gap-4 mt-4 pt-3 border-t border-slate-200/60 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {formatDuration(displayDuration)}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500 font-medium capitalize">
              <Armchair className="w-3.5 h-3.5 text-slate-400" />
              {flight.cabinClass.replace('_', ' ')}
            </span>
            {index < 51 && (scoreOverride !== undefined || flight.valueScore > 0) && (
              <span
                className="text-xs text-slate-400"
                title={flight.breakdown ? `Price ${(flight.breakdown.priceScore * 100).toFixed(0)}  Duration ${(flight.breakdown.durationScore * 100).toFixed(0)}  Stops ${(flight.breakdown.stopsScore * 100).toFixed(0)}` : undefined}
              >
                Score {scoreOverride ?? flight.valueScore}
              </span>
            )}
            <span className={cn(
              'ml-auto text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border',
              isNDC ? 'text-[#1ABC9C] bg-[#1ABC9C]/10 border-[#1ABC9C]/20'
                : isMystifly ? 'text-indigo-600 bg-indigo-50 border-indigo-200'
                : 'text-slate-500 bg-slate-50 border-slate-200'
            )}>
              {isNDC ? 'NDC Connection' : isMystifly ? 'GDS Aggregator' : 'GDS'}
            </span>
          </div>
        )}

        {/* AI reasoning bullets */}
        {aiReasons && aiReasons.length > 0 && !isCompact && index < 25 && (
          <div className="mt-2.5 px-3 py-2.5 rounded-xl bg-[#1ABC9C]/6 border border-[#1ABC9C]/20 space-y-1">
            <p className="flex items-center gap-1.5 text-[10px] font-bold text-[#1ABC9C] uppercase tracking-wider mb-1.5">
              <Sparkles className="w-3 h-3" /> Why FareMind AI recommends this
            </p>
            {aiReasons.slice(0, 5).map((reason, i) => {
              const isAlert = [
                'longer journey', 'significantly longer', 'layover — may be less convenient',
                'risk of missed transfer', 'Inconvenient flight times', 'No checked baggage',
                'additional fee may apply', 'Non-refundable and non-changeable', 'Consider trade-offs',
                'Higher than', 'Higher fare'
              ].some(a => reason.includes(a));
              return (
                <div key={i} className="flex items-start gap-1.5">
                  {isAlert ? (
                    <X className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                  ) : (
                    <Check className="w-3 h-3 text-[#1ABC9C] shrink-0 mt-0.5" />
                  )}
                  <span className={cn("text-[11px] leading-relaxed", isAlert ? "text-amber-700/80" : "text-slate-600")}>
                    {reason}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
