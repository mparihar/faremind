'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import {
  RefreshCw, Search, MessageSquare, Clock, Inbox, CheckCircle2,
  ArrowUpCircle, XCircle, Phone, Mail, User, AlertTriangle, Ticket,
  Plane, ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

interface AgentTicket {
  id: string;
  ticketNumber: string | null;
  sequenceNumber: number | null;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  channel: string;
  bookingRef: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

const STATUS_CFG: Record<TicketStatus, { label: string; cls: string; icon: React.ElementType }> = {
  OPEN:              { label: 'Open',          cls: 'bg-blue-400/15 text-blue-400',       icon: Inbox },
  IN_PROGRESS:       { label: 'In Progress',   cls: 'bg-amber-400/15 text-amber-400',     icon: Clock },
  WAITING_CUSTOMER:  { label: 'Waiting',       cls: 'bg-purple-400/15 text-purple-400',   icon: User },
  ESCALATED:         { label: 'Escalated',     cls: 'bg-red-400/15 text-red-400',         icon: ArrowUpCircle },
  RESOLVED:          { label: 'Resolved',      cls: 'bg-emerald-400/15 text-emerald-400', icon: CheckCircle2 },
  CLOSED:            { label: 'Closed',        cls: 'bg-slate-400/15 text-slate-400',     icon: XCircle },
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  LOW:    'bg-slate-400/15 text-slate-400 border-slate-400/20',
  MEDIUM: 'bg-blue-400/15 text-blue-400 border-blue-400/20',
  HIGH:   'bg-amber-400/15 text-amber-400 border-amber-400/20',
  URGENT: 'bg-red-400/15 text-red-400 border-red-400/20',
};

function getTicketNum(t: AgentTicket): string {
  if (t.ticketNumber) return t.ticketNumber;
  if (t.sequenceNumber) return `FM-TKT-${String(t.sequenceNumber).padStart(4, '0')}`;
  return t.id.slice(-6).toUpperCase();
}

export default function AgentSupportTicketsPage() {
  const router = useRouter();
  const { sessionToken } = useAuthStore();
  const [tickets, setTickets] = useState<AgentTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/support-tickets', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    if (sessionToken) fetchTickets();
  }, [sessionToken]);

  const filtered = tickets.filter(t => {
    if (statusFilter && t.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (t.ticketNumber?.toLowerCase().includes(q) ?? false) ||
        t.subject.toLowerCase().includes(q) ||
        t.customerName.toLowerCase().includes(q) ||
        t.customerEmail.toLowerCase().includes(q) ||
        (t.bookingRef?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  const stats = {
    open: tickets.filter(t => t.status === 'OPEN').length,
    inProgress: tickets.filter(t => t.status === 'IN_PROGRESS').length,
    resolved: tickets.filter(t => ['RESOLVED', 'CLOSED'].includes(t.status)).length,
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1ABC9C]/15 flex items-center justify-center">
              <Ticket size={20} className="text-[#1ABC9C]" />
            </div>
            Support Tickets
          </h1>
          <p className="text-slate-400 text-sm mt-1 ml-[52px]">
            Customer support cases · {tickets.length} total
          </p>
        </div>
        <button
          onClick={fetchTickets}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm font-semibold hover:bg-slate-700"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 cursor-pointer hover:brightness-110 transition-all"
             onClick={() => setStatusFilter(statusFilter === 'OPEN' ? '' : 'OPEN')}>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Open</p>
          <p className="text-2xl font-black text-blue-400 mt-1">{stats.open}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 cursor-pointer hover:brightness-110 transition-all"
             onClick={() => setStatusFilter(statusFilter === 'IN_PROGRESS' ? '' : 'IN_PROGRESS')}>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">In Progress</p>
          <p className="text-2xl font-black text-amber-400 mt-1">{stats.inProgress}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 cursor-pointer hover:brightness-110 transition-all"
             onClick={() => setStatusFilter(statusFilter === 'RESOLVED' ? '' : 'RESOLVED')}>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Resolved</p>
          <p className="text-2xl font-black text-emerald-400 mt-1">{stats.resolved}</p>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by ticket #, subject, customer, booking ref…"
            className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as TicketStatus | '')}
          className="px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
        >
          <option value="">All Statuses</option>
          {(Object.keys(STATUS_CFG) as TicketStatus[]).map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700/50">
              {['Ticket #', 'Subject', 'Customer', 'Category', 'Priority', 'Status', 'Messages', 'Created'].map(h => (
                <th key={h} className="px-5 py-3.5 text-left text-xs font-black text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {loading ? (
              <tr><td colSpan={8} className="px-5 py-12 text-center">
                <RefreshCw size={20} className="text-[#1ABC9C] animate-spin mx-auto" />
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-12 text-center text-slate-500">No tickets found</td></tr>
            ) : (
              filtered.map(ticket => {
                const cfg = STATUS_CFG[ticket.status] || STATUS_CFG.OPEN;
                const StIcon = cfg.icon;
                return (
                  <tr
                    key={ticket.id}
                    className="hover:bg-white/[0.02] transition-colors cursor-pointer"
                    onClick={() => router.push(`/agent/support-tickets/${ticket.id}`)}
                  >
                    <td className="px-5 py-4">
                      <span className="font-bold text-sm font-mono text-[#1ABC9C]">{getTicketNum(ticket)}</span>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-white font-semibold text-sm truncate max-w-[240px]">{ticket.subject}</p>
                    </td>
                    <td className="px-5 py-4">
                      <div>
                        <p className="text-white text-sm font-semibold">{ticket.customerName}</p>
                        <p className="text-slate-500 text-xs">{ticket.customerEmail}</p>
                        {ticket.customerPhone && (
                          <p className="text-slate-500 text-xs flex items-center gap-1 mt-0.5">
                            <Phone size={9} /> {ticket.customerPhone}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {ticket.category === 'Cancellation Request' || ticket.category === 'Cancellation' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/10 text-red-400 border border-red-400/20">
                          <XCircle size={10} /> {ticket.category}
                        </span>
                      ) : ticket.category === 'Flight Change Request' || ticket.category === 'Change Request' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-purple-500/10 text-purple-400 border border-purple-400/20">
                          <Plane size={10} /> {ticket.category}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-sm">{ticket.category}</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${PRIORITY_STYLES[ticket.priority]}`}>
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${cfg.cls}`}>
                        <StIcon size={10} /> {cfg.label}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <MessageSquare size={12} />
                        <span className="text-sm font-semibold">{ticket.messageCount}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-400 text-sm">
                      {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
