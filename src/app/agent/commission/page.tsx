'use client';

/**
 * The agent's commission account.
 *
 * Separate from the wallet on purpose, and the page says so. The wallet is the
 * agent's own money, put in to pay for bookings, spendable immediately.
 * Commission is money FareMind owes them for business they brought, accrued when
 * the customer's payment is captured and settled on the monthly payout cycle.
 *
 * Showing the two as one number would imply commission is available to book
 * with, which it is not — an agent who planned around that would find the
 * booking declined.
 */

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  Wallet, TrendingUp, Clock, CheckCircle2, RefreshCw, Info,
} from 'lucide-react';
import { format } from 'date-fns';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const money = (n: number, dp = 2) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  }).format(Number.isFinite(n) ? n : 0);

interface Entry {
  id: string;
  entryType: string;
  amount: number;
  serviceFeeCommission: number | null;
  ancillaryCommission: number | null;
  serviceFeeRate: number | null;
  ancillaryRate: number | null;
  status: string;
  earnedAt: string;
  paidAt: string | null;
  description: string | null;
  booking: {
    masterBookingReference: string;
    originAirport: string;
    destinationAirport: string;
    totalAmount: string | number;
    customerName: string | null;
  } | null;
}

export default function AgentCommissionPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch<any>(`/api/agent/commission?year=${year}&month=${month}`);
      setData(d);
    } catch { setData(null); }
    setLoading(false);
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const entries: Entry[] = data?.entries ?? [];
  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  return (
    <div className="p-6 lg:p-8 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Commission</h1>
          <p className="text-slate-500 text-sm">What you have earned on the bookings you made</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] cursor-pointer">
            {years.map(y => <option key={y} value={y} className="bg-slate-800">{y}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] cursor-pointer">
            <option value={0} className="bg-slate-800">All Months</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1} className="bg-slate-800">{m}</option>)}
          </select>
          <button onClick={load}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm font-semibold hover:text-white transition-all">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={13} className="text-amber-400" />
            <p className="text-[10px] font-black text-amber-400 uppercase tracking-wider">Awaiting payout</p>
          </div>
          <p className="text-2xl font-black text-white tabular-nums">{money(data?.pending ?? 0)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">earned, not yet settled</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={13} className="text-emerald-400" />
            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-wider">Paid out</p>
          </div>
          <p className="text-2xl font-black text-white tabular-nums">{money(data?.paid ?? 0)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">settled to date</p>
        </div>
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={13} className="text-[#1ABC9C]" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
              {month === 0 ? year : `${MONTHS[month - 1]} ${year}`}
            </p>
          </div>
          <p className="text-2xl font-black text-white tabular-nums">{money(data?.periodEarned ?? 0)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{data?.periodBookings ?? 0} entries this period</p>
        </div>
      </div>

      {/* Whether this month has been settled. Without it an agent is looking at
          a list of amounts with no way to tell what has actually been paid. */}
      {data?.payout && (
        <div className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border ${
          data.payout.status === 'PAID'
            ? 'bg-emerald-500/[0.07] border-emerald-500/25'
            : 'bg-amber-500/[0.07] border-amber-500/25'}`}>
          {data.payout.status === 'PAID'
            ? <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
            : <Clock size={15} className="text-amber-400 shrink-0 mt-0.5" />}
          <div>
            {data.payout.status === 'PAID' ? (
              <>
                <p className="text-sm font-bold text-emerald-300">
                  {MONTHS[month - 1]} {year} paid — {money(data.payout.paidAmount)}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Settled on {format(new Date(data.payout.decidedAt), 'd MMMM yyyy')}.
                  {data.payout.paidAmount !== data.payout.systemAmount && (
                    <> Adjusted from {money(data.payout.systemAmount)}{data.payout.reason ? ` — ${data.payout.reason}` : ''}.</>
                  )}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-amber-300">
                  {MONTHS[month - 1]} {year} payout on hold
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {data.payout.reason ?? 'Held for review.'} This commission remains owed to you and carries into the next payout.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* The distinction that matters most, said before they go looking for the
          money in the wrong place. */}
      <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
        <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-400 leading-relaxed">
          Commission is <span className="text-slate-200 font-semibold">separate from your booking wallet</span>.
          Your wallet is your own funds for paying for bookings; commission is what FareMind owes you, and it
          is settled on the monthly payout cycle rather than added to your booking balance.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
        <h2 className="text-sm font-black text-white px-5 pt-5 pb-3">Commission Statement</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-700/50 bg-slate-800/40">
                {['Earned', 'Booking', 'Route', 'Customer', 'Service Fee Share', 'Ancillary Share', 'Commission', 'Status'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-b border-slate-700/30">
                  {/* A real instant — the agent's own zone is correct here. */}
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{format(new Date(e.earnedAt), 'd MMM yyyy')}</td>
                  <td className="px-4 py-3 font-mono text-[#1ABC9C] font-bold whitespace-nowrap">
                    {e.booking?.masterBookingReference ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                    {e.booking ? `${e.booking.originAirport} → ${e.booking.destinationAirport}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 truncate max-w-[160px]">{e.booking?.customerName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums whitespace-nowrap">
                    {e.serviceFeeCommission == null ? '—' : money(e.serviceFeeCommission)}
                    {e.serviceFeeRate != null && <span className="text-slate-600 text-[10px] ml-1">@{e.serviceFeeRate}%</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums whitespace-nowrap">
                    {e.ancillaryCommission == null ? '—' : money(e.ancillaryCommission)}
                    {e.ancillaryRate != null && <span className="text-slate-600 text-[10px] ml-1">@{e.ancillaryRate}%</span>}
                  </td>
                  <td className={`px-4 py-3 font-black tabular-nums whitespace-nowrap ${e.amount < 0 ? 'text-red-400' : 'text-[#1ABC9C]'}`}>
                    {money(e.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      e.entryType === 'REVERSED' ? 'bg-red-400/15 text-red-400'
                      : e.status === 'PAID' ? 'bg-emerald-400/15 text-emerald-400'
                      : 'bg-amber-400/15 text-amber-400'}`}>
                      {e.entryType === 'REVERSED' ? 'Reversed' : e.status === 'PAID' ? 'Paid' : 'Pending'}
                    </span>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500 text-sm">
                  No commission earned in {month === 0 ? year : `${MONTHS[month - 1]} ${year}`}.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
