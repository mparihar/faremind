'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import { RefreshCw, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

export default function AuditLogsPage() {
  const router = useRouter();
  const [logs, setLogs]     = useState<any[]>([]);
  const [total, setTotal]   = useState(0);
  const [pages, setPages]   = useState(1);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (search) params.set('action', search);
    const res = await adminFetch(`/api/admin/audit-logs?${params}`);
    if (res.status === 401) { router.replace('/admin/login'); return; }
    const data = await res.json();
    setLogs(data.logs ?? []);
    setTotal(data.total ?? 0);
    setPages(data.pages ?? 1);
    setLoading(false);
  }, [page, search, router]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Audit Logs</h1>
          <p className="text-slate-400 text-sm mt-0.5">{total.toLocaleString()} immutable records</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="relative max-w-sm mb-5">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Filter by action…"
          className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
        />
      </div>

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50">
                {['Time', 'Actor', 'Action', 'Entity', 'Entity ID', 'IP'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {loading ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center">
                  <RefreshCw size={20} className="text-[#1ABC9C] animate-spin mx-auto" />
                </td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-500">No logs found</td></tr>
              ) : logs.map((log: any) => (
                <tr key={log.id} className="hover:bg-white/2 transition-colors">
                  <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                    {format(new Date(log.createdAt), 'dd MMM yyyy hh:mm:ss a')}
                  </td>
                  <td className="px-5 py-3">
                    {log.adminUser ? (
                      <div>
                        <p className="text-white text-sm font-semibold">{log.adminUser.fullName}</p>
                        <p className="text-slate-500 text-xs">{log.adminUser.role}</p>
                      </div>
                    ) : <span className="text-slate-500 text-sm">System</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className="px-2 py-0.5 rounded-full bg-[#1ABC9C]/10 text-[#1ABC9C] text-[10px] font-bold font-mono">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-300 text-sm">{log.entityType}</td>
                  <td className="px-5 py-3 text-slate-500 text-xs font-mono">{log.entityId?.slice(0, 12) ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{log.ipAddress ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-700/50">
          <p className="text-slate-400 text-xs">
            {total.toLocaleString()} records · page {page} of {pages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-all"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-all"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
