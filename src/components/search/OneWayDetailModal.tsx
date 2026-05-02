'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Clock, Download, Printer,
  Luggage, Armchair, Share2, Bookmark, ChevronRight,
} from 'lucide-react';
import { formatPrice, getAirlineLogo } from '@/lib/utils';
import type { JourneySegment } from '@/lib/round-trip-types';
import type { CabinClass, BaggageAllowance } from '@/lib/types';

interface Props {
  journey: JourneySegment;
  totalPrice: number;
  currency: string;
  cabinClass: CabinClass;
  baggage: BaggageAllowance;
  direction?: 'outbound' | 'return';
  onClose: () => void;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtDur(mins: number) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function OneWayDetailModal({ journey, totalPrice, currency, cabinClass, baggage, direction, onClose }: Props) {
  const dirLabel = direction === 'outbound' ? 'Outbound' : direction === 'return' ? 'Return' : 'One-Way';
  const priceLabel = direction ? `${dirLabel} Fare · Per Person` : 'One-Way · Incl. Taxes & Fees';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ duration: 0.22 }}
          className="bg-[#F8FAFC] rounded-[2.5rem] shadow-2xl w-full flex flex-col overflow-hidden"
          style={{ maxWidth: 1020, maxHeight: '92vh' }}
        >
          {/* ── Header ── */}
          <div className="px-8 pt-5 pb-4 bg-white border-b border-slate-100 shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
                  <img
                    src={getAirlineLogo(journey.airlineCodes[0])}
                    alt=""
                    className="w-8 h-8 object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <div className="min-w-0">
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight uppercase leading-none">
                    {journey.departureAirport} TO {journey.arrivalAirport}
                  </h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">
                    {journey.departureAirport} → {journey.arrivalAirport} · {dirLabel} Itinerary Details
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-5 shrink-0">
                <div className="text-right">
                  <p className="text-2xl font-bold text-slate-900 leading-none">{formatPrice(totalPrice, currency)}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">
                    {currency} · {priceLabel}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {[
                    { icon: Share2, label: 'Share' },
                    { icon: Printer, label: 'Print', onClick: () => window.print() },
                    { icon: Bookmark, label: 'Save' },
                  ].map(({ icon: Icon, label, onClick }) => (
                    <button
                      key={label}
                      onClick={onClick}
                      title={label}
                      className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all shadow-sm"
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                  <button
                    onClick={onClose}
                    className="w-9 h-9 rounded-full bg-slate-900 flex items-center justify-center text-white hover:bg-slate-700 transition-all ml-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="flex-1 flex overflow-hidden">

            {/* Left: segments — no scrollbar, compact so 3 stops fit */}
            <div className="flex-1 overflow-y-auto scrollbar-hide px-6 py-4">
              {journey.segments.map((seg, idx) => (
                <div key={seg.id ?? idx}>
                  {/* ── Flight card ── */}
                  <div className="bg-[#E9F1F0] rounded-[1.25rem] border border-slate-200/40 shadow-sm overflow-hidden">

                    {/* Card top bar */}
                    <div className="px-4 py-2 bg-[#dceae9] border-b border-slate-200/40 flex items-center justify-between">
                      <span className="text-[9px] font-bold text-slate-800 uppercase tracking-widest">
                        Flight {idx + 1} of {journey.segments.length} ({fmtDate(seg.departure.time)})
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                          {cabinClass.replace('_', ' ')}
                        </span>
                        <div className="flex items-center gap-0.5 opacity-20">
                          <Armchair className="w-2.5 h-2.5" />
                          <Armchair className="w-2.5 h-2.5" />
                          <Armchair className="w-2.5 h-2.5" />
                        </div>
                      </div>
                    </div>

                    {/* Card body */}
                    <div className="px-4 py-3">
                      <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">

                        {/* Departure */}
                        <div>
                          <h3 className="text-[22px] font-bold text-slate-900 leading-none tracking-tighter">
                            {seg.departure.airport}
                          </h3>
                          <p className="text-[8px] font-semibold text-slate-400 mt-0.5 uppercase tracking-tight leading-snug">
                            {seg.departure.airportName}
                          </p>
                          <div className="mt-2">
                            <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest">Dep.</span>
                            <div className="flex items-baseline gap-1 mt-0.5">
                              <span className="text-[16px] font-bold text-slate-900 leading-none">{fmtTime(seg.departure.time)}</span>
                              <span className="text-[7px] font-bold text-slate-500 uppercase tracking-widest">Local</span>
                            </div>
                            <p className="text-[8px] font-bold text-slate-800 mt-0.5 uppercase tracking-tight">
                              Terminal {seg.departure.terminal || '—'}
                            </p>
                          </div>
                        </div>

                        {/* Center: airline + line */}
                        <div className="flex flex-col items-center gap-1.5 px-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-white/80 border border-slate-200/60 flex items-center justify-center p-0.5 shadow-sm">
                              <img src={getAirlineLogo(seg.airline.code)} alt="" className="w-full h-full object-contain" />
                            </div>
                            <div className="text-center">
                              <p className="text-[8px] font-bold text-slate-900 uppercase tracking-widest leading-none">
                                {seg.flightNumber}
                              </p>
                              <p className="text-[7px] font-medium text-slate-500 mt-0.5 uppercase tracking-tighter">
                                {seg.aircraft}
                              </p>
                            </div>
                          </div>
                          <div className="relative w-16">
                            <div className="w-full h-px bg-slate-300" />
                            <ChevronRight className="absolute -right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-slate-300" />
                          </div>
                        </div>

                        {/* Arrival */}
                        <div className="text-right">
                          <h3 className="text-[22px] font-bold text-slate-900 leading-none tracking-tighter">
                            {seg.arrival.airport}
                          </h3>
                          <p className="text-[8px] font-semibold text-slate-400 mt-0.5 uppercase tracking-tight leading-snug">
                            {seg.arrival.airportName}
                          </p>
                          <div className="mt-2">
                            <div className="flex items-baseline gap-1 justify-end">
                              <span className="text-[16px] font-bold text-slate-900 leading-none">{fmtTime(seg.arrival.time)}</span>
                              <span className="text-[7px] font-bold text-slate-500 uppercase tracking-widest">Local</span>
                            </div>
                            <p className="text-[8px] font-bold text-slate-800 mt-0.5 uppercase tracking-tight">
                              Terminal {seg.arrival.terminal || '—'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Layover ── */}
                  {idx < journey.segments.length - 1 && (
                    <div className="py-2.5 flex items-center gap-3 pl-5">
                      <div className="w-px h-8 border-l border-dashed border-slate-300" />
                      <div className="flex-1 bg-white rounded-xl px-4 py-2 border border-slate-200 flex items-center gap-2.5 shadow-sm">
                        <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="text-[10px] font-bold text-slate-600">
                          {fmtDur(journey.layovers[idx].durationMinutes)} Layover &amp; Change Planes in{' '}
                          {journey.layovers[idx].airportName} ({journey.layovers[idx].airport})
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Footer actions */}
              <div className="flex items-center gap-3 pt-4 pb-3">
                <button className="px-4 py-2 bg-white border border-slate-200 rounded-2xl text-[10px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm">
                  <Download className="w-3.5 h-3.5" /> Download Itinerary
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-2xl text-[10px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm"
                >
                  <Printer className="w-3.5 h-3.5" /> Print
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-100 rounded-2xl text-[10px] font-black text-slate-500 uppercase tracking-widest hover:bg-slate-200 transition-all"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Right: info panel */}
            <div className="w-[300px] border-l border-slate-100 bg-white flex flex-col shrink-0">
              {/* Panel title */}
              <div className="px-6 py-3 border-b border-slate-100 shrink-0">
                <p className="text-[9px] font-bold text-slate-900 uppercase tracking-[0.12em]">Journey at a Glance</p>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-hide">
                {/* Total Duration */}
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Duration</p>
                  <p className="text-2xl font-bold text-slate-900">{fmtDur(journey.durationMinutes)}</p>
                </div>

                {/* Connections */}
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Connections</p>
                  <p className="text-[11px] font-bold text-slate-900 uppercase tracking-tight">
                    {journey.stops > 0 ? `${journey.stops} (${journey.stopAirports.join(', ')})` : 'Non-stop'}
                  </p>
                </div>

                {/* Airline */}
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                  <img src={getAirlineLogo(journey.airlineCodes[0])} alt="" className="w-7 h-7 object-contain" />
                  <p className="text-[11px] font-bold text-slate-800 uppercase tracking-tight">{journey.airlineNames[0]}</p>
                </div>

                {/* Cabin & Fare */}
                <div>
                  <p className="text-[9px] font-bold text-slate-900 uppercase tracking-[0.15em] mb-2">Cabin &amp; Fare</p>
                  <div className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                    <div className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-sm">
                      <Armchair className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-900 uppercase tracking-tight">
                        {cabinClass.replace('_', ' ')} Class
                      </p>
                      <p className="text-[8px] font-medium text-slate-400 mt-0.5 uppercase tracking-tight">Seat pitch: 31 inches</p>
                    </div>
                  </div>
                </div>

                {/* Baggage */}
                <div>
                  <p className="text-[9px] font-bold text-slate-900 uppercase tracking-[0.15em] mb-2">Baggage Allowance</p>
                  <div className="space-y-2">
                    {baggage.carryOn > 0 && (
                      <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                        <Luggage className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="text-[9px] font-bold text-slate-700 uppercase tracking-tight">
                          {baggage.carryOn} Carry-on (7kg)
                        </span>
                      </div>
                    )}
                    {baggage.checked > 0 && (
                      <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                        <Luggage className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="text-[9px] font-bold text-slate-700 uppercase tracking-tight">
                          {baggage.checked} Checked bag (23kg)
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
