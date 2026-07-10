'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import { BarChart3, RefreshCw, TrendingUp, Plane, DollarSign, Users, Calendar } from 'lucide-react';

/**
 * Admin Reports — Sales Dashboard
 * Shows booking counts, revenue, top airlines, top routes, and provider breakdown.
 * NEW page — does not modify any existing admin pages.
 */

const fmt = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);

export default function ReportsPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');

  async function load() {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/reports?period=${period}`);
      if (res.status === 401) { router.replace('/admin/login'); return; }
      setData(await res.json());
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [period]);

  if (loading) return <div className="flex justify-center py-32"><RefreshCw size={24} className="animate-spin text-slate-500" /></div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-400/15 flex items-center justify-center">
              <BarChart3 size={20} className="text-violet-400" />
            </div>
            Sales & Revenue Reports
          </h1>
          <p className="text-slate-400 text-sm mt-1 ml-[52px]">Business intelligence dashboard</p>
        </div>
        <div className="flex gap-2">
          {[
            { key: '7d', label: '7 Days' },
            { key: '30d', label: '30 Days' },
            { key: '90d', label: '90 Days' },
            { key: 'all', label: 'All Time' },
          ].map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${period === p.key ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/20' : 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:text-white'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Bookings', value: data?.totalBookings || 0, icon: Plane, color: 'text-white', bg: 'bg-slate-800/30 border-slate-700/50' },
          { label: 'Revenue', value: fmt(data?.totalRevenue || 0), icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-400/5 border-emerald-400/20' },
          { label: 'FareMind Margin', value: fmt(data?.totalMargin || 0), icon: TrendingUp, color: 'text-[#1ABC9C]', bg: 'bg-[#1ABC9C]/5 border-[#1ABC9C]/20' },
          { label: 'Unique Customers', value: data?.uniqueCustomers || 0, icon: Users, color: 'text-blue-400', bg: 'bg-blue-400/5 border-blue-400/20' },
        ].map(kpi => (
          <div key={kpi.label} className={`border rounded-xl p-4 ${kpi.bg}`}>
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon size={12} className="text-slate-500" />
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{kpi.label}</p>
            </div>
            <p className={`text-xl font-black ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Provider Breakdown */}
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
            <Plane size={14} className="text-slate-500" /> Bookings by Provider
          </h3>
          <div className="space-y-2">
            {(data?.byProvider || []).map((p: any) => {
              const pct = data?.totalBookings ? Math.round((p.count / data.totalBookings) * 100) : 0;
              return (
                <div key={p.provider} className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-sm font-bold text-white w-20">{p.provider}</span>
                    <div className="flex-1 bg-slate-700/30 rounded-full h-2 overflow-hidden">
                      <div className="bg-[#1ABC9C] h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-3">
                    <span className="text-xs font-bold text-slate-400">{p.count}</span>
                    <span className="text-[10px] text-slate-500 w-8 text-right">{pct}%</span>
                  </div>
                </div>
              );
            })}
            {(!data?.byProvider || data.byProvider.length === 0) && (
              <p className="text-slate-500 text-xs text-center py-4">No data</p>
            )}
          </div>
        </div>

        {/* Top Routes */}
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
            <TrendingUp size={14} className="text-slate-500" /> Top Routes
          </h3>
          <div className="space-y-2">
            {(data?.topRoutes || []).slice(0, 8).map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-700/30 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-500 w-4">{i + 1}</span>
                  <span className="text-sm font-bold text-white">{r.origin}</span>
                  <span className="text-[10px] text-slate-500">→</span>
                  <span className="text-sm font-bold text-white">{r.destination}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-400">{r.count} bookings</span>
                  <span className="text-xs font-bold text-[#1ABC9C]">{fmt(r.revenue)}</span>
                </div>
              </div>
            ))}
            {(!data?.topRoutes || data.topRoutes.length === 0) && (
              <p className="text-slate-500 text-xs text-center py-4">No data</p>
            )}
          </div>
        </div>

        {/* Booking Status Breakdown */}
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h3 className="text-white font-bold text-sm mb-3">Booking Status Distribution</h3>
          <div className="space-y-2">
            {(data?.byStatus || []).map((s: any) => (
              <div key={s.status} className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-300">{s.status}</span>
                <span className="text-sm font-bold text-white">{s.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
            <Calendar size={14} className="text-slate-500" /> Daily Trend (Last 7 Days)
          </h3>
          <div className="space-y-1">
            {(data?.dailyTrend || []).slice(0, 7).map((d: any) => (
              <div key={d.date} className="flex items-center justify-between py-1.5 border-b border-slate-700/30 last:border-0">
                <span className="text-xs font-semibold text-slate-400">{d.date}</span>
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-white">{d.bookings} bookings</span>
                  <span className="text-xs font-bold text-[#1ABC9C]">{fmt(d.revenue)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
