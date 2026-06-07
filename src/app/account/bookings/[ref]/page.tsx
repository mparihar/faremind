'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plane, ArrowLeft, Loader2, User, Calendar, Check, X,
  XCircle, Luggage, CreditCard, Ticket, Mail, Download, TrendingUp,
  Clock, MapPin, Shield, ChevronRight, Hash, FileText,
} from 'lucide-react';
import { useManageBookingStore } from '@/store/useManageBookingStore';
import { useAuthStore } from '@/store/useAuthStore';
import CancelBookingModal from '@/components/manage-booking/CancelBookingModal';
import { SeatMapModal, PassengerModal, DateChangeModal, ETicketModal, RefundModal, SupportModal } from '@/components/manage-booking/BookingModals';
import { generateItineraryHtmlFromBooking } from '@/lib/fare-utils';

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, [string, string]> = {
    CONFIRMED: ['bg-emerald-500/10 text-emerald-400 border border-emerald-500/20', 'Confirmed'],
    TICKETED: ['bg-emerald-500/10 text-emerald-400 border border-emerald-500/20', 'Ticketed'],
    CANCELLED: ['bg-red-500/10 text-red-400 border border-red-500/20', 'Cancelled'],
    CREATED: ['bg-amber-500/10 text-amber-400 border border-amber-500/20', 'Processing'],
    COMPLETED: ['bg-blue-500/10 text-blue-400 border border-blue-500/20', 'Completed'],
  };
  const [cls, label] = m[status] || ['bg-slate-500/10 text-slate-400 border border-slate-500/20', status];
  return <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${cls}`}>{label}</span>;
}

function MiniStatus({ label, status }: { label: string; status: string }) {
  const color = ['CONFIRMED','TICKETED','ISSUED','PAID'].includes(status) ? 'text-emerald-400' : status === 'CANCELLED' || status === 'FAILED' || status === 'VOIDED' ? 'text-red-400' : 'text-amber-400';
  return (
    <div className="text-center">
      <p className="text-[9px] text-slate-600 uppercase tracking-wider font-bold mb-0.5">{label}</p>
      <p className={`text-[11px] font-bold capitalize ${color}`}>{(status || '—').replace(/_/g, ' ').toLowerCase()}</p>
    </div>
  );
}

const fmtC = (n: number, c = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);

type Tab = 'overview' | 'itinerary' | 'passengers' | 'timeline';
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'overview', label: 'Overview', icon: FileText },
  { key: 'itinerary', label: 'Itinerary', icon: Plane },
  { key: 'passengers', label: 'Passengers', icon: User },
  { key: 'timeline', label: 'Activity', icon: Clock },
];

export default function BookingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ref = params.ref as string;
  const { booking, bookingLoading, loadBookingDetail, actions, loadActions, timeline, loadTimeline, activeModal, setActiveModal } = useManageBookingStore();
  const { loadSession } = useAuthStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [emailSending, setEmailSending] = useState(false);
  const [emailDone, setEmailDone] = useState(false);
  const [emailError, setEmailError] = useState('');

  useEffect(() => { loadSession(); }, []);
  useEffect(() => { if (ref) { loadBookingDetail(ref); loadActions(ref); loadTimeline(ref); } }, [ref]);

  // Download Full Itinerary handler
  useEffect(() => {
    if (activeModal === 'download_full_itinerary' && booking) {
      const html = generateItineraryHtmlFromBooking(booking);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FAREMIND-Itinerary-${booking.masterBookingReference || booking.masterPnr || 'booking'}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setActiveModal(null);
    }
  }, [activeModal, booking, setActiveModal]);

  if (bookingLoading || !booking) return <div className="flex items-center justify-center py-24"><Loader2 className="w-7 h-7 text-[#1ABC9C] animate-spin" /></div>;

  const b = booking;
  const isCancelled = b.bookingStatus === 'CANCELLED';
  const isPast = new Date(b.departureDate) < new Date();
  const exactDepTime = b.journeys?.[0]?.departureDateTime || b.departureDate;
  const depDate = new Date(exactDepTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const fmt = (n: number) => fmtC(n, b.currency || 'USD');

  const actionConfig: Record<string, { icon: any; cls: string }> = {
    cancel: { icon: XCircle, cls: 'text-red-400 border-red-400/20 bg-red-400/5 hover:bg-red-400/10' },
    seat_change: { icon: Ticket, cls: 'text-blue-400 border-blue-400/20 bg-blue-400/5 hover:bg-blue-400/10' },
    passenger_update: { icon: User, cls: 'text-amber-400 border-amber-400/20 bg-amber-400/5 hover:bg-amber-400/10' },
    date_change: { icon: Calendar, cls: 'text-purple-400 border-purple-400/20 bg-purple-400/5 hover:bg-purple-400/10' },
    download_eticket: { icon: Download, cls: 'text-[#1ABC9C] border-[#1ABC9C]/20 bg-[#1ABC9C]/5 hover:bg-[#1ABC9C]/10' },
    download_full_itinerary: { icon: Download, cls: 'text-indigo-400 border-indigo-400/20 bg-indigo-400/5 hover:bg-indigo-400/10' },
    email_itinerary: { icon: Mail, cls: 'text-pink-400 border-pink-400/20 bg-pink-400/5 hover:bg-pink-400/10' },
    refund_status: { icon: CreditCard, cls: 'text-blue-400 border-blue-400/20 bg-blue-400/5 hover:bg-blue-400/10' },
    contact_support: { icon: Mail, cls: 'text-slate-400 border-slate-400/20 bg-slate-400/5 hover:bg-slate-400/10' },
    add_baggage: { icon: Luggage, cls: 'text-orange-400 border-orange-400/20 bg-orange-400/5 hover:bg-orange-400/10' },
    upgrade_cabin: { icon: TrendingUp, cls: 'text-violet-400 border-violet-400/20 bg-violet-400/5 hover:bg-violet-400/10' },
    resend_itinerary: { icon: Mail, cls: 'text-sky-400 border-sky-400/20 bg-sky-400/5 hover:bg-sky-400/10' },
  };
  const fallbackActions = isCancelled
    ? [{ key: 'refund_status', label: 'View Refund Status', available: true }, { key: 'contact_support', label: 'Contact Support', available: true }]
    : [
        { key: 'cancel', label: 'Cancel Booking', available: !isPast },
        { key: 'date_change', label: 'Change Flight', available: !isPast, disabled: !(b.pnrs?.some((p: any) => p.changeable)) },
        { key: 'seat_change', label: 'Change Seat', available: !isPast, disabled: !(b.pnrs?.some((p: any) => p.seatSelection !== null && p.seatSelection !== 'false' && p.seatSelection !== 'none' && p.seatSelection !== 'unavailable')) },
        { key: 'passenger_update', label: 'Update Passenger', available: true },
        { key: 'download_eticket', label: 'Download E-Ticket', available: b.ticketingStatus === 'ISSUED' },
        { key: 'download_full_itinerary', label: 'Download Full Itinerary', available: true },
        { key: 'email_itinerary', label: 'Email Itinerary', available: true },
        { key: 'contact_support', label: 'Contact Support', available: true },
      ];
  const baseActions = (actions.length > 0 ? actions : fallbackActions).filter(a => a.available);
  // Always append document actions (these are client-side, not from backend)
  const documentActions = [
    { key: 'download_full_itinerary', label: 'Download Full Itinerary', available: true },
    { key: 'email_itinerary', label: 'Email Itinerary', available: true },
  ];
  const resolvedActions = [
    ...baseActions.filter(a => a.key !== 'download_full_itinerary' && a.key !== 'email_itinerary'),
    ...documentActions,
  ];

  return (
    <div>
      {/* Back */}
      <button onClick={() => router.push('/account/bookings')} className="flex items-center gap-2 text-slate-500 hover:text-white text-sm mb-4 transition-colors">
        <ArrowLeft size={15} /> Back to My Trips
      </button>

      {/* ── Content Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column (Header + Tabs) */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* ── Header Card ── */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden mb-5">
        {/* Status ribbon */}
        <div className={`h-1 ${isCancelled ? 'bg-red-500' : isPast ? 'bg-blue-500' : 'bg-[#1ABC9C]'}`} />
        <div className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                <h1 className="text-xl font-black text-white">{b.masterBookingReference || b.masterPnr}</h1>
                <StatusBadge status={b.bookingStatus} />
                {(b.tripType || '').toLowerCase().includes('round') && (
                  <span className="text-[9px] font-bold text-slate-500 bg-white/[0.04] px-2 py-0.5 rounded-full border border-white/[0.06]">Round Trip</span>
                )}
              </div>
              <p className="text-slate-500 text-sm">{b.customerName} · {depDate}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-[#F97316]">{fmt(Number(b.totalAmount))}</p>
              <div className="flex items-center gap-3 mt-1 justify-end">
                <MiniStatus label="Booking" status={b.bookingStatus} />
                <div className="w-px h-6 bg-white/[0.06]" />
                <MiniStatus label="Payment" status={b.paymentStatus} />
                <div className="w-px h-6 bg-white/[0.06]" />
                <MiniStatus label="Ticketing" status={b.ticketingStatus} />
              </div>
            </div>
          </div>
          {/* Journey legs */}
          {(b.journeys || []).length > 0 ? (
            <div className="space-y-3 mt-4 pt-4 border-t border-white/[0.06]">
              {(b.journeys || []).map((j: any, ji: number) => {
                const isReturn = j.direction === 'RETURN';
                const depDt = j.departureDateTime || j.departureDate || b.departureDate;
                const arrDt = j.arrivalDateTime || j.arrivalDate;
                const fmtTimeLeg = (dt: string) => new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                const fmtDateLeg = (dt: string) => new Date(dt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                const fmtDurLeg = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
                const stops = j.totalStops ?? 0;
                const dur = j.totalDurationMinutes ?? 0;
                const airline = j.segments?.[0]?.airlineName || j.segments?.[0]?.airlineCode || '';
                const flightNo = j.segments?.[0]?.flightNumber || '';
                const cabin = j.segments?.[0]?.cabin || '';

                return (
                  <div key={j.id || ji} className={`rounded-xl border p-4 ${isReturn ? 'border-purple-500/20 bg-purple-500/[0.03]' : 'border-[#1ABC9C]/20 bg-[#1ABC9C]/[0.03]'}`}>
                    {/* Leg label */}
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-2 h-2 rounded-full ${isReturn ? 'bg-purple-400' : 'bg-[#1ABC9C]'}`} />
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${isReturn ? 'text-purple-400' : 'text-[#1ABC9C]'}`}>
                        {isReturn ? 'Return' : 'Outbound'}
                      </span>
                      <span className="text-[10px] text-slate-500">{fmtDateLeg(depDt)}</span>
                      {airline && <span className="text-[10px] text-slate-600">· {airline}</span>}
                      {flightNo && <span className="text-[10px] text-slate-600 font-mono">{flightNo}</span>}
                      {cabin && <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full">{cabin}</span>}
                    </div>

                    {/* Route row */}
                    <div className="flex items-center gap-3">
                      <div className="text-center min-w-0">
                        <p className="text-white font-black text-2xl leading-none">{j.originAirport || b.originAirport}</p>
                        <p className="text-slate-500 text-xs mt-0.5">{j.originCity || b.originCity}</p>
                        {depDt && <p className="text-white font-semibold text-xs mt-1">{fmtTimeLeg(depDt)}</p>}
                      </div>

                      <div className="flex-1 flex flex-col items-center gap-0.5 px-2">
                        {dur > 0 && <span className="text-[10px] text-slate-500 font-semibold">{fmtDurLeg(dur)}</span>}
                        <div className="flex items-center gap-1 w-full">
                          <div className={`h-px flex-1 ${isReturn ? 'bg-purple-400/20' : 'bg-[#1ABC9C]/20'}`} />
                          <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${isReturn ? 'bg-purple-400/15 border-purple-400/30' : 'bg-[#1ABC9C]/15 border-[#1ABC9C]/30'}`}>
                            <Plane size={10} className={isReturn ? 'text-purple-400 -rotate-90' : 'text-[#1ABC9C] rotate-90'} />
                          </div>
                          <div className={`h-px flex-1 ${isReturn ? 'bg-purple-400/20' : 'bg-[#1ABC9C]/20'}`} />
                        </div>
                        <span className="text-[9px] text-slate-600">{stops === 0 ? 'Nonstop' : stops === 1 ? '1 stop' : `${stops} stops`}</span>
                      </div>

                      <div className="text-center min-w-0">
                        <p className="text-white font-black text-2xl leading-none">{j.destinationAirport || b.destinationAirport}</p>
                        <p className="text-slate-500 text-xs mt-0.5">{j.destinationCity || b.destinationCity}</p>
                        {arrDt && <p className="text-white font-semibold text-xs mt-1">{fmtTimeLeg(arrDt)}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/[0.06]">
              <div className="text-center"><p className="text-white font-black text-2xl">{b.originAirport}</p><p className="text-slate-500 text-xs">{b.originCity}</p></div>
              <div className="flex-1 flex items-center gap-1.5"><div className="h-px flex-1 bg-gradient-to-r from-white/10 to-white/5" /><Plane size={13} className="text-[#1ABC9C] rotate-90" /><div className="h-px flex-1 bg-gradient-to-l from-white/10 to-white/5" /></div>
              <div className="text-center"><p className="text-white font-black text-2xl">{b.destinationAirport}</p><p className="text-slate-500 text-xs">{b.destinationCity}</p></div>
            </div>
          )}
        </div>
      </div>

          {/* Tab bar */}
          <div className="flex gap-1 mb-4 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1">
            {TABS.map(t => {
              const Icon = t.icon; const active = tab === t.key;
              return (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${active ? 'bg-white/[0.08] text-white border border-white/[0.1]' : 'text-slate-500 hover:text-slate-300'}`}>
                  <Icon size={13} />{t.label}
                </button>
              );
            })}
          </div>

          {/* ─ Overview Tab ─ */}
          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Booking Details</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[['Reference', b.masterBookingReference], ['Airline PNR', b.masterPnr || '—'], ['Departure', depDate], ['Trip Type', (b.tripType || '').replace(/_/g, ' ')],
                    ['Provider', b.primaryProvider], ['Passengers', `${b.passengers?.length || 1}`], ['Payment', (b.paymentStatus || '').replace(/_/g, ' ')], ['Ticketing', (b.ticketingStatus || '').replace(/_/g, ' ')]
                  ].map(([label, val]) => (
                    <div key={label as string} className="flex justify-between py-1.5 border-b border-white/[0.03]">
                      <span className="text-slate-500">{label}</span>
                      <span className="text-white font-medium capitalize text-right">{(val as string).toLowerCase()}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* ─ Itinerary Tab ─ */}
          {tab === 'itinerary' && (() => {
            const fmtTime = (dt: string) => new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            const fmtDate = (dt: string) => new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const fmtDur = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
            const allSegs = (b.journeys || []).flatMap((j: any) => (j.segments || []).map((s: any) => ({ ...s, direction: j.direction })));

            return (
              <div className="space-y-5">
                {/* ── Itinerary Summary ── */}
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Itinerary Summary</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    {[
                      ['Route', `${b.originAirport} → ${b.destinationAirport}`],
                      ['Trip type', (b.tripType || '').replace(/_/g, ' ')],
                      ['Departure', fmtDate(b.departureDate)],
                      ['Return', b.returnDate ? fmtDate(b.returnDate) : '—'],
                      ['Airline', allSegs[0]?.airlineName || b.primaryProvider],
                      ['Class', allSegs[0]?.cabin ? allSegs[0].cabin.charAt(0).toUpperCase() + allSegs[0].cabin.slice(1).toLowerCase() : '—'],
                      ['Status', (b.bookingStatus || '').replace(/_/g, ' ')],
                      ['Airline PNR', b.masterPnr || '—'],
                    ].map(([label, val]) => (
                      <div key={label as string} className="flex justify-between py-1.5 border-b border-white/[0.03]">
                        <span className="text-slate-500">{label}</span>
                        <span className="text-white font-medium capitalize text-right">{(val as string).toLowerCase()}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Flight Details ── */}
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-4">Flight Details</p>
                  <div className="space-y-5">
                    {(b.journeys || []).map((j: any, ji: number) => (
                      <div key={j.id || ji}>
                        {/* Journey header */}
                        <div className="flex items-center gap-2 mb-3">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${j.direction === 'RETURN' ? 'bg-amber-500/10 text-amber-400' : 'bg-[#1ABC9C]/10 text-[#1ABC9C]'}`}>
                            {j.direction === 'RETURN' ? 'Return' : 'Outbound'}
                          </span>
                          <span className="text-xs text-slate-500">{fmtDate(j.departureDateTime || j.departureDate || b.departureDate)}</span>
                        </div>

                        {/* Segments */}
                        {(j.segments || []).map((seg: any, si: number) => (
                          <div key={seg.id || si} className={`bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 ${si > 0 ? 'mt-3' : ''}`}>
                            {/* Airline & flight */}
                            <div className="flex items-center gap-2 mb-3">
                              <Plane size={14} className="text-[#1ABC9C]" />
                              <span className="text-white text-sm font-bold">{seg.airlineName}</span>
                              <span className="text-slate-500 text-xs font-mono">{seg.flightNumber}</span>
                              {seg.cabin && <span className="ml-auto px-2 py-0.5 rounded-lg bg-white/[0.04] text-slate-400 text-[10px] font-bold uppercase">{seg.cabin}</span>}
                            </div>

                            {/* Times row */}
                            <div className="flex items-center gap-3">
                              {/* Departure */}
                              <div className="flex-1">
                                <p className="text-white text-xl font-black">{seg.departureDateTime ? fmtTime(seg.departureDateTime) : '—'}</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">{seg.originAirport} · {seg.originCity}</p>
                                {seg.originTerminal && <p className="text-[10px] text-slate-600">Terminal {seg.originTerminal}</p>}
                              </div>

                              {/* Duration line */}
                              <div className="flex flex-col items-center px-2">
                                <span className="text-[10px] text-slate-500 font-bold">{seg.durationMinutes ? fmtDur(seg.durationMinutes) : ''}</span>
                                <div className="flex items-center gap-1 my-1 w-24">
                                  <div className="h-px flex-1 bg-white/10" />
                                  <Plane size={10} className="text-[#1ABC9C] rotate-90" />
                                  <div className="h-px flex-1 bg-white/10" />
                                </div>
                                {seg.totalStops > 0 && <span className="text-[9px] text-amber-400">{seg.totalStops} stop</span>}
                              </div>

                              {/* Arrival */}
                              <div className="flex-1 text-right">
                                <p className="text-white text-xl font-black">{seg.arrivalDateTime ? fmtTime(seg.arrivalDateTime) : '—'}</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">{seg.destinationAirport} · {seg.destinationCity}</p>
                                {seg.destinationTerminal && <p className="text-[10px] text-slate-600">Terminal {seg.destinationTerminal}</p>}
                              </div>
                            </div>

                            {/* Aircraft */}
                            {seg.aircraftType && (
                              <p className="text-[10px] text-slate-600 mt-2 pt-2 border-t border-white/[0.04]">Aircraft: {seg.aircraftType}</p>
                            )}
                          </div>
                        ))}

                        {/* Layover between journeys */}
                        {ji < (b.journeys || []).length - 1 && (
                          <div className="my-4 border-t border-dashed border-white/[0.06]" />
                        )}
                      </div>
                    ))}
                    {(!b.journeys || b.journeys.length === 0) && (
                      <div className="flex items-center gap-4 py-4">
                        <div className="text-center"><p className="text-white font-black text-2xl">{b.originAirport}</p><p className="text-slate-500 text-xs">{b.originCity}</p></div>
                        <div className="flex-1 flex items-center gap-1.5"><div className="h-px flex-1 bg-white/10" /><Plane size={13} className="text-[#1ABC9C] rotate-90" /><div className="h-px flex-1 bg-white/10" /></div>
                        <div className="text-center"><p className="text-white font-black text-2xl">{b.destinationAirport}</p><p className="text-slate-500 text-xs">{b.destinationCity}</p></div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Passenger Details ── */}
                {(b.passengers || []).length > 0 && (
                  <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-4">Passenger Details</p>
                    <div className="space-y-5">
                      {(b.passengers || []).map((pax: any, pi: number) => (
                        <div key={pax.id || pi}>
                          <p className="text-white font-bold text-sm mb-3">{pax.firstName} {pax.lastName}</p>
                          {/* Per-journey info */}
                          {(b.journeys || []).map((j: any, ji: number) => {
                            const paxSeats = (b.seats || []).filter((s: any) => s.passengerId === pax.id && (j.segments || []).some((seg: any) => seg.id === s.segmentId));
                            const paxMeals = (b.meals || []).filter((m: any) => m.passengerId === pax.id && m.journeyId === j.id);
                            const paxBaggage = (b.baggage || []).filter((bg: any) => bg.passengerId === pax.id && bg.journeyId === j.id);
                            const seatLabel = paxSeats.length > 0 ? paxSeats.map((s: any) => s.seatNumber).join(', ') : 'Pending airline assignment';
                            const mealLabel = paxMeals.length > 0 ? paxMeals.map((m: any) => m.mealLabel).join(', ') : 'Pending airline assignment';
                            const baggageLabel = paxBaggage.length > 0 ? paxBaggage.map((bg: any) => `${bg.quantity} ${bg.baggageType} bag${bg.quantity > 1 ? 's' : ''}`).join(', ') : 'Not selected';
                            return (
                              <div key={j.id || ji} className="mb-3">
                                <div className={`flex items-center gap-2 py-1.5 px-3 rounded-t-lg ${j.direction === 'RETURN' ? 'bg-amber-500/10' : 'bg-[#1ABC9C]/10'}`}>
                                  <span className={`text-[10px] font-bold uppercase ${j.direction === 'RETURN' ? 'text-amber-400' : 'text-[#1ABC9C]'}`}>
                                    {j.direction === 'RETURN' ? 'Return Flight' : 'Outbound Flight'}
                                  </span>
                                  <span className="ml-auto text-[10px] text-slate-400 font-mono">{j.originAirport} → {j.destinationAirport}</span>
                                </div>
                                <div className="bg-white/[0.02] border border-white/[0.05] border-t-0 rounded-b-lg p-3 space-y-2">
                                  <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">Seat</span>
                                    <span className={`font-medium ${paxSeats.length > 0 ? 'text-white' : 'text-amber-400'}`}>{seatLabel}</span>
                                  </div>
                                  <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">Meal</span>
                                    <span className={`font-medium ${paxMeals.length > 0 ? 'text-white' : 'text-amber-400'}`}>{mealLabel}</span>
                                  </div>
                                  <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">Baggage</span>
                                    <span className={`font-medium ${paxBaggage.length > 0 ? 'text-white' : 'text-slate-400'}`}>{baggageLabel}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {pi < (b.passengers || []).length - 1 && <div className="border-t border-white/[0.06] mt-4 mb-2" />}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Fare Breakdown ── */}
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Fare Breakdown</p>
                  <div className="space-y-2 text-sm">
                    {(() => {
                      const charges = b.commercialCharges || [];
                      const baseFares = charges.filter((c: any) => c.chargeType === 'BASE_FARE');
                      const taxes = charges.filter((c: any) => c.chargeType === 'TAX');
                      const fees = charges.filter((c: any) => ['SERVICE_FEE', 'MARKUP', 'PLATFORM_FEE'].includes(c.chargeType));
                      const addons = b.addons || [];
                      const paxTypes: Record<string, { count: number; total: number }> = {};
                      for (const pax of (b.passengers || [])) {
                        const t = (pax.passengerType || 'adult').toLowerCase();
                        if (!paxTypes[t]) paxTypes[t] = { count: 0, total: 0 };
                        paxTypes[t].count++;
                      }
                      // If we have commercial charges, use them; otherwise derive from totals
                      if (charges.length > 0) {
                        return (
                          <>
                            {baseFares.map((c: any, i: number) => (
                              <div key={c.id || i} className="flex justify-between py-1.5 border-b border-white/[0.03]">
                                <span className="text-slate-400">{c.passengerType ? `${c.passengerType.charAt(0).toUpperCase() + c.passengerType.slice(1)} fare × ${c.quantity}` : 'Base fare'}</span>
                                <span className="text-white font-medium">{fmt(Number(c.totalAmount))}</span>
                              </div>
                            ))}
                            {taxes.length > 0 && (
                              <div className="flex justify-between py-1.5 border-b border-white/[0.03]">
                                <span className="text-slate-400">Taxes & government fees</span>
                                <span className="text-white font-medium">{fmt(taxes.reduce((sum: number, t: any) => sum + Number(t.totalAmount), 0))}</span>
                              </div>
                            )}
                            {fees.map((c: any, i: number) => (
                              <div key={c.id || i} className="flex justify-between py-1.5 border-b border-white/[0.03]">
                                <span className="text-slate-400">{c.chargeType === 'SERVICE_FEE' ? 'Service fee' : c.chargeType === 'MARKUP' ? 'Fare adjustment' : 'Platform fee'}</span>
                                <span className="text-white font-medium">{fmt(Number(c.totalAmount))}</span>
                              </div>
                            ))}
                            {addons.map((a: any, i: number) => (
                              <div key={a.id || i} className="flex justify-between py-1.5 border-b border-white/[0.03]">
                                <span className="text-slate-400">{a.addonName}</span>
                                <span className="text-white font-medium">{fmt(Number(a.amount))}</span>
                              </div>
                            ))}
                          </>
                        );
                      } else {
                        // Fallback: show available totals from the master booking
                        const providerTotal = b.providerPayableTotal ? Number(b.providerPayableTotal) : null;
                        const markup = b.markupAmount ? Number(b.markupAmount) : null;
                        const serviceFee = b.serviceFeeAmount ? Number(b.serviceFeeAmount) : null;
                        const priceProt = b.priceProtectionAmount ? Number(b.priceProtectionAmount) : null;
                        const insurance = b.travelInsuranceAmount ? Number(b.travelInsuranceAmount) : null;
                        return (
                          <>
                            {providerTotal !== null && (
                              <div className="flex justify-between py-1.5 border-b border-white/[0.03]">
                                <span className="text-slate-400">Base fare (all passengers)</span>
                                <span className="text-white font-medium">{fmt(providerTotal)}</span>
                              </div>
                            )}
                            {markup !== null && markup > 0 && (
                              <div className="flex justify-between py-1.5 border-b border-white/[0.03]">
                                <span className="text-slate-400">Fare adjustment</span>
                                <span className="text-white font-medium">{fmt(markup)}</span>
                              </div>
                            )}
                            {serviceFee !== null && serviceFee > 0 && (
                              <div className="flex justify-between py-1.5 border-b border-white/[0.03]">
                                <span className="text-slate-400">Service fee</span>
                                <span className="text-white font-medium">{fmt(serviceFee)}</span>
                              </div>
                            )}
                            {priceProt !== null && priceProt > 0 && (
                              <div className="flex justify-between py-1.5 border-b border-white/[0.03]">
                                <span className="text-slate-400">Price drop protection</span>
                                <span className="text-white font-medium">{fmt(priceProt)}</span>
                              </div>
                            )}
                            {insurance !== null && insurance > 0 && (
                              <div className="flex justify-between py-1.5 border-b border-white/[0.03]">
                                <span className="text-slate-400">Travel insurance</span>
                                <span className="text-white font-medium">{fmt(insurance)}</span>
                              </div>
                            )}
                            {addons.map((a: any, i: number) => (
                              <div key={a.id || i} className="flex justify-between py-1.5 border-b border-white/[0.03]">
                                <span className="text-slate-400">{a.addonName}</span>
                                <span className="text-white font-medium">{fmt(Number(a.amount))}</span>
                              </div>
                            ))}
                          </>
                        );
                      }
                    })()}
                    {/* Grand total */}
                    <div className="flex justify-between pt-3 mt-2 border-t border-white/[0.08]">
                      <span className="text-white font-bold">Total Charged</span>
                      <span className="text-[#F97316] font-black text-lg">{fmt(Number(b.totalAmount))}</span>
                    </div>
                  </div>
                </div>

                {/* ── Payment ── */}
                {(b.payments || []).length > 0 && (
                  <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Payment</p>
                    <div className="space-y-2 text-sm">
                      {(b.payments || []).map((pay: any, i: number) => (
                        <div key={pay.id || i} className="space-y-2">
                          <div className="flex justify-between py-1.5 border-b border-white/[0.03]">
                            <span className="text-slate-500">Payment method</span>
                            <span className="text-white font-medium">{pay.paymentMethodType || 'Card'}{pay.cardLast4 ? ` ····${pay.cardLast4}` : ''}</span>
                          </div>
                          <div className="flex justify-between py-1.5 border-b border-white/[0.03]">
                            <span className="text-slate-500">Amount</span>
                            <span className="text-white font-medium">{fmt(Number(pay.amount))}</span>
                          </div>
                          <div className="flex justify-between py-1.5 border-b border-white/[0.03]">
                            <span className="text-slate-500">Status</span>
                            <span className={`font-medium ${pay.status === 'COMPLETED' || pay.status === 'PAID' ? 'text-emerald-400' : pay.status === 'FAILED' ? 'text-red-400' : 'text-amber-400'}`}>
                              {(pay.status || '').replace(/_/g, ' ')}
                            </span>
                          </div>
                          {pay.paidAt && (
                            <div className="flex justify-between py-1.5 border-b border-white/[0.03]">
                              <span className="text-slate-500">Confirmed at</span>
                              <span className="text-white font-medium text-xs">{new Date(pay.paidAt).toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ─ Passengers Tab ─ */}
          {tab === 'passengers' && (
            <div className="space-y-3">
              {(b.passengers || []).map((p: any, i: number) => (
                <div key={p.id || i} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1ABC9C]/20 to-[#1ABC9C]/5 border border-[#1ABC9C]/20 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-[#1ABC9C]">{p.firstName?.[0]}{p.lastName?.[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold">{p.firstName} {p.lastName}</p>
                      <p className="text-slate-500 text-xs capitalize">{(p.passengerType || 'Adult').toLowerCase()}</p>
                    </div>
                    {p.ticketNumber && <span className="text-[10px] text-slate-500 font-mono bg-white/[0.04] px-2 py-1 rounded shrink-0">{p.ticketNumber}</span>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                    {p.email && <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2"><p className="text-slate-600 text-[9px] uppercase font-bold">Email</p><p className="text-slate-300 truncate">{p.email}</p></div>}
                    {p.phone && <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2"><p className="text-slate-600 text-[9px] uppercase font-bold">Phone</p><p className="text-slate-300">{p.phone}</p></div>}
                    {p.gender && <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2"><p className="text-slate-600 text-[9px] uppercase font-bold">Gender</p><p className="text-slate-300 capitalize">{p.gender}</p></div>}
                    {p.dateOfBirth && <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2"><p className="text-slate-600 text-[9px] uppercase font-bold">Date of Birth</p><p className="text-slate-300">{new Date(p.dateOfBirth).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p></div>}
                    {p.nationality && <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2"><p className="text-slate-600 text-[9px] uppercase font-bold">Nationality</p><p className="text-slate-300">{p.nationality}</p></div>}
                    {p.passportCountry && <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2"><p className="text-slate-600 text-[9px] uppercase font-bold">Issuing Country</p><p className="text-slate-300">{p.passportCountry}</p></div>}
                    {p.passportNumber && <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2"><p className="text-slate-600 text-[9px] uppercase font-bold">Passport #</p><p className="text-slate-300">{p.passportNumber}</p></div>}
                    {p.passportExpiry && <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2"><p className="text-slate-600 text-[9px] uppercase font-bold">Expiry Date</p><p className="text-slate-300">{new Date(p.passportExpiry).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p></div>}
                  </div>
                </div>
              ))}
              {(!b.passengers || b.passengers.length === 0) && <div className="text-center py-10 text-slate-500 text-sm">No passenger data available.</div>}
            </div>
          )}

          {/* ─ Timeline Tab ─ */}
          {tab === 'timeline' && (
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
              {timeline.length === 0 ? <p className="text-slate-500 text-sm text-center py-6">No activity recorded yet.</p> : (
                <div className="space-y-0">
                  {timeline.slice(0, 20).map((ev, i) => {
                    const isLast = i === Math.min(timeline.length, 20) - 1;
                    return (
                      <div key={ev.id} className="flex gap-3.5">
                        <div className="flex flex-col items-center">
                          <div className="w-2.5 h-2.5 rounded-full bg-[#1ABC9C] mt-1.5 shrink-0 border-2 border-[#1ABC9C]/30" />
                          {!isLast && <div className="w-px flex-1 bg-white/[0.06] my-1" />}
                        </div>
                        <div className={`pb-4 ${isLast ? '' : ''}`}>
                          <p className="text-white text-sm font-medium">{ev.eventTitle}</p>
                          {ev.eventDescription && <p className="text-slate-500 text-xs mt-0.5">{ev.eventDescription}</p>}
                          <p className="text-slate-600 text-[10px] mt-1">{new Date(ev.createdAt).toLocaleString()}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right Column: Actions ── */}
        <div className="space-y-4">
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 lg:sticky lg:top-24">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Actions</p>
            <div className="space-y-2">
              {resolvedActions.map(a => {
                const cfg = actionConfig[a.key] || actionConfig.contact_support;
                const Icon = cfg.icon;
                return (
                  <button key={a.key} onClick={() => !a.disabled && setActiveModal(a.key)}
                    className={`w-full flex items-center gap-3 py-4 px-4 rounded-xl border transition-all text-left ${cfg.cls} ${a.disabled ? 'opacity-40 cursor-not-allowed grayscale' : ''}`}>
                    <Icon size={15} />
                    <span className="text-sm font-semibold flex-1">{a.label}</span>
                    <ChevronRight size={12} className="opacity-40" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {activeModal === 'cancel' && <CancelBookingModal bookingId={ref} onClose={() => setActiveModal(null)} successRedirect="/account/bookings" />}
        {activeModal === 'seat_change' && <SeatMapModal bookingId={ref} onClose={() => setActiveModal(null)} provider={b.primaryProvider} />}
        {activeModal === 'passenger_update' && <PassengerModal bookingId={ref} passengers={b.passengers || []} onClose={() => setActiveModal(null)} />}
        {activeModal === 'date_change' && <DateChangeModal bookingId={ref} booking={b} onClose={() => setActiveModal(null)} />}
        {activeModal === 'download_eticket' && <ETicketModal bookingId={ref} onClose={() => setActiveModal(null)} />}
        {activeModal === 'refund_status' && <RefundModal booking={b} onClose={() => setActiveModal(null)} />}
        {activeModal === 'contact_support' && <SupportModal booking={b} onClose={() => setActiveModal(null)} />}
        {activeModal === 'email_itinerary' && (() => {
          const email = b.customerEmail || 'your email';

          async function handleSendEmail() {
            try {
              setEmailSending(true);
              setEmailError('');
              const htmlContent = generateItineraryHtmlFromBooking(b);
              const pdfBase64 = btoa(unescape(encodeURIComponent(htmlContent)));
              let apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
              apiUrl = apiUrl.replace(/\/$/, '');
              const res = await fetch(`${apiUrl}/api/manage-booking/${ref}/email-itinerary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, pdfBase64, isHtml: true }),
              });
              if (!res.ok) throw new Error('Failed to send email');
              setEmailDone(true);
            } catch {
              setEmailError('Failed to send email. Please try again.');
            } finally {
              setEmailSending(false);
            }
          }

          function closeEmailModal() {
            setActiveModal(null);
            setEmailDone(false);
            setEmailError('');
            setEmailSending(false);
          }

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={closeEmailModal}>
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-sm bg-[#0f1525] border border-white/10 rounded-2xl p-6 text-center" onClick={e => e.stopPropagation()}>
                {emailDone ? (
                  <>
                    <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3"><Check size={28} className="text-emerald-400" /></div>
                    <p className="text-white font-bold mb-1">Itinerary Sent!</p>
                    <p className="text-slate-400 text-sm mb-4">A copy has been sent to {email}.</p>
                    <button onClick={closeEmailModal} className="px-6 py-2.5 rounded-xl bg-[#1ABC9C] text-white font-semibold text-sm">Done</button>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-full bg-pink-500/10 border border-pink-500/20 flex items-center justify-center mx-auto mb-3"><Mail size={28} className="text-pink-400" /></div>
                    <p className="text-white font-bold mb-1">Email Itinerary</p>
                    <p className="text-slate-400 text-sm mb-4">Send the full itinerary to <span className="text-white font-semibold">{email}</span></p>
                    {emailError && <p className="text-red-400 text-xs mb-3">{emailError}</p>}
                    <div className="flex gap-3 justify-center">
                      <button onClick={closeEmailModal} className="px-5 py-2.5 rounded-xl border border-white/10 text-slate-400 font-semibold text-sm hover:bg-white/[0.04] transition-all">Cancel</button>
                      <button onClick={handleSendEmail} disabled={emailSending} className="px-5 py-2.5 rounded-xl bg-[#1ABC9C] text-white font-semibold text-sm disabled:opacity-50">{emailSending ? 'Sending…' : 'Send Email'}</button>
                    </div>
                  </>
                )}
              </motion.div>
            </div>
          );
        })()}
        {activeModal === 'resend_itinerary' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setActiveModal(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-sm bg-[#0f1525] border border-white/10 rounded-2xl p-6 text-center" onClick={e => e.stopPropagation()}>
              <div className="w-14 h-14 rounded-full bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mx-auto mb-3"><Check size={28} className="text-sky-400" /></div>
              <p className="text-white font-bold mb-1">Itinerary Sent</p>
              <p className="text-slate-400 text-sm mb-4">A copy has been sent to {b.customerEmail}.</p>
              <button onClick={() => setActiveModal(null)} className="px-6 py-2.5 rounded-xl bg-[#1ABC9C] text-white font-semibold text-sm">Done</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
