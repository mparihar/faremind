'use client';

/**
 * Finance — what FareMind processed, and what FareMind earned.
 *
 * The page previously showed three cards: Total Revenue, Total Refunds, Net
 * Revenue. "Total Revenue" was the sum of what customers were charged, which is
 * the airline's money passing through us. On a $2,146 booking where $2,096 goes
 * to the carrier and $50 is our service fee, that reads as forty times what we
 * made. At volume it is the difference between "we sold $500,000 of tickets" and
 * "we earned $18,000", and only the second number pays anyone.
 *
 * So the page is built around two separate ladders, never mixed:
 *
 *   VOLUME     Gross Booking Value → Refunds → Net Booking Value
 *   EARNINGS   FareMind Gross Revenue → Agent Commission → Net Revenue
 *
 * The airline fare appears in the first and never in the second.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  DollarSign, TrendingUp, TrendingDown, RefreshCw, ArrowDownLeft,
  Users, Plane, Wallet, Download, Minus,
} from 'lucide-react';
import { PROVIDERS, providerLabel } from '@/lib/providers/provider-identity';
import HScrollbar from '@/components/ui/HScrollbar';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Whole dollars on cards, cents in the ledger — scanning vs reconciling. */
const money = (n: number, dp = 0) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  }).format(Number.isFinite(n) ? n : 0);

interface Totals {
  grossBookingValue: number; refunds: number; netBookingValue: number;
  serviceFeeRevenue: number; markupRevenue: number; ancillaryRevenue: number;
  insuranceCommission: number; fareMindGrossRevenue: number;
  agentCommission: number; paymentProcessingCost: number | null;
  fareMindNetRevenue: number; providerCost: number;
  bookings: number; averageBookingValue: number;
}

/** The comparison line under a KPI. Null means there is nothing to compare to. */
function Delta({ value, label }: { value: number | null; label: string }) {
  if (value == null) {
    return <p className="text-[10px] text-slate-600 mt-1">No {label} to compare</p>;
  }
  const up = value >= 0;
  const Icon = value === 0 ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <p className={`text-[10px] mt-1 flex items-center gap-1 font-semibold ${
      value === 0 ? 'text-slate-500' : up ? 'text-emerald-400' : 'text-red-400'}`}>
      <Icon size={10} />
      {up && value !== 0 ? '+' : ''}{value}% vs {label}
    </p>
  );
}

function Kpi({ label, value, sub, delta, deltaLabel, tone = 'slate', icon: Icon }: {
  label: string; value: string; sub?: string;
  delta?: number | null; deltaLabel?: string;
  tone?: 'slate' | 'teal' | 'red' | 'amber';
  icon?: React.ElementType;
}) {
  const TONES = {
    slate: 'border-slate-700/50 bg-slate-800/40',
    teal:  'border-[#1ABC9C]/25 bg-[#1ABC9C]/[0.06]',
    red:   'border-red-500/20 bg-red-500/[0.06]',
    amber: 'border-amber-500/20 bg-amber-500/[0.06]',
  };
  return (
    <div className={`rounded-2xl border p-4 ${TONES[tone]}`}>
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon size={13} className="text-slate-400" />}
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-2xl font-black text-white tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
      {deltaLabel !== undefined && <Delta value={delta ?? null} label={deltaLabel} />}
    </div>
  );
}

/**
 * Twelve months of volume and earnings on one axis.
 *
 * Earnings are one to two orders of magnitude smaller than volume, so plotting
 * both against a single scale would flatten revenue into the axis — the line
 * that matters most would be the one you cannot see. Revenue therefore gets its
 * own scale, and the legend says so rather than leaving it to be inferred.
 */
