'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Plane, Clock, Sparkles, Share2, Printer,
  Bookmark, Luggage, Armchair, CheckCircle2,
  RotateCcw, ChevronRight, Star,
} from 'lucide-react';
import { cn, formatPrice, getAirlineLogo } from '@/lib/utils';
import type { RoundTripOption, JourneySegment } from '@/lib/round-trip-types';
import OneWayDetailModal from './OneWayDetailModal';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtDur(mins: number) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function comfortScore(totalMin: number, stops: number) {
  return Math.round(Math.min(95, Math.max(20, 100 - stops * 20 - Math.max(0, (totalMin / 60 - 10) * 2))));
}
function comfortMeta(s: number): { emoji: string; label: string } {
  if (s >= 78) return { emoji: '😊', label: 'Comfortable' };
  if (s >= 52) return { emoji: '😐', label: 'Moderate' };
  return             { emoji: '😓', label: 'Tiring' };
}
function generateInsights(opt: RoundTripOption): string[] {
  const ins: string[] = [];
  ins.push(opt.totalStops === 0
    ? 'Nonstop on both legs — zero connection stress'
    : `${opt.totalStops} connection${opt.totalStops > 1 ? 's' : ''} routed via optimized global hubs`
  );
  ins.push(opt.fareRules.refundable
    ? opt.fareRules.cancellationFee != null && opt.fareRules.cancellationFee > 0
      ? `Refundable fare (penalty: $${opt.fareRules.cancellationFee}) — flexible booking`
      : 'Fully refundable & changeable — maximum booking flexibility'
    : opt.fareRules.changeable
      ? 'Changeable fare — schedule flexibility if plans shift'
      : 'Standard non-refundable fare — review change policies before booking'
  );
  const bags = [
    opt.baggage.carryOn ? `${opt.baggage.carryOn} carry-on` : '',
    opt.baggage.checked ? `${opt.baggage.checked} checked bag${opt.baggage.checked !== 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  if (bags.length) ins.push(`${bags.join(' & ')} included — no surprise fees at check-in`);
  return ins;
}

// ─── Comfort gauge ────────────────────────────────────────────────────────────

function ComfortMeter({ score }: { score: number }) {
  const { emoji, label } = comfortMeta(score);
  return (
    <div className="flex flex-col items-center">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">Comfort</p>
      <div className="relative w-[72px] h-9 overflow-hidden">
        <div className="absolute inset-0 border-[5px] border-slate-100 rounded-t-full" />
        <div
          className="absolute inset-0 border-[5px] border-amber-400 rounded-t-full"
          style={{ clipPath: `polygon(0 0, ${score}% 0, ${score}% 100%, 0 100%)` }}
        />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-base leading-none">{emoji}</div>
      </div>
      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mt-1.5">{label}</p>
    </div>
  );
}

// ─── Journey card ─────────────────────────────────────────────────────────────

function JourneyCard({
  j, direction, onViewDetails,
}: {
  j: JourneySegment; direction: 'outbound' | 'return'; onViewDetails: () => void;
}) {
  const isOut = direction === 'outbound';
  const hasStops = j.stops > 0;
  const gate       = (j.segments[0] as any)?.departure?.gate;
  const depTerm    = (j.segments[0] as any)?.departure?.terminal;
  const arrTerm    = (j.segments[j.segments.length - 1] as any)?.arrival?.terminal;
  const aircraft   = (j.segments[0] as any)?.aircraft;

  return (
    <div className="bg-[#E9F1F0] rounded-[1.5rem] p-4 shadow-sm border border-slate-200/40">

      {/* ── Card label ── */}
      <h3 className="text-[9px] font-semibold text-slate-500 uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5 flex-wrap">
        <span className="font-bold text-slate-700">{isOut ? 'Outbound:' : 'Return:'}</span>
        <span>{j.departureAirport}{hasStops ? ` via ${j.stopAirports.join(', ')} to` : ' direct to'} {j.arrivalAirport}</span>
        <span>({fmtDate(j.departureTime)}{hasStops ? ` – ${fmtDate(j.arrivalTime)}` : ''})</span>
      </h3>

      {/* ── Airline row + Gate ── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shadow-sm border border-slate-100 p-1.5 shrink-0">
            <img src={getAirlineLogo(j.airlineCodes[0])} alt="" className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-bold text-slate-900 uppercase tracking-tight leading-none truncate">{j.airlineNames[0]}</p>
            <p className="text-[8px] font-bold text-slate-800 mt-0.5 uppercase tracking-tight">
              {j.flightNumbers[0]}{aircraft ? ` · ${aircraft}` : ''}
            </p>
          </div>
        </div>
        {gate && (
          <div className="text-right shrink-0">
            <p className="text-[7px] font-bold text-slate-700 uppercase tracking-widest">Gate</p>
            <p className="text-[9px] font-bold text-slate-900">{gate}</p>
          </div>
        )}
      </div>

      {/* ── BA-style timeline ── */}
      <div className="flex gap-3">

        {/* Vertical dot → line → dot */}
        <div className="flex flex-col items-center shrink-0 pt-1">
          <div className="w-2 h-2 rounded-full bg-slate-500" />
          <div className="w-px flex-1 bg-slate-300 my-1.5" />
          <div className="w-2 h-2 rounded-full bg-[#1ABC9C]" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">

          {/* Departure row */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[22px] font-bold text-slate-900 leading-none tracking-tighter">{j.departureAirport}</p>
              {depTerm && (
                <p className="text-[8px] font-semibold text-slate-800 mt-0.5 uppercase tracking-widest">Terminal {depTerm}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[22px] font-bold text-slate-900 leading-none tracking-tighter">{fmtTime(j.departureTime)}</p>
              <p className="text-[9px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">{fmtDate(j.departureTime)}</p>
            </div>
          </div>

          {/* Middle: travel info */}
          <div className="py-3">
            {hasStops ? (
              <div>
                <p className="text-[9px] font-semibold text-slate-500 mb-1.5">via {j.stopAirports[0]}</p>
                <div className="relative flex items-center">
                  <div className="absolute w-full h-px bg-slate-300" />
                  <div className="relative z-10 bg-white px-2.5 py-0.5 rounded-full border border-slate-200 shadow-sm">
                    <p className="text-[8px] font-bold text-slate-900 uppercase tracking-widest whitespace-nowrap">
                      {j.layovers[0] ? `${fmtDur(j.layovers[0].durationMinutes)} Layover` : 'Connection'}
                    </p>
                  </div>
                  <ChevronRight className="absolute -right-1 w-3 h-3 text-slate-300" />
                </div>
                {(j.segments[0] as any)?.arrival?.terminal && (
                  <p className="text-[8px] font-semibold text-slate-800 mt-1.5 uppercase tracking-widest">
                    Terminal {(j.segments[0] as any).arrival.terminal}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[9px] font-semibold text-slate-500">
                Travel time: {fmtDur(j.durationMinutes)} · Nonstop
              </p>
            )}
          </div>

          {/* Arrival row */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[22px] font-bold text-slate-900 leading-none tracking-tighter">{j.arrivalAirport}</p>
              {arrTerm && (
                <p className="text-[8px] font-semibold text-slate-800 mt-0.5 uppercase tracking-widest">Terminal {arrTerm}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[22px] font-bold text-slate-900 leading-none tracking-tighter">{fmtTime(j.arrivalTime)}</p>
              <p className="text-[9px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">{fmtDate(j.arrivalTime)}</p>
            </div>
          </div>

        </div>
      </div>

      {/* ── View details button — connecting only ── */}
      {hasStops && (
        <div className="mt-4 pt-3 flex justify-center border-t border-slate-200/50">
          <button
            onClick={(e) => { e.stopPropagation(); onViewDetails(); }}
            className="px-5 py-1.5 bg-white border border-slate-200 rounded-full text-[8px] font-bold text-slate-700 uppercase tracking-[0.12em] hover:bg-slate-50 transition-all shadow-sm flex items-center gap-1.5"
          >
            View {isOut ? 'Outbound' : 'Return'} Details
            <ChevronRight className="w-2.5 h-2.5 text-slate-400" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface Props {
  option: RoundTripOption;
  aiEnabled?: boolean;
  onClose: () => void;
  onBook: () => void;
  isBestAiPick?: boolean;
  isTopAiPick?: boolean;
  aiScoreOverride?: number;
  aiReasonsOverride?: string[];
  /** Admin/Support viewers see internal scores */
  showScores?: boolean;
}

export default function RoundTripDetailModal({ option, aiEnabled, onClose, onBook, isBestAiPick, isTopAiPick, aiScoreOverride, aiReasonsOverride, showScores }: Props) {
  const [activeDetailJourney, setActiveDetailJourney] = useState<JourneySegment | null>(null);
  const [tab, setTab] = useState<'glance' | 'ai'>('glance');

  // Use AI-overridden score when available (cabin-aware), fall back to legacy score
  const displayScore = aiScoreOverride ?? option.score;
  const cScore = comfortScore(option.totalDurationMinutes, option.totalStops);
  const insights = aiReasonsOverride && aiReasonsOverride.length > 0
    ? aiReasonsOverride
    : generateInsights(option);
  const scoreBreakdown = option.scoreBreakdown;

  return (
    <>
      <AnimatePresence mode="wait">
        <motion.div
          key="rt-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            key="rt-modal"
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ duration: 0.22 }}
            className="bg-white rounded-2xl sm:rounded-[2.5rem] shadow-2xl w-full flex flex-col overflow-hidden max-h-[100dvh] sm:max-h-[88vh] max-w-[1020px]"
          >
            {/* ── Header ── */}
            <div className="px-4 sm:px-7 pt-3 sm:pt-4 pb-3 sm:pb-4 bg-white border-b border-slate-100 shrink-0">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                {/* Left: logo + name + route */}
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                    <img
                      src={getAirlineLogo(option.airlineCodes[0])}
                      alt=""
                      className="w-8 h-8 object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight uppercase leading-none truncate">
                      {option.airlines[0] ?? 'Airline'}
                    </h2>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                        {option.outboundJourney.departureAirport} ↔ {option.outboundJourney.arrivalAirport} Round-Trip Details
                      </span>
                      <Plane className="w-3 h-3 text-slate-300" />
                      <Plane className="w-3 h-3 text-slate-300 -scale-x-100" />
                    </div>
                  </div>
                </div>

                {/* Right: price + actions */}
                <div className="flex items-center sm:items-start gap-3 sm:gap-5 shrink-0">
                  <div className="text-left sm:text-right">
                    <p className="text-xl sm:text-3xl font-bold text-[#F97316] leading-none">
                      {formatPrice(option.totalPrice, option.currency)}
                    </p>
                    <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest mt-1.5">
                      {option.currency} · Round-Trip · Incl. Taxes & Fees
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-1.5">
                    {[
                      { icon: Share2,   tip: 'Share' },
                      { icon: Printer,  tip: 'Print',  onClick: () => window.print() },
                      { icon: Bookmark, tip: 'Save'  },
                    ].map(({ icon: Icon, tip, onClick }) => (
                      <button
                        key={tip}
                        onClick={onClick}
                        className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all shadow-sm"
                        title={tip}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </button>
                    ))}
                    <button
                      onClick={onClose}
                      className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-all ml-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 flex flex-col md:flex-row items-stretch overflow-hidden bg-[#F8FAFC] min-h-0">

              {/* Left: journey cards */}
              <div className="flex-1 flex flex-col min-w-0 md:border-r border-slate-100">
                <div className="flex-1 overflow-y-auto px-4 sm:px-7 py-4 sm:py-5 space-y-4 scrollbar-hide">
                  {aiEnabled && (isBestAiPick || isTopAiPick) && (
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-white shadow-md ${
                      isBestAiPick
                        ? 'bg-gradient-to-r from-[#0ea47a] to-[#1ABC9C] shadow-[#1ABC9C]/20'
                        : 'bg-gradient-to-r from-[#1ABC9C] to-[#26d0ce] shadow-[#26d0ce]/20'
                    }`}>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">
                        {isBestAiPick ? 'Best AI Pick' : 'AI Pick'}
                      </span>
                    </div>
                  )}
                  <div className="space-y-4">
                    <JourneyCard
                      j={option.outboundJourney}
                      direction="outbound"
                      onViewDetails={() => setActiveDetailJourney(option.outboundJourney)}
                    />
                    <JourneyCard
                      j={option.returnJourney}
                      direction="return"
                      onViewDetails={() => setActiveDetailJourney(option.returnJourney)}
                    />
                  </div>
                </div>

                {/* ── CTA ── */}
                <div className="px-4 sm:px-7 py-3 sm:py-4 bg-white border-t border-slate-100 shrink-0 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.05)]">
                  <button
                    onClick={onBook}
                    className="w-full py-3 bg-[#1ABC9C] text-white rounded-[1.5rem] font-bold text-xs sm:text-sm shadow-xl shadow-[#1ABC9C]/30 hover:brightness-105 active:scale-[0.99] transition-all flex items-center justify-center gap-2 sm:gap-3 relative overflow-hidden uppercase tracking-widest"
                  >
                    <Plane className="w-4 h-4 -rotate-45" />
                    Select Fare · {formatPrice(option.totalPrice, option.currency)} →
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-15">
                      <Sparkles className="w-6 h-6" />
                    </div>
                  </button>
                </div>
              </div>

              {/* Right: info panel */}
              <div className="w-full md:w-[360px] bg-white flex flex-col shrink-0 self-stretch overflow-hidden border-t md:border-t-0 border-slate-100">
                {/* Tabs */}
                <div className="flex border-b border-slate-100 shrink-0">
                  {([
                    { key: 'glance', label: 'Journey at a Glance' },
                    { key: 'ai',     label: 'AI Choice Analysis'  },
                  ] as const).map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={cn(
                        'flex-1 py-2.5 text-[9px] font-bold uppercase tracking-[0.12em] transition-all border-b-2',
                        tab === t.key
                          ? 'text-slate-900 border-slate-900'
                          : 'text-slate-400 border-transparent hover:text-slate-600'
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  {tab === 'glance' ? (
                    <>
                      {/* Stats row */}
                      <div className="flex items-start justify-between px-1">
                        <div className="space-y-3">
                          <InfoStat label="Total Duration" value={fmtDur(option.totalDurationMinutes)} />
                          <InfoStat label="Connections" value={String(option.totalStops)} />
                          {showScores && displayScore != null && (
                            <InfoStat
                              label="Airfare Score"
                              value={`${displayScore}/100`}
                              sub={option.badges?.includes('cheapest') ? 'Cheapest' : option.badges?.includes('fastest') ? 'Fastest' : undefined}
                            />
                          )}
                        </div>
                        <ComfortMeter score={cScore} />
                      </div>

                      {/* AI highlights */}
                      <ul className="space-y-2.5">
                        {insights.map((text, i) => (
                          <li key={i} className="flex items-start gap-2.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-900 mt-1.5 shrink-0" />
                            <span className="text-[10px] font-medium text-slate-600 leading-relaxed">{text}</span>
                          </li>
                        ))}
                      </ul>

                      {/* Cabin & Fare */}
                      <PanelSection title="Cabin & Fare">
                        <div className="flex items-start gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                          <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-sm">
                            <Armchair className="w-4 h-4 text-slate-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-[10px] font-bold text-slate-900 uppercase tracking-tight">
                                {option.cabinClass.replace('_', ' ')} Class
                              </p>
                              <div className="flex items-center gap-0.5 opacity-25 shrink-0">
                                <Armchair className="w-2 h-2" />
                                <Armchair className="w-2 h-2" />
                                <Armchair className="w-2 h-2" />
                              </div>
                            </div>
                            <p className="text-[8px] text-slate-400 uppercase tracking-tight">Seat pitch varies by aircraft</p>
                          </div>
                        </div>
                      </PanelSection>

                      {/* Fare Policy */}
                      <PanelSection title="Fare Policy">
                        <div className="space-y-2.5 px-0.5">
                          <PolicyRow
                            icon={<CheckCircle2 className={cn('w-3.5 h-3.5', option.fareRules.refundable ? 'text-green-500' : 'text-red-400')} />}
                            label={
                              option.fareRules.refundable
                                ? option.fareRules.cancellationFee != null && option.fareRules.cancellationFee > 0
                                  ? `Refundable (penalty: $${option.fareRules.cancellationFee})`
                                  : option.fareRules.cancellationFee === 0
                                    ? 'Fully Refundable (no fee)'
                                    : 'Refundable'
                                : 'Non-refundable'
                            }
                          />
                          <PolicyRow
                            icon={<RotateCcw className={cn('w-3.5 h-3.5', option.fareRules.changeable ? 'text-slate-600' : 'text-slate-300')} />}
                            label={
                              option.fareRules.changeable
                                ? option.fareRules.changeFee != null && option.fareRules.changeFee > 0
                                  ? `Changes: $${option.fareRules.changeFee} + fare diff`
                                  : option.fareRules.changeFee === 0
                                    ? 'Free changes (fare diff may apply)'
                                    : 'Changeable (fee may apply)'
                                : 'No changes allowed'
                            }
                          />
                          <PolicyRow
                            icon={<Clock className="w-3.5 h-3.5 text-slate-300" />}
                            label="24h Free Cancellation"
                          />
                        </div>
                      </PanelSection>

                      {/* Baggage */}
                      <PanelSection title="Baggage Allowance">
                        <div className="space-y-2">
                          {option.baggage.carryOn > 0 && (
                            <BagRow label={
                              option.baggage.carryOnWeight
                                ? `${option.baggage.carryOn} Carry-on · ${option.baggage.carryOnWeight} kg (${Math.round(option.baggage.carryOnWeight * 2.205)} lbs)`
                                : `${option.baggage.carryOn} Carry-on included`
                            } />
                          )}
                          {option.baggage.checked > 0 && (
                            <BagRow label={
                              option.baggage.checkedWeight
                                ? `${option.baggage.checked} Checked bag${option.baggage.checked !== 1 ? 's' : ''} · ${option.baggage.checkedWeight} kg (${Math.round(option.baggage.checkedWeight * 2.205)} lbs) each`
                                : `${option.baggage.checked} Checked bag${option.baggage.checked !== 1 ? 's' : ''} included`
                            } />
                          )}
                          {option.baggage.carryOn === 0 && option.baggage.checked === 0 && (
                            <p className="text-[10px] text-slate-400 px-0.5">No free baggage included.</p>
                          )}
                        </div>
                      </PanelSection>
                    </>
                  ) : (
                    /* ── AI Choice Analysis tab ── */
                    <>

                      <PanelSection title="Why This Option">
                        <ul className="space-y-2.5">
                          {insights.map((text, i) => (
                            <li key={i} className="flex items-start gap-2.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C] mt-1.5 shrink-0" />
                              <span className="text-[10px] font-medium text-slate-600 leading-relaxed">{text}</span>
                            </li>
                          ))}
                        </ul>
                      </PanelSection>

                      {option.badges && option.badges.length > 0 && (
                        <PanelSection title="Badges">
                          <div className="flex flex-wrap gap-2">
                            {option.badges.map((b) => (
                              <span
                                key={b}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-[9px] font-bold text-amber-700 uppercase tracking-wider"
                              >
                                <Star className="w-2.5 h-2.5" />
                                {b.replace('_', ' ')}
                              </span>
                            ))}
                          </div>
                        </PanelSection>
                      )}

                      {showScores && scoreBreakdown && (
                        <PanelSection title="Score Breakdown (Admin)">
                          <div className="space-y-2">
                            {Object.entries(scoreBreakdown).map(([key, val]) => (
                              <div key={key} className="flex items-center justify-between">
                                <span className="text-[10px] font-semibold text-slate-500 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                                <div className="flex items-center gap-2">
                                  <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-[#1ABC9C] rounded-full" style={{ width: `${Math.round(Number(val) * 100)}%` }} />
                                  </div>
                                  <span className="text-[10px] font-bold text-slate-700 w-8 text-right">{Math.round(Number(val) * 100)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </PanelSection>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

          </motion.div>
        </motion.div>
      </AnimatePresence>

      {activeDetailJourney && (
        <OneWayDetailModal
          journey={activeDetailJourney}
          totalPrice={Math.round(option.totalPrice / 2)}
          currency={option.currency}
          cabinClass={option.cabinClass}
          baggage={option.baggage}
          direction={activeDetailJourney === option.outboundJourney ? 'outbound' : 'return'}
          onClose={() => setActiveDetailJourney(null)}
        />
      )}
    </>
  );
}

// ─── Small panel atoms ────────────────────────────────────────────────────────

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-bold text-slate-900 uppercase tracking-[0.15em] mb-3">{title}</p>
      {children}
    </div>
  );
}

function InfoStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-0.5">{label}</p>
      <div className="flex items-baseline gap-1.5">
        <p className="text-lg font-bold text-slate-900 leading-tight">{value}</p>
        {sub && <span className="text-[8px] font-semibold text-slate-400 uppercase tracking-wider">({sub})</span>}
      </div>
    </div>
  );
}

function PolicyRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      {icon}
      <span className="text-[10px] font-medium text-slate-700 uppercase tracking-tight">{label}</span>
    </div>
  );
}

function BagRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
      <Luggage className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <span className="text-[9px] font-bold text-slate-700 uppercase tracking-tight">{label}</span>
    </div>
  );
}
