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

  useEffect(() => { loadSession(); }, []);
  useEffect(() => { if (ref) { loadBookingDetail(ref); loadActions(ref); loadTimeline(ref); } }, [ref]);

  if (bookingLoading || !booking) return <div className="flex items-center justify-center py-24"><Loader2 className="w-7 h-7 text-[#1ABC9C] animate-spin" /></div>;

  const b = booking;
  const isCancelled = b.bookingStatus === 'CANCELLED';
  const isPast = new Date(b.departureDate) < new Date();
  const depDate = new Date(b.departureDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const fmt = (n: number) => fmtC(n, b.currency || 'USD');

  const actionConfig: Record<string, { icon: any; cls: string }> = {
    cancel: { icon: XCircle, cls: 'text-red-400 border-red-400/20 bg-red-400/5 hover:bg-red-400/10' },
    seat_change: { icon: Ticket, cls: 'text-blue-400 border-blue-400/20 bg-blue-400/5 hover:bg-blue-400/10' },
    passenger_update: { icon: User, cls: 'text-amber-400 border-amber-400/20 bg-amber-400/5 hover:bg-amber-400/10' },
    date_change: { icon: Calendar, cls: 'text-purple-400 border-purple-400/20 bg-purple-400/5 hover:bg-purple-400/10' },
    download_eticket: { icon: Download, cls: 'text-[#1ABC9C] border-[#1ABC9C]/20 bg-[#1ABC9C]/5 hover:bg-[#1ABC9C]/10' },
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
        { key: 'date_change', label: 'Change Flight', available: !isPast },
        { key: 'seat_change', label: 'Change Seat', available: !isPast },
        { key: 'passenger_update', label: 'Update Passenger', available: true },
        { key: 'download_eticket', label: 'Download E-Ticket', available: b.ticketingStatus === 'ISSUED' },
        { key: 'resend_itinerary', label: 'Re-send Itinerary', available: true },
        { key: 'contact_support', label: 'Contact Support', available: true },
      ];
  const resolvedActions = (actions.length > 0 ? actions : fallbackActions).filter(a => a.available);

  return (
    <div>
      {/* Back */}
      <button onClick={() => router.push('/account/bookings')} className="flex items-center gap-2 text-slate-500 hover:text-white text-sm mb-4 transition-colors">
        <ArrowLeft size={15} /> Back to My Trips
      </button>

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
          {/* Route display */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/[0.06]">
            <div className="text-center"><p className="text-white font-black text-2xl">{b.originAirport}</p><p className="text-slate-500 text-xs">{b.originCity}</p></div>
            <div className="flex-1 flex items-center gap-1.5"><div className="h-px flex-1 bg-gradient-to-r from-white/10 to-white/5" /><Plane size={13} className="text-[#1ABC9C] rotate-90" /><div className="h-px flex-1 bg-gradient-to-l from-white/10 to-white/5" /></div>
            <div className="text-center"><p className="text-white font-black text-2xl">{b.destinationAirport}</p><p className="text-slate-500 text-xs">{b.destinationCity}</p></div>
          </div>
        </div>
      </div>

      {/* ── Content Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Tabs */}
        <div className="lg:col-span-2">
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
                  {[['Reference', b.masterBookingReference], ['PNR', b.masterPnr || '—'], ['Departure', depDate], ['Trip Type', (b.tripType || '').replace(/_/g, ' ')],
                    ['Provider', b.primaryProvider], ['Passengers', `${b.passengers?.length || 1}`], ['Payment', (b.paymentStatus || '').replace(/_/g, ' ')], ['Ticketing', (b.ticketingStatus || '').replace(/_/g, ' ')]
                  ].map(([label, val]) => (
                    <div key={label as string} className="flex justify-between py-1.5 border-b border-white/[0.03]">
                      <span className="text-slate-500">{label}</span>
                      <span className="text-white font-medium capitalize text-right">{(val as string).toLowerCase()}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* PNRs */}
              {b.pnrs?.length > 0 && (
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Airline PNRs</p>
                  <div className="flex flex-wrap gap-2">
                    {b.pnrs.map((p: any) => (
                      <div key={p.id} className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                        <p className="text-white font-mono font-bold text-sm">{p.pnrCode}</p>
                        <p className="text-slate-500 text-[10px] capitalize">{p.provider} · {p.status?.toLowerCase()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─ Itinerary Tab ─ */}
          {tab === 'itinerary' && (
            <div className="space-y-4">
              {(b.journeys || []).map((j: any, i: number) => (
                <div key={j.id || i} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-[10px] font-bold text-[#1ABC9C] uppercase tracking-wider bg-[#1ABC9C]/10 px-2.5 py-0.5 rounded-full">{j.direction === 'RETURN' ? 'Return' : 'Outbound'}</span>
                    <span className="text-xs text-slate-500">{new Date(j.departureDate || b.departureDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  </div>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="text-center"><p className="text-white font-black text-2xl">{j.originAirport || b.originAirport}</p><p className="text-slate-500 text-xs">{j.originCity || b.originCity}</p></div>
                    <div className="flex-1 flex items-center gap-1.5"><div className="h-px flex-1 bg-white/10" /><Plane size={13} className="text-[#1ABC9C] rotate-90" /><div className="h-px flex-1 bg-white/10" /></div>
                    <div className="text-center"><p className="text-white font-black text-2xl">{j.destinationAirport || b.destinationAirport}</p><p className="text-slate-500 text-xs">{j.destinationCity || b.destinationCity}</p></div>
                  </div>
                  {(j.segments || []).map((seg: any, si: number) => (
                    <div key={seg.id || si} className={`py-3 ${si > 0 ? 'border-t border-white/[0.06]' : ''}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-bold text-sm">{seg.flightNumber || seg.marketingFlightNumber}</span>
                          <span className="text-slate-400 text-xs">{seg.airlineName}</span>
                        </div>
                        {seg.cabinClass && <span className="px-2 py-0.5 rounded-lg bg-white/[0.04] text-slate-400 text-[10px] font-bold uppercase">{seg.cabinClass}</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        {seg.departureTime && <span>{seg.departureTime}</span>}
                        {seg.arrivalTime && <><span>→</span><span>{seg.arrivalTime}</span></>}
                        {seg.aircraft && <span className="ml-2 text-slate-600">· {seg.aircraft}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {(!b.journeys || b.journeys.length === 0) && (
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
                  <div className="flex items-center gap-4">
                    <div className="text-center"><p className="text-white font-black text-2xl">{b.originAirport}</p><p className="text-slate-500 text-xs">{b.originCity}</p></div>
                    <div className="flex-1 flex items-center gap-1.5"><div className="h-px flex-1 bg-white/10" /><Plane size={13} className="text-[#1ABC9C] rotate-90" /><div className="h-px flex-1 bg-white/10" /></div>
                    <div className="text-center"><p className="text-white font-black text-2xl">{b.destinationAirport}</p><p className="text-slate-500 text-xs">{b.destinationCity}</p></div>
                  </div>
                </div>
              )}
            </div>
          )}

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
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    {p.email && <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2"><p className="text-slate-600 text-[9px] uppercase font-bold">Email</p><p className="text-slate-300 truncate">{p.email}</p></div>}
                    {p.phone && <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2"><p className="text-slate-600 text-[9px] uppercase font-bold">Phone</p><p className="text-slate-300">{p.phone}</p></div>}
                    {p.nationality && <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2"><p className="text-slate-600 text-[9px] uppercase font-bold">Nationality</p><p className="text-slate-300">{p.nationality}</p></div>}
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

        {/* ── Right: Actions ── */}
        <div className="space-y-4">
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 lg:sticky lg:top-24">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Actions</p>
            <div className="space-y-2">
              {resolvedActions.map(a => {
                const cfg = actionConfig[a.key] || actionConfig.contact_support;
                const Icon = cfg.icon;
                return (
                  <button key={a.key} onClick={() => setActiveModal(a.key)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${cfg.cls}`}>
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
