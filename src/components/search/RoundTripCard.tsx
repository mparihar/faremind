'use client';

import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { ArrowRight, ArrowLeft, Clock, Armchair, Sparkles, Tag, Zap, Minimize2, ChevronRight, Check, X } from 'lucide-react';
import { useAiRecommendationLimit } from '@/hooks/useAiRecommendationLimit';
import { cn, formatDuration, formatTime, formatPrice, getAirlineLogo } from '@/lib/utils';
import type { RoundTripOption, JourneySegment } from '@/lib/round-trip-types';

// ─── Leg row ─────────────────────────────────────────────────────────────────

interface LegProps {
  journey: JourneySegment;
  direction: 'outbound' | 'return';
}

function Leg({ journey, direction }: LegProps) {
  const primaryCode = journey.airlineCodes[0] ?? '';
  const stopsLabel =
    journey.stops === 0 ? 'Nonstop' : journey.stops === 1 ? '1 stop' : `${journey.stops} stops`;

  return (
    <div className="flex items-center gap-3 py-3">
      {/* Direction badge */}
      <div className={cn(
        'shrink-0 flex flex-col items-center gap-0.5 w-14',
      )}>
        <div className={cn(
          'w-8 h-8 rounded-xl flex items-center justify-center shadow-sm border',
          direction === 'outbound'
            ? 'bg-[#0F172A]/10 border-[#0F172A]/20'
            : 'bg-[#1ABC9C]/10 border-[#1ABC9C]/20',
        )}>
          {direction === 'outbound'
            ? <ArrowRight className="w-4 h-4 text-[#0F172A]" />
            : <ArrowLeft  className="w-4 h-4 text-[#1ABC9C]" />}
        </div>
        <span className={cn(
          'text-[9px] font-black uppercase tracking-widest',
          direction === 'outbound' ? 'text-[#0F172A]' : 'text-[#1ABC9C]',
        )}>
          {direction === 'outbound' ? 'Out' : 'Ret'}
        </span>
      </div>

      {/* Airline logo */}
      <div className="shrink-0 w-9 h-9 rounded-xl bg-white border border-gray-200 flex items-center justify-center shadow-sm overflow-hidden">
        <img
          src={getAirlineLogo(primaryCode)}
          alt={journey.airlineNames[0] ?? primaryCode}
          className="w-6 h-6 object-contain"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      </div>

      {/* Timeline */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {/* Departure */}
          <div className="shrink-0 text-left">
            <p className="text-base font-black text-slate-800 leading-none tracking-tight">
              {formatTime(journey.departureTime)}
            </p>
            <p className="text-[10px] text-slate-500 font-semibold mt-0.5">{journey.departureAirport}</p>
          </div>

          {/* Arc */}
          <div className="flex-1 flex flex-col items-center px-1 min-w-0">
            <p className="text-[9px] text-slate-400 font-semibold whitespace-nowrap mb-1">
              {formatDuration(journey.durationMinutes)} · {stopsLabel}
            </p>
            <div className="relative w-full h-[2px] bg-slate-200 rounded-full overflow-visible">
              <div className={cn(
                'absolute inset-y-0 left-0 rounded-full',
                direction === 'outbound' ? 'bg-[#0F172A]/60' : 'bg-[#1ABC9C]/60',
              )} style={{ width: '100%' }} />
              {journey.stops > 0 && (() => {
                const positions = journey.stops === 1 ? [50] : [33, 67];
                return journey.stopAirports.slice(0, 2).map((airport, i) => {
                  // Find layover duration for this stop
                  const layover = journey.layovers?.find(l => l.airport === airport);
                  const layoverText = layover ? ` (${formatDuration(layover.durationMinutes)})` : '';
                  return (
                    <div key={airport + i} className="absolute top-1/2 -translate-y-1/2" style={{ left: `${positions[i]}%` }}>
                      <div className={cn(
                        'w-2 h-2 rounded-full bg-white border-2 shadow-sm -translate-x-1/2',
                        direction === 'outbound' ? 'border-slate-500' : 'border-[#1ABC9C]',
                      )} />
                      <span className="absolute top-[8px] left-1/2 -translate-x-1/2 text-[8px] font-black text-slate-500 whitespace-nowrap tracking-wide">
                        {airport}{layoverText}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Arrival */}
          <div className="shrink-0 text-right">
            <p className="text-base font-black text-slate-800 leading-none tracking-tight">
              {formatTime(journey.arrivalTime)}
            </p>
            <p className="text-[10px] text-slate-500 font-semibold mt-0.5">{journey.arrivalAirport}</p>
          </div>
        </div>

        {/* Flight number + airline name */}
        <p className="text-[10px] text-slate-500 font-semibold mt-1 truncate">
          {journey.flightNumbers?.length > 0
            ? journey.flightNumbers.join(' · ')
            : journey.airlineNames.join(' · ')}
          <span className="text-slate-400 font-medium"> · {journey.airlineNames[0]}</span>
        </p>
      </div>
    </div>
  );
}

// ─── Badge chip ───────────────────────────────────────────────────────────────

const BADGE_CONFIG: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  best_ai_pick:    { label: '✨ Best AI Pick',    icon: <Sparkles  className="w-3 h-3" />, cls: 'bg-gradient-to-r from-[#0ea47a] to-[#1ABC9C] text-white' },
  ai_pick:         { label: '✨ AI Pick',         icon: <Sparkles  className="w-3 h-3" />, cls: 'bg-gradient-to-r from-[#1ABC9C] to-[#26d0ce] text-white' },
  cheapest:        { label: 'Cheapest',           icon: <Tag       className="w-3 h-3" />, cls: 'bg-[#F97316]  text-white' },
  fastest:         { label: 'Fastest',            icon: <Zap       className="w-3 h-3" />, cls: 'bg-[#0F172A]   text-white' },
  fewest_stops:    { label: 'Fewest Stops',       icon: <Minimize2 className="w-3 h-3" />, cls: 'bg-slate-700 text-white' },
  best_value:      { label: 'Best Value',         icon: <Sparkles  className="w-3 h-3" />, cls: 'bg-gradient-to-r from-[#059669] to-[#10B981] text-white' },
  recommended:     { label: 'Recommended',        icon: <Sparkles  className="w-3 h-3" />, cls: 'bg-emerald-600 text-white' },
  better_schedule: { label: 'Better Schedule',    icon: <Clock     className="w-3 h-3" />, cls: 'bg-sky-600 text-white' },
  flexible:        { label: 'Flexible',           icon: <ArrowRight className="w-3 h-3 rotate-[135deg]" />, cls: 'bg-purple-600 text-white' },
};

// ─── Main card ────────────────────────────────────────────────────────────────

interface RoundTripCardProps {
  option: RoundTripOption;
  index: number;
  onSelect: (option: RoundTripOption) => void;
  onHover?: (id: string | null) => void;
  isHovered?: boolean;
  aiEnabled?: boolean;
  isTopAiPick?: boolean;
  isBestAiPick?: boolean;
  scoreOverride?: number;
  isAiHighlighted?: boolean;
  aiReasons?: string[];
  // 🧬 DNA Search
  dnaScore?: number;
  dnaMatchLabel?: string;
  dnaMatchReasons?: string[];
  dnaMismatchReasons?: string[];
  /** Admin/Support viewers see internal scores */
  showScores?: boolean;
}

export default function RoundTripCard({ option, index, onSelect, onHover, isHovered, aiEnabled, isTopAiPick, isBestAiPick, scoreOverride, isAiHighlighted, aiReasons, dnaScore, dnaMatchLabel, dnaMatchReasons, dnaMismatchReasons, showScores }: RoundTripCardProps) {
  const aiRecLimit = useAiRecommendationLimit();
  const [viewing, setViewing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewing(true);
    onSelect(option);
    timerRef.current = setTimeout(() => setViewing(false), 2000);
  };

  const serverBadges = (option.badges as string[] ?? []).filter(b => b !== 'best_value');
  const displayBadges: string[] = (() => {
    if (!aiEnabled) return serverBadges;
    const filtered = serverBadges.filter(b => b !== 'ai_pick' && b !== 'best_ai_pick');
    if (isBestAiPick) return ['best_ai_pick', ...filtered];
    if (isTopAiPick)  return ['ai_pick',      ...filtered];
    return serverBadges;
  })();

  // Add 'flexible' badge if fare is refundable or changeable
  if ((option.fareRules.refundable || option.fareRules.changeable) && !displayBadges.includes('flexible')) {
    displayBadges.push('flexible');
  }

  const hasBadge = displayBadges.length > 0;

  const ringClass = isAiHighlighted
    ? 'ring-2 ring-[#1ABC9C]/60 shadow-lg shadow-[#1ABC9C]/15'
    : displayBadges.includes('best_ai_pick') || displayBadges.includes('ai_pick')
      ? 'ring-2 ring-[#1ABC9C]/40 shadow-lg shadow-[#1ABC9C]/10'
      : displayBadges.includes('cheapest')
        ? 'ring-2 ring-[#F97316]/40 shadow-lg shadow-[#F97316]/10'
        : displayBadges.includes('fastest')
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
        ? { delay: Math.min(index * 0.05, 0.4), duration: 0.4, ease: [0.16, 1, 0.3, 1],
            boxShadow: { duration: 1.6, repeat: 2, ease: 'easeInOut', delay: 0.4 } }
        : { delay: Math.min(index * 0.05, 0.4), duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={cn('glass-card-scenic p-0 overflow-hidden cursor-pointer group rounded-3xl', ringClass, isHovered && 'ring-2 ring-[#1ABC9C]/50 shadow-xl shadow-[#1ABC9C]/10')}
      onClick={() => onSelect(option)}
      onMouseEnter={() => onHover?.(option.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {/* AI Top Pick banner */}
      {isAiHighlighted && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#0a5252] via-[#0d9488] to-[#14b8a6]"
        >
          <Sparkles className="w-3.5 h-3.5 text-white shrink-0" />
          <span className="text-white text-[11px] font-black uppercase tracking-wider">
            FAREMIND AI Top Recommendation
          </span>
        </motion.div>
      )}

      {/* Badges row */}
      {hasBadge && (
        <div className="flex items-center gap-2 px-5 pt-4 flex-wrap">
          {displayBadges.map((badge) => {
            const cfg = BADGE_CONFIG[badge];
            if (!cfg) return null;
            return (
              <span
                key={badge}
                className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold shadow-sm', cfg.cls)}
              >
                {cfg.icon}
                {cfg.label}
              </span>
            );
          })}
          {dnaScore !== undefined && dnaMatchLabel && (
            <motion.span
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-sm',
                dnaScore >= 90
                  ? 'bg-gradient-to-r from-emerald-500/15 to-emerald-500/5 border-emerald-400/40 text-emerald-700'
                  : dnaScore >= 80
                    ? 'bg-gradient-to-r from-teal-500/15 to-teal-500/5 border-teal-400/40 text-teal-700'
                    : dnaScore >= 70
                      ? 'bg-gradient-to-r from-amber-500/15 to-amber-500/5 border-amber-400/40 text-amber-700'
                      : 'bg-slate-50 border-slate-200 text-slate-500'
              )}
            >
              <span className="font-black tracking-wide">DNA</span> {dnaMatchLabel}
            </motion.span>
          )}
        </div>
      )}

      <div className={cn('px-5 pb-0', hasBadge ? 'pt-2' : 'pt-4')}>
        {/* Outbound leg */}
        <Leg journey={option.outboundJourney} direction="outbound" />

        {/* Divider */}
        <div className="border-t border-dashed border-slate-200" />

        {/* Return leg */}
        <Leg journey={option.returnJourney} direction="return" />
      </div>

      {/* Footer: price + meta + CTA */}
      <div className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 sm:py-4 bg-white/30 border-t border-white/50 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            {formatDuration(option.totalDurationMinutes)} total
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium capitalize">
            <Armchair className="w-3.5 h-3.5 text-slate-400" />
            {option.cabinClass.replace('_', ' ')}
          </div>
          </div>

          {showScores && index < 51 && (scoreOverride ?? option.score) !== undefined && (
            <span className="text-xs text-slate-400 font-medium">Score {scoreOverride ?? option.score}</span>
          )}
          {showScores && dnaScore !== undefined && dnaScore >= 0 && (
            <span className="text-xs font-semibold text-emerald-600" title="DNA Match Score">
              <span className="font-black">DNA</span> {dnaScore}%
            </span>
          )}

        <div className="ml-auto flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="text-2xl font-black text-[#F97316] leading-none">
              {formatPrice(option.totalPrice, option.currency)}
            </p>
            <p className="text-[10px] text-slate-400 font-medium">round trip</p>
          </div>
          <button
            onClick={handleView}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-[#1ABC9C] hover:brightness-110 active:scale-[0.98] shadow-sm transition-all min-w-[72px] justify-center"
          >
            {viewing ? (
              <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            ) : (
              <>View <ChevronRight className="w-4 h-4" /></>
            )}
          </button>
        </div>
      </div>

      {/* AI reasoning bullets */}
      {aiReasons && aiReasons.length > 0 && index < aiRecLimit && (
        <div className="px-5 pb-4 mt-[-4px]">
          <div className="px-3 py-2.5 rounded-xl bg-[#1ABC9C]/6 border border-[#1ABC9C]/20 space-y-1">
            <p className="flex items-center gap-1.5 text-[10px] font-bold text-[#1ABC9C] uppercase tracking-wider mb-1.5">
              <Sparkles className="w-3 h-3" /> Why FAREMIND AI recommends this
            </p>
            {aiReasons.slice(0, 5).map((reason, i) => {
              const cleanReason = reason.replace(/^[✓✔×•\-*]\s*/g, '');
              const isAlert = reason.trimStart().startsWith('×') || [
                'longer journey', 'significantly longer', 'longer than',
                'layover — may be less convenient',
                'risk of missed transfer', 'Inconvenient flight times', 'No checked baggage',
                'additional fee may apply', 'Non-refundable and non-changeable', 'Consider trade-offs',
                'Higher than', 'Higher fare', 'Non-refundable', 'not refundable',
              ].some(a => cleanReason.toLowerCase().includes(a.toLowerCase()));
              return (
                <div key={i} className="flex items-start gap-1.5">
                  {isAlert ? (
                    <X className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                  ) : (
                    <Check className="w-3 h-3 text-[#1ABC9C] shrink-0 mt-0.5" />
                  )}
                  <span className={cn("text-[11px] leading-relaxed", isAlert ? "text-amber-600" : "text-slate-600")}>
                    {cleanReason}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 🧬 DNA Match Reasons */}
      {dnaMatchReasons && dnaMatchReasons.length > 0 && (
        <div className="px-5 pb-4 mt-[-4px]">
          <div className="px-3 py-2.5 rounded-xl bg-emerald-500/6 border border-emerald-400/20 space-y-1">
            <p className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">
              Why this matches your DNA
            </p>
            {dnaMatchReasons.slice(0, 5).map((reason, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <Check className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                <span className="text-[11px] leading-relaxed text-slate-600">{reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
