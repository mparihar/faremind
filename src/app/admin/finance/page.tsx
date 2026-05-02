'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import { DollarSign, TrendingUp, TrendingDown, RefreshCw, ArrowDownLeft } from 'lucide-react';
import { format } from 'date-fns';

const PAY_STATUS_COLORS: Record<string, string> = {
  COMPLETED:          'bg-emerald-400/15 text-emerald-400',
  PENDING:            'bg-amber-400/15 text-amber-400',
  REFUNDED:           'bg-blue-400/15 text-blue-400',
  PARTIALLY_REFUNDED: 'bg-purple-400/15 text-purple-400',
  FAILED:             'bg-red-400/15 text-red-400',
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export default function FinancePage() {
  const router = useRouter();
  const [data, setData]     = useState<any>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await adminFetch('/api/admin/finance');
    if (res.status === 401) { router.replace('/admin/login'); return; }
    if (res.status === 403) {
      return;
    }
    setData(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex items-center justify-center h-screen"><RefreshCw size={24} className="text-[#1ABC9C] animate-spin" /></div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Finance</h1>
          <p className="text-slate-400 text-sm mt-0.5">Revenue, refunds & settlements</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all">
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-emerald-400/5 border border-emerald-400/20 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-400/15 flex items-center justify-center">
              <TrendingUp size={20} className="text-emerald-400" />
            </div>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Revenue</p>
          </div>
          <p className="text-3xl font-black text-white">{fmtMoney(data?.revenue?.total ?? 0)}</p>
          <p className="text-emerald-400 text-xs mt-1">{data?.revenue?.count ?? 0} payments</p>
        </div>

        <div className="bg-red-400/5 border border-red-400/20 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-red-400/15 flex items-center justify-center">
              <ArrowDownLeft size={20} className="text-red-400" />
            </div>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Refunds</p>
          </div>
          <p className="text-3xl font-black text-white">{fmtMoney(data?.refunds?.total ?? 0)}</p>
          <p className="text-red-400 text-xs mt-1">{data?.refunds?.count ?? 0} refunds</p>
        </div>

        <div className="bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-[#1ABC9C]/15 flex items-center justify-center">
              <DollarSign size={20} className="text-[#1ABC9C]" />
            </div>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Net Revenue</p>
          </div>
          <p className="text-3xl font-black text-white">{fmtMoney((data?.revenue?.total ?? 0) - (data?.refunds?.total ?? 0))}</p>
          <p className="text-[#1ABC9C] text-xs mt-1">after refunds</p>
        </div>
      </div>

      {/* Pending settlements */}
      {data?.pendingSettlements?.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-slate-700/50">
            <h2 className="text-white font-bold text-sm">Pending Settlements</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50">
                {['Partner', 'Period', 'Bookings', 'Gross Revenue', 'Commission', 'Net Payable'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {data.pendingSettlements.map((s: any) => (
                <tr key={s.id}>
                  <td className="px-5 py-3">
                    <p className="text-white font-semibold text-xs">{s.partner?.name}</p>
                    <p className="text-slate-500 text-[10px]">{s.partner?.email}</p>
                  </td>
                  <td className="px-5 py-3 text-slate-300 text-xs">
                    {format(new Date(s.periodStart), 'dd MMM')} – {format(new Date(s.periodEnd), 'dd MMM yyyy')}
                  </td>
                  <td className="px-5 py-3 text-white text-xs">{s.bookingsCount}</td>
                  <td className="px-5 py-3 text-white text-xs">{fmtMoney(Number(s.grossRevenue))}</td>
                  <td className="px-5 py-3 text-[#1ABC9C] text-xs font-bold">{fmtMoney(Number(s.commission))}</td>
                  <td className="px-5 py-3 text-amber-400 text-xs font-bold">{fmtMoney(Number(s.netPayable))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent payments */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/50">
          <h2 className="text-white font-bold text-sm">Recent Payments</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50">
              {['Booking', 'Passenger', 'Type', 'Amount', 'Status', 'Date'].map(h => (
                <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {(data?.recentPayments ?? []).map((p: any) => (
              <tr key={p.id}>
                <td className="px-5 py-3 font-mono text-[#1ABC9C] text-xs font-bold">{p.booking?.pnr ?? p.bookingId?.slice(0, 8)}</td>
                <td className="px-5 py-3 text-slate-300 text-xs">
                  {p.booking?.user ? `${p.booking.user.firstName} ${p.booking.user.lastName}` : '—'}
                </td>
                <td className="px-5 py-3 text-slate-400 text-xs">{p.type}</td>
                <td className="px-5 py-3 text-white font-bold text-xs">{fmtMoney(Number(p.amount))}</td>
                <td className="px-5 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${PAY_STATUS_COLORS[p.status] ?? 'bg-slate-400/15 text-slate-400'}`}>
                    {p.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-500 text-xs">{format(new Date(p.createdAt), 'dd MMM yyyy')}</td>
              </tr>
            ))}
            {(data?.recentPayments ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No payments</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
