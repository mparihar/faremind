'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  CreditCard, RefreshCw, Search, ChevronRight, Filter,
  CheckCircle2, XCircle, Clock, ArrowDownLeft,
} from 'lucide-react';

/**
 * Admin Finance — Payments Page
 * Lists all Stripe payment transactions (BookingPayment records).
 * NEW page — does not modify existing /admin/finance page.
 */

const STATUS_COLORS: Record<string, string> = {
  SUCCEEDED: 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
  PENDING:   'bg-amber-400/15 text-amber-400 border-amber-400/20',
  FAILED:    'bg-red-400/15 text-red-400 border-red-400/20',
  REFUNDED:  'bg-blue-400/15 text-blue-400 border-blue-400/20',
  PARTIALLY_REFUNDED: 'bg-violet-400/15 text-violet-400 border-violet-400/20',
};

const fmt = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);

export default function PaymentsPage() {
  const router = useRouter();
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/finance/payments?status=${filter}&q=${search}`);
      if (res.status === 401) { router.replace('/admin/login'); return; }
      const data = await res.json();
      setPayments(data.payments || []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [filter]);

  const stats = {
    total: payments.length,
    succeeded: payments.filter(p => p.status === 'SUCCEEDED').length,
    pending: payments.filter(p => p.status === 'PENDING').length,
    totalAmount: payments.filter(p => p.status === 'SUCCEEDED').reduce((s, p) => s + Number(p.amount), 0),
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-400/15 flex items-center justify-center">
              <CreditCard size={20} className="text-emerald-400" />
            </div>
            Payment Transactions
          </h1>
          <p className="text-slate-400 text-sm mt-1 ml-[52px]">All Stripe payment records</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total', value: stats.total, color: 'text-white' },
          { label: 'Succeeded', value: stats.succeeded, color: 'text-emerald-400' },
          { label: 'Pending', value: stats.pending, color: 'text-amber-400' },
          { label: 'Total Revenue', value: fmt(stats.totalAmount), color: 'text-[#1ABC9C]' },
        ].map(s => (
          <div key={s.label} className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{s.label}</p>
            <p className={`text-xl font-black ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {['ALL', 'SUCCEEDED', 'PENDING', 'FAILED', 'REFUNDED'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${filter === f ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/20' : 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:text-white'}`}>
            {f === 'ALL' ? 'All' : f}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw size={24} className="animate-spin text-slate-500" /></div>
      ) : (
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                {['Booking Ref', 'Amount', 'Method', 'Status', 'Stripe PI', 'Paid At'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={p.id} className="border-b border-slate-700/30 hover:bg-slate-800/40 transition-all">
                  <td className="px-4 py-3 text-sm font-bold text-white">{p.bookingRef || '—'}</td>
                  <td className="px-4 py-3 text-sm font-black text-[#1ABC9C]">{fmt(Number(p.amount), p.currency)}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{p.paymentMethodType || '—'} {p.cardLast4 ? `····${p.cardLast4}` : ''}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${STATUS_COLORS[p.status] || 'bg-slate-700/50 text-slate-400 border-slate-600/30'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[10px] text-slate-500 font-mono">{p.stripePaymentIntentId?.slice(0, 20) || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{p.paidAt ? new Date(p.paidAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500 text-sm">No payments found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
