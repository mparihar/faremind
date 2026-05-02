'use client';

import { cn } from '@/lib/utils';
import { useSearchStore } from '@/store/useSearchStore';
import type { SortOption } from '@/lib/types';
import {
  SlidersHorizontal,
  DollarSign,
  Clock,
  ArrowUpDown,
  RefreshCcw,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SORT_OPTIONS: { value: SortOption; label: string; icon: typeof DollarSign }[] = [
  { value: 'price', label: 'Cheapest', icon: DollarSign },
  { value: 'duration', label: 'Fastest', icon: Clock },
  { value: 'departure', label: 'Departure', icon: ArrowUpDown },
];

const STOP_OPTIONS = [
  { value: 0, label: 'Nonstop only' },
  { value: 1, label: '1 stop or fewer' },
  { value: 2, label: '2 stops or fewer' },
];

interface FlightFiltersProps {
  totalResults: number;
  airlines: { code: string; name: string }[];
}

export default function FlightFilters({ totalResults, airlines }: FlightFiltersProps) {
  const { sortBy, setSortBy, filters, setFilters } = useSearchStore();
  const [showFilters, setShowFilters] = useState(false);

  const activeFilterCount = [
    filters.maxStops !== undefined,
    filters.refundableOnly,
    filters.airlines && filters.airlines.length > 0,
    filters.providers && filters.providers.length > 0,
  ].filter(Boolean).length;

  return (
    <div>
      {/* Top bar: Sort + Filter toggle */}
      <div className="flex items-center justify-between gap-4 mb-4">
        {/* Result count */}
        <p className="text-sm text-slate-400">
          <span className="text-white font-semibold">{totalResults}</span> flights found
        </p>

        <div className="flex items-center gap-2">
          {/* Sort buttons */}
          <div className="hidden sm:flex items-center rounded-xl bg-white/[0.04] border border-white/[0.06] p-1">
            {SORT_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  onClick={() => setSortBy(opt.value)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    sortBy === opt.value
                      ? 'bg-[#1ABC9C]/20 text-[#1ABC9C] shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  )}
                >
                  <Icon className="w-3 h-3" />
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Filter button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all border',
              showFilters || activeFilterCount > 0
                ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border-[#1ABC9C]/30'
                : 'bg-white/[0.04] text-slate-400 border-white/[0.06] hover:text-white'
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-[#1ABC9C] text-white text-[10px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Filter panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Filters</h3>
                <button
                  onClick={() => setFilters({ maxStops: undefined, refundableOnly: false, airlines: [], providers: [] })}
                  className="text-xs text-[#1ABC9C] hover:text-[#1ABC9C]/80 transition-colors"
                >
                  Clear all
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Stops */}
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-2 block">Stops</label>
                  <div className="space-y-2">
                    {STOP_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setFilters({ maxStops: filters.maxStops === opt.value ? undefined : opt.value })}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all',
                          filters.maxStops === opt.value
                            ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] ring-1 ring-[#1ABC9C]/30'
                            : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Refundable */}
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-2 block">Fare Type</label>
                  <button
                    onClick={() => setFilters({ refundableOnly: !filters.refundableOnly })}
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium transition-all',
                      filters.refundableOnly
                        ? 'bg-success-500/15 text-success-300 ring-1 ring-success-500/30'
                        : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
                    )}
                  >
                    <RefreshCcw className="w-3 h-3" />
                    Refundable only
                  </button>
                </div>

                {/* Airlines */}
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-2 block">Airlines</label>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {airlines.map((airline) => {
                      const isSelected = filters.airlines?.includes(airline.code);
                      return (
                        <button
                          key={airline.code}
                          onClick={() => {
                            const current = filters.airlines || [];
                            setFilters({
                              airlines: isSelected
                                ? current.filter((a) => a !== airline.code)
                                : [...current, airline.code],
                            });
                          }}
                          className={cn(
                            'w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-2',
                            isSelected
                              ? 'bg-[#1ABC9C]/15 text-[#1ABC9C]'
                              : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
                          )}
                        >
                          <div className={cn(
                            'w-3 h-3 rounded border transition-all',
                            isSelected
                              ? 'bg-[#1ABC9C] border-[#1ABC9C]'
                              : 'border-slate-600'
                          )} />
                          {airline.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Provider */}
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-2 block">Source</label>
                  <div className="space-y-2">
                    {[
                      { value: 'duffel' as const, label: 'NDC Direct (Duffel)' },
                      { value: 'amadeus' as const, label: 'GDS (Amadeus)' },
                    ].map((opt) => {
                      const isSelected = filters.providers?.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          onClick={() => {
                            const current = filters.providers || [];
                            setFilters({
                              providers: isSelected
                                ? current.filter((p) => p !== opt.value)
                                : [...current, opt.value],
                            });
                          }}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all',
                            isSelected
                              ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] ring-1 ring-[#1ABC9C]/30'
                              : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
