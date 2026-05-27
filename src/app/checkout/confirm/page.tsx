'use client';

import { Fragment, useEffect } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  Check, Copy, Share2, Download, LayoutDashboard, Search,
  ShieldCheck, Plane, User, CreditCard, CheckCircle2, Clock,
  AlertCircle, Loader2, CalendarDays, MapPin, ArrowRightLeft,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCheckoutStore, buildLocalPricing } from '@/store/useCheckoutStore';
import {
  buildFareBreakdown, generateItineraryHtml,
  formatDate, formatShortDate, formatTime, formatDurationMinutes,
  calculateTripDurationDays, maskPaymentMethod,
  buildPassengerServices,
  type PassengerServices, type DirectionServices,
} from '@/lib/fare-utils';
import type { FlightSegment } from '@/lib/types';
import type { PassengerInfo } from '@/store/useCheckoutStore';
import type { Layover } from '@/lib/round-trip-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
      className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all', className)}
    >
      {copied ? <><Check className="w-3.5 h-3.5" />Copied!</> : <><Copy className="w-3.5 h-3.5" />Copy PNR</>}
    </button>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ icon, title, accent }: { icon: React.ReactNode; title: string; accent?: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-5">
      <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0', accent ?? 'bg-slate-100')}>
        {icon}
      </div>
      <h2 className="text-sm font-bold text-slate-900 tracking-tight">{title}</h2>
    </div>
  );
}

// ─── Service row ─────────────────────────────────────────────────────────────

function ServiceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-xs font-medium text-slate-500 flex-shrink-0 w-24">{label}</span>
      <span className="text-xs text-right ml-2">{children}</span>
    </div>
  );
}

// ─── Seat status badge ────────────────────────────────────────────────────────

function SeatStatusBadge({ status }: { status: string }) {
  const color = status === 'Confirmed'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : status.startsWith('Pending')
      ? 'bg-amber-50 text-amber-700 border-amber-100'
      : 'bg-slate-50 text-slate-500 border-slate-100';
  return (
    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', color)}>{status}</span>
  );
}

// ─── Direction card (outbound / return block per passenger) ───────────────────

function DirectionCard({ dir }: { dir: DirectionServices }) {
  const isOut = dir.label === 'Outbound Flight';
  const hasSegs = dir.segments.length > 0;

  return (
    <div className="rounded-xl border border-slate-100 overflow-hidden">
      {/* Direction header */}
      <div className={cn(
        'flex items-center justify-between px-3.5 py-2 border-b',
        isOut ? 'bg-[#1ABC9C]/5 border-[#1ABC9C]/10' : 'bg-orange-50 border-orange-100',
      )}>
        <span className={cn('text-[10px] font-black uppercase tracking-widest', isOut ? 'text-[#1ABC9C]' : 'text-orange-500')}>
          {dir.label}
        </span>
        <span className="text-xs font-semibold text-slate-500">{dir.route}</span>
      </div>

      <div className="p-3.5 space-y-3">
        {hasSegs
          ? /* Segment-level rows */
            <>
              {dir.segments.map((seg, i) => (
                <div key={seg.segmentId} className={cn('pb-3', i < dir.segments.length - 1 && 'border-b border-slate-50')}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Plane className="w-3 h-3 text-slate-300" />
                    <span className="text-[10px] font-bold text-slate-500">{seg.route}</span>
                    <span className="text-[10px] font-mono text-slate-300">· {seg.flightNumber}</span>
                  </div>
                  <div className="space-y-0">
                    <ServiceRow label="Seat"><span className="font-semibold text-slate-800">{seg.seat}</span></ServiceRow>
                    <ServiceRow label="Seat status"><SeatStatusBadge status={seg.seatStatus} /></ServiceRow>
                    <ServiceRow label="Meal"><span className="text-slate-700">{seg.meal}</span></ServiceRow>
                  </div>
                </div>
              ))}
              {/* Baggage at direction level */}
              <div className="pt-1 border-t border-slate-50">
                <ServiceRow label="Baggage"><span className="font-semibold text-slate-800">{dir.baggage}</span></ServiceRow>
              </div>
            </>
          : /* Direction-level rows */
            <div className="space-y-0">
              <ServiceRow label="Seat"><span className="font-semibold text-slate-800">{dir.seat}</span></ServiceRow>
              <ServiceRow label="Seat status"><SeatStatusBadge status={dir.seatStatus} /></ServiceRow>
              <ServiceRow label="Meal"><span className="text-slate-700">{dir.meal}</span></ServiceRow>
              <ServiceRow label="Baggage"><span className="font-semibold text-slate-800">{dir.baggage}</span></ServiceRow>
            </div>
        }
      </div>
    </div>
  );
}

