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
  ChevronLeft, ChevronRight, Filter, RefreshCw, Eye, Trash2,
  Calendar, Plane, CreditCard, Ticket,
} from 'lucide-react';
import { format } from 'date-fns';

interface BookingPnrRow {
  id: string;
  pnrCode: string;
  journeyDirection: string;
  isPrimary: boolean;
  pnrType: string;
  airlineCode?: string | null;
  airlineName?: string | null;
  provider?: string | null;
}

interface BookingRow {
  id: string;
  pnr: string | null;
  masterBookingReference: string;
  pnrStrategy: string | null;
  isSplitTicket: boolean;
  pnrCount: number;
  pnrs: BookingPnrRow[];
  status: string;
  paymentStatus: string;
  ticketingStatus: string;
  provider: string;
  airlineCode: string | null;
  airlineName: string | null;
  tripType: string;
  originAirport: string;
  destinationAirport: string;
  departureTime: string;
  returnDate: string | null;
  totalPrice: number;
  currency: string;
  cabinClass: string;
  customerEmail: string;
  createdAt: string;
  user: { firstName: string; lastName: string; email: string };
  passengers: { id: string; type: string }[];
  payments: { status: string; amount: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  // Booking statuses
  CREATED:    'bg-blue-400/15 text-blue-400',
  CONFIRMED:  'bg-emerald-400/15 text-emerald-400',
  TICKETED:   'bg-[#1ABC9C]/15 text-[#1ABC9C]',
  PENDING:    'bg-amber-400/15 text-amber-400',
  CANCELLED:  'bg-red-400/15 text-red-400',
  FAILED:     'bg-red-500/15 text-red-500',
  COMPLETED:  'bg-slate-400/15 text-slate-400',
  REBOOKED:   'bg-purple-400/15 text-purple-400',
  // Payment
  SUCCEEDED:  'bg-emerald-400/15 text-emerald-400',
  PARTIAL:    'bg-amber-400/15 text-amber-400',
  REFUNDED:   'bg-purple-400/15 text-purple-400',
  PARTIALLY_REFUNDED: 'bg-orange-400/15 text-orange-400',
  // Ticketing
  NOT_STARTED: 'bg-slate-500/15 text-slate-500',
  IN_PROGRESS: 'bg-amber-400/15 text-amber-400',
  ISSUED:      'bg-[#1ABC9C]/15 text-[#1ABC9C]',
  PARTIALLY_ISSUED: 'bg-orange-400/15 text-orange-400',
  VOIDED:      'bg-red-400/15 text-red-400',
};

const BOOKING_STATUSES = ['', 'CREATED', 'CONFIRMED', 'TICKETED', 'CANCELLED', 'COMPLETED', 'FAILED', 'REBOOKED'];
const PAYMENT_STATUSES = ['', 'PENDING', 'PARTIAL', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'];
const TICKETING_STATUSES = ['', 'NOT_STARTED', 'IN_PROGRESS', 'ISSUED', 'PARTIALLY_ISSUED', 'FAILED', 'VOIDED'];
const PROVIDERS = ['', 'duffel', 'mystifly'];
const CABINS = ['', 'economy', 'premium_economy', 'business', 'first'];
const TRIP_TYPES = ['', 'ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY'];

function Badge({ value }: { value: string }) {
  const color = STATUS_COLORS[value] ?? 'bg-slate-400/15 text-slate-400';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${color}`}>
      {value.replace(/_/g, ' ')}
    </span>
  );
}

function PnrPopover({ pnrs, onClick }: { pnrs: BookingPnrRow[]; onClick: (pnr: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (pnrs.length === 1) {
    return (
      <span
        className="font-mono text-xs text-slate-300 font-semibold cursor-pointer hover:text-[#1ABC9C] transition-colors"
        onClick={(e) => { e.stopPropagation(); onClick(pnrs[0].pnrCode); }}
      >
        {pnrs[0].pnrCode}
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-700/50 text-slate-300 text-[10px] font-bold hover:bg-slate-600/50 transition-all"
      >
        {pnrs.length} PNRs
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-slate-800 border border-slate-700 rounded-xl p-2 shadow-2xl min-w-[180px]">
          {pnrs.map(p => (
            <button
              key={p.id}
              onClick={(e) => { e.stopPropagation(); onClick(p.pnrCode); setOpen(false); }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-700/50 transition-all"
            >
              <span className="font-mono text-xs text-white font-bold">{p.pnrCode}</span>
              <span className="text-[10px] text-slate-500">{p.journeyDirection}</span>
              {p.airlineCode && <span className="text-[10px] text-slate-500">{p.airlineCode}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const DIR_LABEL: Record<string, string> = { OUTBOUND: '↗', RETURN: '↙', ALL: '⇄' };

const col = createColumnHelper<BookingRow>();

const DATA_COLUMNS = [
  col.accessor('masterBookingReference', {
    header: 'FBR',
    cell: i => {
      const row = i.row.original;
      return (
        <div className="space-y-1 min-w-[100px]">
          <span className="font-mono text-[#1ABC9C] font-black text-xs block">
            {row.masterBookingReference ?? row.pnr ?? row.id.slice(0, 8)}
          </span>
          {row.isSplitTicket && (
            <span className="inline-block px-1.5 py-0.5 rounded bg-amber-400/10 border border-amber-400/20 text-amber-400 text-[9px] font-bold uppercase tracking-wide">
              Split
            </span>
          )}
        </div>
      );
    },
  }),
  col.display({
    id: 'pnrDisplay',
    header: 'PNR(s)',
    cell: ({ row, table }) => {
      const pnrs = row.original.pnrs ?? [];
      if (pnrs.length === 0) return <span className="text-slate-600 text-xs">—</span>;
      return <PnrPopover pnrs={pnrs} onClick={() => (table.options.meta as any)?.navigateToBooking(row.original.id)} />;
    },
  }),
  col.accessor('provider', {
    header: 'Provider',
    cell: i => <span className="text-slate-400 text-xs capitalize font-semibold">{i.getValue()}</span>,
  }),
  col.accessor(r => `${r.user.firstName} ${r.user.lastName}`, {
    id: 'passenger',
    header: 'Lead Passenger',
    cell: i => (
      <div className="min-w-[120px]">
        <p className="text-white font-semibold text-sm truncate">{i.getValue()}</p>
        <p className="text-slate-500 text-xs truncate">{i.row.original.customerEmail ?? i.row.original.user.email}</p>
      </div>
    ),
  }),
  col.accessor(r => `${r.originAirport} → ${r.destinationAirport}`, {
    id: 'route',
    header: 'Route',
    cell: i => <span className="text-white font-bold text-sm whitespace-nowrap">{i.getValue()}</span>,
  }),
  col.accessor('tripType', {
    header: 'Trip',
    cell: i => {
      const v = i.getValue();
      const label = v === 'ROUND_TRIP' ? 'RT' : v === 'ONE_WAY' ? 'OW' : v === 'MULTI_CITY' ? 'MC' : v;
      const color = v === 'ROUND_TRIP' ? 'text-blue-400' : v === 'ONE_WAY' ? 'text-purple-400' : 'text-slate-400';
      return <span className={`text-xs font-bold ${color}`}>{label}</span>;
    },
  }),
  col.accessor('departureTime', {
    header: 'Departure',
    cell: i => <span className="text-slate-300 text-xs whitespace-nowrap">{format(new Date(i.getValue()), 'dd MMM yyyy')}</span>,
  }),
  col.accessor('cabinClass', {
    header: 'Cabin',
    cell: i => <span className="text-slate-400 text-xs capitalize">{i.getValue().toLowerCase().replace('_', ' ')}</span>,
  }),
  col.accessor(r => r.passengers.length, {
    id: 'paxCount',
    header: 'Pax',
    cell: i => <span className="text-slate-300 text-sm text-center block">{i.getValue()}</span>,
  }),
  col.accessor('totalPrice', {
    header: 'Amount',
    cell: i => (
      <span className="text-white font-bold text-sm whitespace-nowrap">
        {new Intl.NumberFormat('en-US', { style: 'currency', currency: i.row.original.currency }).format(Number(i.getValue()))}
      </span>
    ),
  }),
  col.accessor('status', {
    header: 'Booking',
    cell: i => <Badge value={i.getValue()} />,
  }),
  col.accessor('paymentStatus', {
    header: 'Payment',
    cell: i => <Badge value={i.getValue() ?? 'PENDING'} />,
  }),
  col.accessor('ticketingStatus', {
    header: 'Ticketing',
    cell: i => <Badge value={i.getValue() ?? 'NOT_STARTED'} />,
  }),
  col.accessor('createdAt', {
    header: 'Created',
    cell: i => <span className="text-slate-500 text-xs whitespace-nowrap">{format(new Date(i.getValue()), 'dd MMM yyyy')}</span>,
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
  const [paymentStatus, setPaymentStatus]     = useState('');
  const [ticketingStatus, setTicketingStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [cabin, setCabin]       = useState('');
  const [tripType, setTripType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const limit = 20;

  const activeFilterCount = [paymentStatus, ticketingStatus, provider, cabin, tripType, dateFrom, dateTo].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search)          params.set('q', search);
    if (status)          params.set('status', status);
    if (paymentStatus)   params.set('paymentStatus', paymentStatus);
    if (ticketingStatus) params.set('ticketingStatus', ticketingStatus);
    if (provider)        params.set('provider', provider);
    if (cabin)           params.set('cabin', cabin);
    if (tripType)        params.set('tripType', tripType);
    if (dateFrom)        params.set('from', dateFrom);
    if (dateTo)          params.set('to', dateTo);
    const res = await adminFetch(`/api/admin/bookings?${params}`);
    if (res.status === 401) { router.replace('/admin/login'); return; }
    const json = await res.json();
    setData(json.bookings ?? []);
    setTotal(json.total ?? 0);
    setPages(json.pages ?? 1);
    setLoading(false);
  }, [page, search, status, paymentStatus, ticketingStatus, provider, cabin, tripType, dateFrom, dateTo, router]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string, ref: string | null) {
    const msg = `You are about to delete booking ${ref ?? id} and all associated passengers, PNRs, seats, meals, add-ons, payment records, and logs from FareMind.\n\nThis does not cancel the provider/airline booking unless cancellation flow is executed.\n\nContinue?`;
    if (!window.confirm(msg)) return;
    setDeleting(id);
    const res = await adminFetch(`/api/admin/bookings/${id}`, { method: 'DELETE' });
    setDeleting(null);
    if (res.ok) await load();
  }

  function resetFilters() {
    setPaymentStatus('');
    setTicketingStatus('');
    setProvider('');
    setCabin('');
    setTripType('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  const columns = [
    ...DATA_COLUMNS,
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => router.push(`/admin/bookings/${row.original.id}`)}
            title="Open"
            className="p-1.5 rounded-lg bg-slate-700/40 text-slate-400 hover:text-white transition-all"
          >
            <Eye size={12} />
          </button>
          <button
            onClick={() => handleDelete(row.original.id, row.original.masterBookingReference)}
            disabled={deleting === row.original.id}
            title="Delete booking"
            className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-all"
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
    meta: {
      navigateToBooking: (id: string) => router.push(`/admin/bookings/${id}`),
    },
  });

  const selectCls = 'pl-3 pr-8 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-[#1ABC9C] transition-all appearance-none cursor-pointer';

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

      {/* Search & Primary Filters */}
      <div className="flex gap-3 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[250px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search FBR, PNR, email, name, airport, Stripe ID, provider order…"
            className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
          />
        </div>
        <div className="relative">
          <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <select
            value={status}
            onChange={e => { setStatus(e.target.value); setPage(1); }}
            className={`pl-8 ${selectCls}`}
          >
            {BOOKING_STATUSES.map(s => (
              <option key={s} value={s} className="bg-slate-800">{s || 'All Statuses'}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-semibold transition-all ${
            showFilters || activeFilterCount > 0
              ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30 text-[#1ABC9C]'
              : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
          }`}
        >
          <Filter size={14} />
          Filters
          {activeFilterCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-[#1ABC9C] text-white text-[10px] font-bold">{activeFilterCount}</span>
          )}
        </button>
      </div>

      {/* Advanced Filters Panel */}
      {showFilters && (
        <div className="mb-5 p-4 bg-slate-800/50 border border-slate-700/50 rounded-2xl">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Payment</label>
              <select value={paymentStatus} onChange={e => { setPaymentStatus(e.target.value); setPage(1); }} className={selectCls + ' w-full'}>
                {PAYMENT_STATUSES.map(s => <option key={s} value={s} className="bg-slate-800">{s || 'All'}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Ticketing</label>
              <select value={ticketingStatus} onChange={e => { setTicketingStatus(e.target.value); setPage(1); }} className={selectCls + ' w-full'}>
                {TICKETING_STATUSES.map(s => <option key={s} value={s} className="bg-slate-800">{s || 'All'}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Provider</label>
              <select value={provider} onChange={e => { setProvider(e.target.value); setPage(1); }} className={selectCls + ' w-full'}>
                {PROVIDERS.map(s => <option key={s} value={s} className="bg-slate-800">{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Cabin</label>
              <select value={cabin} onChange={e => { setCabin(e.target.value); setPage(1); }} className={selectCls + ' w-full'}>
                {CABINS.map(s => <option key={s} value={s} className="bg-slate-800">{s ? s.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'All'}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Trip Type</label>
              <select value={tripType} onChange={e => { setTripType(e.target.value); setPage(1); }} className={selectCls + ' w-full'}>
                {TRIP_TYPES.map(s => <option key={s} value={s} className="bg-slate-800">{s ? s.replace(/_/g, ' ') : 'All'}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Depart From</label>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-[#1ABC9C] transition-all" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Depart To</label>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-[#1ABC9C] transition-all" />
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="flex justify-end mt-3">
              <button onClick={resetFilters} className="text-xs text-slate-400 hover:text-white transition-all">Clear all filters</button>
            </div>
          )}
        </div>
      )}

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
                      className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-300 transition-colors whitespace-nowrap"
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
                    className="hover:bg-white/[0.02] cursor-pointer transition-colors"
                    onClick={() => router.push(`/admin/bookings/${row.original.id}`)}
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
    </div>
  );
}
