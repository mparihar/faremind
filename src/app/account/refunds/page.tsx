'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  CreditCard, Clock, CheckCircle2, AlertCircle, XCircle,
  Loader2, ArrowRight, ChevronRight, Search,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useManageBookingStore } from '@/store/useManageBookingStore';

const fmt = (n: string | number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n));

function RefundStatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    CANCELLED: ['bg-amber-500/10 text-amber-400 border-amber-500/20', 'Refund Pending'],
    REFUNDED: ['bg-emerald-500/10 text-emerald-400 border-emerald-500/20', 'Refunded'],
    REFUND_FAILED: ['bg-red-500/10 text-red-400 border-red-500/20', 'Refund Failed'],
  };
  const [cls, label] = map[status] || ['bg-slate-500/10 text-slate-400 border-slate-500/20', 'Unknown'];
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${cls}`}>{label}</span>;
}

function RefundSteps({ status }: { status: string }) {
  const steps = [
    { label: 'Cancellation Received', icon: CheckCircle2 },
    { label: 'Airline Processing', icon: Clock },
    { label: 'Refund Initiated', icon: CreditCard },
    { label: 'Refund Complete', icon: CheckCircle2 },
  ];
  const currentStep = status === 'REFUNDED' ? 4 : status === 'CANCELLED' ? 2 : 1;

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => {
        const isDone = i < currentStep;
        const isCurrent = i === currentStep;
        return (
          <div key={step.label} className="flex items-center gap-1">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${isDone ? 'bg-[#1ABC9C]' : isCurrent ? 'bg-[#1ABC9C]/20 border border-[#1ABC9C]/40' : 'bg-white/[0.04] border border-white/[0.08]'}`}>
              {isDone ? <CheckCircle2 size={10} className="text-white" /> : <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />}
            </div>
            {i < steps.length - 1 && (
              <div className={`w-6 h-px ${isDone ? 'bg-[#1ABC9C]' : 'bg-white/[0.08]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function RefundsPage() {
  const { user } = useAuthStore();
  const { bookings, bookingsLoading, loadUserBookings, setBookingsFilter } = useManageBookingStore();

  useEffect(() => {
    if (!user?.id) return;
    setBookingsFilter('all');
    loadUserBookings(user.id);
  }, [user?.id]);

  // Filter to cancelled bookings (potential refunds)
  const refundBookings = bookings.filter(b => b.bookingStatus === 'CANCELLED');
  const totalRefundable = refundBookings.reduce((sum, b) => sum + Number(b.totalAmount), 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Refunds & Credits</h1>
          <p className="text-slate-500 text-sm mt-0.5">Track your cancellation refunds and airline credits</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard size={14} className="text-amber-400" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pending Refunds</span>
          </div>
          <p className="text-xl font-black text-white">{refundBookings.length}</p>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} className="text-blue-400" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Est. Total Value</span>
          </div>
          <p className="text-xl font-black text-[#1ABC9C]">{fmt(totalRefundable)}</p>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Completed</span>
          </div>
          <p className="text-xl font-black text-white">0</p>
        </div>
      </div>

      {/* Refund list */}
      {bookingsLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 text-[#1ABC9C] animate-spin" />
        </div>
      ) : refundBookings.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
            <CreditCard size={24} className="text-slate-600" />
          </div>
          <p className="text-white font-bold mb-1">No refunds</p>
          <p className="text-slate-500 text-sm">You don&apos;t have any cancelled bookings or pending refunds.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {refundBookings.map((b, i) => {
            const j = b.journeys?.[0];
            const origin = j?.originAirport || b.originAirport;
            const dest = j?.destinationAirport || b.destinationAirport;
            return (
              <motion.div key={b.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white font-bold text-sm font-mono">{b.masterBookingReference}</span>
                      <RefundStatusBadge status={b.bookingStatus} />
                    </div>
                    <p className="text-slate-500 text-xs">
                      {origin} → {dest} · {new Date(b.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Amount</p>
                    <p className="text-[#F97316] font-black text-lg">{fmt(b.totalAmount, b.currency)}</p>
                  </div>
                </div>

                {/* Refund progress */}
                <div className="flex items-center justify-between bg-white/[0.02] border border-white/[0.04] rounded-xl px-4 py-3">
                  <RefundSteps status={b.bookingStatus} />
                  <p className="text-slate-500 text-xs">5–10 business days</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
