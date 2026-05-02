'use client';

import { motion } from 'framer-motion';
import { 
  X, 
  Clock, 
  Luggage, 
  Armchair, 
  Leaf, 
  ChevronRight,
  Plane
} from 'lucide-react';
import { 
  cn, 
  formatDuration, 
  formatTime, 
  formatPrice, 
  getAirlineLogo 
} from '@/lib/utils';
import type { UnifiedFlight } from '@/lib/types';

interface FlightDetailProps {
  flight: UnifiedFlight;
}

export default function FlightDetail({ flight }: FlightDetailProps) {
  const firstSeg = flight.segments[0];
  const lastSeg = flight.segments[flight.segments.length - 1];

  return (
    <div className="flex flex-col h-full bg-white/40 backdrop-blur-xl rounded-[32px] overflow-hidden border border-white/60">
      {/* Header Info */}
      <div className="p-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/60 border border-white flex items-center justify-center shadow-sm">
            <img 
              src={getAirlineLogo(flight.airline.code)} 
              alt={flight.airline.name} 
              className="w-8 h-8 object-contain"
            />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-800">{flight.airline.name}</h3>
            <p className="text-xs text-slate-500 font-bold">{flight.airline.code} {flight.id.split('_')[0]}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-black text-[#F97316]">
            {formatPrice(flight.totalPrice, flight.currency)}
          </p>
        </div>
      </div>

      {/* Timeline Section */}
      <div className="px-6 py-4 bg-white/20 border-y border-white/40">
        <div className="flex items-center justify-between gap-4">
          <div className="text-left">
            <p className="text-xl font-black text-slate-800 leading-none">
              {formatTime(firstSeg.departure.time)}
            </p>
            <p className="text-xs text-slate-600 mt-2 font-bold uppercase tracking-wider">
              {firstSeg.departure.airport}
            </p>
            <p className="text-[10px] text-slate-400 font-medium">New York</p>
          </div>

          <div className="flex-1 flex flex-col items-center gap-2 px-4">
            <p className="text-[10px] text-slate-400 font-black uppercase tracking-tighter">
              {formatDuration(flight.totalDuration)}
            </p>
            <div className="relative w-full h-[2px] bg-slate-200 rounded-full">
              <div className="absolute inset-y-0 left-0 bg-[#F97316] rounded-full" style={{ width: '100%' }} />
              <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-[#F97316] shadow-sm" />
            </div>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
              {flight.stops === 0 ? 'Non-stop' : `${flight.stops} stop${flight.stops > 1 ? 's' : ''}`}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xl font-black text-slate-800 leading-none">
              {formatTime(lastSeg.arrival.time)}
            </p>
            <p className="text-xs text-slate-600 mt-2 font-bold uppercase tracking-wider">
              {lastSeg.arrival.airport}
            </p>
            <p className="text-[10px] text-slate-400 font-medium">Los Angeles</p>
          </div>
        </div>
      </div>

      {/* Attributes Section */}
      <div className="p-6 grid grid-cols-3 gap-4">
        <div className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/40 border border-white/60">
          <Luggage className="w-5 h-5 text-slate-400" />
          <div className="text-center">
            <p className="text-[10px] text-slate-400 font-bold uppercase">Baggage</p>
            <p className="text-[10px] text-slate-800 font-black">1 x 23kg</p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/40 border border-white/60">
          <Armchair className="w-5 h-5 text-slate-400" />
          <div className="text-center">
            <p className="text-[10px] text-slate-400 font-bold uppercase">Cabin</p>
            <p className="text-[10px] text-slate-800 font-black">{flight.cabinClass}</p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/40 border border-white/60">
          <Leaf className="w-5 h-5 text-slate-400" />
          <div className="text-center">
            <p className="text-[10px] text-slate-400 font-bold uppercase">CO₂ Emission</p>
            <p className="text-[10px] text-slate-800 font-black">421 kg</p>
          </div>
        </div>
      </div>

      {/* CTA Footer */}
      <div className="mt-auto p-6 pt-0">
        <button className="w-full py-4 rounded-2xl font-black text-white bg-[#1ABC9C] flex items-center justify-center gap-2 shadow-lg shadow-[#1ABC9C]/20 hover:scale-[1.02] transition-all">
          View Details
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
