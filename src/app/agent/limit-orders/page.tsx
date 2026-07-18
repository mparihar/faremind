'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Target, Search, Plane, DollarSign, Clock, Pause, Play,
  XCircle, ChevronRight, Eye, Loader2, RefreshCw, Filter,
  CheckCircle2, AlertTriangle, Bell, Zap,
} from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  DRAFT: { label: 'Draft', color: 'text-slate-400', bg: 'bg-slate-400/10', border: 'border-slate-400/20' },
  ACTIVE: { label: 'Active', color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
  MONITORING: { label: 'Monitoring', color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' },
  MATCHED: { label: 'Matched', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
  AWAITING_CUSTOMER: { label: 'Awaiting Action', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
  PURCHASING: { label: 'Purchasing', color: 'text-cyan-400', bg: 'bg-cyan-400/10', border: 'border-cyan-400/20' },
  BOOKED: { label: 'Booked', color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/20' },
  EXPIRED: { label: 'Expired', color: 'text-slate-500', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  CANCELLED: { label: 'Cancelled', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' },
  FAILED: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' },
  SUPPORT_REQUIRED: { label: 'Support Required', color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/20' },
};

export default function AgentLimitOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchEmail, setSearchEmail] = useState('');
  const [searchRoute, setSearchRoute] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (searchEmail) params.set('customerEmail', searchEmail);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`${BACKEND}/api/limit-orders?${params}`);
      const data = await res.json();
      if (data.success) setOrders(data.orders || []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [searchEmail, statusFilter]);

  useEffect(() => { fetchOrders(); }, []);

  const handleAction = async (orderId: string, action: string) => {
    setActionLoading(orderId);
    try {
      await fetch(`${BACKEND}/api/limit-orders/${orderId}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorType: 'agent' }),
      });
      await fetchOrders();
    } catch { /* ignore */ } finally {
      setActionLoading(null);
    }
  };

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Target size={22} className="text-[#1ABC9C]" /> Limit Orders
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">Monitor and manage customer limit orders</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="email" placeholder="Search by customer email..."
            value={searchEmail} onChange={e => setSearchEmail(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder-slate-600 focus:border-[#1ABC9C]/40 focus:outline-none transition-all"
            onKeyDown={e => e.key === 'Enter' && fetchOrders()} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-300 text-sm focus:outline-none appearance-none cursor-pointer min-w-[140px]">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button onClick={fetchOrders} className="px-4 py-2.5 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] transition-all flex items-center gap-2">
          <Search size={14} /> Search
        </button>
        <button onClick={fetchOrders} className="px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white transition-all">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="text-[#1ABC9C] animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {!loading && orders.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
            <Target size={22} className="text-slate-600" />
          </div>
          <p className="text-white font-bold mb-1">No limit orders found</p>
          <p className="text-slate-500 text-sm">Try searching by customer email or adjusting filters.</p>
        </div>
      )}

      {/* Orders Table */}
      {!loading && orders.length > 0 && (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Route</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Customer</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fare Range</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mode</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Matches</th>
                <th className="text-right px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: any, i: number) => {
                const sc = STATUS_CONFIG[order.status] || STATUS_CONFIG.DRAFT;
                const isActionable = ['ACTIVE', 'MONITORING', 'MATCHED', 'AWAITING_CUSTOMER'].includes(order.status);
                return (
                  <motion.tr key={order.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3">
                      <span className="text-white font-bold">{order.origin}</span>
                      <Plane size={10} className="text-[#1ABC9C] rotate-90 inline mx-1.5" />
                      <span className="text-white font-bold">{order.destination}</span>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-white text-xs font-semibold">{order.user?.firstName} {order.user?.lastName}</p>
                      <p className="text-slate-500 text-[10px]">{order.user?.email}</p>
                    </td>
                    <td className="px-5 py-3 text-white font-bold text-xs">{fmt(Number(order.minFare))} – {fmt(Number(order.maxFare))}</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{fmtDate(order.departureDate)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold ${order.executionMode === 'AUTO_PURCHASE' ? 'text-cyan-400' : 'text-amber-400'}`}>
                        {order.executionMode === 'AUTO_PURCHASE' ? 'Auto' : 'Notify'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${sc.bg} ${sc.color} border ${sc.border}`}>
                        {sc.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs text-center">{order._count?.matches || 0}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        {isActionable && (
                          <button onClick={() => handleAction(order.id, 'pause')} disabled={actionLoading === order.id}
                            className="p-1.5 rounded-lg hover:bg-amber-500/10 text-slate-500 hover:text-amber-400 transition-all" title="Pause">
                            <Pause size={12} />
                          </button>
                        )}
                        {order.status === 'DRAFT' && (
                          <button onClick={() => handleAction(order.id, 'resume')} disabled={actionLoading === order.id}
                            className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-slate-500 hover:text-emerald-400 transition-all" title="Resume">
                            <Play size={12} />
                          </button>
                        )}
                        {!['BOOKED', 'CANCELLED', 'EXPIRED'].includes(order.status) && (
                          <button onClick={() => handleAction(order.id, 'cancel')} disabled={actionLoading === order.id}
                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-all" title="Cancel">
                            <XCircle size={12} />
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
