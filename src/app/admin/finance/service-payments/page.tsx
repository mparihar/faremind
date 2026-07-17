'use client';

import { useEffect, useState } from 'react';
import { adminFetch } from '@/store/useAdminStore';
import {
  CreditCard, RefreshCw, Search, CheckCircle2, XCircle, Clock,
  Wallet, Filter, Hash, Ticket, Shield, TrendingDown, Heart,
  Armchair, Calendar, Luggage, ArrowUpCircle, HelpCircle, User,
} from 'lucide-react';

const fmt = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);

const SVC_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  CFAR:                   { label: 'CFAR', icon: Shield, color: 'text-blue-400' },
  PRICE_DROP_PROTECTION:  { label: 'Price Drop', icon: TrendingDown, color: 'text-emerald-400' },
  TRAVEL_INSURANCE:       { label: 'Insurance', icon: Heart, color: 'text-purple-400' },
  SEAT_CHANGE:            { label: 'Seat Change', icon: Armchair, color: 'text-amber-400' },
  DATE_CHANGE:            { label: 'Date Change', icon: Calendar, color: 'text-pink-400' },
  BAGGAGE_CHANGE:         { label: 'Baggage', icon: Luggage, color: 'text-teal-400' },
  UPGRADE:                { label: 'Upgrade', icon: ArrowUpCircle, color: 'text-yellow-400' },
  OTHER:                  { label: 'Other', icon: HelpCircle, color: 'text-slate-400' },
};

const STATUS_BADGE: Record<string, string> = {
  SUCCEEDED: 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
  PENDING:   'bg-amber-400/15 text-amber-400 border-amber-400/20',
  FAILED:    'bg-red-400/15 text-red-400 border-red-400/20',
  REFUNDED:  'bg-blue-400/15 text-blue-400 border-blue-400/20',
};

