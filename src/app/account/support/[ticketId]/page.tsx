'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import {
  ArrowLeft, RefreshCw, Clock, CheckCircle2, XCircle,
  Inbox, MessageSquare, Calendar, AlertTriangle, ArrowUpCircle, User,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

const STATUS_CONFIG: Record<TicketStatus, { label: string; cls: string; icon: React.ElementType }> = {
  OPEN:              { label: 'Open',              cls: 'bg-blue-400/15 text-blue-400',      icon: Inbox },
  IN_PROGRESS:       { label: 'In Progress',       cls: 'bg-amber-400/15 text-amber-400',    icon: Clock },
  WAITING_CUSTOMER:  { label: 'Awaiting Your Reply', cls: 'bg-purple-400/15 text-purple-400', icon: User },
  ESCALATED:         { label: 'Escalated',          cls: 'bg-red-400/15 text-red-400',        icon: ArrowUpCircle },
  RESOLVED:          { label: 'Resolved',           cls: 'bg-emerald-400/15 text-emerald-400', icon: CheckCircle2 },
  CLOSED:            { label: 'Closed',             cls: 'bg-slate-400/15 text-slate-400',    icon: XCircle },
};

interface TicketMessage {
  id: string;
  content: string;
  createdAt: string;
  senderName: string | null; // null = customer, string = admin
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
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

function getTicketNum(ticket: TicketDetail): string {
  if (ticket.ticketNumber) return ticket.ticketNumber;
  if (ticket.sequenceNumber) return `FM-TKT-${String(ticket.sequenceNumber).padStart(4, '0')}`;
  return ticket.id.slice(-6).toUpperCase();
}

export default function UserTicketDetailPage({ params }: { params: Promise<{ ticketId: string }> }) {
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
        const res = await fetch(`/api/user/support-tickets/${ticketId}`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setTicket(data.ticket);
        } else {
          setError('Ticket not found or access denied.');
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
      <div className="text-center py-16">
        <AlertTriangle size={32} className="text-red-400 mx-auto mb-3" />
        <p className="text-white font-semibold">{error || 'Ticket not found'}</p>
        <button onClick={() => router.push('/account/support')} className="text-[#1ABC9C] text-sm mt-3 hover:underline">
          ← Back to Support
        </button>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.OPEN;
  const StatusIcon = statusCfg.icon;
  const ticketNum = getTicketNum(ticket);
  const isResolved = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED';

  return (
    <div>
      {/* Back button */}
      <button
        onClick={() => router.push('/account/support')}
        className="flex items-center gap-2 text-slate-400 hover:text-white text-sm font-medium mb-5 transition-colors"
      >
        <ArrowLeft size={14} /> Back to Support
      </button>

      {/* Header card */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 mb-2 flex-wrap">
              <span className="text-[#1ABC9C] font-mono font-bold text-sm bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 px-2.5 py-1 rounded-lg shrink-0">
                {ticketNum}
              </span>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${statusCfg.cls}`}>
                <StatusIcon size={12} />
                {statusCfg.label}
              </span>
            </div>
            <h1 className="text-xl font-black text-white mb-1">{ticket.subject}</h1>
            <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
              <span className="flex items-center gap-1">
                <Calendar size={11} />
                Created {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
              </span>
              <span className="text-slate-600">•</span>
              <span>{ticket.category}</span>
              {ticket.bookingRef && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="text-[#1ABC9C] font-mono font-semibold">{ticket.bookingRef}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Resolution banner */}
      {isResolved && (
        <div className="flex items-center gap-3 px-5 py-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl mb-5">
          <CheckCircle2 size={20} className="text-emerald-400 shrink-0" />
          <div>
            <p className="text-emerald-400 font-bold text-sm">This ticket has been {ticket.status === 'RESOLVED' ? 'resolved' : 'closed'}</p>
            <p className="text-slate-400 text-xs mt-0.5">
              Last updated {formatDistanceToNow(new Date(ticket.updatedAt), { addSuffix: true })}. If you need further help, please submit a new request.
            </p>
          </div>
        </div>
      )}

      {/* Refund status banner — visible to customer */}
      {(ticket as any).refundInfo?.refundStatus && (ticket as any).refundInfo.refundStatus !== 'NOT_APPLICABLE' && (() => {
        const ri = (ticket as any).refundInfo;
        const isIssued = ri.refundStatus === 'REFUND_ISSUED';
        const isPending = ri.refundStatus === 'REFUND_PENDING';
        return (
          <div className={`flex items-center gap-3 px-5 py-4 rounded-2xl mb-5 ${
            isIssued ? 'bg-emerald-500/5 border border-emerald-500/20' :
            isPending ? 'bg-amber-500/5 border border-amber-500/20' :
            'bg-red-500/5 border border-red-500/20'
          }`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
              isIssued ? 'bg-emerald-400/15' : isPending ? 'bg-amber-400/15' : 'bg-red-400/15'
            }`}>
              <span className="text-lg">{isIssued ? '✅' : isPending ? '⏳' : '⚠️'}</span>
            </div>
            <div>
              <p className={`font-bold text-sm ${
                isIssued ? 'text-emerald-400' : isPending ? 'text-amber-400' : 'text-red-400'
              }`}>
                {isIssued ? 'Refund Issued' : isPending ? 'Refund Processing' : 'Refund Failed'}
              </p>
              <p className="text-slate-400 text-xs mt-0.5">
                {isIssued
                  ? `$${ri.refundAmount?.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${ri.currency} has been refunded to your original payment method. Please allow 5–10 business days.`
                  : isPending
                    ? `Your refund of $${(ri.refundAmount ?? ri.totalAmount)?.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${ri.currency} is being processed. We'll update you once it's completed.`
                    : 'There was an issue processing your refund. Our team is working on it — you will be contacted shortly.'}
              </p>
            </div>
          </div>
        );
      })()}

      {/* Original request */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 mb-4">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-8 h-8 rounded-full bg-[#1ABC9C]/15 border border-[#1ABC9C]/30 flex items-center justify-center text-xs font-bold text-[#1ABC9C]">
            You
          </div>
          <div>
            <p className="text-white font-semibold text-sm">Your Request</p>
            <p className="text-slate-500 text-[10px]">{formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}</p>
          </div>
        </div>
        <div className="text-slate-300 text-sm whitespace-pre-wrap leading-relaxed pl-[42px]">
          {ticket.description}
        </div>
      </div>

      {/* Messages thread */}
      {ticket.messages.length > 0 && (
        <div className="space-y-3 mb-5">
          <p className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <MessageSquare size={12} /> Responses ({ticket.messages.length})
          </p>
          {ticket.messages.map(msg => {
            const isAdmin = !!msg.senderName;
            return (
              <div
                key={msg.id}
                className={`rounded-2xl p-5 border ${
                  isAdmin
                    ? 'bg-[#1ABC9C]/[0.03] border-[#1ABC9C]/15'
                    : 'bg-white/[0.04] border-white/[0.08]'
                }`}
              >
                <div className="flex items-center gap-2.5 mb-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    isAdmin
                      ? 'bg-[#1ABC9C]/20 text-[#1ABC9C]'
                      : 'bg-slate-700 text-white'
                  }`}>
                    {isAdmin ? (msg.senderName?.[0] || 'S') : 'You'}
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-semibold text-sm">
                      {isAdmin ? `${msg.senderName} · FAREMIND Support` : 'You'}
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

      {/* No responses yet */}
      {ticket.messages.length === 0 && !isResolved && (
        <div className="text-center py-10 bg-white/[0.02] border border-white/[0.06] rounded-2xl">
          <Clock size={28} className="text-slate-600 mx-auto mb-2" />
          <p className="text-slate-400 text-sm font-semibold">No responses yet</p>
          <p className="text-slate-500 text-xs mt-1">Our support team will review your request and respond soon.</p>
        </div>
      )}
    </div>
  );
}
