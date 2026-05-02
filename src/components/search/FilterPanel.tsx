'use client';

import { useState } from 'react';
import { ChevronDown, SlidersHorizontal, X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface FilterOption {
  id: string;
  label: string;
  count: number;
  minPrice: number | null;
  note?: string;
}

// ─── Section ──────────────────────────────────────────────────────────────────

function FilterSection({
  title, options, selected, onToggle, defaultOpen = true,
}: {
  title: string;
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (options.length === 0) return null;

  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/60 transition-colors"
      >
        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">{title}</span>
        <ChevronDown className={`w-3 h-3 text-slate-300 transition-transform duration-150 ${open ? '' : '-rotate-90'}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pb-2.5 px-2.5 space-y-0.5">
              {options.map(opt => {
                const active = selected.has(opt.id);
                const disabled = opt.count === 0;
                return (
                  <button
                    key={opt.id}
                    onClick={() => !disabled && onToggle(opt.id)}
                    disabled={disabled}
                    className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-all ${
                      disabled ? 'cursor-not-allowed' :
                      active   ? 'bg-[#1ABC9C]/15' : 'hover:bg-white/60'
                    }`}
                  >
                    {/* Custom checkbox */}
                    <div className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border transition-all ${
                      active   ? 'bg-[#1ABC9C] border-[#1ABC9C]' :
                      disabled ? 'bg-white/60 border-slate-200'  : 'bg-white border-slate-300'
                    }`}>
                      {active && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />}
                    </div>

                    {/* Label + count + price */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-semibold leading-none truncate text-slate-900">
                          {opt.label}
                        </span>
                        <span className="text-[9px] font-bold text-slate-900 shrink-0">({opt.count})</span>
                      </div>
                      {opt.note && (
                        <p className="text-[8px] text-[#1ABC9C] font-semibold mt-0.5 leading-none">{opt.note}</p>
                      )}
                      {opt.minPrice != null && (
                        <p className="text-[9px] font-bold text-slate-900 mt-0.5 leading-none">
                          From ${Math.round(opt.minPrice).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface FilterPanelProps {
  airlines: FilterOption[];
  classes: FilterOption[];
  features: FilterOption[];
  selectedAirlines: Set<string>;
  selectedClasses: Set<string>;
  selectedFeatures: Set<string>;
  onToggleAirline: (id: string) => void;
  onToggleClass: (id: string) => void;
  onToggleFeature: (id: string) => void;
  onClearAll: () => void;
  loading?: boolean;
}

export default function FilterPanel({
  airlines, classes, features,
  selectedAirlines, selectedClasses, selectedFeatures,
  onToggleAirline, onToggleClass, onToggleFeature,
  onClearAll, loading,
}: FilterPanelProps) {
  const activeCount = selectedAirlines.size + selectedClasses.size + selectedFeatures.size;
  const hasOptions = airlines.length > 0 || classes.length > 0 || features.length > 0;

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className={`h-7 rounded-lg skeleton opacity-${70 - i * 8}`} />
        ))}
      </div>
    );
  }

  if (!hasOptions) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-white/40 backdrop-blur-sm border-b border-white/30">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-3 h-3 text-slate-400" />
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Filters</span>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-[#1ABC9C] text-white text-[8px] font-bold leading-none">
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            onClick={onClearAll}
            className="flex items-center gap-1 text-[9px] font-semibold text-[#1ABC9C] hover:text-emerald-600 transition-colors"
          >
            <X className="w-2.5 h-2.5" /> Clear all
          </button>
        )}
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto scrollbar-light">
        <FilterSection title="Airlines"          options={airlines} selected={selectedAirlines} onToggle={onToggleAirline} defaultOpen={true}  />
        <FilterSection title="Preferred Class"   options={classes}  selected={selectedClasses}  onToggle={onToggleClass}   defaultOpen={false} />
        <FilterSection title="Travel & Baggage"  options={features} selected={selectedFeatures} onToggle={onToggleFeature} defaultOpen={false} />
      </div>
    </div>
  );
}
