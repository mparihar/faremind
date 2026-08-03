'use client';

/**
 * Admin: unified Payments dashboard across all purposes + PaymentRequest mgmt.
 * RBAC gate is enforced server-side (withAdmin SUPPORT+); the sidebar hides it
 * below SUPPORT.
 */
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/store/useAdminStore';
import { CreditCard, RefreshCw, Search, Plus, X, Wallet, Ticket, HelpCircle } from 'lucide-react';

interface PayRow {
  /** The airline's record locator. Null until the airline publishes one. */
  airlinePnr?: string | null;
  id: string; purpose: string; status: string; amount: number; currency: string; serviceType: string;
  description: string; customerName: string; customerEmail: string; requestedBy: string; bookingRef: string | null;
  autoRecharge: boolean; stripePaymentIntentId: string | null; paidAt: string | null; failedAt: string | null;
  failureReason: string | null; createdAt: string;
}
interface ReqRow {
  id: string; reference: string; amount: number; currency: string; note: string; payerEmail: string | null;
  payerName: string | null; status: string; createdByEmail: string | null; paidAt: string | null; createdAt: string;
}

const PURPOSE_META: Record<string, { label: string; icon: any; color: string }> = {
  BOOKING_PAYMENT: { label: 'Booking', icon: Ticket, color: 'text-blue-400' },
  AGENT_WALLET_RECHARGE: { label: 'Wallet Recharge', icon: Wallet, color: 'text-[#1ABC9C]' },
  OTHER_PAYMENT: { label: 'Other', icon: HelpCircle, color: 'text-amber-400' },
};
const STATUS_PILL: Record<string, string> = {
  SUCCEEDED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  PENDING: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  FAILED: 'bg-red-500/15 text-red-400 border-red-500/25',
  PAID: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  OPEN: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  CANCELLED: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
  EXPIRED: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
};

