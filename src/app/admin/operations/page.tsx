'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  RefreshCw, Ticket, AlertTriangle, Clock, CheckCircle2,
  ArrowRight, Activity, XCircle, ShieldAlert,
} from 'lucide-react';

interface OperationsStats {
  ticketingPending: number;
  ticketingEscalated: number;
  providerErrors24h: number;
  failedBookings24h: number;
  activeBookings: number;
}

export default function OperationsPage() {
  const router = useRouter();
  const [stats, setStats] = useState<OperationsStats | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadStats() {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/operations/stats');
      if (res.status === 401) { router.replace('/admin/login'); return; }
      const data = await res.json();
      setStats(data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadStats(); }, []);

  const cards = [
    {
      title: 'Pending Tickets',
      value: stats?.ticketingPending ?? 0,
      subtitle: 'Awaiting confirmation',
      icon: Ticket,
      color: 'amber',
      href: '/admin/operations/ticket-queue',
      urgent: (stats?.ticketingPending ?? 0) > 0,
    },
    {
      title: 'Escalated',
      value: stats?.ticketingEscalated ?? 0,
      subtitle: 'Requires manual review',
      icon: ShieldAlert,
      color: 'red',
      href: '/admin/operations/ticket-queue?filter=escalated',
      urgent: (stats?.ticketingEscalated ?? 0) > 0,
    },
    {
      title: 'Provider Errors (24h)',
      value: stats?.providerErrors24h ?? 0,
      subtitle: 'API failures',
      icon: AlertTriangle,
      color: 'orange',
      href: '/admin/operations/provider-errors',
      urgent: false,
    },
    {
      title: 'Failed Bookings (24h)',
      value: stats?.failedBookings24h ?? 0,
      subtitle: 'Customer-facing failures',
      icon: XCircle,
      color: 'red',
      href: '/admin/failed-bookings',
      urgent: false,
    },
    {
      title: 'Active Bookings',
      value: stats?.activeBookings ?? 0,
      subtitle: 'Confirmed or in progress',
      icon: Activity,
      color: 'emerald',
      href: '/admin/bookings',
      urgent: false,
    },
  ];

  const colorMap: Record<string, { bg: string; border: string; text: string; iconBg: string }> = {
    amber:   { bg: 'bg-amber-400/5',   border: 'border-amber-400/20',   text: 'text-amber-400',   iconBg: 'bg-amber-400/15' },
    red:     { bg: 'bg-red-400/5',     border: 'border-red-400/20',     text: 'text-red-400',     iconBg: 'bg-red-400/15' },
    orange:  { bg: 'bg-orange-400/5',  border: 'border-orange-400/20',  text: 'text-orange-400',  iconBg: 'bg-orange-400/15' },
    emerald: { bg: 'bg-emerald-400/5', border: 'border-emerald-400/20', text: 'text-emerald-400', iconBg: 'bg-emerald-400/15' },
    blue:    { bg: 'bg-blue-400/5',    border: 'border-blue-400/20',    text: 'text-blue-400',    iconBg: 'bg-blue-400/15' },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1ABC9C]/15 flex items-center justify-center">
              <Activity size={20} className="text-[#1ABC9C]" />
            </div>
            Operations
          </h1>
          <p className="text-slate-400 text-sm mt-1 ml-[52px]">
            Booking operations, ticketing, and provider monitoring
          </p>
        </div>
        <button
          onClick={loadStats}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(card => {
          const Icon = card.icon;
          const c = colorMap[card.color] || colorMap.blue;
          return (
            <button
              key={card.title}
              onClick={() => router.push(card.href)}
              className={`${c.bg} border ${c.border} rounded-2xl p-5 text-left hover:scale-[1.02] transition-all group relative overflow-hidden`}
            >
              {card.urgent && card.value > 0 && (
                <div className="absolute top-3 right-3">
                  <span className="relative flex h-3 w-3">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c.iconBg} opacity-75`} />
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${c.iconBg}`} />
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl ${c.iconBg} flex items-center justify-center`}>
                  <Icon size={20} className={c.text} />
                </div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">{card.title}</p>
              </div>
              <p className="text-3xl font-black text-white mb-1">{card.value}</p>
              <div className="flex items-center justify-between">
                <p className={`${c.text} text-xs`}>{card.subtitle}</p>
                <ArrowRight size={14} className="text-slate-500 group-hover:text-white transition-colors" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
