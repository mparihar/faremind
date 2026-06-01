'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import { RefreshCw, GitMerge, XCircle, ArrowRight, Clock, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

type QueueTab = 'changes' | 'cancellations';

const CHANGE_STATUS_COLORS: Record<string, string> = {
  NEW:                      'bg-amber-400/15 text-amber-400',
  QUOTED:                   'bg-blue-400/15 text-blue-400',
  CUSTOMER_PAYMENT_PENDING: 'bg-purple-400/15 text-purple-400',
};

const CANCEL_STATUS_COLORS: Record<string, string> = {
  CANCEL_REQUESTED: 'bg-red-400/15 text-red-400',
  IN_PROGRESS:      'bg-amber-400/15 text-amber-400',
  REFUND_PENDING:   'bg-blue-400/15 text-blue-400',
};

function fmtMoney(n: number, cur = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
}

export default function WorkQueuesPage() {
  const router = useRouter();
  const [data, setData]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]       = useState<QueueTab>('changes');

  async function load() {
    setLoading(true);
    const res = await adminFetch('/api/admin/work-queues');
    if (res.status === 401) { router.replace('/admin/login'); return; }
    setData(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex items-center justify-center h-screen"><RefreshCw size={24} className="text-[#1ABC9C] animate-spin" /></div>;

  const changes = data?.changes ?? [];
  const cancellations = data?.cancellations ?? [];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Work Queues</h1>
          <p className="text-slate-400 text-sm mt-0.5">Items requiring agent action</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-amber-400/5 border border-amber-400/20 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-400/15 flex items-center justify-center">
            <GitMerge size={22} className="text-amber-400" />
          </div>
          <div>
            <p className="text-3xl font-black text-white">{changes.length}</p>
            <p className="text-amber-400 text-xs font-bold mt-0.5">Pending Change Requests</p>
          </div>
        </div>
        <div className="bg-red-400/5 border border-red-400/20 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-red-400/15 flex items-center justify-center">
            <XCircle size={22} className="text-red-400" />
          </div>
          <div>
            <p className="text-3xl font-black text-white">{cancellations.length}</p>
            <p className="text-red-400 text-xs font-bold mt-0.5">Pending Cancellations</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-700/50">
        {([
          { id: 'changes' as QueueTab, label: `Change Requests (${changes.length})`, icon: GitMerge },
          { id: 'cancellations' as QueueTab, label: `Cancellations (${cancellations.length})`, icon: XCircle },
        ]).map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-all ${
                tab === t.id ? 'border-[#1ABC9C] text-[#1ABC9C]' : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Change requests */}
      {tab === 'changes' && (
        <div className="space-y-3">
          {changes.length === 0 ? (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-10 text-center">
              <AlertCircle size={32} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No pending change requests</p>
            </div>
          ) : changes.map((c: any) => (
            <div key={c.id} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 hover:border-amber-400/30 transition-all">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-white font-bold text-sm">{c.type?.replace('_', ' ')}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${CHANGE_STATUS_COLORS[c.status] ?? 'bg-slate-400/15 text-slate-400'}`}>
                      {c.status?.replace('_', ' ')}
                    </span>
                  </div>
                  {c.booking && (
                    <p className="text-slate-400 text-xs mb-2">
                      Booking <span className="text-[#1ABC9C] font-mono font-bold">{c.booking.pnr ?? c.bookingId.slice(0, 8)}</span>
                      {' · '}{c.booking.originAirport} → {c.booking.destinationAirport}
                      {' · '}{c.booking.user?.firstName} {c.booking.user?.lastName}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Clock size={10} /> {format(new Date(c.createdAt), 'dd MMM yyyy hh:mm a')}</span>
                    {c.totalCost && <span className="text-amber-400 font-bold">Cost: {fmtMoney(Number(c.totalCost), c.currency)}</span>}
                    {c.assignedTo && <span>Assigned: {c.assignedTo}</span>}
                  </div>
                </div>
                <button
                  onClick={() => router.push(`/admin/bookings/${c.bookingId}`)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-xs text-white font-semibold transition-all ml-4"
                >
                  View Booking <ArrowRight size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cancellations */}
      {tab === 'cancellations' && (
        <div className="space-y-3">
          {cancellations.length === 0 ? (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-10 text-center">
              <AlertCircle size={32} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No pending cancellations</p>
            </div>
          ) : cancellations.map((c: any) => (
            <div key={c.id} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 hover:border-red-400/30 transition-all">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${CANCEL_STATUS_COLORS[c.status] ?? 'bg-slate-400/15 text-slate-400'}`}>
                      {c.status?.replace('_', ' ')}
                    </span>
                  </div>
                  {c.booking && (
                    <p className="text-slate-400 text-xs mb-2">
                      Booking <span className="text-[#1ABC9C] font-mono font-bold">{c.booking.pnr ?? c.bookingId.slice(0, 8)}</span>
                      {' · '}{c.booking.originAirport} → {c.booking.destinationAirport}
                      {' · '}{c.booking.user?.firstName} {c.booking.user?.lastName}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Clock size={10} /> {format(new Date(c.createdAt), 'dd MMM yyyy hh:mm a')}</span>
                    <span>Original: <span className="text-white font-bold">{fmtMoney(Number(c.originalAmount), c.currency)}</span></span>
                    {c.refundAmount && <span className="text-[#1ABC9C] font-bold">Refund: {fmtMoney(Number(c.refundAmount), c.currency)}</span>}
                  </div>
                </div>
                <button
                  onClick={() => router.push(`/admin/bookings/${c.bookingId}`)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-xs text-white font-semibold transition-all ml-4"
                >
                  View Booking <ArrowRight size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
