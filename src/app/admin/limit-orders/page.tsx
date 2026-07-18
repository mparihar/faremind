'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Target, Search, Plane, DollarSign, Clock, Pause, Play,
  XCircle, Loader2, RefreshCw, Activity, BarChart3, Zap,
  CheckCircle2, AlertTriangle, Bell, TrendingUp, Users,
  RotateCcw, Shield, Ticket,
} from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  DRAFT: { label: 'Draft', color: 'text-slate-400', bg: 'bg-slate-400/10', border: 'border-slate-400/20' },
  ACTIVE: { label: 'Active', color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
  MONITORING: { label: 'Monitoring', color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' },
  MATCHED: { label: 'Matched', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
  AWAITING_CUSTOMER: { label: 'Awaiting', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
  PURCHASING: { label: 'Purchasing', color: 'text-cyan-400', bg: 'bg-cyan-400/10', border: 'border-cyan-400/20' },
  BOOKED: { label: 'Booked', color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/20' },
  EXPIRED: { label: 'Expired', color: 'text-slate-500', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  CANCELLED: { label: 'Cancelled', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' },
  FAILED: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' },
  SUPPORT_REQUIRED: { label: 'Support', color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/20' },
};

interface Stats {
  activeOrders: number; triggeredToday: number; autoBookedToday: number;
  notifyOnlyToday: number; failedOrders: number; totalOrders: number;
  supportTicketsToday: number; liveSearchReuseRate: number;
  autoPurchaseSuccessRate: number; liveSearchMatches: number; schedulerMatches: number;
}

export default function AdminLimitOrdersPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchEmail, setSearchEmail] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, ordersRes] = await Promise.all([
        fetch(`${BACKEND}/api/limit-orders/admin/stats`),
        (() => {
          const p = new URLSearchParams({ limit: '30' });
          if (searchEmail) p.set('customerEmail', searchEmail);
          if (statusFilter) p.set('status', statusFilter);
          return fetch(`${BACKEND}/api/limit-orders?${p}`);
        })(),
      ]);
      const [statsData, ordersData] = await Promise.all([statsRes.json(), ordersRes.json()]);
      if (statsData.success) setStats(statsData.stats);
      if (ordersData.success) setOrders(ordersData.orders || []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [searchEmail, statusFilter]);

  useEffect(() => { fetchData(); }, []);

  const handleAction = async (orderId: string, action: string) => {
    setActionLoading(orderId);
    try {
      await fetch(`${BACKEND}/api/limit-orders/${orderId}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorType: 'admin' }),
      });
      await fetchData();
    } catch { /* ignore */ } finally {
      setActionLoading(null);
    }
  };

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const KPI = ({ icon: Icon, label, value, color = 'text-white', subValue }: { icon: any; label: string; value: string | number; color?: string; subValue?: string }) => (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-[#1ABC9C]" />
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-2xl font-black ${color}`}>{value}</p>
      {subValue && <p className="text-slate-500 text-[10px] mt-0.5">{subValue}</p>}
    </div>
  );

  return (
    <div className="p-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Target size={22} className="text-[#1ABC9C]" /> Limit Order Management
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">Monitor, manage, and configure limit orders</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-400 text-sm font-bold hover:text-white transition-all">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* KPI Grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          <KPI icon={Activity} label="Active Orders" value={stats.activeOrders} color="text-emerald-400" />
          <KPI icon={Zap} label="Triggered Today" value={stats.triggeredToday} />
          <KPI icon={CheckCircle2} label="Auto-Booked Today" value={stats.autoBookedToday} color="text-green-400" />
          <KPI icon={Bell} label="Notify Matches" value={stats.notifyOnlyToday} color="text-amber-400" />
          <KPI icon={AlertTriangle} label="Failed" value={stats.failedOrders} color={stats.failedOrders > 0 ? 'text-red-400' : 'text-slate-400'} />
          <KPI icon={Ticket} label="Support Tickets" value={stats.supportTicketsToday} subValue="Created today" />
          <KPI icon={TrendingUp} label="Reuse Rate" value={`${stats.liveSearchReuseRate}%`} color="text-cyan-400" subValue={`${stats.liveSearchMatches} live / ${stats.schedulerMatches} scheduled`} />
          <KPI icon={Shield} label="Auto-Purchase Rate" value={`${stats.autoPurchaseSuccessRate}%`} color="text-green-400" />
          <KPI icon={Users} label="Total Orders" value={stats.totalOrders} />
          <KPI icon={BarChart3} label="Provider Savings" value="—" subValue="Searches avoided via reuse" />
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="email" placeholder="Search by customer email..."
            value={searchEmail} onChange={e => setSearchEmail(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder-slate-600 focus:border-[#1ABC9C]/40 focus:outline-none transition-all"
            onKeyDown={e => e.key === 'Enter' && fetchData()} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-300 text-sm focus:outline-none appearance-none cursor-pointer min-w-[140px]">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button onClick={fetchData} className="px-4 py-2.5 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] transition-all">
          <Search size={14} />
        </button>
      </div>

      {/* Orders Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="text-[#1ABC9C] animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Target size={22} className="text-slate-600 mb-3" />
          <p className="text-white font-bold text-sm">No limit orders found</p>
        </div>
      ) : (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Route</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Customer</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fare</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mode</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Matches</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: any, i: number) => {
                const sc = STATUS_CONFIG[order.status] || STATUS_CONFIG.DRAFT;
                return (
                  <motion.tr key={order.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-white font-bold text-xs">{order.origin}</span>
                      <Plane size={9} className="text-[#1ABC9C] rotate-90 inline mx-1" />
                      <span className="text-white font-bold text-xs">{order.destination}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white text-xs font-semibold truncate max-w-[140px]">{order.user?.firstName} {order.user?.lastName}</p>
                      <p className="text-slate-600 text-[10px] truncate max-w-[140px]">{order.user?.email}</p>
                    </td>
                    <td className="px-4 py-3 text-white font-bold text-xs">{fmt(Number(order.minFare))}–{fmt(Number(order.maxFare))}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(order.departureDate)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold ${order.executionMode === 'AUTO_PURCHASE' ? 'text-cyan-400' : 'text-amber-400'}`}>
                        {order.executionMode === 'AUTO_PURCHASE' ? 'Auto' : 'Notify'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${sc.bg} ${sc.color} border ${sc.border}`}>{sc.label}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-400 text-xs">{order._count?.matches || 0}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        {['ACTIVE', 'MONITORING'].includes(order.status) && (
                          <button onClick={() => handleAction(order.id, 'pause')} disabled={actionLoading === order.id}
                            className="p-1.5 rounded-lg hover:bg-amber-500/10 text-slate-500 hover:text-amber-400 transition-all" title="Pause">
                            <Pause size={11} />
                          </button>
                        )}
                        {order.status === 'DRAFT' && (
                          <button onClick={() => handleAction(order.id, 'resume')} disabled={actionLoading === order.id}
                            className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-slate-500 hover:text-emerald-400 transition-all" title="Resume">
                            <Play size={11} />
                          </button>
                        )}
                        {!['BOOKED', 'CANCELLED', 'EXPIRED'].includes(order.status) && (
                          <button onClick={() => handleAction(order.id, 'cancel')} disabled={actionLoading === order.id}
                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-all" title="Cancel">
                            <XCircle size={11} />
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
