'use client';

import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { SeatCabin, SeatElement } from '@/lib/seat-map-types';

// ── Passenger color palette ───────────────────────────────────────────────────

const PAX_BG    = ['bg-blue-500',   'bg-purple-500', 'bg-pink-500',   'bg-orange-500'];
const PAX_RING  = ['ring-blue-300', 'ring-purple-300','ring-pink-300', 'ring-orange-300'];
const PAX_HEX   = ['#3B82F6',      '#8B5CF6',        '#EC4899',       '#F97316'];
const PAX_LABEL = ['Traveler 1',   'Traveler 2',     'Traveler 3',    'Traveler 4'];

// ── Types ─────────────────────────────────────────────────────────────────────

interface SeatAssignment {
  designator: string;
  passengerIndex: number;
  price: number;
  currency: string;
  serviceId: string | null;
}

interface TooltipState {
  designator: string;
  type: string;
  price: number;
  currency: string;
  features: string[];
  x: number;
  y: number;
}

interface SeatGridProps {
  cabin: SeatCabin;
  assignments: SeatAssignment[];             // current seat assignments for this segment
  activePassengerIndex: number;
  passengerLabels: string[];
  onSeatClick: (
    designator: string,
    serviceId: string | null,
    price: number,
    currency: string,
  ) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSeatType(disclosures: string[]): string {
  if (disclosures.includes('window')) return 'Window';
  if (disclosures.includes('aisle'))  return 'Aisle';
  return 'Middle';
}

function formatFeatures(disclosures: string[]): string[] {
  const MAP: Record<string, string> = {
    extra_legroom:     'Extra legroom',
    exit_row:          'Exit row',
    window:            'Window seat',
    aisle:             'Aisle seat',
    bulkhead:          'Bulkhead row',
    restricted:        'Limited recline',
    quiet_zone:        'Quiet zone',
    overwing:          'Over wing',
    lavatory_nearby:   'Near lavatory',
  };
  return disclosures.filter(d => d !== 'window' && d !== 'aisle').map(d => MAP[d] ?? d);
}

function isPremium(disclosures: string[]): boolean {
  return disclosures.includes('extra_legroom') || disclosures.includes('exit_row');
}

// ── Seat button ───────────────────────────────────────────────────────────────

interface SeatButtonProps {
  element: SeatElement;
  assignedPaxIndex: number | null;
  isActivePax: boolean;
  onHover: (el: SeatElement | null, rect: DOMRect | null) => void;
  onClick: () => void;
}

function SeatButton({
  element, assignedPaxIndex, isActivePax, onHover, onClick,
}: SeatButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (ref.current) onHover(element, ref.current.getBoundingClientRect());
  }, [element, onHover]);

  const handleMouseLeave = useCallback(() => onHover(null, null), [onHover]);

  // Non-seat elements (lavatory, galley, etc.)
  if (element.type !== 'seat') {
    const ICONS: Record<string, string> = {
      lavatory: '🚻', galley: '🍽️', stairs: '↕', bassinet: '🍼', empty: '',
    };
    return (
      <div className="w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center text-2xl text-slate-400 rounded select-none">
        {ICONS[element.type] ?? ''}
      </div>
    );
  }

  // Occupied
  if (!element.available) {
    return (
      <button
        disabled
        className="w-11 h-11 sm:w-12 sm:h-12 rounded-lg bg-slate-200 border border-slate-300 cursor-not-allowed flex items-center justify-center"
        aria-label={`${element.designator} — occupied`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        ref={ref}
      >
        <span className="text-sm font-bold text-slate-500">
          {element.designator?.replace(/\d+/g, '')}
        </span>
      </button>
    );
  }

  const premium = isPremium(element.disclosures);

  // Assigned to a passenger
  if (assignedPaxIndex !== null) {
    const paxBg   = PAX_BG[assignedPaxIndex % PAX_BG.length];
    const paxRing = PAX_RING[assignedPaxIndex % PAX_RING.length];
    return (
      <motion.button
        ref={ref}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        className={`w-11 h-11 sm:w-12 sm:h-12 rounded-lg border-2 ${paxBg} border-white ring-2 ${paxRing} flex items-center justify-center cursor-pointer shadow-md`}
        aria-label={`${element.designator} — assigned to passenger ${assignedPaxIndex + 1}`}
      >
        <span className="text-sm font-extrabold text-white leading-none">
          {assignedPaxIndex + 1}
        </span>
      </motion.button>
    );
  }

  // Available — free
  const isFree = element.price === 0;
  const hoverCls = isActivePax
    ? 'hover:scale-110 hover:shadow-lg hover:brightness-110 cursor-pointer'
    : 'cursor-pointer hover:scale-105';

  return (
    <motion.button
      ref={ref}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      whileTap={{ scale: 0.92 }}
      className={`w-11 h-11 sm:w-12 sm:h-12 rounded-lg border flex items-center justify-center transition-all duration-100 ${hoverCls} ${
        premium
          ? 'bg-amber-400 border-amber-500'
          : isFree
            ? 'bg-emerald-500 border-emerald-600'
            : 'bg-sky-500 border-sky-600'
      }`}
      aria-label={`${element.designator} — ${isFree ? 'free' : `$${element.price}`}`}
    >
      <span className="text-sm font-bold text-white leading-none">
        {element.designator?.replace(/\d+/g, '')}
      </span>
    </motion.button>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function SeatTooltip({ tooltip }: { tooltip: TooltipState }) {
  const features = formatFeatures(tooltip.features);
  return (
    <div
      className="fixed z-[200] pointer-events-none"
      style={{ left: tooltip.x, top: tooltip.y - 8, transform: 'translate(-50%, -100%)' }}
    >
      <div className="bg-slate-900 text-white rounded-xl px-3 py-2.5 shadow-2xl min-w-[120px] text-center">
        <p className="text-sm font-extrabold">{tooltip.designator}</p>
        <p className="text-xs text-slate-300 mt-0.5">{tooltip.type}</p>
        <p className={`text-xs font-bold mt-1 ${tooltip.price === 0 ? 'text-emerald-400' : 'text-sky-400'}`}>
          {tooltip.price === 0 ? 'Free' : `$${tooltip.price.toFixed(0)}`}
        </p>
        {features.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {features.map(f => (
              <p key={f} className="text-xs text-amber-300">{f}</p>
            ))}
          </div>
        )}
        {/* Arrow */}
        <div className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-900" />
      </div>
    </div>
  );
}

// ── Main SeatGrid ─────────────────────────────────────────────────────────────

export default function SeatGrid({
  cabin,
  assignments,
  activePassengerIndex,
  passengerLabels,
  onSeatClick,
}: SeatGridProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const assignmentMap = new Map<string, number>(
    assignments.map(a => [a.designator, a.passengerIndex]),
  );

  const handleHover = useCallback((el: SeatElement | null, rect: DOMRect | null) => {
    if (!el || !rect || el.type !== 'seat') { setTooltip(null); return; }
    setTooltip({
      designator: el.designator ?? '',
      type: getSeatType(el.disclosures),
      price: el.price,
      currency: el.currency,
      features: el.disclosures,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, []);

  const { rows, columnHeaders } = cabin;
  if (rows.length === 0) return null;

  // Total columns per section for spacer calculation
  const sectionCount = columnHeaders.length;

  return (
    <div className="relative">
      {tooltip && <SeatTooltip tooltip={tooltip} />}

      {/* ── Unified top bar: passenger selector + legend ── */}
      <div className="flex items-center gap-3 mb-4 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">

        {/* Active passenger badge + label */}
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
          style={{ backgroundColor: PAX_HEX[activePassengerIndex % PAX_HEX.length] }}
        >
          {activePassengerIndex + 1}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-700 leading-none">
            Selecting for{' '}
            <span className="text-[#F97316] font-bold">
              {passengerLabels[activePassengerIndex] ?? PAX_LABEL[activePassengerIndex]}
            </span>
          </p>
          <p className="text-xs text-slate-400 mt-0.5 leading-none">Click a seat to assign</p>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-slate-200 shrink-0" />

        {/* Legend */}
        <div className="flex items-center gap-2.5 shrink-0">
          {[
            { color: 'bg-emerald-500', label: 'Free'     },
            { color: 'bg-sky-500',     label: 'Paid'     },
            { color: 'bg-amber-400',   label: 'Premium'  },
            { color: 'bg-slate-300',   label: 'Occupied' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-1">
              <div className={`w-3 h-3 rounded-sm ${item.color}`} />
              <span className="text-xs text-slate-500 font-medium">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-slate-200 shrink-0" />

        {/* Passenger dots */}
        <div className="flex gap-1 shrink-0">
          {passengerLabels.map((label, i) => {
            const assigned = assignments.filter(a => a.passengerIndex === i).length;
            return (
              <div
                key={i}
                title={`${label}${assigned ? ' — assigned' : ''}`}
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white transition-all ${
                  i === activePassengerIndex ? 'ring-2 ring-offset-1' : 'opacity-50'
                }`}
                style={{
                  backgroundColor: PAX_HEX[i % PAX_HEX.length],
                  // @ts-ignore
                  '--tw-ring-color': PAX_HEX[i % PAX_HEX.length],
                }}
              >
                {assigned ? '✓' : i + 1}
              </div>
            );
          })}
        </div>
      </div>

      {/* Aircraft wrapper — scrollable on small screens */}
      <div className="overflow-x-auto pb-2">
        <div className="inline-block min-w-full">

          {/* Column headers */}
          <div className="flex items-center gap-1 pl-12 mb-1.5">
            {columnHeaders.flatMap((cols, si) => [
              ...cols.map(col => (
                <div key={col} className="w-11 sm:w-12 text-center text-sm font-bold text-slate-600">
                  {col}
                </div>
              )),
              si < sectionCount - 1
                ? <div key={`ah-${si}`} className="w-5 sm:w-6" />
                : null,
            ])}
          </div>

          {/* Rows */}
          <div className="space-y-1">
            {rows.map((row, rowIdx) => (
              <div key={`row-${rowIdx}-${row.rowNumber}`} className={`flex items-center gap-1 ${row.isExitRow ? 'mt-2' : ''}`}>
                {/* Exit row marker */}
                {row.isExitRow && (
                  <div className="absolute -left-1 text-xs font-bold text-orange-400 rotate-90 whitespace-nowrap" />
                )}

                {/* Row number */}
                <div className="w-11 text-right pr-1.5 text-sm font-mono text-slate-500 shrink-0">
                  {row.isExitRow
                    ? <span className="text-orange-400 font-bold">{row.rowNumber}</span>
                    : row.rowNumber}
                </div>

                {/* Sections */}
                {row.sections.flatMap((section, si) => {
                  const expectedCols = columnHeaders[si]?.length ?? section.elements.length;
                  const padNeeded = Math.max(0, expectedCols - section.elements.length);
                  const hasSeat   = section.elements.some(el => el.type === 'seat');
                  const iconEls   = section.elements.filter(
                    el => el.type !== 'seat' && el.type !== 'empty',
                  );
                  // Span when visible icons are outnumbered by expected columns
                  // (covers both: fewer total elements AND empty-padded sections)
                  const hasIcon = !hasSeat && iconEls.length > 0 && iconEls.length < expectedCols;

                  const aisleDiv = si < sectionCount - 1
                    ? <div key={`aisle-${rowIdx}-${si}`} className="w-5 sm:w-6 flex items-center justify-center">
                        <div className="w-px h-5 bg-slate-300" />
                      </div>
                    : null;

                  // Non-seat icons that need to span the full section width
                  if (padNeeded > 0 && hasIcon) {
                    // use sm cell width (48px = w-12) so the container matches seat columns at sm: breakpoint
                    const spanW = expectedCols * 48 + (expectedCols - 1) * 4;
                    const ICONS: Record<string, string> = {
                      lavatory: '🚻', galley: '🍽️', stairs: '↕', bassinet: '🍼',
                    };
                    return [
                      <div
                        key={`span-${rowIdx}-${si}`}
                        className="flex items-center justify-around shrink-0 h-11 sm:h-12"
                        style={{ width: `${spanW}px` }}
                      >
                        {iconEls.map((el, eli) => {
                          const pillW = Math.floor((spanW / iconEls.length) * 0.78);
                          return (
                            <div
                              key={eli}
                              className="flex items-center justify-center text-2xl text-slate-400 bg-slate-100 rounded-xl shrink-0"
                              style={{ width: `${pillW}px`, height: '40px' }}
                            >
                              {ICONS[el.type]}
                            </div>
                          );
                        })}
                      </div>,
                      aisleDiv,
                    ];
                  }

                  // Normal seat section: pad with spacers if under-populated
                  const leftPad  = Math.floor(padNeeded / 2);
                  const rightPad = padNeeded - leftPad;
                  const seatEls  = section.elements.map((el) => {
                    const paxIdx = el.designator ? (assignmentMap.get(el.designator) ?? null) : null;
                    return (
                      <SeatButton
                        key={el.designator ?? `${rowIdx}-${si}-${el.type}-${section.elements.indexOf(el)}`}
                        element={el}
                        assignedPaxIndex={paxIdx}
                        isActivePax={true}
                        onHover={handleHover}
                        onClick={() => {
                          if (!el.designator) return;
                          onSeatClick(el.designator, el.serviceId, el.price, el.currency);
                        }}
                      />
                    );
                  });

                  return [
                    ...Array.from({ length: leftPad }, (_, i) => (
                      <div key={`lpad-${rowIdx}-${si}-${i}`} className="w-11 h-11 sm:w-12 sm:h-12 shrink-0" />
                    )),
                    ...seatEls,
                    ...Array.from({ length: rightPad }, (_, i) => (
                      <div key={`rpad-${rowIdx}-${si}-${i}`} className="w-11 h-11 sm:w-12 sm:h-12 shrink-0" />
                    )),
                    aisleDiv,
                  ];
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
