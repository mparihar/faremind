'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, RefreshCw, Clock, CheckCircle2, XCircle, CreditCard,
  AlertTriangle, Ticket, Calendar, Banknote, Receipt, Plane,
  HelpCircle, Mail, Shield, Hash,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { formatDistanceToNow } from 'date-fns';

const fmt = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    PENDING:    ['bg-amber-500/10 text-amber-400 border-amber-500/20', 'Pending'],
    PROCESSING: ['bg-blue-500/10 text-blue-400 border-blue-500/20', 'Processing'],
    COMPLETED:  ['bg-emerald-500/10 text-emerald-400 border-emerald-500/20', 'Refunded'],
    FAILED:     ['bg-red-500/10 text-red-400 border-red-500/20', 'Failed'],
    PARTIAL:    ['bg-purple-500/10 text-purple-400 border-purple-500/20', 'Partial'],
  };
  const [cls, label] = map[status] || ['bg-slate-500/10 text-slate-400 border-slate-500/20', status];
  return <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${cls}`}>{label}</span>;
}

function PnrStatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    ACTIVE:    ['bg-emerald-500/10 text-emerald-400', 'Active'],
    CANCELLED: ['bg-red-500/10 text-red-400', 'Cancelled'],
    VOIDED:    ['bg-amber-500/10 text-amber-400', 'Voided'],
  };
  const [cls, label] = map[status] || ['bg-slate-500/10 text-slate-400', status];
  return <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${cls}`}>{label}</span>;
}

