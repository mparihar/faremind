'use client';

import React, { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import { useAdminStore } from '@/store/useAdminStore';
import {
  ArrowLeft, RefreshCw, Plane, User, Ticket, Package, CreditCard,
  Clock, FileJson, MessageSquare, Send, ChevronDown, ChevronRight,
  Globe, Tag, Hash, Trash2, Pencil, Plus, X, Save, Eye, EyeOff,
  Shield, Armchair, UtensilsCrossed, AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'summary' | 'journey' | 'passengers' | 'tickets' | 'seats' | 'meals' | 'addons' | 'payments' | 'timeline' | 'payloads' | 'notes' | 'auditLog';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'timeline',   label: 'Timeline',           icon: Clock },
  { id: 'summary',    label: 'Booking Summary',    icon: Hash },
  { id: 'journey',    label: 'Journey Details',    icon: Plane },
  { id: 'passengers', label: 'Passengers',         icon: User },
  { id: 'tickets',    label: 'Tickets / PNRs',     icon: Ticket },
  { id: 'seats',      label: 'Seats',              icon: Armchair },
  { id: 'meals',      label: 'Meals',              icon: UtensilsCrossed },
  { id: 'addons',     label: 'Add-ons',            icon: Package },
  { id: 'payments',   label: 'Payments',           icon: CreditCard },
  { id: 'payloads',   label: 'Provider Payloads',  icon: FileJson },
  { id: 'notes',      label: 'Notes',              icon: MessageSquare },
  { id: 'auditLog',   label: 'Audit Log',          icon: Shield },
];

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED:           'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
  TICKETED:            'bg-[#1ABC9C]/15 text-[#1ABC9C] border-[#1ABC9C]/20',
  CREATED:             'bg-blue-400/15 text-blue-400 border-blue-400/20',
  PENDING:             'bg-amber-400/15 text-amber-400 border-amber-400/20',
  SUCCEEDED:           'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
  ISSUED:              'bg-[#1ABC9C]/15 text-[#1ABC9C] border-[#1ABC9C]/20',
  NOT_STARTED:         'bg-slate-400/15 text-slate-400 border-slate-400/20',
  IN_PROGRESS:         'bg-amber-400/15 text-amber-400 border-amber-400/20',
  CANCELLED:           'bg-red-400/15 text-red-400 border-red-400/20',
  FAILED:              'bg-red-500/15 text-red-500 border-red-500/20',
  COMPLETED:           'bg-slate-400/15 text-slate-400 border-slate-400/20',
  ROUND_TRIP:          'bg-blue-400/15 text-blue-400 border-blue-400/20',
  ONE_WAY:             'bg-purple-400/15 text-purple-400 border-purple-400/20',
  MASTER_AIRLINE_PNR:  'bg-[#1ABC9C]/15 text-[#1ABC9C]',
  AIRLINE_PNR:         'bg-blue-400/15 text-blue-400',
  SPLIT_TICKET_PNR:    'bg-amber-400/15 text-amber-400',
  PROVIDER_PNR:        'bg-purple-400/15 text-purple-400',
  SUB_PNR:             'bg-pink-400/15 text-pink-400',
  SINGLE_PNR:          'bg-[#1ABC9C]/15 text-[#1ABC9C]',
  DIRECTION_PNR:       'bg-amber-400/15 text-amber-400',
  SEGMENT_PNR:         'bg-orange-400/15 text-orange-400',
  PROVIDER_SPLIT:      'bg-red-400/15 text-red-400',
  UNKNOWN:             'bg-slate-400/15 text-slate-400',
  PROTECTED:           'bg-[#1ABC9C]/15 text-[#1ABC9C]',
  PARTIALLY_PROTECTED: 'bg-amber-400/15 text-amber-400',
  NOT_PROTECTED:       'bg-red-400/15 text-red-400',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number, cur = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);
}

function fmtDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function fmtDate(dt: string | null | undefined, fmt = 'dd MMM yyyy, HH:mm') {
  if (!dt) return '—';
  try { return format(new Date(dt), fmt); } catch { return '—'; }
}

// ─── Components ───────────────────────────────────────────────────────────────

