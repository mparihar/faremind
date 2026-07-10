'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  RefreshCw, Clock, AlertTriangle, CheckCircle2, XCircle,
  ArrowRight, Eye, RotateCcw, ChevronDown, Timer, Ticket,
} from 'lucide-react';
import { format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReconRecord {
  id: string;
  bookingId: string;
  provider: string;
  providerUniqueId: string;
  status: string;
  pollCount: number;
  lastPollAt: string | null;
  nextPollAt: string | null;
  lastProviderStatus: string | null;
  ticketNumbers: string[];
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  escalatedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  booking: {
    masterBookingReference: string;
    customerEmail: string;
    customerName: string;
    totalAmount: number;
    currency: string;
    primaryProvider: string;
  };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  PENDING:        { label: 'Pending',         color: 'bg-amber-400/15 text-amber-400 border-amber-400/20',   icon: Clock },
  POLLING:        { label: 'Polling...',      color: 'bg-blue-400/15 text-blue-400 border-blue-400/20',     icon: RefreshCw },
  TICKETED:       { label: 'Ticketed',        color: 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20', icon: CheckCircle2 },
  NOT_BOOKED:     { label: 'Not Booked',      color: 'bg-red-400/15 text-red-400 border-red-400/20',        icon: XCircle },
  MANUAL_REVIEW:  { label: 'Manual Review',   color: 'bg-orange-400/15 text-orange-400 border-orange-400/20', icon: Eye },
  ESCALATED:      { label: 'Escalated',       color: 'bg-red-500/15 text-red-500 border-red-500/20',        icon: AlertTriangle },
  RESOLVED:       { label: 'Resolved',        color: 'bg-slate-400/15 text-slate-400 border-slate-400/20',  icon: CheckCircle2 },
  FAILED:         { label: 'Failed',          color: 'bg-red-400/15 text-red-400 border-red-400/20',        icon: XCircle },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function TicketQueuePage() {
  const router = useRouter();
  const [records, setRecords] = useState<ReconRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'escalated'>('all');

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/operations/ticket-queue');
      if (res.status === 401) { router.replace('/admin/login'); return; }
      const data = await res.json();
      setRecords(data.records || []);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(loadQueue, 30000);
    return () => clearInterval(interval);
  }, [loadQueue]);

  const filteredRecords = records.filter(r => {
    if (filter === 'pending') return ['PENDING', 'POLLING'].includes(r.status);
    if (filter === 'escalated') return ['ESCALATED', 'MANUAL_REVIEW'].includes(r.status);
    return true;
  });

  const handleRetry = async (id: string) => {
    setRetrying(id);
    try {
      await adminFetch('/api/admin/operations/ticket-queue/retry', {
        method: 'POST',
        body: JSON.stringify({ reconciliationId: id }),
      });
      await loadQueue();
    } catch {}
    setRetrying(null);
  };

  const handleResolve = async (id: string, resolution: 'TICKETED' | 'NOT_BOOKED') => {
    setResolving(id);
    try {
      await adminFetch('/api/admin/operations/ticket-queue/resolve', {
        method: 'POST',
        body: JSON.stringify({ reconciliationId: id, resolution }),
      });
      await loadQueue();
    } catch {}
    setResolving(null);
  };

  // ─── Stats ──────────────────────────────────────────────────────────────
  const pendingCount = records.filter(r => ['PENDING', 'POLLING'].includes(r.status)).length;
  const escalatedCount = records.filter(r => ['ESCALATED', 'MANUAL_REVIEW'].includes(r.status)).length;
  const resolvedCount = records.filter(r => ['TICKETED', 'NOT_BOOKED', 'RESOLVED'].includes(r.status)).length;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400/15 flex items-center justify-center">
              <Ticket size={20} className="text-amber-400" />
            </div>
            Pending Ticket Queue
          </h1>
          <p className="text-slate-400 text-sm mt-1 ml-[52px]">
            Bookings awaiting ticketing confirmation from Mystifly
          </p>
        </div>
        <button
          onClick={loadQueue}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <button
          onClick={() => setFilter('pending')}
          className={`p-4 rounded-2xl border transition-all text-left ${
            filter === 'pending'
              ? 'bg-amber-400/10 border-amber-400/30'
              : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600/50'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-amber-400" />
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pending</p>
          </div>
          <p className="text-2xl font-black text-white">{pendingCount}</p>
        </button>

        <button
          onClick={() => setFilter('escalated')}
          className={`p-4 rounded-2xl border transition-all text-left ${
            filter === 'escalated'
              ? 'bg-red-400/10 border-red-400/30'
              : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600/50'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-red-400" />
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Escalated</p>
          </div>
          <p className="text-2xl font-black text-white">{escalatedCount}</p>
        </button>

        <button
          onClick={() => setFilter('all')}
          className={`p-4 rounded-2xl border transition-all text-left ${
            filter === 'all'
              ? 'bg-emerald-400/10 border-emerald-400/30'
              : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600/50'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">All Records</p>
          </div>
          <p className="text-2xl font-black text-white">{records.length}</p>
        </button>
      </div>

      {/* Queue Table */}
      {loading && records.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="text-center py-20">
          <CheckCircle2 size={40} className="text-emerald-400 mx-auto mb-3 opacity-50" />
          <p className="text-slate-400 font-semibold">No records in this view</p>
          <p className="text-slate-500 text-sm mt-1">All bookings are properly ticketed</p>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50">
                {['Status', 'MFRef', 'Booking', 'Customer', 'Amount', 'Polls', 'Last Poll', 'Provider Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map(r => {
                const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.PENDING;
                const StatusIcon = cfg.icon;
                return (
                  <tr key={r.id} className="border-b border-slate-700/30 hover:bg-white/[0.02] transition-all">
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${cfg.color}`}>
                        <StatusIcon size={12} />
                        {cfg.label}
                      </span>
                    </td>

                    {/* MFRef */}
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono text-[#1ABC9C] bg-[#1ABC9C]/10 px-2 py-0.5 rounded">
                        {r.providerUniqueId}
                      </code>
                    </td>

                    {/* Booking */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => router.push(`/admin/bookings/${r.bookingId}`)}
                        className="text-blue-400 hover:text-blue-300 font-semibold text-xs transition-colors"
                      >
                        {r.booking.masterBookingReference}
                      </button>
                    </td>

                    {/* Customer */}
                    <td className="px-4 py-3">
                      <p className="text-white text-xs font-semibold">{r.booking.customerName}</p>
                      <p className="text-slate-400 text-[11px]">{r.booking.customerEmail}</p>
                    </td>

                    {/* Amount */}
                    <td className="px-4 py-3 text-white text-xs font-semibold">
                      ${r.booking.totalAmount?.toFixed(2)} {r.booking.currency}
                    </td>

                    {/* Polls */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Timer size={12} className="text-slate-400" />
                        <span className="text-slate-300 text-xs font-bold">{r.pollCount}/7</span>
                      </div>
                    </td>

                    {/* Last Poll */}
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {r.lastPollAt ? format(new Date(r.lastPollAt), 'HH:mm:ss') : '—'}
                    </td>

                    {/* Provider Status */}
                    <td className="px-4 py-3">
                      <span className="text-slate-300 text-xs font-mono">{r.lastProviderStatus || '—'}</span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {['PENDING', 'POLLING', 'ESCALATED', 'MANUAL_REVIEW'].includes(r.status) && (
                          <>
                            <button
                              onClick={() => handleRetry(r.id)}
                              disabled={retrying === r.id}
                              className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all"
                              title="Retry poll"
                            >
                              <RotateCcw size={14} className={retrying === r.id ? 'animate-spin' : ''} />
                            </button>
                            <button
                              onClick={() => handleResolve(r.id, 'TICKETED')}
                              disabled={resolving === r.id}
                              className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all"
                              title="Resolve as Ticketed"
                            >
                              <CheckCircle2 size={14} />
                            </button>
                            <button
                              onClick={() => handleResolve(r.id, 'NOT_BOOKED')}
                              disabled={resolving === r.id}
                              className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                              title="Resolve as Not Booked"
                            >
                              <XCircle size={14} />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => router.push(`/admin/bookings/${r.bookingId}`)}
                          className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                          title="View booking"
                        >
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
