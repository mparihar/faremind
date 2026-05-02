'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  flexRender, createColumnHelper, type SortingState,
} from '@tanstack/react-table';
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Filter, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface BookingRow {
  id: string;
  pnr: string | null;
  status: string;
  originAirport: string;
  destinationAirport: string;
  departureTime: string;
  totalPrice: number;
  currency: string;
  cabinClass: string;
  createdAt: string;
  user: { firstName: string; lastName: string; email: string };
  passengers: { id: string; type: string }[];
  payments: { status: string; amount: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: 'bg-emerald-400/15 text-emerald-400',
  TICKETED:  'bg-[#1ABC9C]/15 text-[#1ABC9C]',
  PENDING:   'bg-amber-400/15 text-amber-400',
  CANCELLED: 'bg-red-400/15 text-red-400',
  FAILED:    'bg-red-500/15 text-red-500',
  COMPLETED: 'bg-slate-400/15 text-slate-400',
  REBOOKED:  'bg-purple-400/15 text-purple-400',
};

const STATUSES = ['', 'PENDING', 'CONFIRMED', 'TICKETED', 'CANCELLED', 'COMPLETED', 'FAILED', 'REBOOKED'];

const col = createColumnHelper<BookingRow>();

const columns = [
  col.accessor('pnr', {
    header: 'PNR',
    cell: i => <span className="font-mono text-[#1ABC9C] font-bold text-xs">{i.getValue() ?? i.row.original.id.slice(0, 8)}</span>,
  }),
  col.accessor(r => `${r.user.firstName} ${r.user.lastName}`, {
    id: 'passenger',
    header: 'Passenger',
    cell: i => (
      <div>
        <p className="text-white font-semibold text-xs">{i.getValue()}</p>
        <p className="text-slate-500 text-[11px]">{i.row.original.user.email}</p>
      </div>
    ),
  }),
  col.accessor(r => `${r.originAirport} → ${r.destinationAirport}`, {
    id: 'route',
    header: 'Route',
    cell: i => <span className="text-white font-bold text-xs">{i.getValue()}</span>,
  }),
  col.accessor('departureTime', {
    header: 'Departure',
    cell: i => <span className="text-slate-300 text-xs">{format(new Date(i.getValue()), 'dd MMM yyyy HH:mm')}</span>,
  }),
  col.accessor('cabinClass', {
    header: 'Cabin',
    cell: i => <span className="text-slate-400 text-xs capitalize">{i.getValue().toLowerCase().replace('_', ' ')}</span>,
  }),
  col.accessor(r => r.passengers.length, {
    id: 'paxCount',
    header: 'Pax',
    cell: i => <span className="text-slate-300 text-xs text-center block">{i.getValue()}</span>,
  }),
  col.accessor('totalPrice', {
    header: 'Amount',
    cell: i => (
      <span className="text-white font-bold text-xs">
        {new Intl.NumberFormat('en-US', { style: 'currency', currency: i.row.original.currency }).format(Number(i.getValue()))}
      </span>
    ),
  }),
  col.accessor('status', {
    header: 'Status',
    cell: i => (
      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[i.getValue()] ?? 'bg-slate-400/15 text-slate-400'}`}>
        {i.getValue()}
      </span>
    ),
  }),
  col.accessor('createdAt', {
    header: 'Created',
    cell: i => <span className="text-slate-500 text-[11px]">{format(new Date(i.getValue()), 'dd MMM yyyy')}</span>,
  }),
];

export default function AdminBookingsPage() {
  const router = useRouter();
  const [data, setData]       = useState<BookingRow[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [pages, setPages]     = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('q', search);
    if (status) params.set('status', status);
    const res = await adminFetch(`/api/admin/bookings?${params}`);
    if (res.status === 401) { router.replace('/admin/login'); return; }
    const json = await res.json();
    setData(json.bookings ?? []);
    setTotal(json.total ?? 0);
    setPages(json.pages ?? 1);
    setLoading(false);
  }, [page, search, status, router]);

  useEffect(() => { load(); }, [load]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: pages,
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Bookings</h1>
          <p className="text-slate-400 text-sm mt-0.5">{total.toLocaleString()} total bookings</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search PNR, email, name, airport…"
            className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
          />
        </div>
        <div className="relative">
          <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <select
            value={status}
            onChange={e => { setStatus(e.target.value); setPage(1); }}
            className="pl-8 pr-8 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all appearance-none cursor-pointer"
          >
            {STATUSES.map(s => (
              <option key={s} value={s} className="bg-slate-800">{s || 'All Statuses'}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id} className="border-b border-slate-700/50">
                  {hg.headers.map(header => (
                    <th
                      key={header.id}
                      className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-300 transition-colors"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          header.column.getIsSorted() === 'asc' ? <ChevronUp size={10} className="text-[#1ABC9C]" /> :
                          header.column.getIsSorted() === 'desc' ? <ChevronDown size={10} className="text-[#1ABC9C]" /> :
                          <ChevronsUpDown size={10} className="opacity-30" />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {loading ? (
                <tr><td colSpan={columns.length} className="px-5 py-12 text-center">
                  <RefreshCw size={20} className="text-[#1ABC9C] animate-spin mx-auto" />
                </td></tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr><td colSpan={columns.length} className="px-5 py-12 text-center text-slate-500">No bookings found</td></tr>
              ) : (
                table.getRowModel().rows.map(row => (
                  <tr
                    key={row.id}
                    className="hover:bg-white/2 cursor-pointer transition-colors"
                    onClick={() => router.push(`/admin/bookings/${row.original.id}`)}
                  >
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className="px-5 py-3.5">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-700/50">
          <p className="text-slate-400 text-xs">
            Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, total)} of {total.toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-all"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-slate-300 text-xs font-bold px-2">{page} / {pages}</span>
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