export default function AdminPaymentsPage() {
  const [tab, setTab] = useState<'payments' | 'requests'>('payments');
  const [rows, setRows] = useState<PayRow[]>([]);
  const [summary, setSummary] = useState<{ purpose: string; status: string; count: number; sum: number }[]>([]);
  const [reqs, setReqs] = useState<ReqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [purpose, setPurpose] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fmt = (n: number, c = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(n);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (purpose) p.set('purpose', purpose);
      if (status) p.set('status', status);
      if (search) p.set('search', search);
      const res = await adminFetch(`/api/admin/payments?${p.toString()}`);
      const data = await res.json();
      setRows(data.payments ?? []); setSummary(data.summary ?? []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [purpose, status, search]);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/payment-requests?${search ? `search=${encodeURIComponent(search)}` : ''}`);
      const data = await res.json();
      setReqs(data.requests ?? []);
    } catch { setReqs([]); } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { tab === 'payments' ? loadPayments() : loadRequests(); }, [tab, loadPayments, loadRequests]);

  const succeededByPurpose = (pp: string) => summary.filter((s) => s.purpose === pp && s.status === 'SUCCEEDED').reduce((a, s) => a + s.sum, 0);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center"><CreditCard className="w-5 h-5 text-[#1ABC9C]" /></div>
          <div><h1 className="text-xl font-black text-white">Payments</h1><p className="text-xs text-slate-500">All payment purposes · booking, wallet recharge, other</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-[#1ABC9C] hover:bg-[#16a085]"><Plus className="w-3.5 h-3.5" /> New Payment Request</button>
          <button onClick={() => (tab === 'payments' ? loadPayments() : loadRequests())} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        </div>
      </div>

      {msg && <div className={`mb-4 text-sm px-3 py-2 rounded-xl border ${msg.type === 'success' ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' : 'text-red-400 border-red-500/20 bg-red-500/10'}`}>{msg.text}</div>}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {Object.entries(PURPOSE_META).map(([pp, m]) => {
          const Icon = m.icon;
          return (
            <div key={pp} className="rounded-2xl border border-white/[0.06] bg-slate-900/60 p-4">
              <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${m.color}`} /><span className="text-xs text-slate-400 font-semibold">{m.label}</span></div>
              <p className="text-2xl font-black text-white">{fmt(succeededByPurpose(pp))}</p>
              <p className="text-[11px] text-slate-500">settled</p>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4">
        {(['payments', 'requests'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === t ? 'bg-[#1ABC9C]/15 text-[#1ABC9C]' : 'text-slate-400 hover:text-white'}`}>{t === 'payments' ? 'Transactions' : 'Payment Requests'}</button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email, name, PI, reference…" className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-800/50 border border-white/10 text-white text-sm focus:outline-none focus:border-[#1ABC9C]/50" />
        </div>
        {tab === 'payments' && (
          <>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="px-3 py-2 rounded-xl bg-slate-800/50 border border-white/10 text-white text-sm">
              <option value="" className="bg-slate-800">All purposes</option>
              <option value="BOOKING_PAYMENT" className="bg-slate-800">Booking</option>
              <option value="AGENT_WALLET_RECHARGE" className="bg-slate-800">Wallet Recharge</option>
              <option value="OTHER_PAYMENT" className="bg-slate-800">Other</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 rounded-xl bg-slate-800/50 border border-white/10 text-white text-sm">
              <option value="" className="bg-slate-800">All statuses</option>
              <option value="SUCCEEDED" className="bg-slate-800">Succeeded</option>
              <option value="PENDING" className="bg-slate-800">Pending</option>
              <option value="FAILED" className="bg-slate-800">Failed</option>
            </select>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-white/[0.06] overflow-hidden overflow-x-auto">
        {tab === 'payments' ? (
          <table className="w-full text-sm">
            <thead className="bg-slate-800/70 text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="text-left px-4 py-3">Purpose</th><th className="text-left px-4 py-3">Payer</th>
                <th className="text-right px-4 py-3">Amount</th><th className="text-center px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Ref</th><th className="text-left px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {loading ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No payments found.</td></tr>
              : rows.map((r) => {
                const m = PURPOSE_META[r.purpose] || { label: r.purpose, color: 'text-slate-400' };
                return (
                  <tr key={r.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3"><span className={`font-semibold ${m.color}`}>{m.label}</span>{r.autoRecharge && <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400">AUTO</span>}<div className="text-[11px] text-slate-500">{r.description?.slice(0, 40)}</div></td>
                    <td className="px-4 py-3"><p className="text-white">{r.customerName}</p><p className="text-[11px] text-slate-500">{r.customerEmail}</p></td>
                    <td className="px-4 py-3 text-right text-white font-semibold">{fmt(r.amount, r.currency)}</td>
                    <td className="px-4 py-3 text-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_PILL[r.status] || 'bg-slate-500/15 text-slate-400 border-slate-500/25'}`}>{r.status}</span></td>
                    <td className="px-4 py-3 text-[11px] text-slate-400">
                      {r.bookingRef || r.stripePaymentIntentId?.slice(0, 14) || '—'}
                      {r.airlinePnr && <div className="text-[10px] font-mono text-slate-500">PNR {r.airlinePnr}</div>}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-400">{new Date(r.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-800/70 text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="text-left px-4 py-3">FM Ref</th><th className="text-left px-4 py-3">Payer</th>
                <th className="text-right px-4 py-3">Amount</th><th className="text-left px-4 py-3">Note</th>
                <th className="text-center px-4 py-3">Status</th><th className="text-left px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {loading ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
              : reqs.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No payment requests.</td></tr>
              : reqs.map((r) => (
                <tr key={r.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono text-[#1ABC9C]">{r.reference}</td>
                  <td className="px-4 py-3"><p className="text-white">{r.payerName || '—'}</p><p className="text-[11px] text-slate-500">{r.payerEmail || 'anyone'}</p></td>
                  <td className="px-4 py-3 text-right text-white font-semibold">{fmt(r.amount, r.currency)}</td>
                  <td className="px-4 py-3 text-[11px] text-slate-400 max-w-[240px] truncate">{r.note}</td>
                  <td className="px-4 py-3 text-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_PILL[r.status] || 'bg-slate-500/15 text-slate-400 border-slate-500/25'}`}>{r.status}</span></td>
                  <td className="px-4 py-3 text-[11px] text-slate-400">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && <CreateRequestModal onClose={() => setShowCreate(false)} onDone={(text) => { setMsg({ type: 'success', text }); setShowCreate(false); setTab('requests'); loadRequests(); }} onError={(text) => setMsg({ type: 'error', text })} />}
    </div>
  );
}

function CreateRequestModal({ onClose, onDone, onError }: { onClose: () => void; onDone: (t: string) => void; onError: (t: string) => void }) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [note, setNote] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [payerName, setPayerName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [busy, setBusy] = useState(false);
  const cls = 'w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white text-sm';

  async function submit() {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/payment-requests', {
        method: 'POST',
        body: JSON.stringify({ amount: parseFloat(amount), currency, note, payerEmail: payerEmail || undefined, payerName: payerName || undefined, expiresInDays: expiresInDays ? Number(expiresInDays) : undefined }),
      });
      const data = await res.json();
      if (res.ok && data.success) onDone(`Payment request ${data.request.reference} created.`);
      else onError(data.error || 'Failed to create request.');
    } catch { onError('Network error.'); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-white font-bold">New Payment Request</h3><button onClick={onClose}><X className="w-4 h-4 text-slate-500" /></button></div>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Amount</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={cls} /></div>
            <div><label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Currency</label><input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className={cls} /></div>
          </div>
          <div><label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Reason / Note</label><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={`${cls} resize-none`} /></div>
          <div><label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Payer email (optional — targets a user)</label><input value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} className={cls} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Payer name (optional)</label><input value={payerName} onChange={(e) => setPayerName(e.target.value)} className={cls} /></div>
            <div><label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Expires (days)</label><input type="number" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} className={cls} /></div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-slate-400 text-sm font-semibold">Cancel</button>
          <button onClick={submit} disabled={busy || !amount || !note} className="flex-1 py-2 rounded-xl bg-[#1ABC9C] hover:bg-[#16a085] text-white text-sm font-bold disabled:opacity-50">{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}
