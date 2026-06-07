'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  flexRender, createColumnHelper, type SortingState,
} from '@tanstack/react-table';
import {
  Search, ChevronUp, ChevronDown, ChevronsUpDown,
  ChevronLeft, ChevronRight, RefreshCw, Trash2,
  Users, Mail, Phone, Calendar, Shield, ShieldOff,
  BookOpen, Clock, AlertTriangle, UserCheck, UserX,
} from 'lucide-react';
import { format } from 'date-fns';

// ── Types ────────────────────────────────────────────────────────────────────

interface CustomerRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  emailVerified: boolean;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  bookingCount: number;
  sessionCount: number;
}

// ── Detail Modal ─────────────────────────────────────────────────────────────

interface CustomerDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  emailVerified: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  masterBookings: Array<{
    id: string;
    masterBookingReference: string;
    masterPnr: string;
    bookingStatus: string;
    tripType: string;
    originAirport: string;
    destinationAirport: string;
    totalAmount: number;
    currency: string;
    createdAt: string;
  }>;
  sessions: Array<{
    id: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    expiresAt: string;
  }>;
  paymentMethods: Array<{
    id: string;
    cardBrand: string;
    cardLast4: string;
    expMonth: number;
    expYear: number;
    status: string;
  }>;
  _count: {
    masterBookings: number;
    sessions: number;
    searchHistory: number;
  };
}

