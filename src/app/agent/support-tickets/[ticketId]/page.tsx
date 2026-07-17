'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import {
  ArrowLeft, RefreshCw, Clock, CheckCircle2, XCircle, Inbox,
  MessageSquare, Calendar, AlertTriangle, ArrowUpCircle, User,
  Phone, Mail, Plane, ExternalLink,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

const STATUS_CFG: Record<TicketStatus, { label: string; cls: string; icon: React.ElementType }> = {
  OPEN:              { label: 'Open',              cls: 'bg-blue-400/15 text-blue-400',       icon: Inbox },
  IN_PROGRESS:       { label: 'In Progress',       cls: 'bg-amber-400/15 text-amber-400',     icon: Clock },
  WAITING_CUSTOMER:  { label: 'Awaiting Reply',    cls: 'bg-purple-400/15 text-purple-400',   icon: User },
  ESCALATED:         { label: 'Escalated',          cls: 'bg-red-400/15 text-red-400',         icon: ArrowUpCircle },
  RESOLVED:          { label: 'Resolved',           cls: 'bg-emerald-400/15 text-emerald-400', icon: CheckCircle2 },
  CLOSED:            { label: 'Closed',             cls: 'bg-slate-400/15 text-slate-400',     icon: XCircle },
};

interface TicketMessage {
  id: string;
  content: string;
  createdAt: string;
  senderName: string | null;
}