// ─── Passenger service card ───────────────────────────────────────────────────

function PassengerServiceCard({
  paxService, passenger, index, total,
}: {
  paxService: PassengerServices;
  passenger?: PassengerInfo;
  index: number;
  total: number;
}) {
  const hasPersonal = passenger && (passenger.gender || passenger.dateOfBirth || passenger.email || passenger.phone);
  const hasDocs = passenger && (passenger.nationality || passenger.passportNumber || passenger.passportExpiry || passenger.passportCountry);

  return (
    <div className={cn('pb-5', index < total - 1 && 'border-b border-slate-100 mb-5')}>
      {total > 1 && (
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-2">
          Passenger {index + 1}
        </p>
      )}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-bold text-slate-900">{paxService.passengerName}</p>
          <p className="text-xs text-slate-400 capitalize mt-0.5">{paxService.passengerType}</p>
        </div>
        {paxService.isLeadPassenger && (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#1ABC9C]/10 text-[#1ABC9C] border border-[#1ABC9C]/20 flex-shrink-0 ml-3">
            Lead passenger
          </span>
        )}
      </div>

      {/* Personal & travel document details */}
      {(hasPersonal || hasDocs) && (
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5 mb-3">
          {hasPersonal && (
            <>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Personal Details</p>
              <div className="space-y-0">
                {passenger.gender    && <ServiceRow label="Gender"><span className="capitalize text-slate-700">{passenger.gender}</span></ServiceRow>}
                {passenger.dateOfBirth && <ServiceRow label="Date of Birth"><span className="text-slate-700">{passenger.dateOfBirth}</span></ServiceRow>}
                {passenger.email     && <ServiceRow label="Email"><span className="text-slate-700 break-all">{passenger.email}</span></ServiceRow>}
                {passenger.phone     && <ServiceRow label="Phone"><span className="text-slate-700">{passenger.phone}</span></ServiceRow>}
              </div>
            </>
          )}
          {hasDocs && (
            <>
              <p className={cn('text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2', hasPersonal && 'mt-3')}>Travel Documents</p>
              <div className="space-y-0">
                {passenger.nationality      && <ServiceRow label="Nationality"><span className="text-slate-700">{passenger.nationality}</span></ServiceRow>}
                {passenger.passportNumber   && <ServiceRow label="Passport No."><span className="font-mono text-slate-800">{passenger.passportNumber}</span></ServiceRow>}
                {passenger.passportExpiry   && <ServiceRow label="Expiry"><span className="text-slate-700">{passenger.passportExpiry}</span></ServiceRow>}
                {passenger.passportCountry  && <ServiceRow label="Issuing Country"><span className="text-slate-700">{passenger.passportCountry}</span></ServiceRow>}
              </div>
            </>
          )}
        </div>
      )}

      <div className="space-y-2">
        {paxService.directions.map((dir, i) => (
          <DirectionCard key={i} dir={dir} />
        ))}
      </div>
    </div>
  );
}

// ─── Flight leg card ──────────────────────────────────────────────────────────

