'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Target, Plus, Plane, Clock, DollarSign, Pause, Play,
  XCircle, ChevronRight, Eye, AlertTriangle, CheckCircle2,
  Loader2, Filter, RefreshCw, Search,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  DRAFT: { label: 'Draft', color: 'text-slate-400', bg: 'bg-slate-400/10', border: 'border-slate-400/20' },
  ACTIVE: { label: 'Active', color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
  MONITORING: { label: 'Monitoring', color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' },
  MATCHED: { label: 'Matched', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
  AWAITING_CUSTOMER: { label: 'Awaiting Action', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
  AWAITING_PAYMENT: { label: 'Awaiting Payment', color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/20' },
  PURCHASING: { label: 'Purchasing', color: 'text-cyan-400', bg: 'bg-cyan-400/10', border: 'border-cyan-400/20' },
  BOOKED: { label: 'Booked', color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/20' },
  EXPIRED: { label: 'Expired', color: 'text-slate-500', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  CANCELLED: { label: 'Cancelled', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' },
  FAILED: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' },
  SUPPORT_REQUIRED: { label: 'Support Required', color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/20' },
};

const CABIN_LABELS: Record<string, string> = {
  ECONOMY: 'Economy', PREMIUM_ECONOMY: 'Premium Economy', BUSINESS: 'Business', FIRST: 'First',
};

interface LimitOrderItem {
  id: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  tripType: string;
  minFare: number;
  maxFare: number;
  currency: string;
  cabinClass: string;
  executionMode: string;
  status: string;
  expiresAt?: string;
  lastMatchedAt?: string;
  createdAt: string;
  _count?: { matches: number };
}

export default function LimitOrdersPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [orders, setOrders] = useState<LimitOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const res = await fetch(`${BACKEND}/api/limit-orders?userId=${user.id}&limit=50`);
      const data = await res.json();
      if (data.success) setOrders(data.orders || []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleAction = async (orderId: string, action: 'pause' | 'resume' | 'cancel') => {
    setActionLoading(orderId);
    try {
      await fetch(`${BACKEND}/api/limit-orders/${orderId}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      await fetchOrders();
    } catch { /* ignore */ } finally {
      setActionLoading(null);
    }
  };

  const filtered = orders.filter(o => {
    if (filter === 'active') return ['ACTIVE', 'MONITORING', 'MATCHED', 'AWAITING_CUSTOMER', 'PURCHASING'].includes(o.status);
    if (filter === 'completed') return ['BOOKED', 'EXPIRED', 'CANCELLED', 'FAILED'].includes(o.status);
    return true;
  });

  const fmt = (n: number, c = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-white">My Limit Orders</h1>
          <p className="text-slate-500 text-sm mt-0.5">Set your price criteria and let FareMind find the perfect fare</p>
        </div>
        <Link href="/account/limit-orders/create"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] transition-all shadow-lg shadow-[#1ABC9C]/20">
          <Plus size={14} />
          Create Limit Order
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-5">
        {(['all', 'active', 'completed'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${filter === f
              ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
              : 'bg-white/[0.04] text-slate-500 border border-white/[0.08] hover:text-white hover:bg-white/[0.06]'
            }`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <button onClick={fetchOrders} className="ml-auto px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-500 hover:text-white transition-all">
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="text-[#1ABC9C] animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
            <Target size={24} className="text-slate-600" />
          </div>
          <p className="text-white font-bold mb-1">No limit orders yet</p>
          <p className="text-slate-500 text-sm mb-5 max-w-sm">
            Create a limit order to set your ideal fare criteria. We'll monitor prices and notify you when a match is found.
          </p>
          <Link href="/account/limit-orders/create"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] transition-all">
            <Plus size={14} />
            Create Your First Limit Order
          </Link>
        </div>
      )}

      {/* Orders List */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((order, i) => {
            const sc = STATUS_CONFIG[order.status] || STATUS_CONFIG.DRAFT;
            const isActionable = ['ACTIVE', 'MONITORING', 'MATCHED', 'AWAITING_CUSTOMER'].includes(order.status);
            const isPaused = order.status === 'DRAFT';

            return (
              <motion.div key={order.id}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 hover:border-white/[0.12] transition-all cursor-pointer group"
                onClick={() => router.push(`/account/limit-orders/${order.id}`)}>

                {/* Top row: Route + Status */}
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-white font-black text-lg">{order.origin}</span>
                    <Plane size={12} className="text-[#1ABC9C] rotate-90" />
                    <span className="text-white font-black text-lg">{order.destination}</span>
                    {order.tripType === 'ROUND_TRIP' && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-white/[0.06] text-slate-400">ROUND</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${sc.bg} ${sc.color} border ${sc.border}`}>
                      {sc.label}
                    </span>
                    <ChevronRight size={14} className="text-slate-600 group-hover:text-white/40 transition-colors" />
                  </div>
                </div>

                {/* Details row */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <DollarSign size={11} className="text-[#1ABC9C]" />
                    {fmt(Number(order.minFare))} – {fmt(Number(order.maxFare))}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock size={11} />
                    {fmtDate(order.departureDate)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Plane size={11} />
                    {CABIN_LABELS[order.cabinClass] || order.cabinClass}
                  </span>
                  <span className={`flex items-center gap-1.5 ${order.executionMode === 'AUTO_PURCHASE' ? 'text-cyan-400' : 'text-amber-400'}`}>
                    {order.executionMode === 'AUTO_PURCHASE' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                    {order.executionMode === 'AUTO_PURCHASE' ? 'Auto-Purchase' : 'Notify Only'}
                  </span>
                  {order._count?.matches ? (
                    <span className="flex items-center gap-1.5 text-emerald-400">
                      <Eye size={11} />
                      {order._count.matches} match{order._count.matches > 1 ? 'es' : ''}
                    </span>
                  ) : null}
                  {order.expiresAt && (
                    <span className="text-slate-500">
                      Expires {fmtDate(order.expiresAt)}
                    </span>
                  )}
                </div>

                {/* Actions */}
                {(isActionable || isPaused) && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-white/[0.06]" onClick={e => e.stopPropagation()}>
                    {isActionable && (
                      <button onClick={() => handleAction(order.id, 'pause')}
                        disabled={actionLoading === order.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-400 text-[11px] font-bold hover:text-amber-400 hover:border-amber-400/30 transition-all">
                        {actionLoading === order.id ? <Loader2 size={10} className="animate-spin" /> : <Pause size={10} />}
                        Pause
                      </button>
                    )}
                    {isPaused && order.status === 'DRAFT' && (
                      <button onClick={() => handleAction(order.id, 'resume')}
                        disabled={actionLoading === order.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 text-[#1ABC9C] text-[11px] font-bold hover:bg-[#1ABC9C]/20 transition-all">
                        {actionLoading === order.id ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                        Resume
                      </button>
                    )}
                    <button onClick={() => handleAction(order.id, 'cancel')}
                      disabled={actionLoading === order.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-500 text-[11px] font-bold hover:text-red-400 hover:border-red-400/30 transition-all">
                      <XCircle size={10} />
                      Cancel
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