interface TicketDetail {
  id: string;
  ticketNumber: string | null;
  sequenceNumber: number | null;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: TicketStatus;
  channel: string;
  bookingRef: string | null;
  airlinePnr: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

function getTicketNum(t: TicketDetail): string {
  if (t.ticketNumber) return t.ticketNumber;
  if (t.sequenceNumber) return `FM-TKT-${String(t.sequenceNumber).padStart(4, '0')}`;
  return t.id.slice(-6).toUpperCase();
}

export default function AgentTicketDetailPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const router = useRouter();
  const { sessionToken } = useAuthStore();
  const { ticketId } = use(params);

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionToken) return;
    (async () => {
      try {
        const res = await fetch(`/api/agent/support-tickets?ticketId=${ticketId}`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setTicket(data.ticket);
        } else {
          setError('Ticket not found.');
        }
      } catch {
        setError('Failed to load ticket.');
      }
      setLoading(false);
    })();
  }, [ticketId, sessionToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={20} className="text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="text-center py-16 p-8">
        <AlertTriangle size={32} className="text-red-400 mx-auto mb-3" />
        <p className="text-white font-semibold">{error || 'Ticket not found'}</p>
        <button onClick={() => router.push('/agent/support-tickets')} className="text-[#1ABC9C] text-sm mt-3 hover:underline">
          ← Back to Support Tickets
        </button>
      </div>
    );
  }

  const cfg = STATUS_CFG[ticket.status] || STATUS_CFG.OPEN;
  const StatusIcon = cfg.icon;
  const ticketNum = getTicketNum(ticket);
  const isResolved = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED';

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Back */}
      <button
        onClick={() => router.push('/agent/support-tickets')}
        className="flex items-center gap-2 text-slate-400 hover:text-white text-sm font-medium mb-5 transition-colors"
      >
        <ArrowLeft size={14} /> Back to Support Tickets
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 mb-2 flex-wrap">
            <span className="text-[#1ABC9C] font-mono font-bold text-sm bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 px-2.5 py-1 rounded-lg shrink-0">
              {ticketNum}
            </span>
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${cfg.cls}`}>
              <StatusIcon size={12} />
              {cfg.label}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
              ticket.priority === 'URGENT' ? 'bg-red-400/15 text-red-400 border-red-400/20'
                : ticket.priority === 'HIGH' ? 'bg-amber-400/15 text-amber-400 border-amber-400/20'
                : 'bg-slate-400/15 text-slate-400 border-slate-400/20'
            }`}>
              {ticket.priority}
            </span>
          </div>
          <h1 className="text-xl font-black text-white mb-1">{ticket.subject}</h1>
          <p className="text-slate-500 text-xs">
            Created {format(new Date(ticket.createdAt), 'PPpp')} · {ticket.category}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main content */}
        <div className="col-span-2 space-y-4">
          {/* Resolution banner */}
          {isResolved && (
            <div className="flex items-center gap-3 px-5 py-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
              <CheckCircle2 size={20} className="text-emerald-400 shrink-0" />
              <div>
                <p className="text-emerald-400 font-bold text-sm">Ticket {ticket.status === 'RESOLVED' ? 'Resolved' : 'Closed'}</p>
                <p className="text-slate-400 text-xs mt-0.5">
                  Last updated {formatDistanceToNow(new Date(ticket.updatedAt), { addSuffix: true })}
                </p>
              </div>
            </div>
          )}

          {/* Original description */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white">
                {ticket.customerName.split(' ').map(n => n[0]).join('')}
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{ticket.customerName}</p>
                <p className="text-slate-500 text-[10px]">{formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}</p>
              </div>
            </div>
            <div className="text-slate-300 text-sm whitespace-pre-wrap leading-relaxed pl-[42px]">
              {ticket.description}
            </div>
          </div>

          {/* Messages */}
          {ticket.messages.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare size={12} /> Responses ({ticket.messages.length})
              </p>
              {ticket.messages.map(msg => {
                const isAdmin = !!msg.senderName;
                return (
                  <div key={msg.id} className={`rounded-2xl p-5 border ${
                    isAdmin ? 'bg-[#1ABC9C]/[0.03] border-[#1ABC9C]/15' : 'bg-slate-800/50 border-slate-700/50'
                  }`}>
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                        isAdmin ? 'bg-[#1ABC9C]/20 text-[#1ABC9C]' : 'bg-slate-700 text-white'
                      }`}>
                        {isAdmin ? (msg.senderName?.[0] || 'S') : ticket.customerName[0]}
                      </div>
                      <div className="flex-1">
                        <p className="text-white font-semibold text-sm">
                          {isAdmin ? `${msg.senderName} · Support` : ticket.customerName}
                        </p>
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <div className="text-slate-300 text-sm whitespace-pre-wrap leading-relaxed pl-[42px]">
                      {msg.content}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {ticket.messages.length === 0 && !isResolved && (
            <div className="text-center py-10 bg-slate-800/30 border border-slate-700/50 rounded-2xl">
              <Clock size={28} className="text-slate-600 mx-auto mb-2" />
              <p className="text-slate-400 text-sm font-semibold">No responses yet</p>
              <p className="text-slate-500 text-xs mt-1">Admin team has not replied to this ticket yet.</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Customer Info */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-4">Customer</h3>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-sm text-white">
                {ticket.customerName.split(' ').map(n => n[0]).join('')}
              </div>
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">{ticket.customerName}</p>
              </div>
            </div>
            <div className="space-y-2">
              <a href={`mailto:${ticket.customerEmail}`}
                className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/20 rounded-xl text-blue-400 text-sm font-semibold transition-all truncate">
                <Mail size={14} className="shrink-0" />
                <span className="truncate">{ticket.customerEmail}</span>
              </a>
              {ticket.customerPhone && (
                <a href={`tel:${ticket.customerPhone}`}
                  className="flex items-center gap-2 px-3 py-2 bg-[#1ABC9C]/10 hover:bg-[#1ABC9C]/15 border border-[#1ABC9C]/20 rounded-xl text-[#1ABC9C] text-sm font-semibold transition-all">
                  <Phone size={14} className="shrink-0" />
                  {ticket.customerPhone}
                </a>
              )}
            </div>
          </div>

          {/* Ticket Details */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-4">Ticket Details</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Category</span>
                <span className="text-white font-semibold">{ticket.category}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Channel</span>
                <span className="text-slate-300">{ticket.channel}</span>
              </div>
              {ticket.bookingRef && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Booking Ref</span>
                  <button
                    onClick={() => router.push(`/agent/bookings/${ticket.bookingRef}`)}
                    className="text-[#1ABC9C] font-bold hover:underline"
                  >
                    {ticket.bookingRef}
                  </button>
                </div>
              )}
              {ticket.airlinePnr && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Airline PNR</span>
                  <span className="text-white font-bold font-mono">{ticket.airlinePnr}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Messages</span>
                <span className="text-slate-300 flex items-center gap-1">
                  <MessageSquare size={12} /> {ticket.messages.length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