function CustomerDetailModal({
  userId,
  onClose,
  onDelete,
  onToggle,
}: {
  userId: string;
  onClose: () => void;
  onDelete: (id: string, email: string) => void;
  onToggle: (id: string, active: boolean) => void;
}) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    adminFetch(`/api/admin/customers/${userId}`)
      .then(r => r.json())
      .then(d => { setDetail(d.user ?? null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const STATUS_COLORS: Record<string, string> = {
    CONFIRMED: 'bg-emerald-400/15 text-emerald-400',
    TICKETED:  'bg-[#1ABC9C]/15 text-[#1ABC9C]',
    CANCELLED: 'bg-red-400/15 text-red-400',
    COMPLETED: 'bg-slate-400/15 text-slate-400',
    FAILED:    'bg-red-500/15 text-red-500',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        className="w-[520px] h-full bg-slate-900 border-l border-slate-700/50 overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-200"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
          </div>
        ) : !detail ? (
          <div className="flex items-center justify-center h-full text-slate-400">User not found</div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-black text-white">{detail.firstName} {detail.lastName}</h2>
                <p className="text-slate-400 text-sm mt-0.5">{detail.email}</p>
              </div>
              <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none transition-colors">&times;</button>
            </div>

            {/* Status Badges */}
            <div className="flex flex-wrap gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                detail.isActive ? 'bg-emerald-400/15 text-emerald-400' : 'bg-red-400/15 text-red-400'
              }`}>
                {detail.isActive ? <UserCheck size={12} /> : <UserX size={12} />}
                {detail.isActive ? 'Active' : 'Disabled'}
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                detail.emailVerified ? 'bg-blue-400/15 text-blue-400' : 'bg-amber-400/15 text-amber-400'
              }`}>
                <Mail size={12} />
                {detail.emailVerified ? 'Email Verified' : 'Not Verified'}
              </span>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/30">
                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Phone</p>
                <p className="text-white text-sm font-semibold">{detail.phone || '—'}</p>
              </div>
              <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/30">
                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Role</p>
                <p className="text-white text-sm font-semibold capitalize">{detail.role.toLowerCase()}</p>
              </div>
              <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/30">
                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Registered</p>
                <p className="text-white text-sm font-semibold">{format(new Date(detail.createdAt), 'dd MMM yyyy')}</p>
              </div>
              <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/30">
                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Last Login</p>
                <p className="text-white text-sm font-semibold">
                  {detail.lastLoginAt ? format(new Date(detail.lastLoginAt), 'dd MMM yyyy hh:mm a') : 'Never'}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/30 text-center">
                <BookOpen size={16} className="text-[#1ABC9C] mx-auto mb-1" />
                <p className="text-white text-lg font-black">{detail._count.masterBookings}</p>
                <p className="text-slate-500 text-[10px] uppercase font-bold">Bookings</p>
              </div>
              <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/30 text-center">
                <Clock size={16} className="text-blue-400 mx-auto mb-1" />
                <p className="text-white text-lg font-black">{detail._count.sessions}</p>
                <p className="text-slate-500 text-[10px] uppercase font-bold">Sessions</p>
              </div>
              <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/30 text-center">
                <Search size={16} className="text-purple-400 mx-auto mb-1" />
                <p className="text-white text-lg font-black">{detail._count.searchHistory}</p>
                <p className="text-slate-500 text-[10px] uppercase font-bold">Searches</p>
              </div>
            </div>

            {/* Bookings */}
            {detail.masterBookings.length > 0 && (
              <div>
                <h3 className="text-sm font-black text-slate-300 uppercase tracking-wider mb-3">Bookings</h3>
                <div className="space-y-2">
                  {detail.masterBookings.map(b => (
                    <div key={b.id} className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/30 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[#1ABC9C] text-sm font-bold">{b.masterBookingReference}</span>
                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${STATUS_COLORS[b.bookingStatus] ?? 'bg-slate-400/15 text-slate-400'}`}>
                            {b.bookingStatus}
                          </span>
                        </div>
                        <p className="text-white text-sm font-semibold mt-0.5">
                          {b.originAirport} → {b.destinationAirport}
                          <span className="text-slate-500 text-xs ml-2">{b.tripType === 'ROUND_TRIP' ? 'RT' : 'OW'}</span>
                        </p>
                        <p className="text-slate-500 text-xs">{format(new Date(b.createdAt), 'dd MMM yyyy')}</p>
                      </div>
                      <span className="text-white font-bold text-sm">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: b.currency }).format(Number(b.totalAmount))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Sessions */}
            {detail.sessions.length > 0 && (
              <div>
                <h3 className="text-sm font-black text-slate-300 uppercase tracking-wider mb-3">Recent Sessions</h3>
                <div className="space-y-1.5">
                  {detail.sessions.map(s => (
                    <div key={s.id} className="bg-slate-800/40 rounded-lg px-3 py-2 text-xs flex items-center justify-between">
                      <span className="text-slate-400 truncate max-w-[200px]">{s.ipAddress ?? 'Unknown IP'}</span>
                      <span className="text-slate-500">{format(new Date(s.createdAt), 'dd MMM hh:mm a')}</span>
                      <span className={`text-xs font-bold ${new Date(s.expiresAt) > new Date() ? 'text-emerald-400' : 'text-slate-600'}`}>
                        {new Date(s.expiresAt) > new Date() ? 'Active' : 'Expired'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment Methods */}
            {detail.paymentMethods?.length > 0 && (
              <div>
                <h3 className="text-sm font-black text-slate-300 uppercase tracking-wider mb-3">Payment Methods</h3>
                <div className="space-y-1.5">
                  {detail.paymentMethods.map(pm => (
                    <div key={pm.id} className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/30 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-6 bg-slate-700 rounded flex items-center justify-center text-[10px] font-bold text-slate-300 uppercase">
                          {pm.cardBrand === 'Unknown' ? 'CARD' : pm.cardBrand}
                        </div>
                        <div>
                          <p className="text-white text-sm font-semibold">•••• {pm.cardLast4}</p>
                          <p className="text-slate-500 text-xs">Exp {pm.expMonth}/{pm.expYear}</p>
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        pm.status === 'ACTIVE' ? 'bg-emerald-400/15 text-emerald-400' :
                        pm.status === 'EXPIRED' ? 'bg-amber-400/15 text-amber-400' :
                        'bg-red-400/15 text-red-400'
                      }`}>
                        {pm.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="border-t border-slate-700/50 pt-4 space-y-2">
              <button
                onClick={() => onToggle(detail.id, !detail.isActive)}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  detail.isActive
                    ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20'
                    : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                }`}
              >
                {detail.isActive ? <><ShieldOff size={14} /> Disable Account</> : <><Shield size={14} /> Enable Account</>}
              </button>
              <button
                onClick={() => onDelete(detail.id, detail.email)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all"
              >
                <Trash2 size={14} /> Delete User & All Data
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Table Columns ────────────────────────────────────────────────────────────

const col = createColumnHelper<CustomerRow>();

const DATA_COLUMNS = [
  col.accessor(r => `${r.firstName} ${r.lastName}`, {
    id: 'name',
    header: 'Customer',
    cell: i => (
      <div className="min-w-[160px]">
        <p className="text-white font-semibold text-sm">{i.getValue()}</p>
        <p className="text-slate-500 text-xs truncate">{i.row.original.email}</p>
      </div>
    ),
  }),
  col.accessor('phone', {
    header: 'Phone',
    cell: i => <span className="text-slate-400 text-sm">{i.getValue() || '—'}</span>,
  }),
  col.accessor('isActive', {
    header: 'Status',
    cell: i => (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
        i.getValue() ? 'bg-emerald-400/15 text-emerald-400' : 'bg-red-400/15 text-red-400'
      }`}>
        {i.getValue() ? 'Active' : 'Disabled'}
      </span>
    ),
  }),
  col.accessor('emailVerified', {
    header: 'Email',
    cell: i => (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
        i.getValue() ? 'bg-blue-400/15 text-blue-400' : 'bg-amber-400/15 text-amber-400'
      }`}>
        {i.getValue() ? 'Verified' : 'Unverified'}
      </span>
    ),
  }),
  col.accessor('bookingCount', {
    header: 'Bookings',
    cell: i => <span className="text-white font-bold text-sm text-center block">{i.getValue()}</span>,
  }),
  col.accessor('sessionCount', {
    header: 'Sessions',
    cell: i => <span className="text-slate-400 text-sm text-center block">{i.getValue()}</span>,
  }),
  col.accessor('lastLoginAt', {
    header: 'Last Login',
    cell: i => {
      const val = i.getValue();
      if (!val) return <span className="text-slate-600 text-xs">Never</span>;
      return <span className="text-slate-400 text-xs whitespace-nowrap">{format(new Date(val), 'dd MMM yyyy hh:mm a')}</span>;
    },
  }),
  col.accessor('createdAt', {
    header: 'Registered',
    cell: i => <span className="text-slate-500 text-xs whitespace-nowrap">{format(new Date(i.getValue()), 'dd MMM yyyy')}</span>,
  }),
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminCustomersPage() {
  const router = useRouter();
  const [data, setData]           = useState<CustomerRow[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [pages, setPages]         = useState(1);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [status, setStatus]       = useState('');
  const [sorting, setSorting]     = useState<SortingState>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('q', search);
    if (status) params.set('status', status);
    const res = await adminFetch(`/api/admin/customers?${params}`);
    if (res.status === 401) { router.replace('/admin/login'); return; }
    const json = await res.json();
    setData(json.users ?? []);
    setTotal(json.total ?? 0);
    setPages(json.pages ?? 1);
    setLoading(false);
  }, [page, search, status, router]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string, email: string) {
    const msg = `⚠️ PERMANENT DELETION\n\nYou are about to permanently delete user "${email}" and ALL their data including:\n• All bookings & payment records\n• Travel DNA profiles\n• Sessions & search history\n• Saved routes & alerts\n\nThis action CANNOT be undone.\n\nType "DELETE" to confirm:`;
    const input = window.prompt(msg);
    if (input !== 'DELETE') return;

    const res = await adminFetch(`/api/admin/customers/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setSelectedId(null);
      await load();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Failed to delete user');
    }
  }

  async function handleToggle(id: string, active: boolean) {
    const action = active ? 'enable' : 'disable';
    if (!window.confirm(`Are you sure you want to ${action} this user?`)) return;
    const res = await adminFetch(`/api/admin/customers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: active }),
    });
    if (res.ok) {
      setSelectedId(null);
      await load();
    }
  }

  const columns = [
    ...DATA_COLUMNS,
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setSelectedId(row.original.id)}
            title="View details"
            className="p-1.5 rounded-lg bg-slate-700/40 text-slate-400 hover:text-white transition-all"
          >
            <Users size={12} />
          </button>
          <button
            onClick={() => handleToggle(row.original.id, !row.original.isActive)}
            title={row.original.isActive ? 'Disable user' : 'Enable user'}
            className={`p-1.5 rounded-lg transition-all ${
              row.original.isActive
                ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
            }`}
          >
            {row.original.isActive ? <ShieldOff size={12} /> : <Shield size={12} />}
          </button>
          <button
            onClick={() => handleDelete(row.original.id, row.original.email)}
            title="Delete user"
            className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ),
    }),
  ];

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

  const selectCls = 'pl-3 pr-8 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-[#1ABC9C] transition-all appearance-none cursor-pointer';

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center">
              <Users size={20} className="text-[#1ABC9C]" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white">Customer Users</h1>
              <p className="text-slate-400 text-sm mt-0.5">{total.toLocaleString()} registered customers</p>
            </div>
          </div>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[250px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name, email, or phone…"
            className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
          />
        </div>
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1); }}
          className={selectCls}
        >
          <option value="" className="bg-slate-800">All Status</option>
          <option value="active" className="bg-slate-800">Active</option>
          <option value="inactive" className="bg-slate-800">Disabled</option>
        </select>
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
                      className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-300 transition-colors whitespace-nowrap"
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
                <tr><td colSpan={columns.length} className="px-5 py-12 text-center text-slate-500">No customers found</td></tr>
              ) : (
                table.getRowModel().rows.map(row => (
                  <tr
                    key={row.id}
                    className="hover:bg-white/[0.02] cursor-pointer transition-colors"
                    onClick={() => setSelectedId(row.original.id)}
                  >
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className="px-4 py-3">
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
            Showing {Math.min(((page - 1) * limit) + 1, total)}–{Math.min(page * limit, total)} of {total.toLocaleString()}
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

      {/* Detail Slide-Out Panel */}
      {selectedId && (
        <CustomerDetailModal
          userId={selectedId}
          onClose={() => setSelectedId(null)}
          onDelete={handleDelete}
          onToggle={handleToggle}
        />
      )}
    </div>
  );
}
