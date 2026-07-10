'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Ticket, Loader2, RefreshCw, Clock, CheckCircle2, AlertTriangle,
  Eye, ExternalLink, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface PendingTicket {
  id: string;
  bookingReference: string;
  mystiflyMfRef: string | null;
  status: string;
  ticketingStatus: string;
  primaryProvider: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  passengers: { firstName: string; lastName: string }[];
  pnrs: { providerPnr: string }[];
}

const STATUS_STYLES: Record<string, string> = {
  'TICKETING_PENDING': 'bg-amber-400/15 text-amber-400 border-amber-400/20',
  'TICKETED': 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
  'FAILED': 'bg-red-400/15 text-red-400 border-red-400/20',
  'CONFIRMED': 'bg-blue-400/15 text-blue-400 border-blue-400/20',
};

export default function AgentTicketQueuePage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<PendingTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const fetchPending = async () => {
    try {
      const res = await fetch('/api/agent/ticket-queue');
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } catch {}
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { fetchPending(); }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchPending();
  };

  const handleCheckStatus = async (ticket: PendingTicket) => {
    if (!ticket.mystiflyMfRef) return;
    setCheckingId(ticket.id);
    try {
      const res = await fetch(`${BACKEND_URL}/api/mystifly/ticket-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uniqueId: ticket.mystiflyMfRef }),
      });
      const data = await res.json();
      // Refresh the list to reflect any status changes
      await fetchPending();
    } catch {}
    setCheckingId(null);
  };

  const fmt = (n: number, c = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);

  const timeAgo = (dateStr: string) => {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

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
            Bookings waiting for ticket issuance
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm font-semibold hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pending</p>
          <p className="text-2xl font-black text-amber-400 mt-1">{tickets.filter(t => t.ticketingStatus === 'TICKETING_PENDING').length}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mystifly</p>
          <p className="text-2xl font-black text-white mt-1">{tickets.filter(t => t.primaryProvider === 'MYSTIFLY').length}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Value</p>
          <p className="text-2xl font-black text-[#1ABC9C] mt-1">{fmt(tickets.reduce((s, t) => s + t.totalAmount, 0))}</p>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-slate-500" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-20">
          <CheckCircle2 size={40} className="text-emerald-400/30 mx-auto mb-3" />
          <p className="text-slate-400 text-sm font-semibold">No pending tickets</p>
          <p className="text-slate-500 text-xs mt-1">All bookings are fully ticketed</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((ticket, i) => (
            <motion.div
              key={ticket.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 hover:bg-slate-800/60 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                  {/* Status indicator */}
                  <div className="w-2 h-12 rounded-full bg-amber-400/40" />

                  <div className="flex-1 grid grid-cols-1 md:grid-cols-5 gap-3">
                    {/* Reference */}
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Reference</p>
                      <p className="text-sm font-black text-white">{ticket.bookingReference}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{ticket.pnrs?.[0]?.providerPnr || '—'}</p>
                    </div>

                    {/* Passengers */}
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Passengers</p>
                      <p className="text-sm font-semibold text-white">
                        {ticket.passengers?.[0] ? `${ticket.passengers[0].firstName} ${ticket.passengers[0].lastName}` : '—'}
                      </p>
                      {ticket.passengers?.length > 1 && (
                        <p className="text-[10px] text-slate-500">+{ticket.passengers.length - 1} more</p>
                      )}
                    </div>

                    {/* Provider */}
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Provider</p>
                      <p className="text-sm font-semibold text-white">{ticket.primaryProvider}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{ticket.mystiflyMfRef || '—'}</p>
                    </div>

                    {/* Amount */}
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Amount</p>
                      <p className="text-sm font-black text-[#1ABC9C]">{fmt(ticket.totalAmount, ticket.currency)}</p>
                    </div>

                    {/* Time */}
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Created</p>
                      <p className="text-sm font-semibold text-white flex items-center gap-1">
                        <Clock size={10} className="text-slate-500" /> {timeAgo(ticket.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 ml-4">
                  {ticket.mystiflyMfRef && (
                    <button
                      onClick={() => handleCheckStatus(ticket)}
                      disabled={checkingId === ticket.id}
                      className="flex items-center gap-1.5 px-3 py-2 bg-amber-400/10 border border-amber-400/20 rounded-xl text-amber-400 text-xs font-bold hover:bg-amber-400/20 disabled:opacity-50"
                    >
                      {checkingId === ticket.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      Check
                    </button>
                  )}
                  <button
                    onClick={() => router.push(`/agent/booking-workspace?ref=${ticket.bookingReference}`)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-slate-300 text-xs font-bold hover:text-white hover:bg-white/10"
                  >
                    <Eye size={12} /> View
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
