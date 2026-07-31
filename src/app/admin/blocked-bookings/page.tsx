'use client';

/**
 * Admin/Support: bookings blocked by the agent wallet limit (BLOCKED_WALLET_LIMIT).
 * Shows the original agent + wallet headroom, and a one-click reassign once the
 * agent has recharged enough. RBAC enforced server-side (SUPPORT+).
 */
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/store/useAdminStore';
import { Ban, RefreshCw, UserCheck, AlertTriangle } from 'lucide-react';

interface Row {
  id: string; reference: string; pnr: string | null; customerName: string; customerEmail: string;
  route: string; amount: number; currency: string; blockStatus: string; createdAt: string;
  agent: { id: string; name: string; email: string; active: boolean } | null;
  wallet: { walletAmount: number; utilized: number; remaining: number; status: string } | null;
  reassignable: boolean;
}

export default function BlockedBookingsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fmt = (n: number, c = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(n);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await adminFetch('/api/admin/blocked-bookings'); const d = await r.json(); setRows(d.bookings ?? []); }
    catch { setRows([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function reassign(row: Row) {
    if (!confirm(`Reassign ${row.reference} (${fmt(row.amount, row.currency)}) to ${row.agent?.name}? This deducts the amount from their wallet and re-activates them if healthy.`)) return;
    setBusy(row.id); setMsg(null);
    try {
      const r = await adminFetch(`/api/admin/blocked-bookings/${row.id}/assign`, { method: 'POST' });
      const d = await r.json();
      if (r.ok && d.success) { setMsg({ type: 'success', text: `${row.reference} reassigned to ${row.agent?.name}.${d.reactivated ? ' Agent reactivated.' : ''}` }); load(); }
      else setMsg({ type: 'error', text: d.error || 'Reassignment failed.' });
    } catch { setMsg({ type: 'error', text: 'Network error.' }); } finally { setBusy(null); }
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center"><Ban className="w-5 h-5 text-red-400" /></div>
          <div><h1 className="text-xl font-black text-white">Blocked Bookings</h1><p className="text-xs text-slate-500">Over agent wallet limit · not attributed to the agent until reassigned</p></div>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      {msg && <div className={`mb-4 text-sm px-3 py-2 rounded-xl border ${msg.type === 'success' ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' : 'text-red-400 border-red-500/20 bg-red-500/10'}`}>{msg.text}</div>}

      <div className="rounded-2xl border border-white/[0.06] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/70 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-3">Booking</th><th className="text-left px-4 py-3">Customer</th>
              <th className="text-right px-4 py-3">Amount</th><th className="text-left px-4 py-3">Original Agent</th>
              <th className="text-right px-4 py-3">Agent Wallet</th><th className="text-right px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {loading ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No blocked bookings 🎉</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className="hover:bg-white/[0.02] bg-red-500/[0.03]">
                <td className="px-4 py-3"><p className="text-[#1ABC9C] font-mono font-bold">{r.reference}</p><p className="text-[11px] text-slate-500">{r.route} · PNR {r.pnr || '—'}</p><span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">{r.blockStatus}</span></td>
                <td className="px-4 py-3"><p className="text-white">{r.customerName}</p><p className="text-[11px] text-slate-500">{r.customerEmail}</p></td>
                <td className="px-4 py-3 text-right text-white font-bold">{fmt(r.amount, r.currency)}</td>
                <td className="px-4 py-3">{r.agent ? <><p className="text-white">{r.agent.name}</p><p className="text-[11px] text-slate-500">{r.agent.email} · {r.agent.active ? <span className="text-emerald-400">active</span> : <span className="text-red-400">disabled</span>}</p></> : <span className="text-slate-500">—</span>}</td>
                <td className="px-4 py-3 text-right">{r.wallet ? <><p className={r.reassignable ? 'text-emerald-400' : 'text-amber-400'}>{fmt(r.wallet.remaining, r.currency)} left</p><p className="text-[11px] text-slate-500">of {fmt(r.wallet.walletAmount, r.currency)}</p></> : <span className="text-slate-500">—</span>}</td>
                <td className="px-4 py-3 text-right">
                  {r.reassignable ? (
                    <button onClick={() => reassign(r)} disabled={busy === r.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-[#1ABC9C] hover:bg-[#16a085] disabled:opacity-50"><UserCheck className="w-3.5 h-3.5" /> {busy === r.id ? 'Assigning…' : 'Assign to agent'}</button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-400"><AlertTriangle className="w-3.5 h-3.5" /> Needs recharge</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-600 mt-3">Reassign is enabled once the agent&apos;s available wallet balance covers the booking. It deducts the amount, recalculates the wallet, and reactivates the agent if no restriction remains.</p>
    </div>
  );
}
