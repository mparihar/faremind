'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FlexPrice {
  dep: string;
  ret: string;
  minPrice: number | null;
  currency: string;
}

interface FlexibleDateStripProps {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  adults: string;
  cabin: string;
  tripParam: string;
  currentMinPrice?: number | null; // actual min from main search results — overrides center tile
}

function fmt(d: string) {
  try { return format(new Date(d + 'T12:00:00'), 'MMM d'); }
  catch { return d; }
}

export default function FlexibleDateStrip({
  origin, destination, departureDate, returnDate, adults, cabin, tripParam, currentMinPrice,
}: FlexibleDateStripProps) {
  const router = useRouter();
  const [prices, setPrices] = useState<FlexPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!origin || !destination || !departureDate || !returnDate) return;
    setLoading(true);
    setFailed(false);
    setPrices([]);

    const params = new URLSearchParams({ origin, destination, date: departureDate, returnDate, adults, cabin });
    fetch(`/api/flex-prices?${params}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => { setPrices(data.prices ?? []); setLoading(false); })
      .catch(() => { setFailed(true); setLoading(false); });
  }, [origin, destination, departureDate, returnDate, adults, cabin]);

  if (failed) return (
    <p className="text-[11px] text-slate-400 italic py-2 px-1">Flexible date prices unavailable right now.</p>
  );

  // Override center tile (index 3) with the real min from already-loaded search results
  const effectivePrices = prices.map((p, i) =>
    i === 3 && currentMinPrice != null ? { ...p, minPrice: currentMinPrice } : p
  );
  const validPrices = effectivePrices.filter((p) => p.minPrice !== null).map((p) => p.minPrice!);
  const lowestPrice = validPrices.length > 0 ? Math.min(...validPrices) : null;

  const handleClick = (dep: string, ret: string) => {
    const p = new URLSearchParams({ origin, destination, date: dep, return: ret, adults, cabin, trip: tripParam });
    router.push(`/search?${p}`);
  };

  return (
    <div className="py-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Flexible dates</p>
        <span className="text-[9px] text-slate-300 font-medium">· adjust departure or return ±3 days</span>
      </div>

      <div className="flex items-stretch gap-2 overflow-x-auto pb-1.5 scrollbar-light">
        {loading
          ? Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex-1 min-w-[88px] h-[56px] rounded-xl skeleton" />
            ))
          : effectivePrices.map((p, i) => {
              const isCenter = i === 3;
              const isCheapest = p.minPrice !== null && p.minPrice === lowestPrice;
              const noFare = p.minPrice === null;

              return (
                <motion.button
                  key={i}
                  whileHover={!noFare && !isCenter ? { scale: 1.03, y: -1 } : {}}
                  whileTap={!noFare && !isCenter ? { scale: 0.97 } : {}}
                  onClick={() => !noFare && !isCenter && handleClick(p.dep, p.ret)}
                  disabled={noFare || isCenter}
                  className={cn(
                    'flex-1 min-w-[88px] rounded-xl px-2.5 py-2 text-left transition-all border relative',
                    isCenter
                      ? 'bg-[#0F172A] border-[#0F172A] text-white shadow-lg cursor-default'
                      : noFare
                        ? 'bg-slate-50 border-slate-100 opacity-50 cursor-not-allowed'
                        : isCheapest
                          ? 'bg-[#1ABC9C]/5 border-[#1ABC9C]/30 hover:border-[#1ABC9C]/60 hover:shadow-sm cursor-pointer'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm cursor-pointer'
                  )}
                >
                  <p className={cn(
                    'text-[9px] font-semibold leading-tight whitespace-nowrap',
                    isCenter ? 'text-white/50' : 'text-slate-400',
                  )}>
                    {fmt(p.dep)} – {fmt(p.ret)}
                  </p>
                  <p className={cn(
                    'text-sm font-black mt-1 leading-none',
                    isCenter ? 'text-white'
                      : isCheapest ? 'text-[#1ABC9C]'
                      : noFare ? 'text-slate-300'
                      : 'text-slate-800',
                  )}>
                    {noFare ? 'No fare' : `$${Math.round(p.minPrice!).toLocaleString()}`}
                  </p>
                  {isCenter && (
                    <p className="text-[8px] font-bold text-white/40 uppercase tracking-wider mt-0.5">Selected</p>
                  )}
                  {isCheapest && !isCenter && !noFare && (
                    <p className="text-[8px] font-black text-[#1ABC9C] uppercase tracking-wider mt-0.5">Lowest ↓</p>
                  )}
                </motion.button>
              );
            })}
      </div>
    </div>
  );
}
