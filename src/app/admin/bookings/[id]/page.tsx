'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import { useAdminStore } from '@/store/useAdminStore';
import {
  ArrowLeft, RefreshCw, User, Plane, CreditCard, ScrollText,
  MessageSquare, Send, Clock, CheckCircle, XCircle, AlertCircle,
} from 'lucide-react';
import { format } from 'date-fns';

type Tab = 'info' | 'passengers' | 'addons' | 'payments' | 'timeline' | 'notes';

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
  TICKETED:  'bg-[#1ABC9C]/15 text-[#1ABC9C] border-[#1ABC9C]/20',
  PENDING:   'bg-amber-400/15 text-amber-400 border-amber-400/20',
  CANCELLED: 'bg-red-400/15 text-red-400 border-red-400/20',
  FAILED:    'bg-red-500/15 text-red-500 border-red-500/20',
  COMPLETED: 'bg-slate-400/15 text-slate-400 border-slate-400/20',
};

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-700/30 last:border-0">
      <span className="text-slate-500 text-xs w-36 shrink-0">{label}</span>
      <span className="text-white text-xs font-semibold">{value}</span>
    </div>
  );
}

export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router  = useRouter();
  const { user } = useAdminStore();
  const [data, setData]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]       = useState<Tab>('info');
  const [note, setNote]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const res = await adminFetch(`/api/admin/bookings/${id}`);
    if (res.status === 401) { router.replace('/admin/login'); return; }
    if (!res.ok) { router.replace('/admin/bookings'); return; }
    setData(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function submitNote() {
    if (!note.trim()) return;
    setSubmitting(true);
    await adminFetch(`/api/admin/bookings/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    setNote('');
    await load();
    setSubmitting(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
    </div>;
  }

  if (!data) return null;
  const { booking, addons, tickets, events, notes, changeRequests, cancellation, providerSync } = data;

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'info',       label: 'Booking Info', icon: Plane },
    { id: 'passengers', label: 'Passengers',   icon: User },
    { id: 'addons',     label: 'Add-ons',      icon: CheckCircle },
    { id: 'payments',   label: 'Payments',     icon: CreditCard },
    { id: 'timeline',   label: 'Timeline',     icon: Clock },
    { id: 'notes',      label: `Notes (${notes?.length ?? 0})`, icon: MessageSquare },
  ];

  const fmtMoney = (n: number, cur = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <button onClick={() => router.back()} className="mt-1 p-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white transition-all">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-black text-white font-mono">{booking.pnr ?? booking.id.slice(0, 8).toUpperCase()}</h1>
            <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${STATUS_COLORS[booking.status] ?? 'bg-slate-400/15 text-slate-400'}`}>
              {booking.status}
            </span>
          </div>
          <p className="text-slate-400 text-sm">
            {booking.originAirport} → {booking.destinationAirport} · {format(new Date(booking.departureTime), 'dd MMM yyyy, HH:mm')} ·
            {' '}{booking.user.firstName} {booking.user.lastName}
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white transition-all">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-700/50 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-all ${
                tab === t.id
                  ? 'border-[#1ABC9C] text-[#1ABC9C]'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="space-y-5">

        {/* ── INFO ── */}
        {tab === 'info' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4">Flight Details</h3>
              <InfoRow label="PNR" value={booking.pnr} />
              <InfoRow label="Airline" value={`${booking.airlineName} (${booking.airlineCode})`} />
              <InfoRow label="Route" value={`${booking.originCity} (${booking.originAirport}) → ${booking.destinationCity} (${booking.destinationAirport})`} />
              <InfoRow label="Departure" value={format(new Date(booking.departureTime), 'dd MMM yyyy, HH:mm')} />
              <InfoRow label="Arrival" value={format(new Date(booking.arrivalTime), 'dd MMM yyyy, HH:mm')} />
              <InfoRow label="Duration" value={`${Math.floor(booking.totalDuration / 60)}h ${booking.totalDuration % 60}m`} />
              <InfoRow label="Stops" value={String(booking.stops)} />
              <InfoRow label="Cabin" value={booking.cabinClass} />
              <InfoRow label="Fare Class" value={booking.fareClass} />
              <InfoRow label="Provider" value={booking.provider} />
              <InfoRow label="Provider Booking ID" value={booking.providerBookingId} />
            </div>

            <div className="space-y-5">
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4">Pricing</h3>
                <InfoRow label="Base Fare" value={booking.baseFare ? fmtMoney(Number(booking.baseFare), booking.currency) : undefined} />
                <InfoRow label="Taxes" value={booking.taxes ? fmtMoney(Number(booking.taxes), booking.currency) : undefined} />
                <InfoRow label="Platform Fee" value={booking.platformFee ? fmtMoney(Number(booking.platformFee), booking.currency) : undefined} />
                <InfoRow label="Total" value={fmtMoney(Number(booking.totalPrice), booking.currency)} />
                <InfoRow label="Currency" value={booking.currency} />
              </div>
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4">Policies</h3>
                <InfoRow label="Refundable" value={booking.refundable ? 'Yes' : 'No'} />
                <InfoRow label="Changeable" value={booking.changeable ? 'Yes' : 'No'} />
                <InfoRow label="Cancellation Fee" value={booking.cancellationFee ? fmtMoney(Number(booking.cancellationFee), booking.currency) : 'N/A'} />
                <InfoRow label="Change Fee" value={booking.changeFee ? fmtMoney(Number(booking.changeFee), booking.currency) : 'N/A'} />
                <InfoRow label="Carry-on Bags" value={String(booking.carryOnBags)} />
                <InfoRow label="Checked Bags" value={String(booking.checkedBags)} />
              </div>
            </div>

            {/* Segments */}
            {booking.segments?.length > 0 && (
              <div className="lg:col-span-2 bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4">Flight Segments</h3>
                <div className="space-y-3">
                  {booking.segments.map((seg: any) => (
                    <div key={seg.id} className="flex items-center gap-4 p-3 bg-slate-700/30 rounded-xl">
                      <div className="text-center w-16">
                        <p className="text-white font-bold text-xs">{seg.depAirport}</p>
                        <p className="text-slate-400 text-[10px]">{format(new Date(seg.depTime), 'HH:mm')}</p>
                      </div>
                      <div className="flex-1 flex items-center gap-2">
                        <div className="h-px flex-1 bg-slate-600" />
                        <Plane size={12} className="text-slate-400" />
                        <div className="h-px flex-1 bg-slate-600" />
                      </div>
                      <div className="text-center w-16">
                        <p className="text-white font-bold text-xs">{seg.arrAirport}</p>
                        <p className="text-slate-400 text-[10px]">{format(new Date(seg.arrTime), 'HH:mm')}</p>
                      </div>
                      <div className="text-right w-32">
                        <p className="text-[#1ABC9C] font-bold text-xs">{seg.airlineCode}{seg.flightNumber}</p>
                        <p className="text-slate-400 text-[10px]">{Math.floor(seg.duration / 60)}h {seg.duration % 60}m</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Provider sync */}
            {providerSync && (
              <div className="lg:col-span-2 bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4">Provider Sync</h3>
                <InfoRow label="Status" value={providerSync.status} />
                <InfoRow label="Provider Order ID" value={providerSync.providerOrderId} />
                <InfoRow label="Last Sync" value={providerSync.lastSyncAt ? format(new Date(providerSync.lastSyncAt), 'dd MMM yyyy HH:mm') : undefined} />
                <InfoRow label="Last Error" value={providerSync.lastError} />
              </div>
            )}
          </div>
        )}

        {/* ── PASSENGERS ── */}
        {tab === 'passengers' && (
          <div className="space-y-4">
            {booking.passengers?.map((p: any, i: number) => (
              <div key={p.id} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-6 h-6 rounded-lg bg-[#1ABC9C]/15 flex items-center justify-center text-[#1ABC9C] text-[10px] font-black">{i + 1}</span>
                  <h3 className="text-white font-bold text-sm">{p.firstName} {p.lastName}</h3>
                  <span className="px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 text-[10px] font-bold">{p.type}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-8">
                  <InfoRow label="Gender" value={p.gender} />
                  <InfoRow label="Date of Birth" value={format(new Date(p.dateOfBirth), 'dd MMM yyyy')} />
                  <InfoRow label="Email" value={p.email} />
                  <InfoRow label="Phone" value={p.phone} />
                  <InfoRow label="Nationality" value={p.nationality} />
                  <InfoRow label="Passport No." value={p.passportNumber} />
                  <InfoRow label="Passport Expiry" value={p.passportExpiry ? format(new Date(p.passportExpiry), 'dd MMM yyyy') : undefined} />
                  <InfoRow label="Issuing Country" value={p.issuingCountry} />
                </div>
              </div>
            ))}
            {tickets?.length > 0 && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4">E-Tickets</h3>
                {tickets.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-0">
                    <span className="text-[#1ABC9C] font-mono text-xs font-bold">{t.ticketNumber}</span>
                    <span className="text-slate-400 text-xs">{t.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ADD-ONS ── */}
        {tab === 'addons' && (
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/50">
              <h3 className="text-white font-bold text-sm">Add-ons & Services</h3>
            </div>
            {addons?.length === 0 ? (
              <p className="px-5 py-8 text-slate-500 text-sm">No add-ons</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    {['Type', 'Description', 'Segment', 'Seat', 'Qty', 'Unit Price', 'Total'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {addons.map((a: any) => (
                    <tr key={a.id}>
                      <td className="px-5 py-3 text-slate-300 text-xs font-bold">{a.type}</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">{a.description ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-400 text-xs font-mono">{a.segmentRef ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">{a.seatNumber ?? '—'}</td>
                      <td className="px-5 py-3 text-white text-xs">{a.quantity}</td>
                      <td className="px-5 py-3 text-white text-xs">{fmtMoney(Number(a.unitPrice), a.currency)}</td>
                      <td className="px-5 py-3 text-[#1ABC9C] font-bold text-xs">{fmtMoney(Number(a.totalPrice), a.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── PAYMENTS ── */}
        {tab === 'payments' && (
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/50">
              <h3 className="text-white font-bold text-sm">Payment History</h3>
            </div>
            {booking.payments?.length === 0 ? (
              <p className="px-5 py-8 text-slate-500 text-sm">No payments</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    {['Stripe ID', 'Type', 'Amount', 'Status', 'Refunded', 'Date'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {booking.payments.map((p: any) => (
                    <tr key={p.id}>
                      <td className="px-5 py-3 font-mono text-[11px] text-slate-400">{p.stripePaymentId?.slice(0, 20) ?? '—'}…</td>
                      <td className="px-5 py-3 text-slate-300 text-xs">{p.type}</td>
                      <td className="px-5 py-3 text-white font-bold text-xs">{fmtMoney(Number(p.amount), p.currency)}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[p.status] ?? 'bg-slate-400/15 text-slate-400'}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        {p.refundedAmount ? fmtMoney(Number(p.refundedAmount), p.currency) : '—'}
                      </td>
                      <td className="px-5 py-3 text-slate-500 text-xs">
                        {format(new Date(p.createdAt), 'dd MMM yyyy HH:mm')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── TIMELINE ── */}
        {tab === 'timeline' && (
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4">Event Timeline</h3>
            {events?.length === 0 ? (
              <p className="text-slate-500 text-sm">No events recorded</p>
            ) : (
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-700" />
                <div className="space-y-4">
                  {events.map((ev: any) => (
                    <div key={ev.id} className="flex items-start gap-4 pl-10 relative">
                      <div className="absolute left-2 top-1 w-4 h-4 rounded-full border-2 border-[#1ABC9C] bg-slate-900" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-white font-bold text-xs">{ev.title}</p>
                          {ev.actorName && <span className="text-slate-500 text-[10px]">by {ev.actorName}</span>}
                        </div>
                        {ev.description && <p className="text-slate-400 text-xs">{ev.description}</p>}
                        <p className="text-slate-600 text-[10px] mt-1">{format(new Date(ev.createdAt), 'dd MMM yyyy HH:mm:ss')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── NOTES ── */}
        {tab === 'notes' && (
          <div className="space-y-4">
            {/* Add note */}
            {user && ['SUPER_ADMIN', 'OPS_ADMIN', 'SUPPORT'].includes(user.role) && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-3">Add Note</h3>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={3}
                  placeholder="Internal note or customer communication…"
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

            {/* Notes list */}
            {notes?.length === 0 ? (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-8 text-center text-slate-500">No notes yet</div>
            ) : (
              notes.map((n: any) => (
                <div key={n.id} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="text-white font-bold text-sm">{n.adminUser?.fullName ?? 'Admin'}</span>
                      <span className="text-slate-500 text-xs ml-2">{n.adminUser?.role}</span>
                      {n.isInternal && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 text-[10px] font-bold">INTERNAL</span>}
                    </div>
                    <span className="text-slate-500 text-xs">{format(new Date(n.createdAt), 'dd MMM yyyy HH:mm')}</span>
                  </div>
                  <p className="text-slate-300 text-sm leading-relaxed">{n.note}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
