'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/store/useAdminStore';
import { Wallet, Search, RefreshCw, Plus, Settings2, ToggleLeft, ToggleRight, RotateCcw, X } from 'lucide-react';

interface WalletRow {
  userId: string; agentName: string; agentEmail: string;
  walletAmount: number; utilized: number; remaining: number; currency: string;
  totalBookings: number; totalBookingValue: number;
  walletStatus: 'HEALTHY' | 'LOW' | 'DISABLED'; privilegeEnabled: boolean;
  lastRechargeAt: string | null; lastNotificationAt: string | null;
}

const STATUS_PILL: Record<string, string> = {
  HEALTHY: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
  LOW: 'bg-amber-500/15 text-amber-400 border border-amber-500/25',
  DISABLED: 'bg-red-500/15 text-red-400 border border-red-500/25',
};

const ROW_ACCENT: Record<string, string> = {
  HEALTHY: '', LOW: 'bg-amber-500/[0.03]', DISABLED: 'bg-red-500/[0.04]',
};

export default function AdminWalletsPage() {
  const [rows, setRows] = useState<WalletRow[]>([]);
  const [policy, setPolicy] = useState<{ lowThreshold: number; disableThreshold: number; currency: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState<{ row: WalletRow; action: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (status) p.set('status', status);
      const res = await adminFetch(`/api/admin/wallets?${p.toString()}`);
      const data = await res.json();
      setRows(data.wallets ?? []);
      setPolicy(data.policy ?? null);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [search, status]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n: number, c = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD', maximumFractionDigits: 0 }).format(n);

  async function submitAction() {
    if (!modal) return;
    setBusy(true); setMsg(null);
    try {
      const body: any = { action: modal.action, reason: reason || undefined };
      if (modal.action === 'recharge' || modal.action === 'adjust') body.amount = parseFloat(amount);
      const res = await adminFetch(`/api/admin/wallets/${modal.row.userId}`, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok && data.success) {
        setMsg({ type: 'success', text: `${modal.action} applied for ${modal.row.agentName}.` });
        setModal(null); setAmount(''); setReason(''); load();
      } else {
        setMsg({ type: 'error', text: data.error || 'Action failed.' });
      }
    } catch { setMsg({ type: 'error', text: 'Network error.' }); } finally { setBusy(false); }
  }

  const openModal = (row: WalletRow, action: string) => { setModal({ row, action }); setAmount(action === 'adjust' ? String(row.walletAmount) : ''); setReason(''); setMsg(null); };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-[#1ABC9C]" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">Agent Wallets</h1>
            <p className="text-xs text-slate-500">Prepaid credit control{policy ? ` · low ≤ ${fmt(policy.lowThreshold, policy.currency)} · disable ≤ ${fmt(policy.disableThreshold, policy.currency)}` : ''}</p>
          </div>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {msg && <div className={`mb-4 text-sm px-3 py-2 rounded-xl border ${msg.type === 'success' ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' : 'text-red-400 border-red-500/20 bg-red-500/10'}`}>{msg.text}</div>}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agent name or email…"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-800/50 border border-white/10 text-white text-sm focus:outline-none focus:border-[#1ABC9C]/50" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 rounded-xl bg-slate-800/50 border border-white/10 text-white text-sm">
          <option value="" className="bg-slate-800">All statuses</option>
          <option value="HEALTHY" className="bg-slate-800">Healthy</option>
          <option value="LOW" className="bg-slate-800">Low</option>
          <option value="DISABLED" className="bg-slate-800">Disabled</option>
        </select>
      </div>

      <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/70 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-3">Agent</th>
              <th className="text-right px-4 py-3">Wallet</th>
              <th className="text-right px-4 py-3">Utilized</th>
              <th className="text-right px-4 py-3">Remaining</th>
              <th className="text-right px-4 py-3">Bookings</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-center px-4 py-3">Privilege</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No agents found.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.userId} className={`hover:bg-white/[0.02] ${ROW_ACCENT[r.walletStatus] || ''}`}>
                <td className="px-4 py-3">
                  <p className="text-white font-semibold">{r.agentName}</p>
                  <p className="text-[11px] text-slate-500">{r.agentEmail}</p>
                </td>
                <td className="px-4 py-3 text-right text-white">{fmt(r.walletAmount, r.currency)}</td>
                <td className="px-4 py-3 text-right text-slate-300">{fmt(r.utilized, r.currency)}</td>
                <td className={`px-4 py-3 text-right font-bold ${r.remaining <= (policy?.disableThreshold ?? 0) ? 'text-red-400' : r.remaining <= (policy?.lowThreshold ?? 0) ? 'text-amber-400' : 'text-emerald-400'}`}>{fmt(r.remaining, r.currency)}</td>
                <td className="px-4 py-3 text-right text-slate-300">{r.totalBookings} · {fmt(r.totalBookingValue, r.currency)}</td>
                <td className="px-4 py-3 text-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_PILL[r.walletStatus]}`}>{r.walletStatus}</span></td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-[10px] font-bold ${r.privilegeEnabled ? 'text-emerald-400' : 'text-red-400'}`}>{r.privilegeEnabled ? 'ENABLED' : 'DISABLED'}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => openModal(r, 'recharge')} title="Recharge" className="p-1.5 rounded-lg text-[#1ABC9C] hover:bg-[#1ABC9C]/10 border border-[#1ABC9C]/20"><Plus className="w-3.5 h-3.5" /></button>
                    <button onClick={() => openModal(r, 'adjust')} title="Set wallet amount" className="p-1.5 rounded-lg text-slate-300 hover:bg-white/[0.06] border border-white/10"><Settings2 className="w-3.5 h-3.5" /></button>
                    {r.privilegeEnabled
                      ? <button onClick={() => openModal(r, 'disable')} title="Disable" className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 border border-red-500/20"><ToggleLeft className="w-3.5 h-3.5" /></button>
                      : <button onClick={() => openModal(r, 'enable')} title="Enable" className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20"><ToggleRight className="w-3.5 h-3.5" /></button>}
                    <button onClick={() => openModal(r, 'reset')} title="Reset utilized (Super Admin)" className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 border border-amber-500/20"><RotateCcw className="w-3.5 h-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold capitalize">{modal.action} — {modal.row.agentName}</h3>
              <button onClick={() => setModal(null)}><X className="w-4 h-4 text-slate-500" /></button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Wallet {fmt(modal.row.walletAmount, modal.row.currency)} · Utilized {fmt(modal.row.utilized, modal.row.currency)} · Remaining {fmt(modal.row.remaining, modal.row.currency)}
            </p>
            {(modal.action === 'recharge' || modal.action === 'adjust') && (
              <div className="mb-3">
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">{modal.action === 'recharge' ? 'Recharge amount' : 'New wallet amount'}</label>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white text-sm" />
              </div>
            )}
            <div className="mb-4">
              <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Reason (optional)</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white text-sm" />
            </div>
            {modal.action === 'reset' && <p className="text-[11px] text-amber-400 mb-3">Resets utilized to $0 (Super Admin only).</p>}
            <div className="flex gap-2">
              <button onClick={() => setModal(null)} className="flex-1 py-2 rounded-xl border border-white/10 text-slate-400 text-sm font-semibold">Cancel</button>
              <button onClick={submitAction} disabled={busy} className="flex-1 py-2 rounded-xl bg-[#1ABC9C] hover:bg-[#16a085] text-white text-sm font-bold disabled:opacity-50">{busy ? 'Working…' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