function Badge({ value, className = '' }: { value: string; className?: string }) {
  const color = STATUS_COLORS[value] ?? 'bg-slate-400/15 text-slate-400';
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border border-transparent ${color} ${className}`}>
      {value.replace(/_/g, ' ')}
    </span>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-700/30 last:border-0">
      <span className="text-slate-500 text-xs w-44 shrink-0">{label}</span>
      <span className={`text-white text-sm font-semibold ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─── Journey segment card ──────────────────────────────────────────────────────

function SegmentCard({ seg, index, total }: { seg: any; index: number; total: number }) {
  return (
    <div className="relative">
      <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/40 bg-slate-800/40">
          <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">
            Segment {index + 1} of {total}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[#1ABC9C] font-mono text-xs font-black">
              {seg.airlineCode}{seg.flightNumber}
            </span>
            {seg.aircraftType && (
              <span className="text-slate-500 text-xs">{seg.aircraftType}</span>
            )}
            <Badge value={seg.cabin ?? 'ECONOMY'} />
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center px-4 py-4">
          <div>
            <p className="text-white text-2xl font-black font-mono leading-none mb-0.5">{seg.originAirport}</p>
            <p className="text-slate-300 text-xs font-semibold">{seg.originCity}</p>
            {seg.originTerminal && (
              <p className="text-slate-500 text-xs">Terminal {seg.originTerminal}{seg.originGate ? ` · Gate ${seg.originGate}` : ''}</p>
            )}
            <p className="text-white text-sm font-bold mt-2">{fmtDate(seg.departureDateTime, 'HH:mm')}</p>
            <p className="text-slate-400 text-xs">{fmtDate(seg.departureDateTime, 'EEE dd MMM yyyy')}</p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-slate-500 text-xs">{fmtDuration(seg.durationMinutes)}</span>
            <div className="flex items-center gap-1 w-28">
              <div className="h-px flex-1 bg-slate-600" />
              <Plane size={12} className="text-slate-400 shrink-0" />
              <div className="h-px flex-1 bg-slate-600" />
            </div>
            <span className="text-slate-600 text-[10px]">{seg.airlineName}</span>
          </div>
          <div className="text-right">
            <p className="text-white text-2xl font-black font-mono leading-none mb-0.5">{seg.destinationAirport}</p>
            <p className="text-slate-300 text-xs font-semibold">{seg.destinationCity}</p>
            {seg.destinationTerminal && (
              <p className="text-slate-500 text-xs">Terminal {seg.destinationTerminal}{seg.destinationGate ? ` · Gate ${seg.destinationGate}` : ''}</p>
            )}
            <p className="text-white text-sm font-bold mt-2">{fmtDate(seg.arrivalDateTime, 'HH:mm')}</p>
            <p className="text-slate-400 text-xs">{fmtDate(seg.arrivalDateTime, 'EEE dd MMM yyyy')}</p>
          </div>
        </div>
        {seg.operatingAirlineCode && seg.operatingAirlineCode !== seg.airlineCode && (
          <div className="px-4 pb-3 text-slate-500 text-xs">
            Operated by {seg.operatingAirlineName ?? seg.operatingAirlineCode}
          </div>
        )}
      </div>
      {seg.layoverAfterMinutes != null && (
        <div className="flex items-center gap-3 my-2 px-4">
          <div className="flex-1 flex items-center gap-3 bg-amber-400/8 border border-amber-400/20 rounded-lg px-4 py-2">
            <Clock size={12} className="text-amber-400 shrink-0" />
            <span className="text-amber-400 text-xs font-bold">
              Layover at {seg.layoverAirport ?? seg.destinationAirport}
              {seg.layoverCity ? ` (${seg.layoverCity})` : ''}
            </span>
            <span className="text-amber-300 text-xs ml-auto font-mono">{fmtDuration(seg.layoverAfterMinutes)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function JourneyPanel({ journey }: { journey: any }) {
  const segs: any[] = journey.segments ?? [];
  const dirLabel = journey.direction === 'OUTBOUND' ? 'Outbound Journey' : 'Return Journey';
  const dirColor = journey.direction === 'OUTBOUND' ? 'text-[#1ABC9C]' : 'text-blue-400';
  return (
    <div className="space-y-3">
      <div className="bg-slate-800/70 border border-slate-700/50 rounded-2xl p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-black uppercase tracking-widest ${dirColor}`}>{dirLabel}</span>
              <Badge value={journey.journeyStatus?.toUpperCase() ?? 'CONFIRMED'} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white text-xl font-black font-mono">{journey.originAirport}</span>
              <span className="text-slate-500 text-sm">{journey.originCity}</span>
              <span className="text-slate-600 mx-1">→</span>
              <span className="text-white text-xl font-black font-mono">{journey.destinationAirport}</span>
              <span className="text-slate-500 text-sm">{journey.destinationCity}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-slate-400 text-xs">{fmtDate(journey.departureDateTime, 'dd MMM yyyy')}</p>
            <p className="text-white font-bold text-sm mt-0.5">{fmtDuration(journey.totalDurationMinutes)}</p>
            <p className="text-slate-500 text-xs">{journey.totalStops === 0 ? 'Non-stop' : `${journey.totalStops} stop${journey.totalStops > 1 ? 's' : ''}`}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          {journey.primaryAirline && <span><Globe size={10} className="inline mr-1" />{journey.primaryAirline}</span>}
          {journey.cabinSummary && <span><Tag size={10} className="inline mr-1" />{journey.cabinSummary.toUpperCase()}</span>}
          <span><Clock size={10} className="inline mr-1" />{fmtDate(journey.departureDateTime, 'HH:mm')} → {fmtDate(journey.arrivalDateTime, 'HH:mm')}</span>
        </div>
      </div>
      {segs.length > 0 ? (
        <div className="space-y-2 pl-2">
          {segs.map((seg, i) => (
            <SegmentCard key={seg.id} seg={seg} index={i} total={segs.length} />
          ))}
        </div>
      ) : (
        <p className="text-slate-500 text-sm px-2">No segment data stored.</p>
      )}
    </div>
  );
}

// ─── Shared input style ────────────────────────────────────────────────────────

const inp = 'w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all';
const sel = `${inp} appearance-none cursor-pointer`;

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router   = useRouter();
  const { user } = useAdminStore();

  const [data, setData]         = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<Tab>('timeline');
  const [selectedPnrId, setSelectedPnrId] = useState<string | null>(null);
  const [note, setNote]         = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedPayload, setExpandedPayload] = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);

  // ── Edit / delete state ──
  const [confirmDel, setConfirmDel] = useState<{ apiPath: string; label: string; redirect?: string } | null>(null);
  const [editBookingOpen, setEditBookingOpen] = useState(false);
  const [editBookingData, setEditBookingData] = useState<Record<string, string>>({});
  const [editPaxId, setEditPaxId] = useState<string | null>(null);
  const [editPaxData, setEditPaxData] = useState<Record<string, string>>({});
  const [addRefOpen, setAddRefOpen] = useState(false);
  const [addRefData, setAddRefData] = useState({ pnrType: 'AIRLINE_PNR', pnrCode: '', journeyDirection: 'ALL', provider: '', airlineCode: '', airlineName: '' });
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState('');

  // ── New feature state ──
  const [revealedPassports, setRevealedPassports] = useState<Set<string>>(new Set());
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // ── Data loading ──
  async function load(keepPnrSelection = false) {
    setLoading(true);
    const res = await adminFetch(`/api/admin/bookings/${id}/full-details`);
    if (res.status === 401) { router.replace('/admin/login'); return; }
    if (!res.ok) { router.replace('/admin/bookings'); return; }
    const json = await res.json();
    setData(json);
    if (!keepPnrSelection) {
      // Auto-select primary (or first) PNR so all detail tabs default to it
      const pnrs: any[] = json.booking?.pnrs ?? [];
      const primary = pnrs.find((p: any) => p.isPrimary) ?? pnrs[0] ?? null;
      setSelectedPnrId(primary?.id ?? null);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  // ── API helpers ──
  async function apiCall(method: string, path: string, body?: any): Promise<boolean> {
    setSaving(true);
    try {
      const res = await adminFetch(path, { method, body: body ? JSON.stringify(body) : undefined });
      return res.ok;
    } finally {
      setSaving(false);
    }
  }

  async function doConfirmDelete() {
    if (!confirmDel) return;
    const ok = await apiCall('DELETE', confirmDel.apiPath);
    if (ok) {
      setConfirmDel(null);
      if (confirmDel.redirect) router.replace(confirmDel.redirect);
      else await load(true);
    }
  }

  async function saveBooking() {
    const ok = await apiCall('PATCH', `/api/admin/bookings/${id}`, editBookingData);
    if (ok) { setEditBookingOpen(false); await load(true); }
  }

  async function savePax() {
    if (!editPaxId) return;
    const ok = await apiCall('PATCH', `/api/admin/bookings/${id}/passengers/${editPaxId}`, editPaxData);
    if (ok) { setEditPaxId(null); await load(true); }
  }

  async function addReference() {
    const { pnrCode, ...rest } = addRefData;
    if (!pnrCode.trim()) return;
    const ok = await apiCall('POST', `/api/admin/bookings/${id}/references`, { pnrCode: pnrCode.trim(), ...rest });
    if (ok) { setAddRefOpen(false); setAddRefData({ pnrType: 'AIRLINE_PNR', pnrCode: '', journeyDirection: 'ALL', provider: '', airlineCode: '', airlineName: '' }); await load(true); }
  }

  async function saveNote() {
    if (!editNoteId || !editNoteText.trim()) return;
    const ok = await apiCall('PATCH', `/api/admin/bookings/${id}/notes/${editNoteId}`, { note: editNoteText });
    if (ok) { setEditNoteId(null); await load(true); }
  }

  async function submitNote() {
    if (!note.trim()) return;
    setSubmitting(true);
    await adminFetch(`/api/admin/bookings/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    setNote('');
    await load(true);
    setSubmitting(false);
  }

  async function loadAuditLogs() {
    setAuditLoading(true);
    const res = await adminFetch(`/api/admin/bookings/${id}/audit-logs`);
    if (res.ok) {
      const json = await res.json();
      setAuditLogs(json.logs ?? []);
    }
    setAuditLoading(false);
  }

  function toggleRevealPassport(paxId: string) {
    setRevealedPassports(prev => {
      const next = new Set(prev);
      next.has(paxId) ? next.delete(paxId) : next.add(paxId);
      return next;
    });
  }

  function maskPassport(value: string | null | undefined, paxId: string): string {
    if (!value) return '—';
    if (revealedPassports.has(paxId)) return value;
    return value.slice(0, 2) + '●'.repeat(Math.max(0, value.length - 4)) + value.slice(-2);
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
    </div>
  );
  if (!data) return null;

  const { booking, addons = [], tickets = [], events = [], notes = [], providerPayloads = [] } = data;
  const journeys: any[] = booking.journeys ?? [];
  const pnrs: any[] = booking.pnrs ?? [];
  const selectedPnr = selectedPnrId ? pnrs.find((p: any) => p.id === selectedPnrId) ?? null : null;
  const isOps = user && ['SUPER_ADMIN', 'OPS_ADMIN'].includes(user.role);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isSupport = user && ['SUPER_ADMIN', 'OPS_ADMIN', 'SUPPORT'].includes(user.role);

  // Derived: separate seats and meals from addons
  const seats = addons.filter((a: any) => a.type === 'SEAT');
  const meals = addons.filter((a: any) => a.type === 'MEAL');
  const otherAddons = addons.filter((a: any) => a.type !== 'SEAT' && a.type !== 'MEAL');

  return (
    <div className="p-6 max-w-7xl">

      {/* ── Confirm delete dialog ── */}
      {confirmDel && (() => {
        const isMasterDel = confirmDel.redirect === '/admin/bookings';
        const fbr = booking.masterBookingReference ?? booking.pnr ?? '';
        const needsTypeConfirm = isMasterDel;
        const canConfirm = !needsTypeConfirm || deleteConfirmText === fbr;
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-red-400" />
                <h3 className="text-white font-bold text-base">Confirm Delete</h3>
              </div>
              <p className="text-slate-400 text-sm mb-3">
                Delete <span className="text-white font-semibold">{confirmDel.label}</span>?
                {' '}This cannot be undone.
              </p>
              {isMasterDel && (
                <div className="mb-4 p-3 bg-red-500/8 border border-red-500/20 rounded-xl">
                  <p className="text-red-400 text-xs font-bold mb-2 flex items-center gap-1.5">
                    <AlertTriangle size={12} />
                    The following will be permanently deleted:
                  </p>
                  <ul className="text-slate-400 text-xs space-y-0.5 ml-4 list-disc">
                    <li>{booking.passengers?.length ?? 0} passenger(s)</li>
                    <li>{pnrs.length} PNR(s)</li>
                    <li>{tickets.length} ticket(s)</li>
                    <li>{seats.length} seat(s), {meals.length} meal(s), {otherAddons.length} add-on(s)</li>
                    <li>{booking.payments?.length ?? 0} payment record(s)</li>
                    <li>{events.length} timeline event(s)</li>
                    <li>{notes.length} note(s)</li>
                    <li>{providerPayloads.length} provider payload(s)</li>
                  </ul>
                  <p className="text-slate-500 text-[10px] mt-2 italic">
                    This does not cancel the provider/airline booking unless cancellation flow is executed.
                  </p>
                </div>
              )}
              {needsTypeConfirm && (
                <div className="mb-4">
                  <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">
                    Type <span className="text-red-400 font-mono">{fbr}</span> to confirm
                  </label>
                  <input
                    value={deleteConfirmText}
                    onChange={e => setDeleteConfirmText(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-xl text-white font-mono text-sm focus:outline-none focus:border-red-400 transition-all"
                    placeholder={fbr}
                  />
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setConfirmDel(null); setDeleteConfirmText(''); }}
                  className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 hover:text-white text-sm transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { doConfirmDelete(); setDeleteConfirmText(''); }}
                  disabled={saving || !canConfirm}
                  className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-all disabled:opacity-50"
                >
                  {saving ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Header ── */}
      <div className="flex items-start gap-4 mb-6">
        <button onClick={() => router.back()} className="mt-1 p-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white transition-all">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <h1 className="text-xl font-black text-white font-mono tracking-wide">
              {booking.masterBookingReference ?? booking.pnr ?? booking.id.slice(0, 8).toUpperCase()}
            </h1>
            <Badge value={booking.status} />
            <Badge value={booking.paymentStatus ?? 'PENDING'} />
            <Badge value={booking.ticketingStatus ?? 'NOT_STARTED'} />
            {booking.tripType && <Badge value={booking.tripType} />}
          </div>
          <p className="text-slate-400 text-sm">
            {booking.originAirport} → {booking.destinationAirport}
            {' · '}{fmtDate(booking.departureTime, 'dd MMM yyyy')}
            {' · '}{booking.user
              ? `${booking.user.firstName} ${booking.user.lastName}`
              : booking.customerName ?? 'Guest'}
            {' · '}<span className="text-slate-500">{booking.customerEmail ?? booking.user?.email}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load(true)} className="p-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white transition-all">
            <RefreshCw size={16} />
          </button>
          {isOps && (
            <button
              onClick={() => setConfirmDel({
                apiPath: `/api/admin/bookings/${id}`,
                label: `Booking ${booking.masterBookingReference ?? booking.pnr}`,
                redirect: '/admin/bookings',
              })}
              title="Delete this booking"
              className="p-2 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-0.5 mb-6 border-b border-slate-700/50 overflow-x-auto scrollbar-hide">
        {TABS.map(t => {
          const Icon = t.icon;
          const count =
            t.id === 'notes'    ? notes.length :
            t.id === 'tickets'  ? tickets.length :
            t.id === 'payloads' ? providerPayloads.length :
            t.id === 'addons'   ? otherAddons.length :
            t.id === 'seats'    ? seats.length :
            t.id === 'meals'    ? meals.length :
            t.id === 'payments' ? (booking.payments?.length ?? 0) :
            t.id === 'timeline' ? events.length :
            t.id === 'auditLog' ? auditLogs.length :
            null;
          return (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                if (t.id === 'auditLog' && auditLogs.length === 0 && !auditLoading) loadAuditLogs();
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-all ${
                tab === t.id
                  ? 'border-[#1ABC9C] text-[#1ABC9C]'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Icon size={13} />
              {t.label}
              {count != null && count > 0 && (
                <span className="ml-1 px-1.5 py-0 rounded-full bg-slate-700 text-slate-300 text-[10px]">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── PNR selector bar (only when multiple PNRs exist) ── */}
      {pnrs.length > 1 && (
        <div className="flex items-center gap-2 mb-5 p-3 bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-x-auto scrollbar-hide">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider shrink-0 mr-1">Filter PNR</span>
          <button
            onClick={() => setSelectedPnrId(null)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 border ${
              selectedPnrId === null
                ? 'bg-[#1ABC9C]/20 border-[#1ABC9C] text-[#1ABC9C]'
                : 'border-transparent bg-slate-700/50 text-slate-400 hover:text-white'
            }`}
          >
            All
          </button>
          {pnrs.map((pnr: any) => (
            <button
              key={pnr.id}
              onClick={() => setSelectedPnrId(selectedPnrId === pnr.id ? null : pnr.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 border ${
                selectedPnrId === pnr.id
                  ? 'bg-[#1ABC9C]/20 border-[#1ABC9C] text-[#1ABC9C]'
                  : 'border-transparent bg-slate-700/50 text-slate-400 hover:text-white'
              }`}
            >
              <span className="font-mono font-black">{pnr.pnrCode}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[pnr.pnrType] ?? 'bg-slate-400/15 text-slate-400'}`}>
                {pnr.journeyDirection}
              </span>
              {pnr.airlineCode && (
                <span className="text-[10px] text-slate-500">{pnr.airlineCode}</span>
              )}
              {pnr.isPrimary && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-[#1ABC9C]/15 text-[#1ABC9C] font-black">PRI</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: BOOKING SUMMARY
          ══════════════════════════════════════════════════════════ */}
      {tab === 'summary' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Section
            title="Master Reference"
            action={isOps ? (
              <button
                onClick={() => {
                  setEditBookingData({
                    bookingStatus:    booking.status,
                    paymentStatus:    booking.paymentStatus ?? '',
                    ticketingStatus:  booking.ticketingStatus ?? '',
                    masterPnr:        booking.pnr ?? '',
                    customerEmail:    booking.customerEmail ?? booking.user?.email ?? '',
                    customerName:     booking.customerName ?? '',
                  });
                  setEditBookingOpen(v => !v);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-700/50 text-slate-300 hover:text-white text-xs font-bold transition-all"
              >
                <Pencil size={11} /> Edit Status
              </button>
            ) : undefined}
          >
            {editBookingOpen && isOps && (
              <div className="mb-4 p-4 bg-slate-900/50 border border-slate-700 rounded-xl space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Booking Status</label>
                    <select className={sel} value={editBookingData.bookingStatus ?? ''} onChange={e => setEditBookingData(d => ({ ...d, bookingStatus: e.target.value }))}>
                      {['CREATED','CONFIRMED','TICKETED','CANCELLED','COMPLETED','FAILED'].map(s => <option key={s} value={s} className="bg-slate-800">{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Payment Status</label>
                    <select className={sel} value={editBookingData.paymentStatus ?? ''} onChange={e => setEditBookingData(d => ({ ...d, paymentStatus: e.target.value }))}>
                      {['PENDING','PARTIAL','SUCCEEDED','FAILED','REFUNDED','PARTIALLY_REFUNDED'].map(s => <option key={s} value={s} className="bg-slate-800">{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Ticketing Status</label>
                    <select className={sel} value={editBookingData.ticketingStatus ?? ''} onChange={e => setEditBookingData(d => ({ ...d, ticketingStatus: e.target.value }))}>
                      {['NOT_STARTED','IN_PROGRESS','ISSUED','PARTIALLY_ISSUED','FAILED','VOIDED'].map(s => <option key={s} value={s} className="bg-slate-800">{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Master PNR</label>
                    <input className={inp} value={editBookingData.masterPnr ?? ''} onChange={e => setEditBookingData(d => ({ ...d, masterPnr: e.target.value }))} placeholder="e.g. ABC123" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Customer Email</label>
                    <input className={inp} type="email" value={editBookingData.customerEmail ?? ''} onChange={e => setEditBookingData(d => ({ ...d, customerEmail: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Customer Name</label>
                    <input className={inp} value={editBookingData.customerName ?? ''} onChange={e => setEditBookingData(d => ({ ...d, customerName: e.target.value }))} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setEditBookingOpen(false)} className="px-3 py-1.5 rounded-xl border border-slate-600 text-slate-400 hover:text-white text-xs transition-all"><X size={11} className="inline mr-1" />Cancel</button>
                  <button onClick={saveBooking} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1ABC9C] hover:bg-[#1ABC9C]/80 text-white text-xs font-bold disabled:opacity-50 transition-all">
                    <Save size={11} />{saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
            <InfoRow label="Master Booking Ref" value={booking.masterBookingReference} mono />
            <InfoRow label="Master PNR" value={booking.pnr} mono />
            <InfoRow label="Booking Status" value={booking.status} />
            <InfoRow label="Payment Status" value={booking.paymentStatus} />
            <InfoRow label="Ticketing Status" value={booking.ticketingStatus} />
            <InfoRow label="Trip Type" value={booking.tripType} />
            <InfoRow label="Provider" value={booking.provider?.toUpperCase()} />
            <InfoRow label="Provider Booking ID" value={booking.providerBookingId} mono />
          </Section>

          <Section title="Customer">
            <InfoRow
              label="Name"
              value={booking.user
                ? `${booking.user.firstName} ${booking.user.lastName}`
                : booking.customerName ?? undefined}
            />
            <InfoRow label="Email" value={booking.customerEmail ?? booking.user?.email} />
            <InfoRow label="Phone" value={booking.user?.phone} />
            {booking.passengers?.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-700/30">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">Passengers</p>
                <div className="space-y-2">
                  {booking.passengers.map((p: any, i: number) => (
                    <div key={p.id} className="flex items-center gap-3 py-1.5">
                      <span className="w-5 h-5 rounded-lg bg-[#1ABC9C]/15 flex items-center justify-center text-[#1ABC9C] text-[10px] font-black shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-bold truncate">
                          {p.firstName}{p.middleName ? ` ${p.middleName}` : ''} {p.lastName}
                        </p>
                        {p.email && <p className="text-slate-500 text-xs truncate">{p.email}</p>}
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400 text-[10px] font-bold shrink-0">
                        {p.type}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>

          <Section title="Route & Dates">
            <InfoRow label="Origin" value={`${booking.originCity} (${booking.originAirport})`} />
            <InfoRow label="Destination" value={`${booking.destinationCity} (${booking.destinationAirport})`} />
            <InfoRow label="Departure" value={fmtDate(booking.departureTime)} />
            {booking.tripType === 'ROUND_TRIP' && (
              <InfoRow label="Return" value={booking.returnDate ? fmtDate(booking.returnDate) : undefined} />
            )}
            <InfoRow label="Cabin" value={booking.cabinClass} />
            <InfoRow label="Fare Class" value={booking.fareClass} />
          </Section>

          <Section title="Financial">
            <InfoRow label="Total Amount" value={fmtMoney(Number(booking.totalPrice), booking.currency)} />
            <InfoRow label="Currency" value={booking.currency} />
            <InfoRow label="Created" value={fmtDate(booking.createdAt)} />
            <InfoRow label="Updated" value={fmtDate(booking.updatedAt)} />
          </Section>

          {(booking.pnrs?.length > 0 || booking.pnrStrategy) && (
            <div className="lg:col-span-2">
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                      Airline PNRs ({booking.pnrs?.length ?? 0})
                    </h3>
                    {booking.pnrStrategy && <Badge value={booking.pnrStrategy} />}
                    {booking.connectionProtStatus && <Badge value={booking.connectionProtStatus} />}
                    {booking.isSplitTicket && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-400 text-[10px] font-bold border border-amber-400/20">Split Ticket</span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 italic">Select a PNR to scope all tabs</span>
                </div>

                {booking.riskLabel && (
                  <div className="mb-4 px-3 py-2 rounded-xl bg-amber-400/8 border border-amber-400/20 text-xs text-amber-400 font-semibold">
                    {booking.riskLabel}
                    {booking.riskExplanation && <span className="text-slate-400 font-normal ml-2">{booking.riskExplanation}</span>}
                  </div>
                )}

                {/* PNR cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {booking.pnrs?.map((pnr: any) => {
                    const isActive = selectedPnrId === pnr.id;
                    const dirIcon = pnr.journeyDirection === 'OUTBOUND' ? '↗ Outbound'
                      : pnr.journeyDirection === 'RETURN' ? '↙ Return' : '⇄ All Directions';
                    return (
                      <button
                        key={pnr.id}
                        onClick={() => setSelectedPnrId(isActive ? null : pnr.id)}
                        className={`text-left p-4 rounded-xl border transition-all group ${
                          isActive
                            ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/50'
                            : 'bg-slate-900/50 border-slate-700/50 hover:border-slate-500/70'
                        }`}
                      >
                        {/* PNR code + status */}
                        <div className="flex items-start justify-between gap-2 mb-2.5">
                          <span className={`font-mono font-black text-xl tracking-wider leading-none ${isActive ? 'text-[#1ABC9C]' : 'text-white'}`}>
                            {pnr.pnrCode}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {pnr.isPrimary && (
                              <span className="px-1.5 py-0.5 rounded bg-[#1ABC9C]/15 text-[#1ABC9C] text-[9px] font-black uppercase tracking-wide">Primary</span>
                            )}
                            <Badge value={pnr.status} />
                          </div>
                        </div>

                        {/* Meta row */}
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_COLORS[pnr.pnrType] ?? 'bg-slate-400/15 text-slate-400'}`}>
                              {pnr.pnrType.replace(/_/g, ' ')}
                            </span>
                            <span className="text-slate-500 text-[10px] font-semibold">{dirIcon}</span>
                          </div>
                          {(pnr.airlineName || pnr.airlineCode) && (
                            <p className="text-slate-400 text-xs">
                              {pnr.airlineName ?? ''}{pnr.airlineCode ? ` (${pnr.airlineCode})` : ''}
                            </p>
                          )}
                          {pnr.provider && (
                            <p className="text-slate-600 text-[10px]">
                              via {pnr.provider}{pnr.providerOrderId ? ` · ${pnr.providerOrderId}` : ''}
                            </p>
                          )}
                        </div>

                        {/* Active indicator */}
                        {isActive && (
                          <p className="mt-2.5 text-[#1ABC9C] text-[10px] font-bold uppercase tracking-wider">
                            ● Tabs scoped to this PNR
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: JOURNEY DETAILS
          ══════════════════════════════════════════════════════════ */}
      {tab === 'journey' && (() => {
        const visibleJourneys = selectedPnr && selectedPnr.journeyDirection !== 'ALL'
          ? journeys.filter((j: any) => j.direction === selectedPnr.journeyDirection)
          : journeys;
        return (
          <div className="space-y-8">
            {visibleJourneys.length === 0 ? (
              <p className="text-slate-500 text-sm">No journey data for the selected PNR filter.</p>
            ) : (
              visibleJourneys.map((journey: any) => {
                const journeyPnrs = pnrs.filter((p: any) =>
                  p.journeyDirection === 'ALL' || p.journeyDirection === journey.direction
                );
                return (
                  <div key={journey.id} className="space-y-2">
                    {journeyPnrs.length > 0 && (
                      <div className="flex items-center gap-2 px-1">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">PNR</span>
                        {journeyPnrs.map((p: any) => (
                          <span
                            key={p.id}
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              selectedPnrId === p.id
                                ? 'bg-[#1ABC9C]/20 border-[#1ABC9C] text-[#1ABC9C]'
                                : 'bg-slate-700/50 border-slate-600/50 text-slate-400'
                            }`}
                          >
                            {p.pnrCode}
                            {p.airlineCode && <span className="ml-1 opacity-60">{p.airlineCode}</span>}
                          </span>
                        ))}
                      </div>
                    )}
                    <JourneyPanel journey={journey} />
                  </div>
                );
              })
            )}
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════
          TAB: PASSENGERS
          ══════════════════════════════════════════════════════════ */}
      {tab === 'passengers' && (
        <div className="space-y-4">
          {booking.passengers?.length === 0 && (
            <p className="text-slate-500 text-sm">No passengers stored.</p>
          )}
          {booking.passengers?.map((p: any, i: number) => {
            const paxTickets = tickets.filter((t: any) => t.passenger?.firstName === p.firstName && t.passenger?.lastName === p.lastName);
            const isEditing = editPaxId === p.id;
            return (
              <div key={p.id} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-7 h-7 rounded-xl bg-[#1ABC9C]/15 flex items-center justify-center text-[#1ABC9C] text-[11px] font-black">{i + 1}</span>
                  <div className="flex-1">
                    <h3 className="text-white font-bold text-sm">
                      {p.firstName}{p.middleName ? ` ${p.middleName}` : ''} {p.lastName}
                    </h3>
                    <span className="text-slate-500 text-xs">{p.type}</span>
                  </div>
                  {isOps && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (isEditing) { setEditPaxId(null); return; }
                          setEditPaxId(p.id);
                          setEditPaxData({
                            firstName: p.firstName ?? '', middleName: p.middleName ?? '',
                            lastName: p.lastName ?? '', email: p.email ?? '', phone: p.phone ?? '',
                            gender: p.gender ?? '', dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : '',
                            nationality: p.nationality ?? '', passportNumber: p.passportNumber ?? '',
                            passportCountry: p.issuingCountry ?? '', passportExpiry: p.passportExpiry ? p.passportExpiry.slice(0, 10) : '',
                          });
                        }}
                        className="p-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-white transition-all"
                        title={isEditing ? 'Cancel edit' : 'Edit passenger'}
                      >
                        {isEditing ? <X size={13} /> : <Pencil size={13} />}
                      </button>
                      <button
                        onClick={() => setConfirmDel({ apiPath: `/api/admin/bookings/${id}/passengers/${p.id}`, label: `${p.firstName} ${p.lastName}` })}
                        className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                        title="Delete passenger"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {isEditing && (
                  <div className="mb-4 p-4 bg-slate-900/50 border border-slate-700 rounded-xl space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        { key: 'firstName', label: 'First Name' }, { key: 'middleName', label: 'Middle Name' },
                        { key: 'lastName', label: 'Last Name' }, { key: 'email', label: 'Email', type: 'email' },
                        { key: 'phone', label: 'Phone' }, { key: 'nationality', label: 'Nationality' },
                        { key: 'passportNumber', label: 'Passport No.' }, { key: 'passportCountry', label: 'Issuing Country' },
                        { key: 'dateOfBirth', label: 'Date of Birth', type: 'date' }, { key: 'passportExpiry', label: 'Passport Expiry', type: 'date' },
                      ].map(({ key, label, type }) => (
                        <div key={key}>
                          <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">{label}</label>
                          <input className={inp} type={type ?? 'text'} value={(editPaxData as any)[key] ?? ''} onChange={e => setEditPaxData(d => ({ ...d, [key]: e.target.value }))} />
                        </div>
                      ))}
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Gender</label>
                        <select className={sel} value={editPaxData.gender ?? ''} onChange={e => setEditPaxData(d => ({ ...d, gender: e.target.value }))}>
                          {['', 'MALE', 'FEMALE', 'OTHER'].map(g => <option key={g} value={g} className="bg-slate-800">{g || '— not set —'}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditPaxId(null)} className="px-3 py-1.5 rounded-xl border border-slate-600 text-slate-400 hover:text-white text-xs transition-all"><X size={11} className="inline mr-1" />Cancel</button>
                      <button onClick={savePax} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1ABC9C] hover:bg-[#1ABC9C]/80 text-white text-xs font-bold disabled:opacity-50 transition-all">
                        <Save size={11} />{saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10">
                  <InfoRow label="Gender" value={p.gender} />
                  <InfoRow label="Date of Birth" value={p.dateOfBirth ? fmtDate(p.dateOfBirth, 'dd MMM yyyy') : undefined} />
                  <InfoRow label="Email" value={p.email} />
                  <InfoRow label="Phone" value={p.phone} />
                  <InfoRow label="Nationality" value={p.nationality} />
                  {p.passportNumber ? (
                    <div className="flex items-start gap-3 py-2.5 border-b border-slate-700/30 last:border-0">
                      <span className="text-slate-500 text-xs w-44 shrink-0">Passport No.</span>
                      <span className="text-white text-sm font-semibold font-mono">{maskPassport(p.passportNumber, p.id)}</span>
                      {isSuperAdmin && (
                        <button
                          onClick={() => toggleRevealPassport(p.id)}
                          className="ml-1 p-1 rounded-lg bg-slate-700/40 text-slate-400 hover:text-white transition-all"
                          title={revealedPassports.has(p.id) ? 'Hide passport' : 'Reveal passport'}
                        >
                          {revealedPassports.has(p.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      )}
                    </div>
                  ) : (
                    <InfoRow label="Passport No." value={undefined} />
                  )}
                  <InfoRow label="Passport Expiry" value={p.passportExpiry ? fmtDate(p.passportExpiry, 'dd MMM yyyy') : undefined} />
                  <InfoRow label="Issuing Country" value={p.issuingCountry} />
                </div>
                {paxTickets.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-700/40">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">Linked Tickets</p>
                    <div className="flex flex-wrap gap-2">
                      {paxTickets.map((t: any) => (
                        <div key={t.id} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 rounded-lg">
                          <span className="text-xs font-mono text-[#1ABC9C] font-bold">
                            {t.ticketNumber ?? 'Pending'}
                          </span>
                          <span className="text-[10px] text-slate-500">·</span>
                          <Badge value={t.status ?? 'PENDING'} />
                          {t.pnrReference && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-600/50 text-slate-300">
                              {t.pnrReference}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: TICKETS / PNRs
          ══════════════════════════════════════════════════════════ */}
      {tab === 'tickets' && (() => {
        const visibleTickets = selectedPnr
          ? tickets.filter((t: any) => t.pnrReference === selectedPnr.pnrCode)
          : tickets;

        // Group tickets by PNR reference for multi-PNR bookings
        const pnrGroups: Record<string, any[]> = {};
        visibleTickets.forEach((t: any) => {
          const key = t.pnrReference ?? '__no_pnr__';
          if (!pnrGroups[key]) pnrGroups[key] = [];
          pnrGroups[key].push(t);
        });
        const showGroups = !selectedPnr && pnrs.length > 1 && Object.keys(pnrGroups).length > 1;

        const TicketTable = ({ rows }: { rows: any[] }) => (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50">
                  {['Passenger', 'Ticket Number', 'E-Ticket', 'Airline', 'PNR Ref', 'Status'].map(h => (
                    <th key={h} className="pb-2 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/20">
                {rows.map((t: any) => (
                  <tr key={t.id}>
                    <td className="py-2.5 pr-4 text-white font-semibold">
                      {t.passenger ? `${t.passenger.firstName} ${t.passenger.lastName}` : '—'}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-[#1ABC9C]">{t.ticketNumber ?? '—'}</td>
                    <td className="py-2.5 pr-4 font-mono text-slate-300">{t.eTicketNumber ?? '—'}</td>
                    <td className="py-2.5 pr-4 text-slate-400">{t.airlineCode ?? '—'}</td>
                    <td className="py-2.5 pr-4 font-mono text-slate-400">{t.pnrReference ?? '—'}</td>
                    <td className="py-2.5 pr-4"><Badge value={t.status ?? 'PENDING'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

        return (
        <div className="space-y-5">
          {showGroups ? (
            Object.entries(pnrGroups).map(([pnrCode, rows]) => {
              const pnrMeta = pnrs.find((p: any) => p.pnrCode === pnrCode);
              return (
                <Section
                  key={pnrCode}
                  title={`Tickets — PNR ${pnrCode === '__no_pnr__' ? 'Unassigned' : pnrCode} (${rows.length})`}
                >
                  {pnrMeta && (
                    <div className="flex items-center gap-2 mb-3">
                      <Badge value={pnrMeta.pnrType} />
                      <span className="text-[10px] text-slate-500">{pnrMeta.journeyDirection}</span>
                      {pnrMeta.airlineName && <span className="text-[10px] text-slate-400">{pnrMeta.airlineName}</span>}
                      {pnrMeta.provider && <span className="text-[10px] text-slate-500">via {pnrMeta.provider}</span>}
                    </div>
                  )}
                  <TicketTable rows={rows} />
                </Section>
              );
            })
          ) : (
            <Section title={`E-Tickets (${visibleTickets.length})`}>
              {visibleTickets.length === 0 ? (
                <p className="text-slate-500 text-sm">
                  {selectedPnr ? `No tickets for PNR ${selectedPnr.pnrCode}.` : 'No tickets issued yet.'}
                </p>
              ) : (
                <TicketTable rows={visibleTickets} />
              )}
            </Section>
          )}

          <Section
            title={`PNR Records (${booking.pnrs?.length ?? 0})`}
            action={isOps ? (
              <button
                onClick={() => setAddRefOpen(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-700/50 text-slate-300 hover:text-white text-xs font-bold transition-all"
              >
                <Plus size={11} /> Add PNR
              </button>
            ) : undefined}
          >
            {addRefOpen && isOps && (
              <div className="mb-4 p-4 bg-slate-900/50 border border-slate-700 rounded-xl space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">PNR Type</label>
                    <select className={sel} value={addRefData.pnrType} onChange={e => setAddRefData(d => ({ ...d, pnrType: e.target.value }))}>
                      {['MASTER_AIRLINE_PNR','AIRLINE_PNR','PROVIDER_PNR','SPLIT_TICKET_PNR','SUB_PNR'].map(t => (
                        <option key={t} value={t} className="bg-slate-800">{t.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">PNR Code *</label>
                    <input className={inp} value={addRefData.pnrCode} onChange={e => setAddRefData(d => ({ ...d, pnrCode: e.target.value }))} placeholder="e.g. ABC123" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Direction</label>
                    <select className={sel} value={addRefData.journeyDirection} onChange={e => setAddRefData(d => ({ ...d, journeyDirection: e.target.value }))}>
                      {['ALL','OUTBOUND','RETURN'].map(t => (
                        <option key={t} value={t} className="bg-slate-800">{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Provider</label>
                    <input className={inp} value={addRefData.provider} onChange={e => setAddRefData(d => ({ ...d, provider: e.target.value }))} placeholder="e.g. duffel" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Airline Code</label>
                    <input className={inp} value={addRefData.airlineCode} onChange={e => setAddRefData(d => ({ ...d, airlineCode: e.target.value }))} placeholder="e.g. EK" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Airline Name</label>
                    <input className={inp} value={addRefData.airlineName} onChange={e => setAddRefData(d => ({ ...d, airlineName: e.target.value }))} placeholder="e.g. Emirates" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setAddRefOpen(false)} className="px-3 py-1.5 rounded-xl border border-slate-600 text-slate-400 hover:text-white text-xs transition-all"><X size={11} className="inline mr-1" />Cancel</button>
                  <button onClick={addReference} disabled={saving || !addRefData.pnrCode.trim()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1ABC9C] hover:bg-[#1ABC9C]/80 text-white text-xs font-bold disabled:opacity-50 transition-all">
                    <Plus size={11} />{saving ? 'Adding…' : 'Add PNR'}
                  </button>
                </div>
              </div>
            )}
            {(booking.pnrs?.length ?? 0) === 0 ? (
              <p className="text-slate-500 text-sm">No PNRs stored.</p>
            ) : (
              <div className="space-y-2">
                {booking.pnrs?.map((pnr: any) => (
                  <div key={pnr.id} className="flex items-center gap-4 p-3 bg-slate-900/40 rounded-xl">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold w-40 text-center ${STATUS_COLORS[pnr.pnrType] ?? 'bg-slate-400/15 text-slate-400'}`}>
                      {pnr.pnrType.replace(/_/g, ' ')}
                    </span>
                    <span className="font-mono text-white font-black text-sm flex-1">{pnr.pnrCode}</span>
                    {pnr.isPrimary && (
                      <span className="px-2 py-0.5 rounded-full bg-[#1ABC9C]/15 text-[#1ABC9C] text-[10px] font-bold">PRIMARY</span>
                    )}
                    <span className="text-slate-500 text-[10px]">{pnr.journeyDirection}</span>
                    <span className="text-slate-500 text-xs">{pnr.provider ?? ''}</span>
                    {pnr.airlineCode && (
                      <span className="text-slate-400 text-xs">{pnr.airlineName ?? pnr.airlineCode}</span>
                    )}
                    <Badge value={pnr.status} />
                    {isOps && !pnr.isPrimary && (
                      <button
                        onClick={() => setConfirmDel({ apiPath: `/api/admin/bookings/${id}/references/${pnr.id}`, label: `PNR ${pnr.pnrCode}` })}
                        className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                        title="Delete PNR"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════
          TAB: ADD-ONS
          ══════════════════════════════════════════════════════════ */}
      {tab === 'addons' && (
        <div className="space-y-4">
        {selectedPnr && (
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-2xl">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Showing add-ons for PNR</span>
            <span className="font-mono font-black text-[#1ABC9C] text-xs">{selectedPnr.pnrCode}</span>
            <Badge value={selectedPnr.journeyDirection} />
            {selectedPnr.airlineName && <span className="text-xs text-slate-400">{selectedPnr.airlineName}</span>}
            <span className="text-[10px] text-slate-500 ml-auto">Add-ons are shown for all directions; segment refs may be used to filter</span>
          </div>
        )}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
            <h3 className="text-white font-bold text-sm">Add-ons & Services</h3>
            <span className="text-slate-400 text-xs">{addons.length} item{addons.length !== 1 ? 's' : ''}</span>
          </div>
          {addons.length === 0 ? (
            <p className="px-5 py-10 text-slate-500 text-sm">No add-ons on this booking.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50">
                  {['Type', 'Description', 'Passenger / Segment', 'Seat', 'Qty', 'Unit Price', 'Total', ...(isOps ? [''] : [])].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {addons.map((a: any) => (
                  <tr key={a.id} className="hover:bg-slate-700/20">
                    <td className="px-5 py-3 text-slate-300 font-bold">{a.type}</td>
                    <td className="px-5 py-3 text-slate-400">{a.description ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-500 font-mono text-xs">{a.segmentRef ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-400">{a.seatNumber ?? '—'}</td>
                    <td className="px-5 py-3 text-white">{a.quantity}</td>
                    <td className="px-5 py-3 text-white">{fmtMoney(Number(a.unitPrice), a.currency)}</td>
                    <td className="px-5 py-3 text-[#1ABC9C] font-bold">{fmtMoney(Number(a.totalPrice), a.currency)}</td>
                    {isOps && (
                      <td className="px-5 py-3">
                        <button
                          onClick={() => setConfirmDel({ apiPath: `/api/admin/bookings/${id}/addons/${a.id}`, label: a.description ?? a.type })}
                          className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                          title="Remove add-on"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-700/50 bg-slate-900/30">
                  <td colSpan={isOps ? 7 : 6} className="px-5 py-3 text-slate-400 text-xs font-bold text-right">Total Add-on Charges</td>
                  <td className="px-5 py-3 text-[#1ABC9C] font-black text-sm">
                    {fmtMoney(addons.reduce((s: number, a: any) => s + Number(a.totalPrice), 0), booking.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: PAYMENTS
          ══════════════════════════════════════════════════════════ */}
      {tab === 'payments' && (() => {
        const addonTotal = addons.reduce((s: number, a: any) => s + Number(a.totalPrice), 0);
        const baseFare = Number(booking.totalPrice) - addonTotal;

        // Group addons by type for breakdown
        const addonGroups: Record<string, { label: string; items: any[]; total: number }> = {};
        for (const a of addons) {
          const key = a.type;
          if (!addonGroups[key]) {
            addonGroups[key] = {
              label: key === 'SEAT' ? 'Seat Selection' : key === 'MEAL' ? 'Meals' : key === 'BAGGAGE' ? 'Checked Baggage' : a.type,
              items: [],
              total: 0,
            };
          }
          addonGroups[key].items.push(a);
          addonGroups[key].total += Number(a.totalPrice);
        }

        return (
        <div className="space-y-4">
          {/* Price Breakdown */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/50">
              <h3 className="text-white font-bold text-sm">Price Breakdown</h3>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-700/20">
                {/* Base airfare row */}
                <tr>
                  <td className="px-5 py-3 text-white font-bold">Base Airfare</td>
                  <td className="px-5 py-3 text-slate-400 font-semibold">
                    {booking.passengers?.length ?? 0} passenger{(booking.passengers?.length ?? 0) !== 1 ? 's' : ''}
                    {booking.cabinClass ? ` · ${booking.cabinClass}` : ''}
                    {booking.airlineName ? ` · ${booking.airlineName}` : ''}
                  </td>
                  <td className="px-5 py-3 text-white font-bold text-right">{fmtMoney(baseFare, booking.currency)}</td>
                </tr>
                {/* Per passenger detail if known */}
                {booking.passengers?.length > 1 && booking.passengers.map((p: any) => (
                  <tr key={p.id} className="bg-slate-900/20">
                    <td className="px-5 py-2 pl-10 text-slate-300 text-xs font-semibold">{p.firstName} {p.lastName}</td>
                    <td className="px-5 py-2 text-slate-500 text-xs font-medium">{p.type}</td>
                    <td className="px-5 py-2 text-slate-300 text-xs font-semibold text-right">
                      {fmtMoney(Math.round((baseFare / (booking.passengers?.length ?? 1)) * 100) / 100, booking.currency)}
                    </td>
                  </tr>
                ))}
                {/* Add-on groups */}
                {Object.values(addonGroups).map((group) => (
                  <React.Fragment key={group.label}>
                    <tr>
                      <td className="px-5 py-3 text-white font-bold">{group.label}</td>
                      <td className="px-5 py-3 text-slate-400 font-semibold">{group.items.length} item{group.items.length !== 1 ? 's' : ''}</td>
                      <td className="px-5 py-3 text-white font-bold text-right">{fmtMoney(group.total, booking.currency)}</td>
                    </tr>
                    {group.items.map((item: any) => (
                      <tr key={item.id} className="bg-slate-900/20">
                        <td className="px-5 py-2 pl-10 text-slate-300 text-xs font-semibold">{item.description}</td>
                        <td className="px-5 py-2 text-slate-400 text-xs font-medium">{item.segmentRef ?? ''}</td>
                        <td className="px-5 py-2 text-slate-300 text-xs font-semibold text-right">{fmtMoney(Number(item.totalPrice), item.currency)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-600/50 bg-slate-900/30">
                  <td colSpan={2} className="px-5 py-3.5 text-slate-200 font-black text-xs uppercase tracking-wider">Total Charged</td>
                  <td className="px-5 py-3.5 text-[#1ABC9C] font-black text-sm text-right">{fmtMoney(Number(booking.totalPrice), booking.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/50">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Payment Summary</h3>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-700/20">
                <tr>
                  <td className="px-5 py-3 text-slate-400 font-semibold w-44">Total Charged</td>
                  <td className="px-5 py-3 text-[#1ABC9C] font-black text-sm">{fmtMoney(Number(booking.totalPrice), booking.currency)}</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-400 font-semibold">Currency</td>
                  <td className="px-5 py-3 text-white font-bold">{booking.currency}</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-400 font-semibold">Payment Status</td>
                  <td className="px-5 py-3"><Badge value={booking.paymentStatus ?? 'PENDING'} /></td>
                </tr>
                {booking.pnrStrategy && (
                  <>
                    <tr>
                      <td className="px-5 py-3 text-slate-400 font-semibold">PNR Strategy</td>
                      <td className="px-5 py-3"><Badge value={booking.pnrStrategy} /></td>
                    </tr>
                    <tr>
                      <td className="px-5 py-3 text-slate-400 font-semibold">PNR Count</td>
                      <td className="px-5 py-3 text-white font-bold">{booking.pnrCount ?? pnrs.length}</td>
                    </tr>
                    {booking.isSplitTicket && (
                      <tr>
                        <td className="px-5 py-3 text-slate-400 font-semibold">Split Ticket</td>
                        <td className="px-5 py-3 text-amber-400 font-bold">Yes — separate airline confirmations</td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/50">
              <h3 className="text-white font-bold text-sm">Payment Transactions ({booking.payments?.length ?? 0})</h3>
            </div>
            {(booking.payments?.length ?? 0) === 0 ? (
              <p className="px-5 py-8 text-slate-500 text-sm">No payment records.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    {['Stripe Intent ID', 'Amount', 'Currency', 'Method / Card', 'Status', 'Paid At', 'Refunded'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {booking.payments.map((p: any) => (
                    <tr key={p.id}>
                      <td className="px-5 py-3 font-mono text-xs text-slate-400 font-semibold">{p.stripePaymentId?.slice(0, 24) ?? '—'}…</td>
                      <td className="px-5 py-3 text-white font-black">{fmtMoney(Number(p.amount), p.currency)}</td>
                      <td className="px-5 py-3 text-slate-300 font-semibold">{p.currency}</td>
                      <td className="px-5 py-3 text-slate-300 font-semibold">
                        {p.paymentMethodType ?? 'card'}
                        {p.cardLast4 && <span className="ml-1 text-slate-500 font-mono">····{p.cardLast4}</span>}
                      </td>
                      <td className="px-5 py-3"><Badge value={p.status} /></td>
                      <td className="px-5 py-3 text-slate-400 font-semibold">{fmtDate(p.paidAt ?? p.createdAt)}</td>
                      <td className="px-5 py-3 text-slate-400 font-semibold">{p.refundedAmount ? fmtMoney(Number(p.refundedAmount), p.currency) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════
          TAB: TIMELINE
          ══════════════════════════════════════════════════════════ */}
      {tab === 'timeline' && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-5">Event Timeline ({events.length})</h3>
          {events.length === 0 ? (
            <p className="text-slate-500 text-sm">No events recorded.</p>
          ) : (
            <div className="relative pl-8">
              <div className="absolute left-3.5 top-0 bottom-0 w-px bg-slate-700" />
              <div className="space-y-5">
                {events.map((ev: any) => (
                  <div key={ev.id} className="relative">
                    <div className="absolute -left-8 top-1 w-4 h-4 rounded-full border-2 border-[#1ABC9C] bg-slate-900 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C]" />
                    </div>
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <p className="text-white font-bold text-sm">{ev.title}</p>
                      {ev.actorName && <span className="text-slate-500 text-[10px]">by {ev.actorName}</span>}
                      <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${
                        ev.actorType === 'system' ? 'bg-blue-400/10 text-blue-400' :
                        ev.actorType === 'admin'  ? 'bg-amber-400/10 text-amber-400' :
                        'bg-slate-700 text-slate-400'
                      }`}>{ev.actorType}</span>
                    </div>
                    {ev.description && <p className="text-slate-400 text-sm leading-relaxed">{ev.description}</p>}
                    <p className="text-slate-600 text-[10px] mt-1">{fmtDate(ev.createdAt, 'dd MMM yyyy HH:mm:ss')}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: PROVIDER PAYLOADS
          ══════════════════════════════════════════════════════════ */}
      {tab === 'payloads' && (
        <div className="space-y-4">
          {providerPayloads.length === 0 ? (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-8 text-center text-slate-500 text-sm">
              No provider payloads stored for this booking.
            </div>
          ) : (
            providerPayloads.map((pl: any) => (
              <div key={pl.id} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
                <div className="flex items-center w-full">
                  <button
                    onClick={() => setExpandedPayload(expandedPayload === pl.id ? null : pl.id)}
                    className="flex-1 flex items-center gap-4 px-5 py-4 hover:bg-slate-700/20 transition-all text-left"
                  >
                    <span className="px-2.5 py-0.5 rounded-full bg-purple-400/15 text-purple-400 text-[10px] font-bold">
                      {pl.payloadType?.replace(/_/g, ' ')}
                    </span>
                    <span className="text-white text-xs font-semibold capitalize">{pl.provider}</span>
                    {pl.providerReference && (
                      <span className="font-mono text-slate-400 text-xs">{pl.providerReference}</span>
                    )}
                    <span className="text-slate-500 text-xs">{fmtDate(pl.createdAt)}</span>
                    {expandedPayload === pl.id
                      ? <ChevronDown size={14} className="text-slate-400 ml-auto" />
                      : <ChevronRight size={14} className="text-slate-400 ml-auto" />}
                  </button>
                  {isOps && (
                    <button
                      onClick={() => setConfirmDel({ apiPath: `/api/admin/bookings/${id}/payloads/${pl.id}`, label: `${pl.provider} ${pl.payloadType} payload` })}
                      className="p-3 text-red-400 hover:bg-red-500/10 transition-all border-l border-slate-700/50"
                      title="Delete payload"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {expandedPayload === pl.id && (
                  <div className="border-t border-slate-700/50 px-5 py-4">
                    <pre className="text-xs text-slate-300 font-mono overflow-x-auto max-h-96 leading-relaxed whitespace-pre-wrap break-words">
                      {JSON.stringify(pl.payloadJson, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: NOTES
          ══════════════════════════════════════════════════════════ */}
      {tab === 'notes' && (
        <div className="space-y-4">
          {isSupport && (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Add Note</h3>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                placeholder="Internal support note or customer communication…"
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-[#1ABC9C] transition-all"
              />
              <div className="flex justify-end mt-3">
                <button
                  onClick={submitNote}
                  disabled={!note.trim() || submitting}
                  className="flex items-center gap-2 px-4 py-2 bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all"
                >
                  <Send size={14} />
                  {submitting ? 'Adding…' : 'Add Note'}
                </button>
              </div>
            </div>
          )}

          {notes.length === 0 ? (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-8 text-center text-slate-500 text-sm">
              No notes yet.
            </div>
          ) : (
            notes.map((n: any) => (
              <div key={n.id} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold text-sm">{n.adminUser?.fullName ?? 'Admin'}</span>
                    {n.adminUser?.role && <span className="text-slate-500 text-xs">{n.adminUser.role}</span>}
                    {n.isInternal && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 text-[10px] font-bold">INTERNAL</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 text-xs">{fmtDate(n.createdAt)}</span>
                    {isSupport && (
                      <>
                        <button
                          onClick={() => {
                            if (editNoteId === n.id) { setEditNoteId(null); return; }
                            setEditNoteId(n.id);
                            setEditNoteText(n.note);
                          }}
                          className="p-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-white transition-all"
                          title={editNoteId === n.id ? 'Cancel' : 'Edit note'}
                        >
                          {editNoteId === n.id ? <X size={12} /> : <Pencil size={12} />}
                        </button>
                        <button
                          onClick={() => setConfirmDel({ apiPath: `/api/admin/bookings/${id}/notes/${n.id}`, label: 'this note' })}
                          className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                          title="Delete note"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {editNoteId === n.id ? (
                  <div className="space-y-2">
                    <textarea
                      rows={3}
                      value={editNoteText}
                      onChange={e => setEditNoteText(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white text-sm resize-none focus:outline-none focus:border-[#1ABC9C] transition-all"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditNoteId(null)} className="px-3 py-1.5 rounded-xl border border-slate-600 text-slate-400 hover:text-white text-xs transition-all">Cancel</button>
                      <button onClick={saveNote} disabled={saving || !editNoteText.trim()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1ABC9C] hover:bg-[#1ABC9C]/80 text-white text-xs font-bold disabled:opacity-50 transition-all">
                        <Save size={11} />{saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-300 text-sm leading-relaxed">{n.note}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
      {/* ══════════════════════════════════════════════════════════
          TAB: SEATS
          ══════════════════════════════════════════════════════════ */}
      {tab === 'seats' && (
        <div className="space-y-4">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
              <h3 className="text-white font-bold text-sm flex items-center gap-2">
                <Armchair size={14} className="text-[#1ABC9C]" />
                Seat Allocations ({seats.length})
              </h3>
            </div>
            {seats.length === 0 ? (
              <p className="px-5 py-10 text-slate-500 text-sm">No seat selections on this booking.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    {['Passenger', 'Segment', 'Seat', 'Type', 'Zone', 'Price', ...(isOps ? [''] : [])].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {seats.map((s: any) => (
                    <tr key={s.id} className="hover:bg-slate-700/20">
                      <td className="px-5 py-3 text-white font-semibold">{s.passengerName ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-400 font-mono text-xs">{s.segmentRef ?? '—'}</td>
                      <td className="px-5 py-3">
                        <span className="px-2.5 py-1 rounded-lg bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 text-[#1ABC9C] font-mono font-black text-sm">{s.seatNumber ?? '—'}</span>
                      </td>
                      <td className="px-5 py-3 text-slate-300">{s.seatType ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-400">{s.zone ?? '—'}</td>
                      <td className="px-5 py-3 text-white font-bold">{fmtMoney(Number(s.totalPrice ?? s.unitPrice ?? 0), s.currency ?? booking.currency)}</td>
                      {isOps && (
                        <td className="px-5 py-3">
                          <button
                            onClick={() => setConfirmDel({ apiPath: `/api/admin/bookings/${id}/seats/${s.id}`, label: `Seat ${s.seatNumber}` })}
                            className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                            title="Remove seat"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-700/50 bg-slate-900/30">
                    <td colSpan={isOps ? 6 : 5} className="px-5 py-3 text-slate-400 text-xs font-bold text-right">Total Seat Charges</td>
                    <td className="px-5 py-3 text-[#1ABC9C] font-black text-sm">
                      {fmtMoney(seats.reduce((s: number, a: any) => s + Number(a.totalPrice ?? a.unitPrice ?? 0), 0), booking.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: MEALS
          ══════════════════════════════════════════════════════════ */}
      {tab === 'meals' && (
        <div className="space-y-4">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
              <h3 className="text-white font-bold text-sm flex items-center gap-2">
                <UtensilsCrossed size={14} className="text-[#1ABC9C]" />
                Meal Preferences ({meals.length})
              </h3>
            </div>
            {meals.length === 0 ? (
              <p className="px-5 py-10 text-slate-500 text-sm">No meal preferences on this booking.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    {['Passenger', 'Journey', 'Meal', 'Description', 'Price', ...(isOps ? [''] : [])].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {meals.map((m: any) => (
                    <tr key={m.id} className="hover:bg-slate-700/20">
                      <td className="px-5 py-3 text-white font-semibold">{m.passengerName ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-400 font-mono text-xs">{m.segmentRef ?? '—'}</td>
                      <td className="px-5 py-3">
                        <span className="px-2 py-0.5 rounded-lg bg-amber-400/10 text-amber-400 text-xs font-bold">{m.mealCode ?? m.description?.slice(0, 20) ?? '—'}</span>
                      </td>
                      <td className="px-5 py-3 text-slate-300">{m.description ?? m.mealLabel ?? '—'}</td>
                      <td className="px-5 py-3 text-white font-bold">{fmtMoney(Number(m.totalPrice ?? m.unitPrice ?? 0), m.currency ?? booking.currency)}</td>
                      {isOps && (
                        <td className="px-5 py-3">
                          <button
                            onClick={() => setConfirmDel({ apiPath: `/api/admin/bookings/${id}/meals/${m.id}`, label: m.description ?? m.mealCode ?? 'this meal' })}
                            className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                            title="Remove meal"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-700/50 bg-slate-900/30">
                    <td colSpan={isOps ? 5 : 4} className="px-5 py-3 text-slate-400 text-xs font-bold text-right">Total Meal Charges</td>
                    <td className="px-5 py-3 text-[#1ABC9C] font-black text-sm">
                      {fmtMoney(meals.reduce((s: number, a: any) => s + Number(a.totalPrice ?? a.unitPrice ?? 0), 0), booking.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: AUDIT LOG
          ══════════════════════════════════════════════════════════ */}
      {tab === 'auditLog' && (
        <div className="space-y-4">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
              <h3 className="text-white font-bold text-sm flex items-center gap-2">
                <Shield size={14} className="text-[#1ABC9C]" />
                Audit Log ({auditLogs.length})
              </h3>
              <button
                onClick={loadAuditLogs}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-700/50 text-slate-300 hover:text-white text-xs font-bold transition-all"
              >
                <RefreshCw size={11} className={auditLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
            {auditLoading ? (
              <div className="px-5 py-10 text-center">
                <RefreshCw size={20} className="text-[#1ABC9C] animate-spin mx-auto" />
              </div>
            ) : auditLogs.length === 0 ? (
              <p className="px-5 py-10 text-slate-500 text-sm text-center">No audit log entries for this booking.</p>
            ) : (
              <div className="relative pl-8 p-5">
                <div className="absolute left-7 top-5 bottom-5 w-px bg-slate-700" />
                <div className="space-y-5">
                  {auditLogs.map((log: any) => {
                    const actionColor =
                      log.action.includes('DELETE') ? 'text-red-400 border-red-400' :
                      log.action.includes('UPDATE') ? 'text-amber-400 border-amber-400' :
                      log.action.includes('CREATE') ? 'text-emerald-400 border-emerald-400' :
                      'text-blue-400 border-blue-400';
                    return (
                      <div key={log.id} className="relative">
                        <div className={`absolute -left-4 top-1 w-3 h-3 rounded-full border-2 bg-slate-900 ${actionColor}`} />
                        <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            log.action.includes('DELETE') ? 'bg-red-400/10 text-red-400' :
                            log.action.includes('UPDATE') ? 'bg-amber-400/10 text-amber-400' :
                            log.action.includes('CREATE') ? 'bg-emerald-400/10 text-emerald-400' :
                            'bg-blue-400/10 text-blue-400'
                          }`}>{log.action.replace(/_/g, ' ')}</span>
                          <span className="text-white text-xs font-bold">{log.entityType}</span>
                          {log.entityId && <span className="text-slate-500 text-xs font-mono">{log.entityId}</span>}
                          <span className="ml-auto text-slate-500 text-[10px]">
                            {log.adminUser?.fullName ?? 'System'}
                            {log.adminUser?.role && ` (${log.adminUser.role.replace(/_/g, ' ')})`}
                          </span>
                        </div>
                        {log.before && (
                          <div className="mt-1 ml-1">
                            <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Before: </span>
                            <span className="text-slate-400 text-xs font-mono">{JSON.stringify(log.before, null, 0).slice(0, 200)}</span>
                          </div>
                        )}
                        {log.after && (
                          <div className="mt-0.5 ml-1">
                            <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">After: </span>
                            <span className="text-slate-300 text-xs font-mono">{JSON.stringify(log.after, null, 0).slice(0, 200)}</span>
                          </div>
                        )}
                        <p className="text-slate-600 text-[10px] mt-1">
                          {fmtDate(log.createdAt, 'dd MMM yyyy HH:mm:ss')}
                          {log.ipAddress && ` · ${log.ipAddress}`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          BOTTOM: MASTER BOOKING ↔ PNR ASSOCIATION TABLE
          Always visible regardless of selected tab
          ══════════════════════════════════════════════════════════ */}
      {pnrs.length > 0 && (
        <div className="mt-8 bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700/50 flex items-center gap-3">
            <Hash size={14} className="text-[#1ABC9C]" />
            <h3 className="text-white font-bold text-sm">Master Booking ↔ PNR Association</h3>
            {booking.pnrStrategy && <Badge value={booking.pnrStrategy} />}
            {booking.connectionProtStatus && <Badge value={booking.connectionProtStatus} />}
            {booking.isSplitTicket && (
              <span className="px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-400 text-[10px] font-bold border border-amber-400/20">
                Split Ticket
              </span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50 bg-slate-900/30">
                {['Master Ref', 'PNR Code', 'Type', 'Direction', 'Airline', 'Provider', 'Provider Order ID', 'Primary', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/20">
              {pnrs.map((pnr: any, i: number) => (
                <tr
                  key={pnr.id}
                  className={`transition-colors ${
                    selectedPnrId === pnr.id
                      ? 'bg-[#1ABC9C]/5 border-l-2 border-[#1ABC9C]'
                      : i % 2 === 1 ? 'bg-slate-900/20' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-[#1ABC9C] font-bold text-xs">
                    {i === 0 ? (booking.masterBookingReference ?? booking.pnr ?? '—') : <span className="text-slate-600">↳</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-white font-black">{pnr.pnrCode}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[pnr.pnrType] ?? 'bg-slate-400/15 text-slate-400'}`}>
                      {pnr.pnrType.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{pnr.journeyDirection}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {pnr.airlineCode
                      ? <><span className="font-mono font-bold">{pnr.airlineCode}</span>{pnr.airlineName ? ` · ${pnr.airlineName}` : ''}</>
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{pnr.provider ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-slate-500 text-xs">{pnr.providerOrderId ?? '—'}</td>
                  <td className="px-4 py-3">
                    {pnr.isPrimary && (
                      <span className="px-1.5 py-0.5 rounded bg-[#1ABC9C]/15 text-[#1ABC9C] text-[10px] font-bold">PRIMARY</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><Badge value={pnr.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {booking.riskLabel && (
            <div className="px-5 py-3 border-t border-slate-700/40 flex items-center gap-3 bg-amber-400/5">
              <span className="text-amber-400 text-xs font-bold">{booking.riskLabel}</span>
              {booking.riskExplanation && (
                <span className="text-slate-400 text-xs">{booking.riskExplanation}</span>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
