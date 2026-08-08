'use client';

/**
 * Monthly agent commission settlement.
 *
 * Every payout is a decision a person takes. The system computes what is owed;
 * an admin pays it, pays a corrected figure, or withholds it with a reason. It
 * does not settle itself — this is the last point at which anyone looks at the
 * numbers before money leaves.
 *
 * A decided period shows what was decided rather than disappearing, so a paid
 * month does not read as a month with no business.
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  ArrowLeft, RefreshCw, CheckCircle2, XCircle, Users, Wallet, Clock, AlertTriangle, Landmark,
} from 'lucide-react';
import { format } from 'date-fns';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
    .format(Number.isFinite(n) ? n : 0);

interface AgentDue {
  agentUserId: string;
  agentName: string;
  agentEmail: string;
  dueAmount: number;
  entryCount: number;
  payoutAccount?: {
    canReceiveTransfer: boolean;
    blockedReason: string | null;
    country: string | null;
    connected: boolean;
  };
  payout: {
    status: 'PAID' | 'REJECTED';
    method?: string | null;
    paymentReference?: string | null;
    stripeTransferId?: string | null;
    transferStatus?: string | null;
    systemAmount: number;
    paidAmount: number;
    reason: string | null;
    decidedBy: string | null;
    decidedAt: string;
  } | null;
}

export default function CommissionPayoutsPage() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ agent: AgentDue; action: 'PAY' | 'REJECT' } | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<'EXTERNAL_TRANSFER' | 'STRIPE_CONNECT'>('EXTERNAL_TRANSFER');
  const [paymentReference, setPaymentReference] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await adminFetch(`/api/admin/finance/commission-payouts?year=${year}&month=${month}`);
    if (res.status === 401) { router.replace('/admin/login'); return; }
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [year, month, router]);

  useEffect(() => { load(); }, [load]);

  function open(agent: AgentDue, action: 'PAY' | 'REJECT') {
    setModal({ agent, action });
    // Pre-filled with what the system computed. The admin accepts it by doing
    // nothing, which is the case that should take the fewest keystrokes.
    setAmount(action === 'PAY' ? agent.dueAmount.toFixed(2) : '');
    setReason('');
    setPaymentReference('');
    setPaidOn(new Date().toISOString().slice(0, 10));
    // Default to whichever method can actually complete. Preselecting a
    // platform transfer the agent cannot receive just moves the failure later.
    setMethod(agent.payoutAccount?.canReceiveTransfer ? 'STRIPE_CONNECT' : 'EXTERNAL_TRANSFER');
    setError(null);
  }

  async function submit() {
    if (!modal) return;
    setSaving(true); setError(null);
    try {
      const res = await adminFetch('/api/admin/finance/commission-payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentUserId: modal.agent.agentUserId,
          action: modal.action,
          year, month,
          ...(modal.action === 'PAY' ? { amount, method, paymentReference, paidOn } : {}),
          reason: reason.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? 'Could not complete this.'); setSaving(false); return; }
      setModal(null);
      await load();
    } catch {
      setError('Could not reach the server.');
    }
    setSaving(false);
  }

  const agents: AgentDue[] = data?.agents ?? [];
  const s = data?.summary;
  const bal = data?.balance;
  const corrected = modal?.action === 'PAY' && Number(amount) !== modal.agent.dueAmount;

  return (
    <div className="p-8 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/admin/finance')}
            className="p-2 bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-2xl font-black text-white">Commission Payouts</h1>
            <p className="text-slate-500 text-sm">Settle agent commission for a month — reviewed and approved by hand</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] cursor-pointer">
            {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map(y =>
              <option key={y} value={y} className="bg-slate-800">{y}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] cursor-pointer">
            {MONTHS.map((m, i) => <option key={m} value={i + 1} className="bg-slate-800">{m}</option>)}
          </select>
          <button onClick={load}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm font-semibold hover:text-white transition-all">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Awaiting decision', value: String(s?.awaitingDecision ?? 0), icon: Clock, tone: 'border-amber-500/25 bg-amber-500/[0.06]', sub: `${s?.agents ?? 0} agents this period` },
          { label: 'Total outstanding', value: money(s?.totalDue ?? 0), icon: Wallet, tone: 'border-amber-500/25 bg-amber-500/[0.06]', sub: 'owed to agents' },
          {
            label: 'Stripe balance',
            value: bal?.known ? money(bal.available) : '—',
            icon: Landmark,
            // Amber when it will not cover what is owed — that is the moment to
            // choose external transfer, and it should read at a glance.
            tone: !bal?.known ? 'border-slate-700/50 bg-slate-800/40'
              : bal.available >= (s?.totalDue ?? 0) ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
              : 'border-amber-500/25 bg-amber-500/[0.06]',
            sub: !bal?.known ? 'could not read Stripe'
              : bal.pending > 0 ? `${money(bal.pending)} settling`
              : 'available to transfer',
          },
          { label: 'Paid this period', value: money(s?.totalPaid ?? 0), icon: CheckCircle2, tone: 'border-emerald-500/25 bg-emerald-500/[0.06]', sub: 'settled' },
        ].map(c => (
          <div key={c.label} className={`rounded-2xl border p-4 ${c.tone}`}>
            <div className="flex items-center gap-2 mb-2">
              <c.icon size={13} className="text-slate-400" />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{c.label}</p>
            </div>
            <p className="text-2xl font-black text-white tabular-nums">{c.value}</p>
            {c.sub && <p className="text-[10px] text-slate-500 mt-0.5">{c.sub}</p>}
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50 bg-slate-800/40">
              {['Agent', 'Bookings', 'Amount Due', 'Status', ''].map(h => (
                <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map(a => (
              <tr key={a.agentUserId} className="border-b border-slate-700/30">
                <td className="px-5 py-4">
                  <p className="text-white font-semibold">{a.agentName}</p>
                  <p className="text-slate-500 text-xs">{a.agentEmail}</p>
                </td>
                <td className="px-5 py-4 text-slate-300 tabular-nums">{a.entryCount}</td>
                <td className="px-5 py-4">
                  <span className="text-white font-black tabular-nums">
                    {money(a.payout ? a.payout.systemAmount : a.dueAmount)}
                  </span>
                  {a.payout && a.payout.paidAmount !== a.payout.systemAmount && (
                    <p className="text-[10px] text-amber-400 mt-0.5">paid {money(a.payout.paidAmount)}</p>
                  )}
                </td>
                <td className="px-5 py-4">
                  {!a.payout ? (
                    <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400/15 text-amber-400">
                      Awaiting decision
                    </span>
                  ) : (
                    <div>
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                        a.payout.status === 'PAID' ? 'bg-emerald-400/15 text-emerald-400' : 'bg-red-400/15 text-red-400'}`}>
                        {a.payout.status === 'PAID' ? 'Paid' : 'Withheld'}
                      </span>
                      <p className="text-[10px] text-slate-500 mt-1">
                        {format(new Date(a.payout.decidedAt), 'd MMM yyyy')}
                        {a.payout.decidedBy ? ` · ${a.payout.decidedBy}` : ''}
                      </p>
                      {a.payout.status === 'PAID' && (
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {a.payout.method === 'STRIPE_CONNECT'
                            ? `Platform transfer${a.payout.stripeTransferId ? ` · ${a.payout.stripeTransferId}` : ''}`
                            : `External${a.payout.paymentReference ? ` · ref ${a.payout.paymentReference}` : ''}`}
                        </p>
                      )}
                      {a.payout.reason && <p className="text-[10px] text-slate-400 mt-0.5 max-w-xs">{a.payout.reason}</p>}
                    </div>
                  )}
                </td>
                <td className="px-5 py-4 text-right">
                  {!a.payout && a.dueAmount > 0 && (
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => open(a, 'PAY')}
                        className="px-3 py-1.5 rounded-lg bg-[#1ABC9C]/10 border border-[#1ABC9C]/30 text-[#1ABC9C] text-xs font-bold hover:bg-[#1ABC9C]/20 transition-all">
                        Pay
                      </button>
                      <button onClick={() => open(a, 'REJECT')}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 text-xs font-bold hover:text-red-400 hover:border-red-500/30 transition-all">
                        Reject
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {agents.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-500 text-sm">
                No agent commission earned in {MONTHS[month - 1]} {year}.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !saving && setModal(null)}>
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              {modal.action === 'PAY'
                ? <CheckCircle2 size={16} className="text-[#1ABC9C]" />
                : <XCircle size={16} className="text-red-400" />}
              <h2 className="text-lg font-black text-white">
                {modal.action === 'PAY' ? 'Pay commission' : 'Withhold commission'}
              </h2>
            </div>
            <p className="text-slate-400 text-sm mb-5">
              {modal.agent.agentName} · {MONTHS[month - 1]} {year}
            </p>

            {modal.action === 'PAY' ? (
              <>
                {/* How the money reaches the agent. Two genuinely different
                    things: one is a claim a human is making, the other is a
                    transfer the platform can prove. */}
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                  Payment method
                </label>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {([
                    ['STRIPE_CONNECT', 'Platform transfer', 'Sent to their bank via Stripe now'],
                    ['EXTERNAL_TRANSFER', 'External transfer', 'Paid outside FareMind — recorded here'],
                  ] as const).map(([value, label, hint]) => {
                    const blocked = value === 'STRIPE_CONNECT' && !modal.agent.payoutAccount?.canReceiveTransfer;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={blocked}
                        onClick={() => setMethod(value)}
                        className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                          blocked
                            ? 'bg-slate-800/40 border-slate-700/40 cursor-not-allowed opacity-50'
                            : method === value
                              ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/40'
                              : 'bg-slate-800 border-slate-700 hover:border-slate-600'}`}
                      >
                        <p className={`text-xs font-bold ${method === value && !blocked ? 'text-[#1ABC9C]' : 'text-slate-300'}`}>{label}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{hint}</p>
                      </button>
                    );
                  })}
                </div>

                {/* Transfers draw on the Stripe balance, not a bank account.
                    Said here because this is where the choice is made. */}
                {method === 'STRIPE_CONNECT' && bal?.known && (
                  <p className={`text-[11px] -mt-2 mb-4 leading-relaxed ${
                    bal.available >= (Number(amount) || 0) ? 'text-slate-500' : 'text-amber-400'}`}>
                    Stripe balance available: <span className="font-semibold">{money(bal.available)}</span>
                    {bal.pending > 0 ? ` (${money(bal.pending)} still settling)` : ''}.
                    {bal.available < (Number(amount) || 0) &&
                      ' This does not cover the transfer — top up the balance or pay externally.'}
                  </p>
                )}

                {/* Why the platform option is unavailable, before it is picked
                    rather than after it fails. */}
                {!modal.agent.payoutAccount?.canReceiveTransfer && modal.agent.payoutAccount?.blockedReason && (
                  <p className="text-[11px] text-slate-500 -mt-2 mb-4 leading-relaxed">
                    <span className="text-slate-400 font-semibold">Platform transfer unavailable:</span>{' '}
                    {modal.agent.payoutAccount.blockedReason}
                  </p>
                )}

                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  Amount to pay
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-bold">$</span>
                  <input
                    type="number" min={0} step="0.01" value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white tabular-nums focus:outline-none focus:border-[#1ABC9C]"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  System calculated <span className="text-slate-300 font-semibold">{money(modal.agent.dueAmount)}</span> across{' '}
                  {modal.agent.entryCount} booking{modal.agent.entryCount === 1 ? '' : 's'}. Change it only to correct a discrepancy.
                </p>
                {corrected && (
                  <div className="flex items-start gap-2 mt-3 px-3 py-2.5 rounded-xl bg-amber-500/[0.08] border border-amber-500/25">
                    <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-300 leading-relaxed">
                      You are paying {money(Number(amount) || 0)} instead of {money(modal.agent.dueAmount)}.
                      The difference is recorded against the agent&apos;s ledger, so a reason is required.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 mb-3">
                <AlertTriangle size={13} className="text-slate-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {money(modal.agent.dueAmount)} stays owed to the agent and rolls into the next payout.
                  Withholding is &ldquo;not this month&rdquo;, not a write-off.
                </p>
              </div>
            )}

            {modal.action === 'PAY' && method === 'EXTERNAL_TRANSFER' && (
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                    Payment reference <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={paymentReference}
                    onChange={e => setPaymentReference(e.target.value)}
                    placeholder="Bank / UPI / cheque ref"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-600 focus:outline-none focus:border-[#1ABC9C]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                    Paid on
                  </label>
                  <input
                    type="date" value={paidOn}
                    onChange={e => setPaidOn(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]"
                  />
                </div>
                <p className="col-span-2 text-[11px] text-slate-500 leading-relaxed">
                  The reference is what the agent matches against their bank statement — it is the only link
                  between this record and the money that actually moved.
                </p>
              </div>
            )}

            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mt-4 mb-1">
              Reason {modal.action === 'REJECT' || corrected ? '(required)' : '(optional)'}
            </label>
            <textarea
              value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder={modal.action === 'REJECT' ? 'Why is this being withheld?' : 'Note anything worth recording'}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-600 focus:outline-none focus:border-[#1ABC9C] resize-none"
            />

            {error && <p className="text-red-400 text-xs mt-3">{error}</p>}

            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setModal(null)} disabled={saving}
                className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-sm font-semibold hover:text-white transition-all disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submit} disabled={saving}
                className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all disabled:opacity-50 ${
                  modal.action === 'PAY'
                    ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30 text-[#1ABC9C] hover:bg-[#1ABC9C]/20'
                    : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'}`}>
                {saving ? 'Working…' : modal.action === 'REJECT' ? 'Withhold'
                  : method === 'STRIPE_CONNECT' ? `Transfer ${money(Number(amount) || 0)}`
                  : `Mark ${money(Number(amount) || 0)} as paid`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
