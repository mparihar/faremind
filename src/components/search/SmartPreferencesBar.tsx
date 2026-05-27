'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DollarSign,
  Clock,
  Plane,
  Sunrise,
  Sun,
  Sunset,
  Moon,
  Sparkles,
  Star,
  Zap,
  TrendingDown,
  ChevronDown,
  X,
  Minimize2,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  BarChart3,
  CalendarDays,
} from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import {
  usePreferencesStore,
  type StopsPreference,
  type DepartureWindow,
  type SortPreference,
} from '@/store/usePreferencesStore';
import type { RoundTripSortMode } from '@/lib/round-trip-types';

// ─── Sub-components ───

interface PillButtonProps {
  icon: React.ReactNode;
  label: string;
  value?: string;
  active?: boolean;
  accent?: 'brand' | 'accent' | 'success' | 'warning';
  onClick: () => void;
}

function PillButton({ icon, label, value, active, accent = 'brand', onClick }: PillButtonProps) {
  const accentMap = {
    brand: { active: 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30 text-[#0F172A] shadow-sm shadow-[#1ABC9C]/10', dot: 'bg-[#1ABC9C]' },
    accent: { active: 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30 text-[#0F172A] shadow-sm shadow-[#1ABC9C]/10', dot: 'bg-[#1ABC9C]' },
    success: { active: 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30 text-[#0F172A] shadow-sm shadow-[#1ABC9C]/10', dot: 'bg-[#1ABC9C]' },
    warning: { active: 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30 text-[#0F172A] shadow-sm shadow-[#1ABC9C]/10', dot: 'bg-[#1ABC9C]' },
  };

  const colors = accentMap[accent];

  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-semibold border transition-all duration-200 tracking-tight',
        active
          ? `${colors.active}`
          : 'bg-white border-gray-200 text-black hover:bg-gray-50 hover:border-gray-300 hover:text-black shadow-sm'
      )}
    >
      <span className="shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">{icon}</span>
      <span className="whitespace-nowrap">{value || label}</span>
      <ChevronDown className="w-4 h-4 opacity-40 group-hover:opacity-70 transition-opacity" />
      {active && (
        <motion.div
          layoutId={`pill-dot-${label}`}
          className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${colors.dot}`}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
        />
      )}
    </button>
  );
}

// ─── Dropdown Panels ───

interface DropdownProps {
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

function Dropdown({ onClose, children, className }: DropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Attach synchronously — no setTimeout so cleanup always removes what was added
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      initial={{ y: -6, scale: 0.97 }}
      animate={{ y: 0, scale: 1 }}
      exit={{ y: -4, scale: 0.98 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      style={{ backgroundColor: '#ffffff' }}
      className={cn(
        'absolute top-full mt-2 z-[9999] min-w-[200px]',
        'rounded-2xl bg-white border border-gray-200',
        'shadow-2xl shadow-black/20 p-2',
        className
      )}
    >
      {children}
    </motion.div>
  );
}

function DropdownOption({
  selected,
  onClick,
  children,
  accent = 'brand',
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-2.5',
        selected
          ? 'bg-[#1ABC9C]/15 text-[#0d9e83] ring-1 ring-[#1ABC9C]/40'
          : 'text-black hover:bg-gray-100 hover:text-black'
      )}
    >
      {children}
    </button>
  );
}

// ─── Main Component ───

function formatJourneyDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return dateStr; }
}

export default function SmartPreferencesBar({
  tripType,
  rtSortMode = null,
  onRtSortChange,
  isEmbedded = false,
  className = '',
  departureDate,
  returnDate,
  origin,
  destination,
}: {
  tripType?: 'one_way' | 'round_trip';
  rtSortMode?: RoundTripSortMode | null;
  onRtSortChange?: (mode: RoundTripSortMode) => void;
  isEmbedded?: boolean;
  className?: string;
  departureDate?: string;
  returnDate?: string;
  origin?: string;
  destination?: string;
} = {}) {
  const prefs = usePreferencesStore();
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [budgetRange, setBudgetRange] = useState<[number, number]>([prefs.budgetMin, prefs.budgetMax]);

  const toggleDropdown = (name: string) => {
    setActiveDropdown((prev) => (prev === name ? null : name));
  };

  const closeDropdown = () => setActiveDropdown(null);

  // ─── Budget display ───
  const budgetLabel = prefs.budgetActive
    ? `${formatPrice(prefs.budgetMin)}–${formatPrice(prefs.budgetMax)}`
    : 'Any budget';

  // ─── Duration display ───
  const isRT = tripType === 'round_trip';
  const durationOptions = isRT
    ? [
        { value: 1200, label: '≤ 20h' },
        { value: 1440, label: '≤ 24h' },
        { value: 1800, label: '≤ 30h' },
        { value: 2160, label: '≤ 36h' },
        { value: null, label: 'Any' },
      ]
    : [
        { value: 180,  label: '≤ 3h'  },
        { value: 360,  label: '≤ 6h'  },
        { value: 600,  label: '≤ 10h' },
        { value: null, label: 'Any'   },
      ];
  const durationLabel = prefs.maxDuration
    ? `≤ ${Math.floor(prefs.maxDuration / 60)}h`
    : 'Any duration';

  // ─── Stops display ───
  const stopsOptions: { value: StopsPreference; label: string; icon: React.ReactNode }[] = [
    { value: 'nonstop', label: 'Nonstop only',   icon: <Plane className="w-3.5 h-3.5" /> },
    { value: '1stop',   label: '1 stop or fewer', icon: <span className="text-xs font-bold">1×</span> },
    { value: '2stop',   label: '2 stops or fewer',icon: <span className="text-xs font-bold">2×</span> },
    { value: 'any',     label: 'Any stops',        icon: <span className="text-xs font-bold">∞</span> },
  ];
  const stopsLabel =
    prefs.stops === 'nonstop' ? 'Nonstop'
    : prefs.stops === '1stop'  ? '1 stop'
    : prefs.stops === '2stop'  ? '2 stops'
    : 'Any stops';

  // ─── Departure window ───
  const windowOptions: { value: DepartureWindow; label: string; sub: string; icon: React.ReactNode }[] = [
    { value: 'morning',   label: 'Morning',          sub: '5 AM – 12 PM', icon: <Sunrise className="w-3.5 h-3.5" /> },
    { value: 'afternoon', label: 'Afternoon',         sub: '12 PM – 5 PM', icon: <Sun     className="w-3.5 h-3.5" /> },
    { value: 'evening',   label: 'Evening',           sub: '5 PM – 9 PM',  icon: <Sunset  className="w-3.5 h-3.5" /> },
    { value: 'night',     label: 'Night / Red-eye',   sub: '9 PM – 5 AM',  icon: <Moon    className="w-3.5 h-3.5" /> },
  ];
  const windowLabel = prefs.departureWindow
    ? windowOptions.find((w) => w.value === prefs.departureWindow)?.label || 'Any time'
    : 'Any time';
  const windowIcon = prefs.departureWindow
    ? windowOptions.find((w) => w.value === prefs.departureWindow)?.icon
    : <Sunrise className="w-3.5 h-3.5" />;

  // ─── Sort display ───
  const sortOptions: { value: SortPreference; label: string; description: string; icon: React.ReactNode }[] = [
    { value: 'any',      label: 'Default',  description: 'Standard ordering',  icon: <span className="text-xs font-bold">✦</span> },
    { value: 'cheapest', label: 'Cheapest', description: 'Lowest price first', icon: <TrendingDown className="w-3.5 h-3.5" /> },
    { value: 'fastest',  label: 'Fastest',  description: 'Shortest flight time',icon: <Zap         className="w-3.5 h-3.5" /> },
  ];

  const rtSortOptions: { key: RoundTripSortMode; icon: React.ReactNode; label: string; sub: string }[] = [
    { key: 'cheapest',     icon: <TrendingDown className="w-3.5 h-3.5" />, label: 'Cheapest',           sub: 'Lowest round-trip price' },
    { key: 'fastest',      icon: <Zap          className="w-3.5 h-3.5" />, label: 'Fastest',            sub: 'Shortest total flying time' },
    { key: 'fewest_stops', icon: <Minimize2    className="w-3.5 h-3.5" />, label: 'Fewest Stops',       sub: 'Minimum connections' },
    { key: 'earliest_dep', icon: <ArrowUp      className="w-3.5 h-3.5" />, label: 'Earliest Departure', sub: 'Departs soonest in the day' },
    { key: 'latest_dep',   icon: <ArrowDown    className="w-3.5 h-3.5" />, label: 'Latest Departure',   sub: 'Departs latest in the day' },
    { key: 'earliest_arr', icon: <ArrowUp      className="w-3.5 h-3.5" />, label: 'Earliest Arrival',   sub: 'Arrives soonest' },
    { key: 'latest_arr',   icon: <ArrowDown    className="w-3.5 h-3.5" />, label: 'Latest Arrival',     sub: 'Arrives latest' },
  ];

  const sortLabel = isRT
    ? (rtSortMode === null ? 'Sort By' : (rtSortOptions.find((o) => o.key === rtSortMode)?.label ?? 'Sort By'))
    : (prefs.sort === 'any' ? 'Sort By' : sortOptions.find((s) => s.value === prefs.sort)?.label ?? 'Sort By');

  const hasActivePrefs =
    prefs.budgetActive || prefs.maxDuration !== null || prefs.stops !== 'any' || prefs.departureWindow !== null;

  if (isEmbedded) {
    return (
      <div className={cn("relative z-50", className)}>
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'flex flex-wrap items-center gap-2 transition-all duration-500',
            (prefs.aiIntelligence && !activeDropdown) ? "opacity-60" : "opacity-100"
          )}
        >
          {/* Intelligence Toggle (Integrated) */}
          <div className="relative mr-2 flex flex-col group">
            <button
              onClick={() => prefs.setAiIntelligence(!prefs.aiIntelligence)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-xl text-[13px] font-semibold transition-all duration-300 border relative z-10',
                prefs.aiIntelligence
                  ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30 text-[#0F172A] shadow-[0_0_15px_rgba(26,188,156,0.3)] scale-[1.03]'
                  : 'bg-white border-gray-200 text-[#0F172A]/70 hover:text-[#0F172A] hover:border-gray-300'
              )}
            >
              <Sparkles className={cn(
                'w-3.5 h-3.5 transition-all duration-300',
                prefs.aiIntelligence ? 'text-[#1ABC9C]' : 'text-gray-400 group-hover:text-[#1ABC9C]'
              )} />
              <span className="tracking-tight whitespace-nowrap text-black">AI Intelligence</span>
              <div className={cn(
                'relative w-7 h-4 rounded-full transition-all duration-300 shrink-0',
                prefs.aiIntelligence ? 'bg-[#1ABC9C]' : 'bg-gray-200'
              )}>
                <motion.div
                  className="absolute top-[2px] w-3 h-3 rounded-full bg-white shadow-sm"
                  animate={{ left: prefs.aiIntelligence ? 14 : 2 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              </div>
            </button>
          </div>

          {/* Filter Group */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Budget Pill */}
            <div className="relative">
              <PillButton
                icon={<DollarSign className="w-4 h-4" />}
                label="Budget"
                value={budgetLabel}
                active={prefs.budgetActive}
                accent="success"
                onClick={() => toggleDropdown('budget')}
              />
              <AnimatePresence>
                {activeDropdown === 'budget' && (
                  <Dropdown onClose={closeDropdown} className="w-72 left-0">
                    <p className="text-xs text-black uppercase tracking-wider font-bold mb-2 px-1">Quick Budget</p>
                    <div className="flex flex-wrap gap-1.5 mb-3 px-1">
                      <button
                        onClick={() => { prefs.setBudgetActive(false); setBudgetRange([0, 2000]); closeDropdown(); }}
                        className={cn('text-xs px-2.5 py-1 rounded-full border font-semibold transition-all',
                          !prefs.budgetActive ? 'bg-[#1ABC9C] text-white border-[#1ABC9C]' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300')}
                      >Any</button>
                      {[750, 1000, 1250, 1500].map((preset) => (
                        <button
                          key={preset}
                          onClick={() => { prefs.setBudget(0, preset); setBudgetRange([0, preset]); closeDropdown(); }}
                          className={cn('text-xs px-2.5 py-1 rounded-full border font-semibold transition-all',
                            prefs.budgetActive && prefs.budgetMax === preset && prefs.budgetMin === 0
                              ? 'bg-[#1ABC9C] text-white border-[#1ABC9C]'
                              : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300')}
                        >
                          Under ${preset.toLocaleString()}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-black uppercase tracking-wider font-bold mb-2 px-1">Custom Range</p>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex-1">
                        <label className="text-xs text-gray-500 mb-1 block">Min</label>
                        <input
                          type="number"
                          min={0}
                          max={budgetRange[1]}
                          step={50}
                          value={budgetRange[0]}
                          onChange={(e) => setBudgetRange([Number(e.target.value), budgetRange[1]])}
                          className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 text-sm font-medium focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100 transition-all"
                        />
                      </div>
                      <span className="text-gray-400 text-sm mt-5">â€“</span>
                      <div className="flex-1">
                        <label className="text-xs text-gray-500 mb-1 block">Max</label>
                        <input
                          type="number"
                          min={budgetRange[0]}
                          max={5000}
                          step={50}
                          value={budgetRange[1]}
                          onChange={(e) => setBudgetRange([budgetRange[0], Number(e.target.value)])}
                          className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 text-sm font-medium focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100 transition-all"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => { prefs.setBudget(budgetRange[0], budgetRange[1]); closeDropdown(); }}
                      className="w-full py-2.5 bg-[#1ABC9C] text-white rounded-xl text-sm font-bold shadow-lg shadow-[#1ABC9C]/10 hover:brightness-110 active:scale-[0.98] transition-all"
                    >
                      Apply Range
                    </button>
                  </Dropdown>
                )}
              </AnimatePresence>
            </div>

            {/* Duration Pill */}
            <div className="relative">
              <PillButton
                icon={<Clock className="w-4 h-4" />}
                label="Duration"
                value={prefs.maxDuration ? `≤ ${Math.round(prefs.maxDuration / 60)}h` : 'Any'}
                active={prefs.maxDuration !== null}
                accent="brand"
                onClick={() => toggleDropdown('duration')}
              />
              <AnimatePresence>
                {activeDropdown === 'duration' && (
                  <Dropdown onClose={closeDropdown} className="w-56 left-0">
                    <p className="text-xs text-black uppercase tracking-wider font-bold mb-3 px-1">Max Travel Time</p>
                    <button
                      onClick={() => { prefs.setMaxDuration(null); closeDropdown(); }}
                      className={cn('w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-between mb-1',
                        prefs.maxDuration === null ? 'bg-[#1ABC9C]/15 text-[#0d9e83]' : 'text-black hover:bg-gray-100')}
                    >
                      <span>Any duration</span>
                      {prefs.maxDuration === null && <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C]" />}
                    </button>
                    {durationOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { prefs.setMaxDuration(opt.value); closeDropdown(); }}
                        className={cn('w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-between mb-1',
                          prefs.maxDuration === opt.value ? 'bg-[#1ABC9C]/15 text-[#0d9e83]' : 'text-black hover:bg-gray-100')}
                      >
                        <span>{opt.label}</span>
                        {prefs.maxDuration === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C]" />}
                      </button>
                    ))}
                  </Dropdown>
                )}
              </AnimatePresence>
            </div>

            {/* Stops Pill */}
            <div className="relative">
              <PillButton
                icon={<Plane className="w-4 h-4" />}
                label="Stops"
                value={prefs.stops === 'any' ? 'Any' : prefs.stops === 'nonstop' ? 'Non-stop' : '1 stop'}
                active={prefs.stops !== 'any'}
                accent="brand"
                onClick={() => toggleDropdown('stops')}
              />
              <AnimatePresence>
                {activeDropdown === 'stops' && (
                  <Dropdown onClose={closeDropdown} className="w-56 left-0">
                    <p className="text-xs text-black uppercase tracking-wider font-bold mb-3 px-1">Maximum Stops</p>
                    {([{ v: 'any', l: 'Any stops' }, { v: 'nonstop', l: 'Non-stop only' }, { v: '1stop', l: '1 stop max' }] as const).map(({ v, l }) => (
                      <button
                        key={v}
                        onClick={() => { prefs.setStops(v); closeDropdown(); }}
                        className={cn('w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-between mb-1',
                          prefs.stops === v ? 'bg-[#1ABC9C]/15 text-[#0d9e83]' : 'text-black hover:bg-gray-100')}
                      >
                        <span>{l}</span>
                        {prefs.stops === v && <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C]" />}
                      </button>
                    ))}
                  </Dropdown>
                )}
              </AnimatePresence>
            </div>

            {/* Time Pill */}
            <div className="relative">
              <PillButton
                icon={windowIcon}
                label="Time"
                value={windowLabel}
                active={prefs.departureWindow !== null}
                accent="warning"
                onClick={() => toggleDropdown('time')}
              />
              <AnimatePresence>
                {activeDropdown === 'time' && (
                  <Dropdown onClose={closeDropdown} className="w-64 left-0">
                    <p className="text-xs text-black uppercase tracking-wider font-bold mb-3 px-1">Departure Window</p>
                    <button
                      onClick={() => { prefs.setDepartureWindow(null); closeDropdown(); }}
                      className={cn('w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-between mb-1',
                        prefs.departureWindow === null ? 'bg-[#1ABC9C]/15 text-[#0d9e83]' : 'text-black hover:bg-gray-100')}
                    >
                      <div className="flex items-center gap-2.5">
                        <Sunrise className="w-4 h-4 opacity-40" />
                        <span>Any time</span>
                      </div>
                      {prefs.departureWindow === null && <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C]" />}
                    </button>
                    {windowOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { prefs.setDepartureWindow(opt.value); closeDropdown(); }}
                        className={cn('w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-between mb-1',
                          prefs.departureWindow === opt.value ? 'bg-[#1ABC9C]/15 text-[#0d9e83]' : 'text-black hover:bg-gray-100')}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="opacity-70">{opt.icon}</span>
                          <div className="flex flex-col">
                            <span>{opt.label}</span>
                            <span className="text-[10px] text-gray-500 font-medium">{opt.sub}</span>
                          </div>
                        </div>
                        {prefs.departureWindow === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C]" />}
                      </button>
                    ))}
                  </Dropdown>
                )}
              </AnimatePresence>
            </div>

            {/* Sort Pill */}
            <div className="relative">
              <PillButton
                icon={<BarChart3 className="w-4 h-4" />}
                label="Sort By"
                value={sortLabel}
                active={isRT ? rtSortMode !== null : prefs.sort !== 'any'}
                accent="brand"
                onClick={() => toggleDropdown('sort')}
              />
              <AnimatePresence>
                {activeDropdown === 'sort' && (
                  <Dropdown onClose={closeDropdown} className="w-72 left-0">
                    <p className="text-xs text-black uppercase tracking-wider font-bold mb-3 px-1">Sort results by</p>
                    {isRT
                      ? rtSortOptions.map((opt) => (
                          <DropdownOption
                            key={opt.key}
                            selected={rtSortMode === opt.key}
                            onClick={() => { onRtSortChange?.(opt.key); closeDropdown(); }}
                          >
                            <span className="w-4 flex justify-center shrink-0">{opt.icon}</span>
                            <div className="flex flex-col">
                              <span>{opt.label}</span>
                              <span className="text-xs text-gray-600">{opt.sub}</span>
                            </div>
                          </DropdownOption>
                        ))
                      : sortOptions.map((opt) => (
                          <DropdownOption
                            key={opt.value}
                            selected={prefs.sort === opt.value}
                            onClick={() => { prefs.setSort(opt.value); closeDropdown(); }}
                          >
                            <span className="w-4 flex justify-center shrink-0">{opt.icon}</span>
                            <div className="flex flex-col">
                              <span>{opt.label}</span>
                              <span className="text-xs text-gray-600">{opt.description}</span>
                            </div>
                          </DropdownOption>
                        ))}
                  </Dropdown>
                )}
              </AnimatePresence>
            </div>

            {/* Reset button */}
            <AnimatePresence>
              {hasActivePrefs && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => prefs.resetAll()}
                  className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                  title="Reset all preferences"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* AI Microcopy */}
        <AnimatePresence>
          {prefs.aiIntelligence && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="flex items-center justify-start px-1 mt-3"
            >
              <div className="bg-[#1ABC9C] text-white px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
                <Zap className="w-3 h-3 fill-white" />
                AI optimizes price, duration, and stops automatically
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Journey Dates */}
        {departureDate && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 px-1 mt-2"
          >
            <CalendarDays className="w-3.5 h-3.5 text-[#1ABC9C] shrink-0" />
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Outbound</span>
              <span className="text-slate-800">{formatJourneyDate(departureDate)}</span>
              {tripType === 'round_trip' && returnDate && (
                <>
                  <ArrowRight className="w-3 h-3 text-slate-300 mx-0.5" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Return</span>
                  <span className="text-slate-800">{formatJourneyDate(returnDate)}</span>
                </>
              )}
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("w-full max-w-7xl mx-auto mb-4", className)}>
      {/* Preferences Row with Integrated Toggle */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className={cn(
          'relative z-50 flex flex-wrap items-center gap-2 px-3 py-2 rounded-2xl transition-all duration-500',
          'bg-white/80 backdrop-blur-xl border border-gray-200/80 shadow-xl shadow-black/5',
          prefs.aiIntelligence && 'border-[#1ABC9C]/30 ring-4 ring-[#1ABC9C]/5 shadow-[#1ABC9C]/10'
        )}
      >
        {/* Intelligence Toggle (Integrated) */}
        <div className="relative mr-2 flex flex-col group">
          <button
            onClick={() => prefs.setAiIntelligence(!prefs.aiIntelligence)}
            title="Uses AI to rank flights by price, duration, and stops automatically"
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-xl text-[13px] font-semibold transition-all duration-300 border relative z-10',
              prefs.aiIntelligence
                ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30 text-[#0F172A] shadow-[0_0_15px_rgba(26,188,156,0.3)] scale-[1.03]'
                : 'bg-white border-gray-200 text-[#0F172A]/70 hover:text-[#0F172A] hover:border-gray-300'
            )}
          >
            <Sparkles className={cn(
              'w-3.5 h-3.5 transition-all duration-300',
              prefs.aiIntelligence ? 'text-[#1ABC9C]' : 'text-gray-400 group-hover:text-[#1ABC9C]'
            )} />
            <span className="tracking-tight whitespace-nowrap text-black">AI Intelligence</span>
            <div className={cn(
              'relative w-7 h-4 rounded-full transition-all duration-300 shrink-0',
              prefs.aiIntelligence ? 'bg-[#1ABC9C]' : 'bg-gray-200'
            )}>
              <motion.div
                className="absolute top-[2px] w-3 h-3 rounded-full bg-white shadow-sm"
                animate={{ left: prefs.aiIntelligence ? 14 : 2 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </div>
          </button>
        </div>

        {prefs.aiIntelligence && (
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-[#1ABC9C]/[0.03] to-transparent pointer-events-none" />
        )}
        
        {/* Softened Filter Group when AI is active */}
        <div className={cn(
          "flex flex-wrap items-center gap-2 transition-all duration-500",
          (prefs.aiIntelligence && !activeDropdown) ? "opacity-60" : "opacity-100"
        )}>

        {/* ── Budget Pill ── */}
        <div className="relative">
          <PillButton
            icon={<DollarSign className="w-4 h-4" />}
            label="Budget"
            value={budgetLabel}
            active={prefs.budgetActive}

            accent="success"
            onClick={() => toggleDropdown('budget')}
          />
          <AnimatePresence>
            {activeDropdown === 'budget' && (
              <Dropdown onClose={closeDropdown} className="w-72 left-0">
                <p className="text-xs text-black uppercase tracking-wider font-bold mb-2 px-1">Quick Budget</p>
                <div className="flex flex-wrap gap-1.5 mb-3 px-1">
                  <button
                    onClick={() => { prefs.setBudgetActive(false); setBudgetRange([0, 2000]); closeDropdown(); }}
                    className={cn('text-xs px-2.5 py-1 rounded-full border font-semibold transition-all',
                      !prefs.budgetActive ? 'bg-[#1ABC9C] text-white border-[#1ABC9C]' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300')}
                  >Any</button>
                  {[750, 1000, 1250, 1500].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => { prefs.setBudget(0, preset); setBudgetRange([0, preset]); closeDropdown(); }}
                      className={cn('text-xs px-2.5 py-1 rounded-full border font-semibold transition-all',
                        prefs.budgetActive && prefs.budgetMax === preset && prefs.budgetMin === 0
                          ? 'bg-[#1ABC9C] text-white border-[#1ABC9C]'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300')}
                    >
                      Under ${preset.toLocaleString()}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-black uppercase tracking-wider font-bold mb-2 px-1">Custom Range</p>

                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">Min</label>
                    <input
                      type="number"
                      min={0}
                      max={budgetRange[1]}
                      step={50}
                      value={budgetRange[0]}
                      onChange={(e) => setBudgetRange([Number(e.target.value), budgetRange[1]])}
                      className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 text-sm font-medium focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100 transition-all"
                    />
                  </div>
                  <span className="text-gray-400 text-sm mt-5">–</span>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">Max</label>
                    <input
                      type="number"
                      min={budgetRange[0]}
                      step={50}
                      value={budgetRange[1]}
                      onChange={(e) => setBudgetRange([budgetRange[0], Number(e.target.value)])}
                      className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 text-sm font-medium focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100 transition-all"
                    />
                  </div>
                </div>

                <div className="px-1 mb-4">
                  <input
                    type="range"
                    min={0}
                    max={3000}
                    step={50}
                    value={budgetRange[1]}
                    onChange={(e) => setBudgetRange([budgetRange[0], Number(e.target.value)])}
                    className="w-full accent-green-500 h-1.5 rounded-full appearance-none bg-gray-200 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-green-500 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-1.5">
                    <span>$0</span>
                    <span>$3,000</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      prefs.setBudget(budgetRange[0], budgetRange[1]);
                      closeDropdown();
                    }}
                    className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold text-white bg-green-600 hover:bg-green-500 transition-all"
                  >
                    Apply
                  </button>
                  {prefs.budgetActive && (
                    <button
                      onClick={() => {
                        prefs.setBudgetActive(false);
                        setBudgetRange([0, 2000]);
                        closeDropdown();
                      }}
                      className="px-3 py-2 rounded-xl text-sm font-medium text-gray-500 bg-gray-100 hover:text-gray-700 hover:bg-gray-200 transition-all"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </Dropdown>
            )}
          </AnimatePresence>
        </div>

        {/* ── Duration Pill ── */}
        <div className="relative">
          <PillButton
            icon={<Clock className="w-4 h-4" />}
            label="Duration"
            value={durationLabel}
            active={prefs.maxDuration !== null}

            accent="accent"
            onClick={() => toggleDropdown('duration')}
          />
          <AnimatePresence>
            {activeDropdown === 'duration' && (
              <Dropdown onClose={closeDropdown}>
                <p className="text-xs text-black uppercase tracking-wider font-bold mb-2 px-1">Max Flight Time</p>
                <div className="space-y-0.5">
                  {durationOptions.map((opt) => (
                    <DropdownOption
                      key={opt.label}
                      selected={prefs.maxDuration === opt.value}
                      accent="accent"
                      onClick={() => {
                        prefs.setMaxDuration(opt.value);
                        closeDropdown();
                      }}
                    >
                      <Clock className="w-3.5 h-3.5 opacity-50 shrink-0" />
                      {opt.label}
                    </DropdownOption>
                  ))}
                </div>
              </Dropdown>
            )}
          </AnimatePresence>
        </div>

        {/* ── Stops Pill ── */}
        <div className="relative">
          <PillButton
            icon={<Plane className="w-4 h-4" />}
            label="Stops"
            value={stopsLabel}
            active={prefs.stops !== 'any'}

            accent="brand"
            onClick={() => toggleDropdown('stops')}
          />
          <AnimatePresence>
            {activeDropdown === 'stops' && (
              <Dropdown onClose={closeDropdown}>
                <p className="text-xs text-black uppercase tracking-wider font-bold mb-2 px-1">Stops Preference</p>
                <div className="space-y-0.5">
                  {stopsOptions.map((opt) => (
                    <DropdownOption
                      key={opt.value}
                      selected={prefs.stops === opt.value}
                      onClick={() => {
                        prefs.setStops(opt.value);
                        closeDropdown();
                      }}
                    >
                      <span className="w-4 flex justify-center shrink-0">{opt.icon}</span>
                      {opt.label}
                    </DropdownOption>
                  ))}
                </div>
              </Dropdown>
            )}
          </AnimatePresence>
        </div>

        {/* ── Separator ── */}
        <div className="hidden sm:block w-px h-6 bg-gray-200 mx-1" />

        {/* ── Departure Window Pill ── */}
        <div className="relative">
          <PillButton
            icon={windowIcon}
            label="Departure"
            value={windowLabel}
            active={prefs.departureWindow !== null}

            accent="warning"
            onClick={() => toggleDropdown('window')}
          />
          <AnimatePresence>
            {activeDropdown === 'window' && (
              <Dropdown onClose={closeDropdown} className="w-56">
                <p className="text-xs text-black uppercase tracking-wider font-bold mb-2 px-1">Departure Window</p>
                <div className="space-y-0.5">
                  <DropdownOption
                    selected={prefs.departureWindow === null}
                    onClick={() => {
                      prefs.setDepartureWindow(null);
                      closeDropdown();
                    }}
                  >
                    <span className="w-4 flex justify-center text-xs font-bold shrink-0">✦</span>
                    <span>Any time</span>
                  </DropdownOption>
                  {windowOptions.map((opt) => (
                    <DropdownOption
                      key={opt.value}
                      selected={prefs.departureWindow === opt.value}
                      onClick={() => {
                        prefs.setDepartureWindow(opt.value);
                        closeDropdown();
                      }}
                    >
                      <span className="w-4 flex justify-center shrink-0">{opt.icon}</span>
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-xs text-gray-600">{opt.sub}</span>
                      </div>
                    </DropdownOption>
                  ))}
                </div>
              </Dropdown>
            )}
          </AnimatePresence>
        </div>

        {/* ── Sort Pill ── */}
        <div className="relative">
          <PillButton
            icon={<Star className="w-4 h-4" />}
            label="Sort"
            value={sortLabel}
            active={isRT ? rtSortMode !== null : prefs.sort !== 'any'}

            accent="brand"
            onClick={() => toggleDropdown('sort')}
          />
          <AnimatePresence>
            {activeDropdown === 'sort' && (
              <Dropdown onClose={closeDropdown} className="right-0 left-auto w-64">
                <p className="text-xs text-black uppercase tracking-wider font-bold mb-2 px-1">Sort Results By</p>
                <div className="space-y-0.5">
                  {isRT
                    ? rtSortOptions.map((opt) => (
                        <DropdownOption
                          key={opt.key}
                          selected={rtSortMode === opt.key}
                          onClick={() => { onRtSortChange?.(opt.key); closeDropdown(); }}
                        >
                          <span className="w-4 flex justify-center shrink-0">{opt.icon}</span>
                          <div className="flex flex-col">
                            <span>{opt.label}</span>
                            <span className="text-xs text-gray-600">{opt.sub}</span>
                          </div>
                        </DropdownOption>
                      ))
                    : sortOptions.map((opt) => (
                        <DropdownOption
                          key={opt.value}
                          selected={prefs.sort === opt.value}
                          onClick={() => { prefs.setSort(opt.value); closeDropdown(); }}
                        >
                          <span className="w-4 flex justify-center shrink-0">{opt.icon}</span>
                          <div className="flex flex-col">
                            <span>{opt.label}</span>
                            <span className="text-xs text-gray-600">{opt.description}</span>
                          </div>
                        </DropdownOption>
                      ))}
                </div>
              </Dropdown>
            )}
          </AnimatePresence>
        </div>

        {/* Reset button */}
        <AnimatePresence>
          {hasActivePrefs && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => prefs.resetAll()}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
              title="Reset all preferences"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reset</span>
            </motion.button>
          )}
        </AnimatePresence>
        </div> {/* Close Softened Filter Group */}
      </motion.div>

      {/* AI Microcopy */}
      <AnimatePresence>
        {prefs.aiIntelligence && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="flex items-center justify-center px-3 mt-3"
          >
            <div className="bg-[#1ABC9C] text-white px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
              <Zap className="w-3 h-3 fill-white" />
              AI optimizes price, duration, and stops automatically
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Journey Dates */}
      {departureDate && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2.5 px-3 mt-3"
        >
          <CalendarDays className="w-4 h-4 text-[#1ABC9C] shrink-0" />
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Outbound</span>
            <span className="text-slate-800 font-bold">{formatJourneyDate(departureDate)}</span>
            {tripType === 'round_trip' && returnDate && (
              <>
                <ArrowRight className="w-3.5 h-3.5 text-slate-300 mx-0.5" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Return</span>
                <span className="text-slate-800 font-bold">{formatJourneyDate(returnDate)}</span>
              </>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
