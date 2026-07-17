'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  CreditCard, Clock, CheckCircle2, XCircle,
  Loader2, ChevronRight, Ticket, AlertTriangle,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

const fmt = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);

function RefundStatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    PENDING:    ['bg-amber-500/10 text-amber-400 border-amber-500/20', 'Pending'],
    PROCESSING: ['bg-blue-500/10 text-blue-400 border-blue-500/20', 'Processing'],
    COMPLETED:  ['bg-emerald-500/10 text-emerald-400 border-emerald-500/20', 'Refunded'],
    FAILED:     ['bg-red-500/10 text-red-400 border-red-500/20', 'Failed'],
    PARTIAL:    ['bg-purple-500/10 text-purple-400 border-purple-500/20', 'Partial'],
  };
  const [cls, label] = map[status] || ['bg-slate-500/10 text-slate-400 border-slate-500/20', 'Unknown'];
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${cls}`}>{label}</span>;
}

function RefundSteps({ status }: { status: string }) {
  const steps = ['Cancellation', 'Processing', 'Initiated', 'Complete'];
  const currentStep = status === 'COMPLETED' ? 4 : status === 'PROCESSING' ? 2 : status === 'FAILED' ? 1 : 1;
  return (
    <div className="flex items-center gap-1">
      {steps.map((_, i) => {
        const isDone = i < currentStep;
        const isFailed = status === 'FAILED' && i === 1;
        return (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
              isFailed ? 'bg-red-500/20 border border-red-500/40' :
              isDone ? 'bg-[#1ABC9C]' : 'bg-white/[0.04] border border-white/[0.08]'
            }`}>
              {isFailed ? <XCircle size={10} className="text-red-400" /> :
               isDone ? <CheckCircle2 size={10} className="text-white" /> :
               <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />}
            </div>
            {i < steps.length - 1 && <div className={`w-6 h-px ${isDone && !isFailed ? 'bg-[#1ABC9C]' : 'bg-white/[0.08]'}`} />}
          </div>
        );
      })}
    </div>
  );
}

export default function AgentRefundsPage() {
  const router = useRouter();
  const { sessionToken } = useAuthStore();
  const [refunds, setRefunds] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({ total: 0, pending: 0, completed: 0, failed: 0, totalRefundable: 0, totalRefunded: 0 });
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
          setRefunds(data.refunds || []);
          setSummary(data.summary || summary);
        } else {
          setError('Failed to load refunds.');
        }
      } catch {
        setError('Network error.');
      }
      setLoading(false);
    })();
  }, [sessionToken]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Refunds & Credits</h1>
          <p className="text-slate-500 text-sm mt-0.5">Track cancellation refunds and airline credits</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard size={14} className="text-amber-400" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pending</span>
          </div>
          <p className="text-xl font-black text-white">{summary.pending}</p>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Completed</span>
          </div>
          <p className="text-xl font-black text-emerald-400">{summary.completed}</p>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} className="text-blue-400" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Refundable</span>
          </div>
          <p className="text-xl font-black text-[#1ABC9C]">{fmt(summary.totalRefundable)}</p>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={14} className="text-[#1ABC9C]" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Refunded</span>
          </div>
          <p className="text-xl font-black text-white">{fmt(summary.totalRefunded)}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 text-[#1ABC9C] animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center py-16 text-center">
          <AlertTriangle size={28} className="text-red-400 mb-3" />
          <p className="text-white font-semibold">{error}</p>
        </div>
      ) : refunds.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
            <CreditCard size={24} className="text-slate-600" />
          </div>
          <p className="text-white font-bold mb-1">No refunds</p>
          <p className="text-slate-500 text-sm">No cancelled bookings or pending refunds found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {refunds.map((r: any, i: number) => (
            <motion.button key={r.bookingId}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              onClick={() => router.push(`/agent/refunds/${r.bookingId}`)}
              className="w-full text-left bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 hover:bg-white/[0.06] transition-all group"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-white font-bold text-sm font-mono">{r.bookingRef}</span>
                    {r.pnrCode && r.pnrCode !== r.bookingRef && (
                      <span className="text-slate-500 text-xs font-mono">PNR: {r.pnrCode}</span>
                    )}
                    <RefundStatusBadge status={r.refundStatus} />
                  </div>
                  <p className="text-slate-500 text-xs">
                    {r.origin} → {r.destination} · {new Date(r.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-slate-500 uppercase font-bold">Refund</p>
                  <p className={`font-black text-lg ${r.refundStatus === 'COMPLETED' ? 'text-emerald-400' : 'text-[#F97316]'}`}>
                    {r.refundAmount > 0 ? fmt(r.refundAmount, r.currency) : fmt(r.totalAmount, r.currency)}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between bg-white/[0.02] border border-white/[0.04] rounded-xl px-4 py-3">
                <RefundSteps status={r.refundStatus} />
                <div className="flex items-center gap-3">
                  {r.supportTickets?.length > 0 && (
                    <span className="text-[10px] text-[#1ABC9C] font-bold flex items-center gap-1">
                      <Ticket size={10} /> {r.supportTickets.length}
                    </span>
                  )}
                  <ChevronRight size={14} className="text-slate-600 group-hover:text-white transition-colors" />
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