function TimelineStep({ label, date, done, failed }: { label: string; date?: string | null; done: boolean; failed?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          failed ? 'bg-red-500/15 border border-red-500/30' :
          done ? 'bg-[#1ABC9C]/15 border border-[#1ABC9C]/30' :
          'bg-white/[0.04] border border-white/[0.08]'
        }`}>
          {failed ? <XCircle size={14} className="text-red-400" /> :
           done ? <CheckCircle2 size={14} className="text-[#1ABC9C]" /> :
           <Clock size={14} className="text-slate-600" />}
        </div>
        <div className="w-px h-6 bg-white/[0.06]" />
      </div>
      <div className="pt-1">
        <p className={`text-sm font-semibold ${done ? 'text-white' : failed ? 'text-red-400' : 'text-slate-500'}`}>{label}</p>
        {date && (
          <p className="text-[10px] text-slate-500 mt-0.5">
            {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
            {' · '}{formatDistanceToNow(new Date(date), { addSuffix: true })}
          </p>
        )}
      </div>
    </div>
  );
}

export default function AgentRefundDetailPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const router = useRouter();
  const { sessionToken } = useAuthStore();
  const { bookingId } = use(params);

  const [refund, setRefund] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionToken) return;
    (async () => {
      try {
        const res = await fetch('/api/user/refunds', {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          const found = (data.refunds || []).find((r: any) => r.bookingId === bookingId);
          if (found) setRefund(found);
          else setError('Refund not found.');
        } else {
          setError('Failed to load refund details.');
        }
      } catch {
        setError('Network error.');
      }
      setLoading(false);
    })();
  }, [bookingId, sessionToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={20} className="text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  if (error || !refund) {
    return (
      <div className="text-center py-16">
        <AlertTriangle size={32} className="text-red-400 mx-auto mb-3" />
        <p className="text-white font-semibold">{error || 'Refund not found'}</p>
        <button onClick={() => router.push('/agent/refunds')} className="text-[#1ABC9C] text-sm mt-3 hover:underline">
          ← Back to Refunds
        </button>
      </div>
    );
  }

  const r = refund;
  const isCompleted = r.refundStatus === 'COMPLETED';
  const isFailed = r.refundStatus === 'FAILED';

  return (
    <div className="p-8">
      <button onClick={() => router.push('/agent/refunds')}
        className="flex items-center gap-2 text-slate-400 hover:text-white text-sm font-medium mb-5 transition-colors">
        <ArrowLeft size={14} /> Back to Refunds & Credits
      </button>

      {/* Header */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 mb-2 flex-wrap">
              <span className="text-[#1ABC9C] font-mono font-bold text-sm bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 px-2.5 py-1 rounded-lg">{r.bookingRef}</span>
              <StatusBadge status={r.refundStatus} />
            </div>
            <h1 className="text-xl font-black text-white mb-1">Refund Details</h1>
            <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
              <span className="flex items-center gap-1"><Calendar size={11} /> {r.origin} → {r.destination}</span>
              <span className="text-slate-600">•</span>
              <span>{new Date(r.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Net Refund</p>
            <p className={`text-2xl font-black ${isCompleted ? 'text-emerald-400' : isFailed ? 'text-red-400' : r.refundAmount > 0 ? 'text-[#F97316]' : 'text-slate-500'}`}>
              {r.refundAmount > 0 ? fmt(r.refundAmount, r.currency) : 'No refund'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* PNR Details */}
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
            <p className="text-white font-bold text-base mb-4 flex items-center gap-2">
              <Hash size={16} className="text-[#1ABC9C]" /> Cancelled PNR Details
            </p>
            <div className="space-y-3">
              {r.pnrs?.length > 0 ? r.pnrs.map((pnr: any) => (
                <div key={pnr.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[#1ABC9C] font-mono font-bold text-sm">{pnr.pnrCode}</span>
                      <PnrStatusBadge status={pnr.status} />
                      {pnr.isPrimary && <span className="text-[8px] bg-white/[0.06] text-slate-400 font-bold px-1.5 py-0.5 rounded uppercase">Primary</span>}
                    </div>
                    {pnr.refundable
                      ? <span className="text-[9px] text-emerald-400 font-bold bg-emerald-400/10 px-1.5 py-0.5 rounded">Refundable</span>
                      : <span className="text-[9px] text-red-400 font-bold bg-red-400/10 px-1.5 py-0.5 rounded">Non-refundable</span>
                    }
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                    {pnr.airlineName && <span className="font-semibold text-slate-400">{pnr.airlineName}</span>}
                    {pnr.cancellationFee != null && pnr.cancellationFee > 0 && (
                      <span className="text-red-400">Cancel fee: {fmt(pnr.cancellationFee, r.currency)}</span>
                    )}
                  </div>
                </div>
              )) : <p className="text-slate-500 text-sm text-center py-4">No PNR details available</p>}
            </div>
          </div>

          {/* Flights */}
          {r.segments?.length > 0 && (
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
              <p className="text-white font-bold text-base mb-4 flex items-center gap-2">
                <Plane size={16} className="text-[#1ABC9C]" /> Cancelled Flights
              </p>
              <div className="space-y-2">
                {r.segments.map((seg: any, i: number) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl">
                    <div className="w-10 h-10 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                      <Plane size={16} className="text-red-400 rotate-45" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold text-sm">{seg.from} → {seg.to}</span>
                        {seg.flight && <span className="text-slate-500 text-xs font-mono">{seg.flight}</span>}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5">
                        {seg.airlineName && <span>{seg.airlineName}</span>}
                        {seg.departureTime && <span>{new Date(seg.departureTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                      </div>
                    </div>
                    <span className="text-[9px] text-red-400 font-bold bg-red-400/10 px-1.5 py-0.5 rounded uppercase shrink-0">{seg.status || 'Cancelled'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Breakdown */}
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
            <p className="text-white font-bold text-base mb-4 flex items-center gap-2">
              <Receipt size={16} className="text-[#1ABC9C]" /> Refund Breakdown
            </p>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Original Amount</span>
                <span className="text-white font-semibold">{fmt(r.originalAmount, r.currency)}</span>
              </div>
              {r.airlinePenalty > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Airline Fee</span>
                  <span className="text-red-400 font-semibold">-{fmt(r.airlinePenalty, r.currency)}</span>
                </div>
              )}
              {r.penaltyAmount > 0 && r.penaltyAmount !== r.airlinePenalty && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Processing Fee</span>
                  <span className="text-red-400 font-semibold">-{fmt(r.penaltyAmount - r.airlinePenalty, r.currency)}</span>
                </div>
              )}
              <div className="border-t border-white/[0.06] pt-3 flex justify-between text-sm">
                <span className="text-white font-bold">Net Refund</span>
                <span className={`font-black text-lg ${isCompleted ? 'text-emerald-400' : r.refundAmount > 0 ? 'text-[#F97316]' : 'text-slate-500'}`}>
                  {r.refundAmount > 0 ? fmt(r.refundAmount, r.currency) : 'No refund'}
                </span>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
            <p className="text-white font-bold text-base mb-4 flex items-center gap-2">
              <Clock size={16} className="text-[#1ABC9C]" /> Timeline
            </p>
            <div className="space-y-0">
              <TimelineStep label="Cancellation Requested" date={r.cancelledAt} done={true} />
              <TimelineStep label="Airline Processing"
                date={r.cancellationStatus && ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(r.cancellationStatus) ? r.cancelledAt : null}
                done={!!r.cancellationStatus && ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(r.cancellationStatus)}
                failed={isFailed} />
              {r.refundAmount > 0 && (
                <>
                  <TimelineStep label="Refund Initiated" date={r.refundRecords?.[0]?.initiatedAt || null} done={r.refundRecords?.length > 0} />
                  <TimelineStep label="Refund Complete" date={r.refundedAt || r.refundRecords?.[0]?.completedAt || null} done={isCompleted} />
                </>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
            <p className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <Shield size={14} className="text-[#1ABC9C]" /> Status
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Booking</span><span className="text-red-400 font-semibold">Cancelled</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Payment</span><span className="text-slate-400 font-semibold">{r.paymentStatus?.replace(/_/g, ' ') || 'Unknown'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Ticketing</span><span className="text-slate-400 font-semibold">{r.ticketingStatus?.replace(/_/g, ' ') || 'Unknown'}</span></div>
            </div>
          </div>

          {r.supportTickets?.length > 0 && (
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
              <p className="text-white font-bold text-sm mb-3 flex items-center gap-2">
                <Ticket size={14} className="text-[#1ABC9C]" /> Support Tickets
              </p>
              <div className="space-y-2">
                {r.supportTickets.map((t: any) => (
                  <button key={t.id} onClick={() => router.push(`/agent/support/${t.id}`)}
                    className="w-full text-left px-3 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl hover:bg-white/[0.06] transition-all">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[#1ABC9C] font-mono font-bold text-xs">{t.ticketNumber}</span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                        t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'bg-emerald-400/15 text-emerald-400' :
                        t.status === 'IN_PROGRESS' ? 'bg-amber-400/15 text-amber-400' : 'bg-blue-400/15 text-blue-400'
                      }`}>{t.status.replace('_', ' ')}</span>
                    </div>
                    <p className="text-slate-400 text-xs truncate">{t.subject}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isCompleted && r.refundAmount > 0 && (
            <div className="bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-2xl p-5">
              <p className="text-white font-bold text-sm mb-2 flex items-center gap-2">
                <HelpCircle size={14} className="text-[#1ABC9C]" /> Need Help?
              </p>
              <button onClick={() => router.push('/agent/support')}
                className="w-full py-2.5 rounded-xl bg-[#1ABC9C] hover:bg-[#16a085] text-white font-bold text-sm transition-all flex items-center justify-center gap-2">
                <Mail size={14} /> Contact Support
              </button>
            </div>
          )}

          {isCompleted && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5">
              <CheckCircle2 size={18} className="text-emerald-400 mb-2" />
              <p className="text-emerald-400 font-bold text-sm">Refund of {fmt(r.refundAmount, r.currency)} processed</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
