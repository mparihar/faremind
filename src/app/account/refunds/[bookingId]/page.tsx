'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, RefreshCw, Clock, CheckCircle2, XCircle, CreditCard,
  AlertTriangle, Ticket, Calendar, Banknote, Receipt, Plane,
  MessageSquare, HelpCircle, Mail, Shield, Hash,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { formatDistanceToNow } from 'date-fns';

const fmt = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);

/* ─── Status badge ─── */
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

/* ─── Timeline step ─── */
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

export default function RefundDetailPage({ params }: { params: Promise<{ bookingId: string }> }) {
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
        <button onClick={() => router.push('/account/refunds')} className="text-[#1ABC9C] text-sm mt-3 hover:underline">
          ← Back to Refunds
        </button>
      </div>
    );
  }

  const r = refund;
  const isCompleted = r.refundStatus === 'COMPLETED';
  const isFailed = r.refundStatus === 'FAILED';

  return (
    <div>
      {/* Back button */}
      <button
        onClick={() => router.push('/account/refunds')}
        className="flex items-center gap-2 text-slate-400 hover:text-white text-sm font-medium mb-5 transition-colors"
      >
        <ArrowLeft size={14} /> Back to Refunds & Credits
      </button>

      {/* Header card */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 mb-2 flex-wrap">
              <span className="text-[#1ABC9C] font-mono font-bold text-sm bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 px-2.5 py-1 rounded-lg">
                {r.bookingRef}
              </span>
              <StatusBadge status={r.refundStatus} />
              {!r.isRefundable && r.refundAmount === 0 && (
                <span className="text-[9px] text-red-400 font-bold uppercase bg-red-400/10 border border-red-400/20 px-1.5 py-0.5 rounded">Non-refundable</span>
              )}
            </div>
            <h1 className="text-xl font-black text-white mb-1">Refund Details</h1>
            <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
              <span className="flex items-center gap-1">
                <Calendar size={11} />
                {r.origin} → {r.destination}
              </span>
              <span className="text-slate-600">•</span>
              <span>{new Date(r.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              {r.tripType && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="capitalize">{r.tripType.replace('_', ' ').toLowerCase()}</span>
                </>
              )}
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
        {/* Left column */}
        <div className="lg:col-span-2 space-y-5">

          {/* ── PNR Details ─── */}
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
                      {pnr.isPrimary && (
                        <span className="text-[8px] bg-white/[0.06] text-slate-400 font-bold px-1.5 py-0.5 rounded uppercase">Primary</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {pnr.refundable ? (
                        <span className="text-[9px] text-emerald-400 font-bold bg-emerald-400/10 px-1.5 py-0.5 rounded">Refundable</span>
                      ) : (
                        <span className="text-[9px] text-red-400 font-bold bg-red-400/10 px-1.5 py-0.5 rounded">Non-refundable</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                    {pnr.airlineName && <span className="font-semibold text-slate-400">{pnr.airlineName}</span>}
                    {pnr.direction && pnr.direction !== 'ALL' && (
                      <span className="capitalize">{pnr.direction === 'OUTBOUND' ? '→ Outbound' : '← Return'}</span>
                    )}
                    {pnr.cancellationFee != null && pnr.cancellationFee > 0 && (
                      <span className="text-red-400">Cancellation fee: {fmt(pnr.cancellationFee, r.currency)}</span>
                    )}
                  </div>
                </div>
              )) : (
                <div className="text-center py-4">
                  <p className="text-slate-500 text-sm">No PNR details available</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Flight Segments ─── */}
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
                        {seg.departureTime && (
                          <span>{new Date(seg.departureTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {new Date(seg.departureTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[9px] text-red-400 font-bold bg-red-400/10 px-1.5 py-0.5 rounded uppercase shrink-0">
                      {seg.status || 'Cancelled'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Financial breakdown ─── */}
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
            <p className="text-white font-bold text-base mb-4 flex items-center gap-2">
              <Receipt size={16} className="text-[#1ABC9C]" /> Refund Breakdown
            </p>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Original Booking Amount</span>
                <span className="text-white font-semibold">{fmt(r.originalAmount, r.currency)}</span>
              </div>
              {r.airlinePenalty > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Airline Cancellation Fee</span>
                  <span className="text-red-400 font-semibold">-{fmt(r.airlinePenalty, r.currency)}</span>
                </div>
              )}
              {r.penaltyAmount > 0 && r.penaltyAmount !== r.airlinePenalty && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Processing Fee (FareMind)</span>
                  <span className="text-red-400 font-semibold">-{fmt(r.penaltyAmount - r.airlinePenalty, r.currency)}</span>
                </div>
              )}
              <div className="border-t border-white/[0.06] pt-3 flex justify-between text-sm">
                <span className="text-white font-bold">Net Refund Amount</span>
                <span className={`font-black text-lg ${isCompleted ? 'text-emerald-400' : r.refundAmount > 0 ? 'text-[#F97316]' : 'text-slate-500'}`}>
                  {r.refundAmount > 0 ? fmt(r.refundAmount, r.currency) : 'No refund'}
                </span>
              </div>
              {r.creditAmount && r.creditAmount > 0 && (
                <div className="flex justify-between text-sm mt-2 px-3 py-2 bg-purple-500/5 border border-purple-500/15 rounded-xl">
                  <span className="text-purple-400 font-semibold">Airline Credit</span>
                  <div className="text-right">
                    <span className="text-purple-400 font-bold">{fmt(r.creditAmount, r.currency)}</span>
                    {r.creditExpiresAt && (
                      <p className="text-purple-400/60 text-[10px]">
                        Expires {new Date(r.creditExpiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Timeline ─── */}
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
            <p className="text-white font-bold text-base mb-4 flex items-center gap-2">
              <Clock size={16} className="text-[#1ABC9C]" /> Timeline
            </p>
            <div className="space-y-0">
              <TimelineStep label="Cancellation Requested" date={r.cancelledAt} done={true} />
              <TimelineStep
                label="Airline Processing"
                date={r.cancellationStatus && ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(r.cancellationStatus) ? r.cancelledAt : null}
                done={!!r.cancellationStatus && ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(r.cancellationStatus)}
                failed={isFailed}
              />
              {r.refundAmount > 0 && (
                <>
                  <TimelineStep
                    label="Refund Initiated"
                    date={r.refundRecords?.[0]?.initiatedAt || null}
                    done={r.refundRecords?.length > 0}
                  />
                  <TimelineStep
                    label="Refund Complete"
                    date={r.refundedAt || r.refundRecords?.[0]?.completedAt || null}
                    done={isCompleted}
                  />
                </>
              )}
            </div>
            {isFailed && r.failureReason && (
              <div className="mt-4 px-4 py-3 bg-red-500/5 border border-red-500/15 rounded-xl">
                <p className="text-red-400 text-sm font-semibold mb-1">Failure Reason</p>
                <p className="text-slate-400 text-sm">{r.failureReason}</p>
              </div>
            )}
            {r.notes && (
              <div className="mt-4 px-4 py-3 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Notes</p>
                <p className="text-slate-300 text-sm">{r.notes}</p>
              </div>
            )}
          </div>

          {/* ── BookingRefund records ─── */}
          {r.refundRecords?.length > 0 && (
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
              <p className="text-white font-bold text-base mb-4 flex items-center gap-2">
                <Banknote size={16} className="text-[#1ABC9C]" /> Refund Transactions
              </p>
              <div className="space-y-2">
                {r.refundRecords.map((rec: any) => (
                  <div key={rec.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-white font-bold text-sm">{fmt(rec.amount, rec.currency)}</span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                        rec.status === 'COMPLETED' ? 'bg-emerald-400/15 text-emerald-400' :
                        rec.status === 'FAILED' ? 'bg-red-400/15 text-red-400' :
                        rec.status === 'PROCESSING' ? 'bg-blue-400/15 text-blue-400' :
                        'bg-amber-400/15 text-amber-400'
                      }`}>{rec.status}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500">
                      <span>{rec.method === 'AIRLINE_CREDIT' ? 'Airline Credit' : 'Original Payment'}</span>
                      {rec.stripeRefundId && <span className="font-mono text-slate-600">{rec.stripeRefundId}</span>}
                      {rec.processingDays && <span>~{rec.processingDays} days</span>}
                      {rec.completedAt && <span className="text-emerald-400">Completed {formatDistanceToNow(new Date(rec.completedAt), { addSuffix: true })}</span>}
                      {rec.failedAt && <span className="text-red-400">Failed {formatDistanceToNow(new Date(rec.failedAt), { addSuffix: true })}</span>}
                    </div>
                    {rec.failureReason && <p className="text-red-400/80 text-xs mt-1">{rec.failureReason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Refund method */}
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
            <p className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <CreditCard size={14} className="text-[#1ABC9C]" /> Refund Method
            </p>
            <div className="flex items-center gap-3 px-3 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl">
              <CreditCard size={18} className="text-[#1ABC9C]" />
              <div>
                <p className="text-white text-sm font-semibold">
                  {r.refundMethod === 'AIRLINE_CREDIT' ? 'Airline Credit' : r.refundAmount > 0 ? 'Original Payment Method' : 'No Refund Applicable'}
                </p>
                <p className="text-slate-500 text-[10px]">
                  {isCompleted ? 'Refund processed' : r.refundAmount > 0 ? 'Estimated 5–10 business days' : 'Non-refundable fare'}
                </p>
              </div>
            </div>
          </div>

          {/* Booking status summary */}
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
            <p className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <Shield size={14} className="text-[#1ABC9C]" /> Booking Status
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Booking</span>
                <span className="text-red-400 font-semibold">Cancelled</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment</span>
                <span className={`font-semibold ${
                  r.paymentStatus === 'REFUNDED' ? 'text-emerald-400' :
                  r.paymentStatus === 'PARTIALLY_REFUNDED' ? 'text-amber-400' :
                  r.paymentStatus === 'NO_REFUND' ? 'text-slate-400' :
                  'text-amber-400'
                }`}>
                  {r.paymentStatus?.replace(/_/g, ' ') || 'Unknown'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Ticketing</span>
                <span className="text-slate-400 font-semibold">
                  {r.ticketingStatus?.replace(/_/g, ' ') || 'Unknown'}
                </span>
              </div>
            </div>
          </div>

          {/* Support tickets */}
          {r.supportTickets?.length > 0 && (
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
              <p className="text-white font-bold text-sm mb-3 flex items-center gap-2">
                <Ticket size={14} className="text-[#1ABC9C]" /> Related Support Tickets
              </p>
              <div className="space-y-2">
                {r.supportTickets.map((t: any) => (
                  <button key={t.id}
                    onClick={() => router.push(`/account/support/${t.id}`)}
                    className="w-full text-left px-3 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl hover:bg-white/[0.06] transition-all"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[#1ABC9C] font-mono font-bold text-xs">{t.ticketNumber}</span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                        t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'bg-emerald-400/15 text-emerald-400' :
                        t.status === 'IN_PROGRESS' ? 'bg-amber-400/15 text-amber-400' :
                        'bg-blue-400/15 text-blue-400'
                      }`}>{t.status.replace('_', ' ')}</span>
                    </div>
                    <p className="text-slate-400 text-xs truncate">{t.subject}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Contact support */}
          {!isCompleted && r.refundAmount > 0 && (
            <div className="bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-2xl p-5">
              <p className="text-white font-bold text-sm mb-2 flex items-center gap-2">
                <HelpCircle size={14} className="text-[#1ABC9C]" /> Need Help?
              </p>
              <p className="text-slate-400 text-xs mb-3">
                If your refund is taking longer than expected, our support team can help.
              </p>
              <button
                onClick={() => router.push('/account/support')}
                className="w-full py-2.5 rounded-xl bg-[#1ABC9C] hover:bg-[#16a085] text-white font-bold text-sm transition-all flex items-center justify-center gap-2"
              >
                <Mail size={14} /> Contact Support
              </button>
            </div>
          )}

          {/* Completed banner */}
          {isCompleted && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 size={18} className="text-emerald-400" />
                <p className="text-emerald-400 font-bold text-sm">Refund Complete</p>
              </div>
              <p className="text-slate-400 text-xs">
                Your refund of <strong className="text-white">{fmt(r.refundAmount, r.currency)}</strong> has been processed
                {r.refundedAt && ` on ${new Date(r.refundedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}.
              </p>
            </div>
          )}

          {/* Non-refundable notice */}
          {r.refundAmount === 0 && !r.isRefundable && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <XCircle size={18} className="text-red-400" />
                <p className="text-red-400 font-bold text-sm">Non-Refundable Fare</p>
              </div>
              <p className="text-slate-400 text-xs">
                This booking was on a non-refundable fare. No monetary refund is applicable per the airline&apos;s fare rules.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
