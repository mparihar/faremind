'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch, useAdminStore } from '@/store/useAdminStore';
import {
  RefreshCw, Search, MessageSquare, Clock, User, AlertTriangle,
  CheckCircle2, ArrowUpCircle, Inbox, ChevronRight, ChevronDown, ChevronUp,
  Phone, Mail, XCircle, Trash2, Pencil, Plane, DollarSign, Users, ShieldAlert,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

interface SupportTicket {
  id: string;
  ticketNumber?: string | null;
  sequenceNumber?: number | null;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  category: string;
  channel?: string;
  urgency?: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  bookingRef?: string | null;
  airlinePnr?: string | null;
  assignedTo?: string | null;
  assignedToId?: string | null;
  failureAuditId?: string | null;
  failureAudit?: any;
  whatsappNumberUsed?: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface AdminUser {
  id: string;
  fullName: string;
  role: string;
}

const CATEGORIES = [
  'All Categories',
  'Failed Booking',
  'Booking Issue',
  'Payment Problem',
  'Cancellation',
  'Change Request',
  'Baggage Claim',
  'Refund Query',
  'Technical Issue',
  'Account Access',
  'General Inquiry',
];

const ERROR_CODE_LABELS: Record<string, { label: string; color: string }> = {
  PROVIDER_ORDER_FAILED:    { label: 'Provider Failed',  color: 'bg-red-500/15 text-red-400' },
  PASSENGER_COUNT_MISMATCH: { label: 'Pax Mismatch',     color: 'bg-amber-500/15 text-amber-400' },
  UNEXPECTED_ERROR:         { label: 'Unexpected',        color: 'bg-purple-500/15 text-purple-400' },
  MISSING_PAYMENT:          { label: 'Missing Payment',   color: 'bg-orange-500/15 text-orange-400' },
  MISSING_OFFER_ID:         { label: 'Missing Offer',     color: 'bg-yellow-500/15 text-yellow-400' },
  PROVIDER_NOT_CONFIGURED:  { label: 'Not Configured',    color: 'bg-slate-500/15 text-slate-400' },
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  LOW:    'bg-slate-400/15 text-slate-400 border-slate-400/20',
  MEDIUM: 'bg-blue-400/15 text-blue-400 border-blue-400/20',
  HIGH:   'bg-amber-400/15 text-amber-400 border-amber-400/20',
  URGENT: 'bg-red-400/15 text-red-400 border-red-400/20',
};

const STATUS_STYLES: Record<TicketStatus, { cls: string; icon: React.ElementType }> = {
  OPEN:              { cls: 'bg-blue-400/15 text-blue-400',    icon: Inbox },
  IN_PROGRESS:       { cls: 'bg-amber-400/15 text-amber-400', icon: Clock },
  WAITING_CUSTOMER:  { cls: 'bg-purple-400/15 text-purple-400', icon: User },
  ESCALATED:         { cls: 'bg-red-400/15 text-red-400',     icon: ArrowUpCircle },
  RESOLVED:          { cls: 'bg-emerald-400/15 text-emerald-400', icon: CheckCircle2 },
  CLOSED:            { cls: 'bg-slate-400/15 text-slate-400',  icon: XCircle },
};

// Use the persistent ticket number from DB, fallback to sequence-based
function formatTicketNumber(ticket: SupportTicket, index: number, total: number): string {
  if (ticket.ticketNumber) return ticket.ticketNumber;
  if (ticket.sequenceNumber) return `FM-TKT-${String(ticket.sequenceNumber).padStart(4, '0')}`;
  const num = total - index;
  return `FM-TKT-${String(num).padStart(4, '0')}`;
}

export default function SupportQueuePage() {
  const router = useRouter();
  const { user: adminUser } = useAdminStore();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [supportStaff, setSupportStaff] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isAdminOrSuper = adminUser?.role === 'SUPER_ADMIN' || adminUser?.role === 'OPS_ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ticketsRes, usersRes] = await Promise.all([
        adminFetch('/api/admin/support-tickets'),
        adminFetch('/api/admin/users')
      ]);

      if (ticketsRes.ok) {
        const json = await ticketsRes.json();
        setTickets(json.tickets || []);
      }
      
      if (usersRes.ok) {
        const json = await usersRes.json();
        const staff = (json.users || []).filter((u: any) => 
          ['SUPPORT', 'SUPER_ADMIN', 'OPS_ADMIN'].includes(u.role)
        );
        setSupportStaff(staff);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAssign = async (ticketId: string, assignedToId: string) => {
    try {
      const res = await adminFetch(`/api/admin/support-tickets/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify({ assignedToId: assignedToId || null })
      });
      if (res.ok) load();
    } catch (e) {
      console.error('Assignment failed', e);
    }
  };

  const handleDelete = async (ticketId: string) => {
    if (!confirm('Are you sure you want to delete this ticket? This action cannot be undone.')) return;
    setDeleting(ticketId);
    try {
      const res = await adminFetch(`/api/admin/support-tickets/${ticketId}`, { method: 'DELETE' });
      if (res.ok) load();
      else {
        const data = await res.json();
        alert(data.error || 'Failed to delete ticket');
      }
    } catch (e) {
      console.error('Delete failed', e);
    } finally {
      setDeleting(null);
    }
  };

  // Support staff default to "Assigned to Me"; admins see everything
  const isSupportOnly = adminUser?.role === 'SUPPORT';
  const [assigneeFilter, setAssigneeFilter] = useState<'ALL' | 'ME'>(isSupportOnly ? 'ME' : 'ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [createData, setCreateData] = useState({ subject: '', description: '', customerName: '', customerEmail: '', category: 'General Inquiry', priority: 'MEDIUM' as TicketPriority });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!createData.subject || !createData.description || !createData.customerName || !createData.customerEmail) {
      setError('All fields are required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const res = await adminFetch('/api/admin/support-tickets', {
        method: 'POST',
        body: JSON.stringify(createData)
      });
      if (res.ok) {
        setCreateOpen(false);
        setCreateData({ subject: '', description: '', customerName: '', customerEmail: '', category: 'General Inquiry', priority: 'MEDIUM' });
        load();
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to create ticket');
      }
    } catch (e) {
      setError('An error occurred');
    }
    setCreating(false);
  };

  const filtered = tickets.filter(t => {
    if (statusFilter && t.status !== statusFilter) return false;
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (categoryFilter && t.category !== categoryFilter) return false;
    if (assigneeFilter === 'ME' && t.assignedToId !== adminUser?.id) return false;
    if (search) {
      // Special pseudo-filter for channel
      if (search === 'channel:whatsapp') {
        return t.channel === 'WHATSAPP';
      }
      if (search === 'channel:chatbot') {
        return t.channel === 'CHATBOT';
      }
      const q = search.toLowerCase();
      return (
        t.id.toLowerCase().includes(q) ||
        (t.ticketNumber?.toLowerCase().includes(q) ?? false) ||
        t.subject.toLowerCase().includes(q) ||
        t.customerName.toLowerCase().includes(q) ||
        t.customerEmail.toLowerCase().includes(q) ||
        (t.bookingRef?.toLowerCase().includes(q) ?? false) ||
        (t.assignedTo?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  const stats = {
    open: tickets.filter(t => t.status === 'OPEN').length,
    inProgress: tickets.filter(t => t.status === 'IN_PROGRESS').length,
    escalated: tickets.filter(t => t.status === 'ESCALATED').length,
    resolved: tickets.filter(t => ['RESOLVED', 'CLOSED'].includes(t.status)).length,
    failedBookings: tickets.filter(t => t.category === 'Failed Booking').length,
    urgentWhatsApp: tickets.filter(t => t.channel === 'WHATSAPP').length,
    aiBotCases: tickets.filter(t => t.channel === 'CHATBOT').length,
  };

  const colCount = isAdminOrSuper ? 10 : 9;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Support Queue</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} · {stats.open} open
            {stats.failedBookings > 0 && <span className="text-red-400"> · {stats.failedBookings} failed booking{stats.failedBookings !== 1 ? 's' : ''}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-[#1ABC9C] hover:bg-[#16a085] rounded-xl text-white text-sm font-semibold transition-all shadow-lg shadow-[#1ABC9C]/20">
            + Create Ticket
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {[
          { label: 'Open', value: stats.open, icon: Inbox, color: 'text-blue-400', bg: 'bg-blue-400/10 border-blue-400/20' },
          { label: 'In Progress', value: stats.inProgress, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/20' },
          { label: 'Escalated', value: stats.escalated, icon: ArrowUpCircle, color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/20' },
          { label: 'Resolved', value: stats.resolved, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/20' },
          { label: 'Failed Bookings', value: stats.failedBookings, icon: ShieldAlert, color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/20' },
          { label: 'Urgent WhatsApp', value: stats.urgentWhatsApp, icon: AlertTriangle, color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/20' },
          { label: 'AI Bot Cases', value: stats.aiBotCases, icon: MessageSquare, color: 'text-violet-400', bg: 'bg-violet-400/10 border-violet-400/20' },
        ].map(s => (
          <div key={s.label} className={`p-5 rounded-2xl border ${s.bg} cursor-pointer hover:brightness-110 transition-all`}
               onClick={() => {
                 if (s.label === 'Failed Bookings') setCategoryFilter(categoryFilter === 'Failed Booking' ? '' : 'Failed Booking');
                 else if (s.label === 'Open') setStatusFilter(statusFilter === 'OPEN' ? '' : 'OPEN');
                 else if (s.label === 'In Progress') setStatusFilter(statusFilter === 'IN_PROGRESS' ? '' : 'IN_PROGRESS');
                 else if (s.label === 'Escalated') setStatusFilter(statusFilter === 'ESCALATED' ? '' : 'ESCALATED');
                 else if (s.label === 'Resolved') setStatusFilter(statusFilter === 'RESOLVED' ? '' : 'RESOLVED');
                 else if (s.label === 'Urgent WhatsApp') {
                   if (search === 'channel:whatsapp') setSearch('');
                   else setSearch('channel:whatsapp');
                 }
                 else if (s.label === 'AI Bot Cases') {
                   if (search === 'channel:chatbot') setSearch('');
                   else setSearch('channel:chatbot');
                 }
               }}
          >
            <div className="flex items-center gap-2 mb-2">
              <s.icon size={16} className={s.color} />
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{s.label}</span>
            </div>
            <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by ticket ID, subject, customer, assignee…"
            className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
        >
          {CATEGORIES.map(c => (
            <option key={c} value={c === 'All Categories' ? '' : c} className="bg-slate-800">{c}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as TicketStatus | '')}
          className="px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
        >
          <option value="">All Statuses</option>
          {(Object.keys(STATUS_STYLES) as TicketStatus[]).map(s => (
            <option key={s} value={s} className="bg-slate-800">{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value as TicketPriority | '')}
          className="px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
        >
          <option value="">All Priorities</option>
          {(Object.keys(PRIORITY_STYLES) as TicketPriority[]).map(p => (
            <option key={p} value={p} className="bg-slate-800">{p}</option>
          ))}
        </select>
        <select
          value={assigneeFilter}
          onChange={e => setAssigneeFilter(e.target.value as 'ALL' | 'ME')}
          className="px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
        >
          <option value="ALL">All Assignees</option>
          <option value="ME">Assigned to Me</option>
        </select>
      </div>

      {/* Tickets table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden min-h-[400px]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700/50">
              {['', 'Ticket #', 'Subject', 'Customer', 'Category', 'Priority', 'Status', 'Messages', 'Created', 'Assignee', ...(isAdminOrSuper ? ['Actions'] : [])].map(h => (
                <th key={h} className="px-5 py-3.5 text-left text-xs font-black text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {loading ? (
              <tr><td colSpan={colCount + 1} className="px-5 py-12 text-center">
                <RefreshCw size={20} className="text-[#1ABC9C] animate-spin mx-auto" />
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={colCount + 1} className="px-5 py-12 text-center text-slate-500">No tickets found</td></tr>
            ) : (
              filtered.map((ticket, idx) => {
                const StatusIcon = STATUS_STYLES[ticket.status]?.icon ?? Inbox;
                const ticketNum = formatTicketNumber(ticket, idx, filtered.length);
                const isFailedBooking = ticket.category === 'Failed Booking' && ticket.failureAudit;
                const isExpanded = expandedId === ticket.id;
                const audit = ticket.failureAudit;

                return (
                  <React.Fragment key={ticket.id}>
                    <tr
                      className="hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => {
                        if (isFailedBooking) {
                          setExpandedId(isExpanded ? null : ticket.id);
                        } else {
                          router.push(`/admin/support-queue/${ticket.id}`);
                        }
                      }}
                    >
                      {/* Expand arrow */}
                      <td className="px-3 py-4 text-slate-500 w-8">
                        {isFailedBooking ? (
                          isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold text-sm font-mono ${ticket.channel === 'WHATSAPP' ? 'text-green-400' : 'text-[#1ABC9C]'}`}>{ticketNum}</span>
                          {ticket.channel === 'WHATSAPP' && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-green-500/15 text-green-400 border border-green-500/20 uppercase tracking-wide">
                              WA
                            </span>
                          )}
                          {ticket.channel === 'CHATBOT' && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-violet-500/15 text-violet-400 border border-violet-500/20 uppercase tracking-wide">
                              BOT
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-white font-semibold text-sm truncate max-w-[280px]">{ticket.subject}</p>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
                            {ticket.customerName.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div>
                            <p className="text-white text-sm font-semibold">{ticket.customerName}</p>
                            <p className="text-slate-500 text-xs">{ticket.customerEmail}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        {ticket.category === 'Failed Booking' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/20">
                            <ShieldAlert size={11} />
                            Failed Booking
                          </span>
                        ) : (
                          <span className="text-slate-400 text-sm">{ticket.category}</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${PRIORITY_STYLES[ticket.priority]}`}>
                          {ticket.priority}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_STYLES[ticket.status]?.cls ?? ''}`}>
                          <StatusIcon size={12} />
                          {ticket.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <MessageSquare size={14} />
                          <span className="text-sm font-semibold">{ticket.messageCount}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-400 text-sm">
                        {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                      </td>
                      <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                        <select 
                          value={ticket.assignedToId || ''} 
                          onChange={(e) => handleAssign(ticket.id, e.target.value)}
                          className="bg-slate-800 border border-slate-700 rounded-lg text-sm text-white px-2.5 py-1.5 focus:outline-none focus:border-[#1ABC9C] max-w-[140px] cursor-pointer"
                        >
                          <option value="">Unassigned</option>
                          {supportStaff.map(staff => (
                            <option key={staff.id} value={staff.id}>{staff.fullName}</option>
                          ))}
                        </select>
                      </td>
                      {isAdminOrSuper && (
                        <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => router.push(`/admin/support-queue/${ticket.id}`)}
                              className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all"
                              title="Edit ticket"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => handleDelete(ticket.id)}
                              disabled={deleting === ticket.id}
                              className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-30"
                              title="Delete ticket"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>

                    {/* Expanded Failed Booking Details */}
                    {isExpanded && isFailedBooking && audit && (
                      <tr className="bg-slate-900/50">
                        <td colSpan={colCount + 1} className="px-6 py-5">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Left: Error & Resolution */}
                            <div>
                              <h4 className="text-xs font-black text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <AlertTriangle size={13} /> Root Cause (Internal)
                              </h4>
                              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-2">
                                  {(() => {
                                    const badge = ERROR_CODE_LABELS[audit.errorCode] ?? { label: audit.errorCode, color: 'bg-slate-500/15 text-slate-400' };
                                    return <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${badge.color}`}>{badge.label}</span>;
                                  })()}
                                  <span className="text-slate-500 text-xs">Stage: {audit.failureStage}</span>
                                </div>
                                <p className="text-red-300 text-xs font-mono leading-relaxed break-all">{audit.errorMessage}</p>
                              </div>

                              <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider mt-4 mb-2">
                                Customer Message (Shown to User)
                              </h4>
                              <p className="text-slate-400 text-sm leading-relaxed">{audit.customerMessage}</p>

                              <div className="flex flex-wrap gap-4 mt-4 text-sm">
                                {audit.stripePaymentIntentId && (
                                  <div><span className="text-slate-500">Stripe PI:</span> <span className="text-slate-300 font-mono text-xs">{audit.stripePaymentIntentId}</span></div>
                                )}
                                {audit.offerId && (
                                  <div><span className="text-slate-500">Offer ID:</span> <span className="text-slate-300 font-mono text-xs">{audit.offerId.slice(0, 24)}…</span></div>
                                )}
                              </div>

                              {(audit.offerProvidedAt || audit.offerExpiresAt) && (
                                <div className="mt-4 p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                  <h4 className="text-xs font-black text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Clock size={12} /> Offer Lifecycle</h4>
                                  <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div><span className="text-slate-500">Created:</span> <span className="text-slate-300 font-semibold">{audit.offerProvidedAt ? format(new Date(audit.offerProvidedAt), 'dd MMM hh:mm:ss a') : '—'}</span></div>
                                    <div><span className="text-slate-500">Expires:</span> <span className="text-slate-300 font-semibold">{audit.offerExpiresAt ? format(new Date(audit.offerExpiresAt), 'dd MMM hh:mm:ss a') : '—'}</span></div>
                                  </div>
                                </div>
                              )}

                              {audit.resolvedAt && audit.resolutionNotes && (
                                <div className="mt-4">
                                  <h4 className="text-xs font-black text-emerald-400 uppercase tracking-wider mb-1.5">Resolution Notes</h4>
                                  <p className="text-slate-300 text-sm leading-relaxed">{audit.resolutionNotes}</p>
                                  <p className="text-slate-500 text-xs mt-1">Resolved by {audit.resolvedBy} on {format(new Date(audit.resolvedAt), 'dd MMM yyyy hh:mm a')}</p>
                                </div>
                              )}
                            </div>

                            {/* Right: Flight & Passenger details */}
                            <div>
                              <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <Plane size={13} /> Flight Details
                              </h4>
                              <div className="grid grid-cols-2 gap-3 mb-4">
                                <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                  <p className="text-xs font-black text-slate-500 uppercase tracking-wider">Route</p>
                                  <p className="text-white text-sm font-bold mt-1">{audit.originAirport} → {audit.destinationAirport}</p>
                                  <p className="text-slate-500 text-xs mt-0.5">
                                    {audit.tripType === 'ROUND_TRIP' ? 'Round Trip' : 'One Way'}
                                    {audit.airline ? ` · ${audit.airline}` : ''}
                                  </p>
                                </div>
                                <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                  <p className="text-xs font-black text-slate-500 uppercase tracking-wider">Amount</p>
                                  <p className="text-white text-sm font-bold mt-1">
                                    ${Number(audit.totalAmount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    <span className="text-slate-500 text-xs ml-1">{audit.currency}</span>
                                  </p>
                                </div>
                                <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                  <p className="text-xs font-black text-slate-500 uppercase tracking-wider">Departure</p>
                                  <p className="text-slate-300 text-sm font-semibold mt-1">{audit.departureDate || '—'}</p>
                                </div>
                                {audit.returnDate && (
                                  <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                    <p className="text-xs font-black text-slate-500 uppercase tracking-wider">Return</p>
                                    <p className="text-slate-300 text-sm font-semibold mt-1">{audit.returnDate}</p>
                                  </div>
                                )}
                                <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                  <p className="text-xs font-black text-slate-500 uppercase tracking-wider">Cabin</p>
                                  <p className="text-slate-300 text-sm font-semibold mt-1">{audit.cabinClass?.replace(/_/g, ' ') || '—'}</p>
                                </div>
                                <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                  <p className="text-xs font-black text-slate-500 uppercase tracking-wider">Fare</p>
                                  <p className="text-slate-300 text-sm font-semibold mt-1">{audit.fareName || '—'}</p>
                                </div>
                              </div>

                              <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <Users size={13} /> Passengers ({audit.passengerCount})
                              </h4>
                              <div className="space-y-2">
                                {(() => {
                                  try {
                                    const paxList = JSON.parse(audit.passengersJson);
                                    return paxList.map((pax: any, i: number) => (
                                      <div key={i} className="flex items-center gap-3 p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                        <div className="w-7 h-7 rounded-lg bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300">{i + 1}</div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-white text-sm font-semibold truncate">{pax.name || 'Unknown'}</p>
                                          <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                                            <span className="uppercase font-bold text-slate-400">{pax.type}</span>
                                            {pax.email && <span>{pax.email}</span>}
                                          </div>
                                        </div>
                                      </div>
                                    ));
                                  } catch { return <p className="text-slate-500 text-xs">Unable to parse passengers</p>; }
                                })()}
                              </div>

                              {/* Contact actions */}
                              <div className="flex gap-2 mt-4">
                                {audit.customerPhone && (
                                  <a href={`tel:${audit.customerPhone}`} className="flex items-center gap-1.5 px-3 py-2 bg-[#1ABC9C]/10 text-[#1ABC9C] rounded-lg text-sm font-semibold hover:bg-[#1ABC9C]/20 transition-all">
                                    <Phone size={13} /> Call
                                  </a>
                                )}
                                <a href={`mailto:${audit.customerEmail}`} className="flex items-center gap-1.5 px-3 py-2 bg-blue-500/10 text-blue-400 rounded-lg text-sm font-semibold hover:bg-blue-500/20 transition-all">
                                  <Mail size={13} /> Email
                                </a>
                                <button
                                  onClick={(e) => { e.stopPropagation(); router.push(`/admin/support-queue/${ticket.id}`); }}
                                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-700/50 text-slate-300 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-all ml-auto"
                                >
                                  <MessageSquare size={13} /> Open Thread
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Create Ticket Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Create Support Ticket</h2>
              <button onClick={() => setCreateOpen(false)} className="text-slate-400 hover:text-white">
                <XCircle size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl">{error}</div>}
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase">Customer Name</label>
                  <input type="text" value={createData.customerName} onChange={e => setCreateData({ ...createData, customerName: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#1ABC9C]" placeholder="John Doe" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase">Customer Email</label>
                  <input type="email" value={createData.customerEmail} onChange={e => setCreateData({ ...createData, customerEmail: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#1ABC9C]" placeholder="john@example.com" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase">Subject</label>
                <input type="text" value={createData.subject} onChange={e => setCreateData({ ...createData, subject: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#1ABC9C]" placeholder="Brief description of issue" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase">Category</label>
                  <select value={createData.category} onChange={e => setCreateData({ ...createData, category: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer">
                    {['Booking Issue', 'Payment Problem', 'Cancellation', 'Change Request', 'Baggage Claim', 'Refund Query', 'Technical Issue', 'Account Access', 'General Inquiry'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase">Priority</label>
                  <select value={createData.priority} onChange={e => setCreateData({ ...createData, priority: e.target.value as TicketPriority })} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer">
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase">Description</label>
                <textarea rows={4} value={createData.description} onChange={e => setCreateData({ ...createData, description: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#1ABC9C]" placeholder="Detailed description..." />
              </div>
            </div>
            
            <div className="p-6 border-t border-slate-800 flex justify-end gap-3">
              <button onClick={() => setCreateOpen(false)} className="px-5 py-2.5 rounded-xl text-slate-300 font-semibold text-sm hover:bg-slate-800 transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={creating} className="px-5 py-2.5 bg-[#1ABC9C] hover:bg-[#16a085] rounded-xl text-white font-bold text-sm transition-colors flex items-center gap-2 shadow-lg shadow-[#1ABC9C]/20 disabled:opacity-50">
                {creating ? <RefreshCw size={16} className="animate-spin" /> : null}
                Create Ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
