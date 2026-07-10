'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import { BookOpen, RefreshCw, ArrowUpRight, ArrowDownLeft, Filter } from 'lucide-react';

/**
 * Admin Finance — Ledger Page
 * Lists all LedgerEntry records (debits/credits) for financial audit.
 * NEW page — does not modify any existing pages.
 */

const TYPE_COLORS: Record<string, string> = {
  PAYMENT:  'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
  REFUND:   'bg-blue-400/15 text-blue-400 border-blue-400/20',
  CHARGE:   'bg-amber-400/15 text-amber-400 border-amber-400/20',
  CREDIT:   'bg-violet-400/15 text-violet-400 border-violet-400/20',
  ADJUSTMENT: 'bg-slate-400/15 text-slate-400 border-slate-400/20',
};

const fmt = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);

export default function LedgerPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');

  async function load() {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/finance/ledger?type=${filter}`);
      if (res.status === 401) { router.replace('/admin/login'); return; }
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [filter]);

  const totalCredits = entries.filter(e => Number(e.amount) > 0).reduce((s, e) => s + Number(e.amount), 0);
  const totalDebits = entries.filter(e => Number(e.amount) < 0).reduce((s, e) => s + Math.abs(Number(e.amount)), 0);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-400/15 flex items-center justify-center">
              <BookOpen size={20} className="text-blue-400" />
            </div>
            Financial Ledger
          </h1>
          <p className="text-slate-400 text-sm mt-1 ml-[52px]">All ledger entries — debits & credits</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Entries</p>
          <p className="text-xl font-black text-white mt-1">{entries.length}</p>
        </div>
        <div className="bg-emerald-400/5 border border-emerald-400/20 rounded-xl p-4">
          <div className="flex items-center gap-1 mb-1"><ArrowUpRight size={12} className="text-emerald-400" /><p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Credits</p></div>
          <p className="text-xl font-black text-emerald-400">{fmt(totalCredits)}</p>
        </div>
        <div className="bg-red-400/5 border border-red-400/20 rounded-xl p-4">
          <div className="flex items-center gap-1 mb-1"><ArrowDownLeft size={12} className="text-red-400" /><p className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Debits</p></div>
          <p className="text-xl font-black text-red-400">{fmt(totalDebits)}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {['ALL', 'PAYMENT', 'REFUND', 'CHARGE', 'CREDIT', 'ADJUSTMENT'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${filter === f ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/20' : 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:text-white'}`}>
            {f === 'ALL' ? 'All' : f}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw size={24} className="animate-spin text-slate-500" /></div>
      ) : (
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                {['Type', 'Amount', 'Description', 'Booking ID', 'Created'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-b border-slate-700/30 hover:bg-slate-800/40 transition-all">
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${TYPE_COLORS[e.type] || 'bg-slate-700/50 text-slate-400 border-slate-600/30'}`}>
                      {e.type}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-sm font-black ${Number(e.amount) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {Number(e.amount) >= 0 ? '+' : ''}{fmt(Number(e.amount), e.currency)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 max-w-[200px] truncate">{e.description || '—'}</td>
                  <td className="px-4 py-3 text-[10px] text-slate-500 font-mono">{e.bookingId?.slice(0, 12) || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{new Date(e.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-500 text-sm">No ledger entries found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