export default function AdminServicePaymentsPage() {
  const [payments, setPayments] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [svcFilter, setSvcFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'ALL') params.set('status', filter);
      if (svcFilter !== 'ALL') params.set('serviceType', svcFilter);
      if (search.trim()) params.set('q', search.trim());
      const res = await adminFetch(`/api/admin/service-payments?${params}`);
      const data = await res.json();
      setPayments(data.payments || []);
      setSummary(data.summary || {});
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [filter, svcFilter]);

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Wallet size={22} className="text-[#1ABC9C]" /> Service Payments
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">All service payments across users and agents</p>
        </div>
        <button onClick={load} className="px-4 py-2 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm font-semibold hover:bg-white/[0.1] transition-all flex items-center gap-2">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
          <p className="text-[10px] text-slate-500 uppercase font-bold">Total</p>
          <p className="text-xl font-black text-white">{summary.total || 0}</p>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
          <p className="text-[10px] text-emerald-400 uppercase font-bold">Succeeded</p>
          <p className="text-xl font-black text-emerald-400">{summary.succeeded || 0}</p>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
          <p className="text-[10px] text-amber-400 uppercase font-bold">Pending</p>
          <p className="text-xl font-black text-amber-400">{summary.pending || 0}</p>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
          <p className="text-[10px] text-[#1ABC9C] uppercase font-bold">Total Revenue</p>
          <p className="text-xl font-black text-[#1ABC9C]">{fmt(summary.totalAmount || 0)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="Search by PNR, name, email, ticket..."
            className="w-full pl-9 pr-4 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-[#1ABC9C]/30 transition-all" />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)}
          className="px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm cursor-pointer focus:outline-none">
          <option value="ALL" className="bg-[#0a0f1e]">All Status</option>
          <option value="SUCCEEDED" className="bg-[#0a0f1e]">Succeeded</option>
          <option value="PENDING" className="bg-[#0a0f1e]">Pending</option>
          <option value="FAILED" className="bg-[#0a0f1e]">Failed</option>
        </select>
        <select value={svcFilter} onChange={e => setSvcFilter(e.target.value)}
          className="px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm cursor-pointer focus:outline-none">
          <option value="ALL" className="bg-[#0a0f1e]">All Services</option>
          {Object.entries(SVC_LABELS).map(([k, v]) => (
            <option key={k} value={k} className="bg-[#0a0f1e]">{v.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={20} className="text-[#1ABC9C] animate-spin" />
        </div>
      ) : payments.length === 0 ? (
        <div className="text-center py-16">
          <Wallet size={32} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No service payments found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {payments.map(p => {
            const svc = SVC_LABELS[p.serviceType] || SVC_LABELS.OTHER;
            const SvcIcon = svc.icon;
            const isExpanded = expanded === p.id;
            return (
              <div key={p.id}>
                <button onClick={() => setExpanded(isExpanded ? null : p.id)}
                  className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all ${
                    isExpanded ? 'bg-white/[0.06] border-[#1ABC9C]/20' : 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.06]'
                  }`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0`}>
                      <SvcIcon size={16} className={svc.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-white font-bold text-sm">{svc.label}</span>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${STATUS_BADGE[p.status] || 'bg-slate-400/15 text-slate-400'}`}>{p.status}</span>
                        <span className="text-slate-600 text-xs font-semibold">{p.requestedBy}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-slate-500">
                        {p.pnrCode && <span className="flex items-center gap-1"><Hash size={9} /> {p.pnrCode}</span>}
                        {p.ticketNumber && <span className="flex items-center gap-1"><Ticket size={9} /> {p.ticketNumber}</span>}
                        <span className="flex items-center gap-1"><User size={9} /> {p.customerName}</span>
                        <span>{p.customerEmail}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-black text-sm ${p.status === 'SUCCEEDED' ? 'text-emerald-400' : p.status === 'FAILED' ? 'text-red-400' : 'text-amber-400'}`}>
                        {fmt(Number(p.amount), p.currency)}
                      </p>
                      <p className="text-slate-600 text-[10px]">
                        {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="mx-4 mt-1 mb-2 px-4 py-4 bg-white/[0.03] border border-white/[0.06] rounded-xl">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                      <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Service</p><p className="text-white font-semibold">{svc.label}</p></div>
                      <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Booking Ref</p><p className="text-white font-mono">{p.booking?.masterBookingReference || 'N/A'}</p></div>
                      <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">PNR</p><p className="text-white font-mono">{p.pnrCode || 'N/A'}</p></div>
                      <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Ticket #</p><p className="text-white font-mono">{p.ticketNumber || 'N/A'}</p></div>
                      <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Customer</p><p className="text-white">{p.customerName}</p><p className="text-slate-500 text-xs">{p.customerEmail}</p>{p.customerPhone && <p className="text-slate-500 text-xs">{p.customerPhone}</p>}</div>
                      <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Requested By</p><p className="text-white font-semibold">{p.requestedBy}</p></div>
                      <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Amount</p><p className={`font-bold ${p.status === 'SUCCEEDED' ? 'text-emerald-400' : 'text-white'}`}>{fmt(Number(p.amount), p.currency)}</p></div>
                      <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Status</p><p className={`font-bold ${p.status === 'SUCCEEDED' ? 'text-emerald-400' : p.status === 'FAILED' ? 'text-red-400' : 'text-amber-400'}`}>{p.status}</p></div>
                      <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Paid At</p><p className="text-white">{p.paidAt ? new Date(p.paidAt).toLocaleString() : '—'}</p></div>
                      {p.stripePaymentIntentId && (
                        <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Stripe PI</p><p className="text-slate-400 font-mono text-xs break-all">{p.stripePaymentIntentId}</p></div>
                      )}
                      {p.booking && (
                        <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Route</p><p className="text-white">{p.booking.originAirport} → {p.booking.destinationAirport}</p></div>
                      )}
                    </div>
                    {p.description && (
                      <div className="mt-3 px-3 py-2 bg-white/[0.02] border border-white/[0.04] rounded-lg">
                        <p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Description</p>
                        <p className="text-slate-300 text-sm">{p.description}</p>
                      </div>
                    )}
                    {p.notes && (
                      <div className="mt-2 px-3 py-2 bg-white/[0.02] border border-white/[0.04] rounded-lg">
                        <p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Notes</p>
                        <p className="text-slate-300 text-sm">{p.notes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