function FlightLegCard({
  directionLabel, dateLabel, segments, layovers, totalDurationMinutes,
}: {
  directionLabel: string;
  dateLabel: string;
  segments: FlightSegment[];
  layovers: Layover[];
  totalDurationMinutes: number;
}) {
  if (!segments.length) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <div className={cn(
            'px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider',
            directionLabel === 'Outbound' ? 'bg-[#1ABC9C]/15 text-[#1ABC9C]' : 'bg-orange-100 text-orange-600',
          )}>
            {directionLabel}
          </div>
          {dateLabel && (
            <div className="flex items-center gap-1 text-xs text-slate-400 font-medium">
              <CalendarDays className="w-3 h-3" />{dateLabel}
            </div>
          )}
        </div>
        <span className="text-xs text-slate-400">{formatDurationMinutes(totalDurationMinutes)} total</span>
      </div>

      {segments.map((seg, i) => (
        <Fragment key={seg.id ?? i}>
          <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2.5">
                  <div className="flex flex-col items-center flex-shrink-0 mt-1">
                    <div className="w-2.5 h-2.5 rounded-full border-[2.5px] border-slate-300 bg-white" />
                    <div className="w-px h-8 bg-gradient-to-b from-slate-200 to-[#1ABC9C] my-1 rounded-full" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#1ABC9C]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 mb-0.5">
                      <span className="text-base font-bold text-slate-900">{formatTime(seg.departure.time)}</span>
                      <span className="text-sm font-semibold text-slate-600">{seg.departure.airport}</span>
                    </div>
                    <p className="text-xs text-slate-400 mb-3">
                      {seg.departure.city}{seg.departure.terminal ? ` · T${seg.departure.terminal}` : ''}
                    </p>
                    <div className="flex items-center gap-1.5 mb-3">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-slate-100 shadow-sm">
                        <Plane className="w-3 h-3 text-slate-400" />
                        <span className="text-[10px] font-bold text-slate-500">{formatDurationMinutes(seg.duration)}</span>
                        {seg.aircraft && <span className="text-[10px] text-slate-300">· {seg.aircraft}</span>}
                      </div>
                    </div>
                    <div className="flex items-baseline gap-1.5 mb-0.5">
                      <span className="text-base font-bold text-slate-900">{formatTime(seg.arrival.time)}</span>
                      <span className="text-sm font-semibold text-slate-600">{seg.arrival.airport}</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {seg.arrival.city}{seg.arrival.terminal ? ` · T${seg.arrival.terminal}` : ''}
                    </p>
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0 pt-0.5">
                <p className="text-xs font-semibold text-slate-600">{seg.airline.name}</p>
                <p className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md inline-block mt-0.5">
                  {seg.flightNumber}
                </p>
              </div>
            </div>
          </div>
          {i < segments.length - 1 && layovers[i] && (
            <div className="flex items-center gap-2 px-3 py-2 my-2 mx-3 rounded-xl bg-amber-50 border border-amber-200">
              <Clock className="w-3 h-3 text-amber-500 flex-shrink-0" />
              <div>
                <p className="text-xs font-bold text-amber-800">{formatDurationMinutes(layovers[i].durationMinutes)} layover · {layovers[i].airport}</p>
                <p className="text-[10px] text-amber-600">{layovers[i].airportName}{layovers[i].terminalChange && ' · Terminal change required'}</p>
              </div>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

// ─── Info row ─────────────────────────────────────────────────────────────────

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
      <span className="text-sm font-medium text-slate-500">{label}</span>
      <span className="text-sm text-right ml-4">{children}</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type DownloadState = 'idle' | 'preparing' | 'done' | 'error';

export default function ConfirmPage() {
  const router = useRouter();
  const store = useCheckoutStore();
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');

  const { confirmation, selectedFare, sourceFlight, sourceRoundTrip, passengers, priceProtection, pricing } = store;
  const effectivePricing = pricing ?? buildLocalPricing(store);
  const breakdown = buildFareBreakdown(effectivePricing);

  useEffect(() => {
    if (!confirmation) {
      const t = setTimeout(() => router.push('/'), 500);
      return () => clearTimeout(t);
    }
  }, [confirmation, router]);

  if (!confirmation) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-7 h-7 border-2 border-[#1ABC9C] border-t-transparent rounded-full" />
      </div>
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const routeLabel = (() => {
    if (sourceRoundTrip) return `${sourceRoundTrip.outboundJourney.departureAirport} ⇄ ${sourceRoundTrip.outboundJourney.arrivalAirport}`;
    if (sourceFlight?.segments.length) {
      const f = sourceFlight.segments[0], l = sourceFlight.segments[sourceFlight.segments.length - 1];
      return `${f.departure.airport} → ${l.arrival.airport}`;
    }
    return selectedFare ? selectedFare.cabin.replace(/_/g, ' ') : 'Your Flight';
  })();

  const airlineName = sourceRoundTrip ? (sourceRoundTrip.airlines[0] ?? '') : (sourceFlight?.airline.name ?? '');
  const isRoundTrip = !!sourceRoundTrip;
  const depDate = sourceRoundTrip ? sourceRoundTrip.outboundJourney.departureTime : (sourceFlight?.segments[0]?.departure.time ?? '');
  const retDate = sourceRoundTrip ? sourceRoundTrip.returnJourney.departureTime : '';
  const tripDays = isRoundTrip && depDate && retDate ? calculateTripDurationDays(depDate, retDate) : 0;

  const outSegs = sourceRoundTrip ? sourceRoundTrip.outboundJourney.segments : (sourceFlight?.segments ?? []);
  const retSegs = sourceRoundTrip ? sourceRoundTrip.returnJourney.segments : [];
  const outLays = sourceRoundTrip ? sourceRoundTrip.outboundJourney.layovers : [];
  const retLays = sourceRoundTrip ? sourceRoundTrip.returnJourney.layovers : [];
  const outDur  = sourceRoundTrip ? sourceRoundTrip.outboundJourney.durationMinutes : (sourceFlight?.totalDuration ?? 0);
  const retDur  = sourceRoundTrip ? sourceRoundTrip.returnJourney.durationMinutes : 0;
  const hasFlightDetails = outSegs.length > 0 || retSegs.length > 0;

  // Passenger services data
  const paxServices = buildPassengerServices({
    passengers,
    passengerNames: confirmation.passengerNames,
    seatSelections: store.seatSelections,
    mealSelections: store.mealSelections,
    extraBags: store.extraBags,
    fareOption: store.fareOption,
    sourceRoundTrip: sourceRoundTrip ?? null,
    sourceFlight: sourceFlight ?? null,
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleDownload = async () => {
    setDownloadState('preparing');
    try {
      const html = generateItineraryHtml({
        confirmation, routeLabel, airlineName, selectedFare, passengers,
        pricing: effectivePricing, priceProtection, sourceRoundTrip, sourceFlight,
        seatSelections: store.seatSelections,
        mealSelections: store.mealSelections,
        extraBags: store.extraBags,
        fareOption: store.fareOption,
      });

      // Download as .html file
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FareMind-Itinerary-${confirmation.masterBookingReference || confirmation.pnr}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setDownloadState('done');
    } catch { setDownloadState('error'); }
    setTimeout(() => setDownloadState('idle'), 3000);
  };

  const handleShare = () => {
    const text = `FareMind Booking · PNR: ${confirmation.pnr} · ${routeLabel}`;
    if (navigator.share) navigator.share({ title: 'My FareMind Booking', text }).catch(() => {});
    else navigator.clipboard.writeText(text);
  };

  // ── Animations ─────────────────────────────────────────────────────────────

  const containerV: Variants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
  const itemV: Variants = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } } };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-[#F0FDF4] py-8 px-4">
      <motion.div variants={containerV} initial="hidden" animate="show" className="max-w-2xl mx-auto space-y-4">

        {/* ── 1. BOOKING REFERENCE / CONFIRMATION HEADER ── */}
        <motion.div variants={itemV}>
          <div className="text-center mb-5">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ duration: 0.6, ease: [0.175, 0.885, 0.32, 1.275], delay: 0.1 }}
              className="relative w-20 h-20 mx-auto mb-4"
            >
              <div className="absolute inset-0 rounded-full bg-emerald-400/20 animate-ping" />
              <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-xl shadow-emerald-500/30">
                <Check className="w-10 h-10 text-white" strokeWidth={3} />
              </div>
            </motion.div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mb-1.5">Booking Confirmed!</h1>
            <p className="text-sm text-slate-500 max-w-xs mx-auto">Your flight is booked. A confirmation has been sent to your email.</p>
          </div>

          {/* Split-ticket warning */}
          {confirmation.isSplitTicket && (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-800">{confirmation.riskLabel ?? 'Split Ticket'}</p>
                <p className="text-xs text-amber-700 mt-0.5">{confirmation.riskExplanation ?? 'This booking has separate confirmation codes per direction. Missed connections are not covered.'}</p>
              </div>
            </div>
          )}

          {/* PNR card */}
          <div className="relative rounded-2xl overflow-hidden shadow-xl shadow-slate-900/20">
            <div className="absolute inset-0 bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F3460]" />
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-[#1ABC9C]/8" />
            <div className="absolute -bottom-6 -left-6 w-28 h-28 rounded-full bg-white/4" />
            <div className="relative p-6 text-center">
              <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-400/30 rounded-full px-3 py-1 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-bold text-emerald-400 tracking-wide">Confirmed</span>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.25em] mb-1">FareMind Booking Reference</p>
              <p className="text-3xl sm:text-4xl font-black text-white tracking-[0.2em] font-mono mb-1">{confirmation.masterBookingReference}</p>
              {/* Airline confirmation codes */}
              {confirmation.pnrs && confirmation.pnrs.length > 0 && (
                <div className="mt-3 mb-3 space-y-1.5">
                  {confirmation.pnrs.map((p, i) => (
                    <div key={i} className="flex items-center justify-center gap-2">
                      <span className="text-[10px] text-slate-500 w-28 text-right">{p.displayLabel}</span>
                      <span className="font-mono font-black text-[#1ABC9C] tracking-widest text-sm">{p.pnrCode}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500 mb-4 font-mono">{confirmation.bookingId}</p>
              <div className="flex items-center justify-center gap-2">
                <CopyButton text={confirmation.masterBookingReference} className="bg-white/10 hover:bg-white/20 text-white border border-white/10" />
                <button onClick={handleShare} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white text-xs font-semibold transition-all">
                  <Share2 className="w-3.5 h-3.5" />Share
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── 2. ITINERARY SUMMARY ── */}
        <motion.div variants={itemV}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 pt-5 pb-0">
              <SectionHeader icon={<Plane className="w-4 h-4 text-[#1ABC9C]" />} title="Itinerary Summary" accent="bg-[#1ABC9C]/10" />
            </div>

            {/* Route banner */}
            <div className="mx-5 mb-4 rounded-xl bg-gradient-to-r from-slate-50 to-slate-100 border border-slate-100 p-3.5">
              <div className="flex items-center justify-between">
                <div className="text-center">
                  <p className="text-xl font-black text-slate-900">
                    {sourceRoundTrip?.outboundJourney.departureAirport ?? sourceFlight?.segments[0]?.departure.airport ?? '—'}
                  </p>
                  <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                    {sourceRoundTrip?.outboundJourney.segments[0]?.departure.city ?? sourceFlight?.segments[0]?.departure.city ?? ''}
                  </p>
                </div>
                <div className="flex flex-col items-center gap-0.5 px-3">
                  <ArrowRightLeft className="w-4 h-4 text-slate-400" />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{isRoundTrip ? 'Round Trip' : 'One Way'}</span>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black text-slate-900">
                    {sourceRoundTrip?.outboundJourney.arrivalAirport ?? sourceFlight?.segments.at(-1)?.arrival.airport ?? '—'}
                  </p>
                  <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                    {sourceRoundTrip?.outboundJourney.segments.at(-1)?.arrival.city ?? sourceFlight?.segments.at(-1)?.arrival.city ?? ''}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-5 pb-5 space-y-0">
              {depDate && <InfoRow label="Departure"><span className="font-semibold text-slate-800">{formatDate(depDate)}</span></InfoRow>}
              {isRoundTrip && retDate && <InfoRow label="Return"><span className="font-semibold text-slate-800">{formatDate(retDate)}</span></InfoRow>}
              {tripDays > 0 && <InfoRow label="Trip duration"><span className="font-bold text-[#1ABC9C]">{tripDays} {tripDays === 1 ? 'day' : 'days'}</span></InfoRow>}
              {airlineName && <InfoRow label="Airline"><span className="font-semibold text-slate-800">{airlineName}</span></InfoRow>}
              {selectedFare && (
                <InfoRow label="Fare class">
                  <span className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-800">{selectedFare.name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 capitalize">
                      {selectedFare.cabin.replace(/_/g, ' ')}
                    </span>
                  </span>
                </InfoRow>
              )}
              <InfoRow label="Status">
                <span className="inline-flex items-center gap-1.5 text-emerald-600 font-semibold text-sm">
                  <CheckCircle2 className="w-3.5 h-3.5" />Confirmed
                </span>
              </InfoRow>
              {/* Passenger list */}
              <div className="pt-3 mt-1 border-t border-slate-100">
                <div className="flex items-center gap-1.5 mb-2">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Passengers</p>
                </div>
                <div className="space-y-1.5">
                  {confirmation.passengerNames.map((name, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-800">{name}</span>
                      <span className="text-xs text-slate-400 capitalize bg-slate-100 px-2 py-0.5 rounded-full">
                        {passengers[i]?.type ?? 'Adult'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── 3. FLIGHT DETAILS ── */}
        {hasFlightDetails && (
          <motion.div variants={itemV}>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <SectionHeader icon={<MapPin className="w-4 h-4 text-slate-500" />} title="Flight Details" accent="bg-slate-100" />
              <div className="space-y-5">
                {outSegs.length > 0 && (
                  <FlightLegCard directionLabel="Outbound" dateLabel={depDate ? formatShortDate(depDate) : ''}
                    segments={outSegs} layovers={outLays} totalDurationMinutes={outDur} />
                )}
                {retSegs.length > 0 && (
                  <>
                    <div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
                    <FlightLegCard directionLabel="Return" dateLabel={retDate ? formatShortDate(retDate) : ''}
                      segments={retSegs} layovers={retLays} totalDurationMinutes={retDur} />
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── 4. PASSENGER DETAILS ── */}
        <motion.div variants={itemV}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <SectionHeader icon={<User className="w-4 h-4 text-blue-500" />} title="Passenger Details" accent="bg-blue-50" />

            {paxServices.length > 0
              ? <>
                  {paxServices.map((pax, i) => (
                    <PassengerServiceCard key={pax.passengerId} paxService={pax} passenger={passengers[i]} index={i} total={paxServices.length} />
                  ))}
                  {/* Airline note */}
                  <div className="flex items-start gap-2.5 mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                    <Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Seat assignments, boarding passes, terminal, and gate information may be updated by the airline closer to departure.
                        Please check airline check-in before travel.
                      </p>
                      {isRoundTrip && (
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Return flight is confirmed. Seat assignment and boarding pass may be available closer to departure or during airline check-in.
                        </p>
                      )}
                    </div>
                  </div>
                </>
              : <p className="text-sm text-slate-400 italic">Passenger details not available.</p>
            }
          </div>
        </motion.div>

        {/* ── 5. PAYMENT SUMMARY ── */}
        <motion.div variants={itemV}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <SectionHeader icon={<CreditCard className="w-4 h-4 text-violet-500" />} title="Payment Summary" accent="bg-violet-50" />

            {breakdown.length > 0 && (
              <div className="space-y-0 mb-3">
                {breakdown.map((line, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <span className={cn('text-sm font-medium', line.muted ? 'text-slate-400' : 'text-slate-600')}>{line.label}</span>
                    <span className={cn(line.muted ? 'text-slate-400 text-xs' : 'font-semibold text-slate-800 text-sm')}>{fmt(line.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Total */}
            <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-100 mb-4">
              <span className="text-sm font-bold text-slate-700">Total charged</span>
              <span className="text-xl font-black text-[#F97316]">{fmt(confirmation.totalCharged)}</span>
            </div>

            <div className="space-y-0">
              <InfoRow label="Payment method">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-800 text-white">CARD</span>
                  {maskPaymentMethod()}
                </span>
              </InfoRow>
              <InfoRow label="Confirmed at">
                <span className="font-medium text-slate-600 text-xs">
                  {new Date(confirmation.confirmedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </InfoRow>
            </div>
          </div>
        </motion.div>

        {/* ── 6. PRICE MONITORING ── */}
        <AnimatePresence>
          {priceProtection && (
            <motion.div variants={itemV}>
              <div className="relative overflow-hidden rounded-2xl border border-[#1ABC9C]/30 shadow-sm">
                <div className="absolute inset-0 bg-gradient-to-br from-[#1ABC9C]/8 via-emerald-50 to-teal-50" />
                <div className="relative flex items-start gap-4 p-5">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#1ABC9C] to-emerald-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-[#1ABC9C]/25">
                    <ShieldCheck className="w-6 h-6 text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 mb-1">Price monitoring is now active</p>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      We&apos;ll notify you if the price drops after booking and refund <strong>80%</strong> of the
                      difference as FareMind credit. Check your dashboard to view price history.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 7. ACTION BUTTONS ── */}
        <motion.div variants={itemV}>
          <div className="flex flex-col sm:flex-row items-stretch gap-3">
            <Link href="/account" className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-[#1ABC9C] to-emerald-500 hover:from-emerald-500 hover:to-[#1ABC9C] shadow-lg shadow-[#1ABC9C]/25 transition-all hover:scale-[1.02] active:scale-[0.98] flex-1">
              <LayoutDashboard className="w-4 h-4" />View Dashboard
            </Link>

            <button
              onClick={handleDownload}
              disabled={downloadState === 'preparing'}
              className={cn(
                'flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all border flex-1 hover:scale-[1.02] active:scale-[0.98]',
                downloadState === 'done'    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : downloadState === 'error'  ? 'bg-red-50 border-red-200 text-red-600'
                : downloadState === 'preparing' ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-wait'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm',
              )}
            >
              {downloadState === 'preparing' && <Loader2 className="w-4 h-4 animate-spin" />}
              {downloadState === 'done'      && <CheckCircle2 className="w-4 h-4" />}
              {downloadState === 'error'     && <AlertCircle className="w-4 h-4" />}
              {downloadState === 'idle'      && <Download className="w-4 h-4" />}
              {downloadState === 'preparing' ? 'Preparing…' : downloadState === 'done' ? 'Downloaded!' : downloadState === 'error' ? 'Try Again' : 'Download Itinerary'}
            </button>

            <Link href="/" className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all flex-1 hover:scale-[1.02] active:scale-[0.98]">
              <Search className="w-4 h-4" />Search Flights
            </Link>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.div variants={itemV}>
          <p className="text-center text-xs text-slate-400 pb-6">
            Confirmation sent to{' '}
            <span className="font-semibold text-slate-600">{passengers[0]?.email || 'your email address'}</span>
            {' · '}Booking ID: <span className="font-mono text-slate-500">{confirmation.bookingId}</span>
          </p>
        </motion.div>

      </motion.div>
    </div>
  );
}
