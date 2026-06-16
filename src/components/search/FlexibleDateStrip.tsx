'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { CalendarDays, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

interface TileData {
  minPrice: number | null;
  currency: string;
  offerId: string | null;
  airline: string | null;
}

type ValidationState =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'price_changed'; currentPrice: number; previousPrice: number; currency: string }
  | { kind: 'unavailable' };

interface FlexibleDateStripProps {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  adults: string;
  cabin: string;
  tripParam: string;
  /** Min price from the already-loaded full search — anchors the center tile price. */
  currentMinPrice?: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function isFutureDate(dateStr: string): boolean {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00Z') > today;
}

function fmt(d: string) {
  try { return format(new Date(d + 'T12:00:00'), 'MMM d'); }
  catch { return d; }
}

function fmtPrice(p: number) {
  return `$${Math.round(p).toLocaleString()}`;
}

// ── Component ──────────────────────────────────────────────────────────────

const CENTER_IDX = 3;
const NON_CENTER = [0, 1, 2, 4, 5, 6];

export default function FlexibleDateStrip({
  origin, destination, departureDate, returnDate, adults, cabin, tripParam, currentMinPrice,
}: FlexibleDateStripProps) {
  const router = useRouter();

  // Build date pairs once from props
  const pairs = [
    { dep: shiftDate(departureDate, -3), ret: returnDate },
    { dep: shiftDate(departureDate, -2), ret: returnDate },
    { dep: shiftDate(departureDate, -1), ret: returnDate },
    { dep: departureDate,               ret: returnDate },   // center
    { dep: departureDate,               ret: shiftDate(returnDate, 1) },
    { dep: departureDate,               ret: shiftDate(returnDate, 2) },
    { dep: departureDate,               ret: shiftDate(returnDate, 3) },
  ];

  // Per-tile state
  const [tileData,    setTileData]    = useState<Partial<Record<number, TileData>>>({});
  const [tileLoading, setTileLoading] = useState<Partial<Record<number, boolean>>>(
    NON_CENTER.reduce((a, i) => ({ ...a, [i]: true }), {}),
  );
  const [validation, setValidation] = useState<Partial<Record<number, ValidationState>>>({});
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const [suggestedIdx, setSuggestedIdx] = useState<number | null>(null);

  // ── Batched progressive fetching ──────────────────────────────────────
  useEffect(() => {
    if (!origin || !destination || !departureDate || !returnDate) return;

    let cancelled = false;
    const controllers: AbortController[] = [];

    // Reset state for non-center tiles
    setTileData({});
    setTileLoading(NON_CENTER.reduce((a, i) => ({ ...a, [i]: true }), {}));

    async function run() {
      // Fetch tiles with concurrency limit of 2 to stay under Duffel rate limits.
      // Priority: tiles closest to the selected date first (4,2 → 5,1 → 6,0).
      const FETCH_ORDER = [4, 2, 5, 1, 6, 0];
      const CONCURRENCY = 2;
      const MAX_RETRIES = 1;
      const RETRY_DELAY = 1500;

      // Simple semaphore — limits in-flight requests to CONCURRENCY
      let running = 0;
      const queue: Array<() => void> = [];
      function acquire(): Promise<void> {
        if (running < CONCURRENCY) { running++; return Promise.resolve(); }
        return new Promise<void>((resolve) => queue.push(() => { running++; resolve(); }));
      }
      function release(): void {
        running--;
        if (queue.length > 0) queue.shift()!();
      }

      async function fetchTile(idx: number) {
        if (cancelled) return;
        const { dep, ret } = pairs[idx];

        if (!isFutureDate(dep)) {
          setTileLoading((prev) => ({ ...prev, [idx]: false }));
          return;
        }

        await acquire();
        if (cancelled) { release(); return; }

        const ctrl = new AbortController();
        controllers.push(ctrl);

        let attempt = 0;
        let success = false;

        while (attempt <= MAX_RETRIES && !cancelled && !success) {
          try {
            if (attempt > 0) {
              await new Promise((r) => setTimeout(r, RETRY_DELAY));
            }

            const params = new URLSearchParams({ origin, destination, dep, ret, adults, cabin });
            const r = await fetch(`/api/flex-prices?${params}`, { signal: ctrl.signal });

            if (cancelled) break;

            if (r.status === 429 || r.status >= 500) {
              attempt++;
              continue;
            }
            if (!r.ok) break;

            const data: TileData = await r.json();
            if (!cancelled) {
              setTileData((prev) => ({ ...prev, [idx]: data }));
              success = true;
            }
          } catch (err: unknown) {
            if ((err as Error)?.name === 'AbortError') break;
            attempt++;
          }
        }

        if (!cancelled) setTileLoading((prev) => ({ ...prev, [idx]: false }));
        release();
      }

      // Launch all tiles — the semaphore controls concurrency
      await Promise.allSettled(FETCH_ORDER.map(fetchTile));
    }

    run();
    return () => { cancelled = true; controllers.forEach((c) => c.abort()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, departureDate, returnDate, adults, cabin]);

  // ── Derived values ────────────────────────────────────────────────────
  // Build effective per-tile price: center uses currentMinPrice; others use fetched data
  const effectivePrices: (number | null)[] = pairs.map((_, i) => {
    if (i === CENTER_IDX) return currentMinPrice ?? null;
    return tileData[i]?.minPrice ?? null;
  });

  const validNonCenter = effectivePrices.filter((p, i) => i !== CENTER_IDX && p !== null) as number[];
  const lowestPrice = validNonCenter.length > 0 ? Math.min(...validNonCenter) : null;

  // ── Click → validate → navigate ──────────────────────────────────────
  function navigateTo(dep: string, ret: string) {
    const p = new URLSearchParams({ origin, destination, date: dep, return: ret, adults, cabin, trip: tripParam });
    router.push(`/search?${p}`);
  }

  async function handleClick(idx: number) {
    if (idx === CENTER_IDX) return;
    const price = effectivePrices[idx];
    if (!price) return;

    // Navigate directly — the full search on the target page provides
    // the authoritative live prices. Skipping validate-offer avoids
    // showing a transient validated price that may differ from the
    // fresh search results on the destination page.
    navigateTo(pairs[idx].dep, pairs[idx].ret);
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="py-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Flexible dates</p>
        <span className="text-[9px] text-black font-medium">· adjust departure or return ±3 days</span>
        <span className="ml-auto flex items-center gap-1 text-[9px] text-[#1ABC9C] font-semibold">
          <ShieldCheck className="w-3 h-3" /> Live prices
        </span>
      </div>

      <div
        className="flex items-stretch gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden py-1 -my-1"
        style={{ scrollbarWidth: 'none', overflowY: 'visible' }}
      >
        {pairs.map((pair, idx) => {
          const isCenter    = idx === CENTER_IDX;
          const loading     = !isCenter && !!tileLoading[idx];
          const price       = effectivePrices[idx];
          const noFare      = price === null;
          const isCheapest  = !noFare && !isCenter && price === lowestPrice;
          const vs          = validation[idx] ?? { kind: 'idle' };
          const isValidating = vs.kind === 'validating';
          const isSuggested = suggestedIdx === idx && vs.kind !== 'unavailable';

          return (
            <div key={idx} className="flex-1 min-w-[88px] relative">
              <motion.button
                whileHover={!noFare && !isCenter && !loading && !isValidating ? { scale: 1.03, y: -1 } : {}}
                whileTap={!noFare && !isCenter && !loading && !isValidating ? { scale: 0.97 } : {}}
                onClick={() => handleClick(idx)}
                disabled={noFare || isCenter || loading || isValidating || vs.kind === 'unavailable'}
                className={cn(
                  'w-full h-full rounded-xl px-2.5 py-2 text-left transition-all border',
                  isCenter
                    ? 'bg-[#0F172A] border-[#0F172A] text-white shadow-lg cursor-default'
                    : loading
                      ? 'bg-slate-50 border-slate-100 animate-pulse cursor-wait'
                      : noFare
                        ? 'bg-slate-50 border-slate-100 opacity-40 cursor-not-allowed'
                        : vs.kind === 'unavailable'
                          ? 'bg-red-50/60 border-red-200 opacity-50 cursor-not-allowed line-through'
                          : isSuggested
                            ? 'bg-[#1ABC9C]/10 border-[#1ABC9C] shadow-md shadow-[#1ABC9C]/15 ring-2 ring-[#1ABC9C]/40 animate-pulse cursor-pointer'
                            : vs.kind === 'price_changed'
                              ? 'bg-amber-50 border-amber-300'
                              : isCheapest
                                ? 'bg-[#1ABC9C]/5 border-[#1ABC9C]/30 hover:border-[#1ABC9C]/60 hover:shadow-sm cursor-pointer'
                                : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm cursor-pointer',
                )}
              >
                <p className={cn(
                  'text-[9px] font-semibold leading-tight whitespace-nowrap',
                  isCenter ? 'text-white/50' : 'text-slate-400',
                )}>
                  {fmt(pair.dep)} – {fmt(pair.ret)}
                </p>

                <p className={cn(
                  'text-sm font-black mt-1 leading-none',
                  isCenter           ? 'text-white'
                    : vs.kind === 'unavailable' ? 'text-red-400 line-through'
                    : isSuggested    ? 'text-[#1ABC9C]'
                    : vs.kind === 'price_changed' ? 'text-amber-600'
                    : isCheapest     ? 'text-[#1ABC9C]'
                    : loading || noFare ? 'text-slate-300'
                    : 'text-slate-800',
                )}>
                  {isValidating
                    ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                    : loading
                      ? '···'
                      : vs.kind === 'unavailable'
                        ? fmtPrice(price!)
                        : noFare
                          ? 'No fare'
                          : fmtPrice(price!)}
                </p>

                {/* Fixed-height label row — always rendered to keep all tiles the same height */}
                <p className={cn(
                  'text-[8px] font-black uppercase tracking-wider mt-0.5 h-3 leading-3',
                  isCenter                        ? 'text-white/40'
                    : vs.kind === 'unavailable'   ? 'text-red-400'
                    : isSuggested                 ? 'text-[#1ABC9C]'
                    : vs.kind === 'price_changed' ? 'text-amber-500'
                    : isCheapest                  ? 'text-[#1ABC9C]'
                    : 'text-transparent select-none',
                )}>
                  {isCenter ? 'Selected'
                    : vs.kind === 'unavailable' ? 'Sold out'
                    : isSuggested ? 'Next best ↗'
                    : vs.kind === 'price_changed' ? 'Updated ↑'
                    : isCheapest && !noFare && vs.kind === 'idle' ? 'Lowest ↓'
                    : '·'}
                </p>
              </motion.button>

              {/* Price-changed confirmation dropdown */}
              <AnimatePresence>
                {vs.kind === 'price_changed' && pendingIdx === idx && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-white border border-amber-300 rounded-xl shadow-lg p-2.5 min-w-[160px]"
                  >
                    <div className="flex items-start gap-1.5 mb-2">
                      <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-[10px] text-slate-700 leading-tight font-medium">
                        Price updated to{' '}
                        <span className="font-black text-slate-900">{fmtPrice(vs.currentPrice)}</span>
                        {' '}(was {fmtPrice(vs.previousPrice)})
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => {
                          setPendingIdx(null);
                          setValidation((prev) => ({ ...prev, [idx]: { kind: 'idle' } }));
                          navigateTo(pair.dep, pair.ret);
                        }}
                        className="flex-1 text-[9px] font-black bg-[#0F172A] text-white rounded-lg py-1.5 px-2 hover:bg-slate-700 transition-colors"
                      >
                        Continue
                      </button>
                      <button
                        onClick={() => {
                          setPendingIdx(null);
                          setValidation((prev) => ({ ...prev, [idx]: { kind: 'idle' } }));
                        }}
                        className="flex-1 text-[9px] font-bold text-slate-500 rounded-lg py-1.5 px-2 border border-slate-200 hover:border-slate-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
