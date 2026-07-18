'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Plane, DollarSign, Clock, Target, Bell, Zap,
  CheckCircle2, XCircle, Pause, Play, AlertTriangle, Loader2,
  Eye, Calendar, CreditCard, Shield, Activity, ChevronDown,
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

const CABIN_LABELS: Record<string, string> = {
  ECONOMY: 'Economy', PREMIUM_ECONOMY: 'Premium Economy', BUSINESS: 'Business', FIRST: 'First',
};

const EVENT_ICONS: Record<string, any> = {
  CREATED: Calendar, ACTIVATED: Play, MATCHED: CheckCircle2, PAUSED: Pause,
  RESUMED: Play, CANCELLED: XCircle, PURCHASE_ATTEMPTED: CreditCard,
  PURCHASE_SUCCEEDED: CheckCircle2, PURCHASE_FAILED: AlertTriangle,
  NOTIFIED: Bell, UPDATED: Target, PAYMENT_AUTHORIZED: Shield,
  SUPPORT_TICKET_CREATED: AlertTriangle, EXPIRED: Clock,
};

export default function LimitOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);

  const fetchOrder = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BACKEND}/api/limit-orders/${id}`);
      const data = await res.json();
      if (data.success) setOrder(data.order);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);

  const handleAction = async (action: string) => {
    setActionLoading(action);
    try {
      await fetch(`${BACKEND}/api/limit-orders/${id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      await fetchOrder();
    } catch { /* ignore */ } finally {
      setActionLoading(null);
    }
  };

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtTime = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={24} className="text-[#1ABC9C] animate-spin" />
    </div>
  );

  if (!order) return (
    <div className="text-center py-20">
      <p className="text-white font-bold">Order not found</p>
      <Link href="/account/limit-orders" className="text-[#1ABC9C] text-sm mt-2 inline-block">← Back to Limit Orders</Link>
    </div>
  );

  const sc = STATUS_CONFIG[order.status] || STATUS_CONFIG.DRAFT;
  const isActionable = ['ACTIVE', 'MONITORING', 'MATCHED', 'AWAITING_CUSTOMER'].includes(order.status);
  const isPaused = order.status === 'DRAFT' && order.pausedAt;
  const events = order.events || [];
  const matches = order.matches || [];
  const visibleEvents = showAllEvents ? events : events.slice(0, 8);

  return (
    <div className="max-w-3xl">
      {/* Back */}
      <Link href="/account/limit-orders" className="flex items-center gap-2 text-slate-500 text-sm hover:text-white transition-colors mb-5">
        <ArrowLeft size={14} /> Back to Limit Orders
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-black text-white">{order.origin} → {order.destination}</h1>
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${sc.bg} ${sc.color} border ${sc.border}`}>
              {sc.label}
            </span>
          </div>
          <p className="text-slate-500 text-sm">
            {order.tripType === 'ROUND_TRIP' ? 'Round Trip' : 'One Way'} · Created {fmtDate(order.createdAt)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {isActionable && (
            <button onClick={() => handleAction('pause')} disabled={!!actionLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-400 text-xs font-bold hover:text-amber-400 hover:border-amber-400/30 transition-all">
              {actionLoading === 'pause' ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />} Pause
            </button>
          )}
          {isPaused && (
            <button onClick={() => handleAction('resume')} disabled={!!actionLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 text-[#1ABC9C] text-xs font-bold hover:bg-[#1ABC9C]/20 transition-all">
              {actionLoading === 'resume' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Resume
            </button>
          )}
          {!['BOOKED', 'CANCELLED', 'EXPIRED'].includes(order.status) && (
            <button onClick={() => handleAction('cancel')} disabled={!!actionLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-500 text-xs font-bold hover:text-red-400 hover:border-red-400/30 transition-all">
              <XCircle size={12} /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* Order Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Fare */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign size={14} className="text-[#1ABC9C]" />
            <h3 className="text-white font-bold text-sm">Fare Range</h3>
          </div>
          <p className="text-white text-xl font-black">{fmt(Number(order.minFare))} – {fmt(Number(order.maxFare))}</p>
          <p className="text-slate-500 text-xs mt-1">{CABIN_LABELS[order.cabinClass] || order.cabinClass}</p>
        </div>

        {/* Schedule */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={14} className="text-[#1ABC9C]" />
            <h3 className="text-white font-bold text-sm">Travel Date</h3>
          </div>
          <p className="text-white text-xl font-black">{fmtDate(order.departureDate)}</p>
          <p className="text-slate-500 text-xs mt-1">
            {order.expiresAt ? `Expires ${fmtDate(order.expiresAt)}` : 'No expiration'}
            {order.maxDurationMinutes ? ` · Max ${order.maxDurationMinutes / 60}h` : ''}
          </p>
        </div>

        {/* Execution */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            {order.executionMode === 'AUTO_PURCHASE' ? <Zap size={14} className="text-cyan-400" /> : <Bell size={14} className="text-amber-400" />}
            <h3 className="text-white font-bold text-sm">Execution Mode</h3>
          </div>
          <p className={`text-xl font-black ${order.executionMode === 'AUTO_PURCHASE' ? 'text-cyan-400' : 'text-amber-400'}`}>
            {order.executionMode === 'AUTO_PURCHASE' ? 'Auto-Purchase' : 'Notify Only'}
          </p>
          <p className="text-slate-500 text-xs mt-1">
            {order.cardLast4 ? `Card ****${order.cardLast4}` : 'No payment method'}
          </p>
        </div>

        {/* Stats */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={14} className="text-[#1ABC9C]" />
            <h3 className="text-white font-bold text-sm">Activity</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-white text-lg font-black">{order._count?.matches || 0}</p>
              <p className="text-slate-500 text-[10px] uppercase tracking-wider">Matches</p>
            </div>
            <div>
              <p className="text-white text-lg font-black">{order._count?.events || 0}</p>
              <p className="text-slate-500 text-[10px] uppercase tracking-wider">Events</p>
            </div>
          </div>
        </div>
      </div>

      {/* Matches */}
      {matches.length > 0 && (
        <div className="mb-6">
          <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
            <Eye size={14} className="text-[#1ABC9C]" /> Matches ({matches.length})
          </h3>
          <div className="space-y-2">
            {matches.map((m: any) => (
              <div key={m.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 flex items-center gap-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  m.action === 'AUTO_PURCHASED' ? 'bg-green-500/15 text-green-400'
                  : m.action === 'NOTIFIED' ? 'bg-amber-500/15 text-amber-400'
                  : m.action === 'SKIPPED' ? 'bg-red-500/15 text-red-400'
                  : 'bg-slate-500/15 text-slate-400'
                }`}>
                  {m.action === 'AUTO_PURCHASED' ? <CheckCircle2 size={14} /> : m.action === 'NOTIFIED' ? <Bell size={14} /> : <XCircle size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-bold">{fmt(Number(m.matchedFare))} · {m.matchedAirline || 'Multiple'} · {m.matchedCabin}</p>
                  <p className="text-slate-500 text-xs">{m.matchSource === 'LIVE_SEARCH' ? 'Live Search' : 'Scheduler'} · {m.matchedProvider} · {fmtTime(m.createdAt)}</p>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  m.action === 'AUTO_PURCHASED' ? 'bg-green-500/10 text-green-400'
                  : m.action === 'NOTIFIED' ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-red-500/10 text-red-400'
                }`}>{m.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Event Timeline */}
      <div>
        <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
          <Clock size={14} className="text-[#1ABC9C]" /> Activity Timeline
        </h3>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-white/[0.06]" />

          <div className="space-y-0">
            {visibleEvents.map((evt: any, i: number) => {
              const Icon = EVENT_ICONS[evt.eventType] || Activity;
              return (
                <motion.div key={evt.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  className="relative flex gap-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0 z-10">
                    <Icon size={12} className="text-slate-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-semibold">{evt.eventTitle}</p>
                    {evt.eventDescription && <p className="text-slate-500 text-xs mt-0.5">{evt.eventDescription}</p>}
                    <p className="text-slate-600 text-[10px] mt-0.5">{fmtTime(evt.createdAt)} · {evt.actorType}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {events.length > 8 && !showAllEvents && (
            <button onClick={() => setShowAllEvents(true)}
              className="flex items-center gap-1.5 ml-12 mt-2 text-[#1ABC9C] text-xs font-bold hover:underline">
              <ChevronDown size={12} /> Show all {events.length} events
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