function TrendChart({ monthly, selected, onSelect }: {
  monthly: (Totals & { month: number })[];
  selected: number;
  onSelect: (m: number) => void;
}) {
  const maxVolume = Math.max(1, ...monthly.map(m => m.grossBookingValue));
  const maxRevenue = Math.max(1, ...monthly.map(m => m.fareMindGrossRevenue));
  const H = 132;

  return (
    <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-black text-white">12-Month Financial Performance</h2>
          <p className="text-[10px] text-slate-500 mt-0.5">Click a month to filter the whole page</p>
        </div>
        <div className="flex items-center gap-4 text-[10px] font-semibold">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-600" /> Gross Booking Value
          </span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-500/60" /> Refunds
          </span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#1ABC9C]" /> FareMind Revenue
            <span className="text-slate-600">(own scale)</span>
          </span>
        </div>
      </div>

      <div className="flex items-end gap-1.5" style={{ height: H }}>
        {monthly.map((m) => {
          const vol = (m.grossBookingValue / maxVolume) * H;
          const ref = (m.refunds / maxVolume) * H;
          const rev = (m.fareMindGrossRevenue / maxRevenue) * H;
          const active = m.month === selected;
          return (
            <button
              key={m.month}
              onClick={() => onSelect(m.month)}
              title={`${MONTHS[m.month - 1]} — GBV ${money(m.grossBookingValue)}, refunds ${money(m.refunds)}, revenue ${money(m.fareMindGrossRevenue)}`}
              className={`group relative flex-1 flex items-end justify-center gap-[2px] rounded-t transition-all ${
                active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`}
              style={{ height: H }}
            >
              <span className="w-1/3 rounded-t bg-slate-600 group-hover:bg-slate-500 transition-colors"
                    style={{ height: Math.max(m.grossBookingValue > 0 ? 2 : 0, vol) }} />
              <span className="w-1/3 rounded-t bg-red-500/60"
                    style={{ height: Math.max(m.refunds > 0 ? 2 : 0, ref) }} />
              <span className="w-1/3 rounded-t bg-[#1ABC9C]"
                    style={{ height: Math.max(m.fareMindGrossRevenue > 0 ? 2 : 0, rev) }} />
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {monthly.map((m) => (
          <span key={m.month}
                className={`flex-1 text-center text-[9px] font-bold uppercase tracking-wider ${
                  m.month === selected ? 'text-[#1ABC9C]' : 'text-slate-600'}`}>
            {SHORT[m.month - 1]}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function FinancePage() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [provider, setProvider] = useState('');
  const [tab, setTab] = useState<'platform' | 'agents'>('platform');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const providerScrollRef = useRef<HTMLDivElement>(null);
  const agentScrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ year: String(year), month: String(month) });
    if (provider) qs.set('provider', provider);
    if (tab === 'agents') qs.set('agentUserId', 'AGENTS');
    const res = await adminFetch(`/api/admin/finance?${qs}`);
    if (res.status === 401) { router.replace('/admin/login'); return; }
    if (res.status === 403) { setLoading(false); return; }
    setData(await res.json());
    setLoading(false);
  }, [year, month, provider, tab, router]);

  useEffect(() => { load(); }, [load]);

  const t: Totals | null = data?.totals ?? null;
  const change = data?.change ?? {};
  // January compares against December of the previous year, not against itself.
  const prevLabel = month === 0 ? undefined : month === 1 ? `Dec ${year - 1}` : SHORT[month - 2];

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y + 1, y, y - 1, y - 2];
  }, [now]);

  const monthly = data?.monthly ?? [];
  const hasData = (t?.bookings ?? 0) > 0;

  return (
    <div className="p-8 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Finance</h1>
          <p className="text-slate-500 text-sm">Revenue, refunds, commissions &amp; settlements</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] cursor-pointer">
            {years.map(y => <option key={y} value={y} className="bg-slate-800">{y}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] cursor-pointer">
            <option value={0} className="bg-slate-800">All Months</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1} className="bg-slate-800">{m}</option>)}
          </select>
          <select value={provider} onChange={e => setProvider(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] cursor-pointer">
            <option value="" className="bg-slate-800">All Providers</option>
            {PROVIDERS.map(p => <option key={p} value={p} className="bg-slate-800">{providerLabel(p)}</option>)}
          </select>
          <button onClick={load}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm font-semibold hover:text-white transition-all">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <a href={`/api/admin/finance/ledger?year=${year}&month=${month}${provider ? `&provider=${provider}` : ''}&format=csv`}
            className="flex items-center gap-2 px-4 py-2 bg-[#1ABC9C]/10 border border-[#1ABC9C]/30 rounded-xl text-[#1ABC9C] text-sm font-semibold hover:bg-[#1ABC9C]/20 transition-all">
            <Download size={14} /> Export CSV
          </a>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {(['platform', 'agents'] as const).map(x => (
          <button key={x} onClick={() => setTab(x)}
            className={`px-4 py-2 rounded-xl text-sm font-bold capitalize transition-all border ${
              tab === x ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30 text-[#1ABC9C]'
                        : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:text-white'}`}>
            {x === 'platform' ? 'Platform' : 'Agents'}
          </button>
        ))}
      </div>

      <TrendChart monthly={monthly} selected={month} onSelect={setMonth} />

      {/* Volume — money that moved through FareMind. Not earnings. */}
      <div>
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">
          Transaction volume
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Gross Booking Value" icon={DollarSign}
               value={money(t?.grossBookingValue ?? 0)}
               sub={`${t?.bookings ?? 0} bookings`}
               delta={change.grossBookingValue} deltaLabel={prevLabel} />
          <Kpi label="Refunds" tone="red" icon={ArrowDownLeft}
               value={money(t?.refunds ?? 0)}
               sub={`${data?.refunds?.refundedBookings ?? 0} refunded · ${data?.refunds?.rate ?? 0}% rate`} />
          <Kpi label="Net Booking Value" icon={DollarSign}
               value={money(t?.netBookingValue ?? 0)}
               sub="volume after refunds"
               delta={change.netBookingValue} deltaLabel={prevLabel} />
          <Kpi label="Average Booking" icon={Plane}
               value={money(t?.averageBookingValue ?? 0)}
               sub="per booking" />
        </div>
      </div>

      {/* Earnings — money that is actually FareMind's. */}
      <div>
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">
          FareMind earnings
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Gross Revenue" tone="teal" icon={TrendingUp}
               value={money(t?.fareMindGrossRevenue ?? 0)}
               sub="fees + commissions"
               delta={change.fareMindGrossRevenue} deltaLabel={prevLabel} />
          <Kpi label="Agent Commission" tone="amber" icon={Users}
               value={money(t?.agentCommission ?? 0)}
               sub="shared with agents" />
          <Kpi label="Net Revenue" tone="teal" icon={Wallet}
               value={money(t?.fareMindNetRevenue ?? 0)}
               sub="after commission"
               delta={change.fareMindNetRevenue} deltaLabel={prevLabel} />
          <Kpi label="Provider Cost" icon={Plane}
               value={money(t?.providerCost ?? 0)}
               sub="paid to airlines — not our cost of revenue" />
        </div>
      </div>

      {/* How the money was earned, line by line. */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
        <h2 className="text-sm font-black text-white mb-3">Revenue Breakdown</h2>
        <div className="space-y-1.5 text-sm max-w-xl">
          {[
            ['Service fees', t?.serviceFeeRevenue ?? 0],
            ['Fare markup', t?.markupRevenue ?? 0],
            ['Ancillary (seats, bags)', t?.ancillaryRevenue ?? 0],
            ['Insurance & protection commission', t?.insuranceCommission ?? 0],
          ].map(([label, v]) => (
            <div key={String(label)} className="flex items-center justify-between py-1">
              <span className="text-slate-400">{label}</span>
              <span className="text-white font-semibold tabular-nums">{money(Number(v), 2)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between py-2 border-t border-slate-700/50">
            <span className="text-white font-bold">FareMind Gross Revenue</span>
            <span className="text-[#1ABC9C] font-black tabular-nums">{money(t?.fareMindGrossRevenue ?? 0, 2)}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-slate-400">Less: agent commission</span>
            <span className="text-amber-400 font-semibold tabular-nums">−{money(t?.agentCommission ?? 0, 2)}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-slate-400">Less: payment processing</span>
            {/* Reported as untracked rather than $0 — showing zero for a cost
                nobody captures claims card processing is free. */}
            {t?.paymentProcessingCost == null
              ? <span className="text-slate-600 text-xs italic">not tracked</span>
              : <span className="text-amber-400 font-semibold tabular-nums">−{money(t.paymentProcessingCost, 2)}</span>}
          </div>
          <div className="flex items-center justify-between py-2 border-t border-slate-700/50">
            <span className="text-white font-black">FareMind Net Revenue</span>
            <span className="text-[#1ABC9C] font-black text-lg tabular-nums">{money(t?.fareMindNetRevenue ?? 0, 2)}</span>
          </div>
        </div>
      </div>

      {/* Provider performance */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
        <h2 className="text-sm font-black text-white px-5 pt-5 pb-3">Provider Performance</h2>
        <div ref={providerScrollRef} id="finance-provider-scroll" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-700/50 bg-slate-800/40">
                {['Provider', 'Bookings', 'Gross Booking Value', 'Refunds', 'Net Booking Value',
                  'Provider Cost', 'Service Fees', 'Ancillary', 'FareMind Revenue', 'Avg Booking'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.providers ?? []).map((p: any) => (
                <tr key={p.provider} className="border-b border-slate-700/30">
                  <td className="px-4 py-3 text-white font-semibold whitespace-nowrap">{providerLabel(p.provider) ?? p.provider}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{p.bookings}</td>
                  <td className="px-4 py-3 text-white font-semibold tabular-nums">{money(p.grossBookingValue, 2)}</td>
                  <td className="px-4 py-3 text-red-400 tabular-nums">{money(p.refunds, 2)}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{money(p.netBookingValue, 2)}</td>
                  <td className="px-4 py-3 text-slate-400 tabular-nums">{money(p.providerCost, 2)}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{money(p.serviceFeeRevenue, 2)}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{money(p.ancillaryRevenue, 2)}</td>
                  <td className="px-4 py-3 text-[#1ABC9C] font-bold tabular-nums">{money(p.fareMindGrossRevenue, 2)}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{money(p.averageBookingValue, 2)}</td>
                </tr>
              ))}
              {(data?.providers ?? []).length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500 text-sm">
                  No transactions for {month === 0 ? year : `${MONTHS[month - 1]} ${year}`}.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-2"><HScrollbar targetRef={providerScrollRef} controlsId="finance-provider-scroll" tone="dark" label="Scroll provider table" /></div>
      </div>

      {/* Agent performance */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
        <h2 className="text-sm font-black text-white px-5 pt-5 pb-3">Agent Performance</h2>
        <div ref={agentScrollRef} id="finance-agent-scroll" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-700/50 bg-slate-800/40">
                {['Agent', 'Bookings', 'Gross Booking Value', 'Refunds', 'Service Fees',
                  'Ancillary', 'Agent Commission', 'FareMind Revenue', 'Avg Booking'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.agents ?? []).map((a: any) => (
                <tr key={a.agentUserId} className="border-b border-slate-700/30 hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 text-white font-semibold whitespace-nowrap">{a.agentName}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{a.bookings}</td>
                  <td className="px-4 py-3 text-white font-semibold tabular-nums">{money(a.grossBookingValue, 2)}</td>
                  <td className="px-4 py-3 text-red-400 tabular-nums">{money(a.refunds, 2)}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{money(a.serviceFeeRevenue, 2)}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{money(a.ancillaryRevenue, 2)}</td>
                  <td className="px-4 py-3 text-amber-400 font-semibold tabular-nums">{money(a.agentCommission, 2)}</td>
                  <td className="px-4 py-3 text-[#1ABC9C] font-bold tabular-nums">{money(a.fareMindNetRevenue, 2)}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{money(a.averageBookingValue, 2)}</td>
                </tr>
              ))}
              {(data?.agents ?? []).length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-sm">
                  No agent bookings for {month === 0 ? year : `${MONTHS[month - 1]} ${year}`}.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-2"><HScrollbar targetRef={agentScrollRef} controlsId="finance-agent-scroll" tone="dark" label="Scroll agent table" /></div>
      </div>

      {/* Empty months still render every card at $0 — a blank page reads as
          broken, which is exactly how the old $0 dashboard read. */}
      {!loading && !hasData && (
        <p className="text-center text-slate-500 text-sm py-2">
          No financial transactions for {month === 0 ? year : `${MONTHS[month - 1]} ${year}`}
          {provider ? ` on ${providerLabel(provider)}` : ''}.
        </p>
      )}
    </div>
  );
}
