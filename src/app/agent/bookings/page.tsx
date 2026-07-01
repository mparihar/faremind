'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';

import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Plane,
  Eye,
  UserCog,
  XCircle,
  Mail,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AgentBooking {
  id: string;
  masterBookingReference: string;
  masterPnr: string | null;
  customerName: string;
  customerEmail: string;
  originAirport: string;
  originCity: string;
  destinationAirport: string;
  destinationCity: string;
  departureDate: string;
  tripType: string;
  bookingStatus: string;
  paymentStatus: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  pnrs: { pnrCode: string; pnrType: string; isPrimary: boolean; airlineCode?: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  TICKETED: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  CREATED: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  FAILED: 'bg-red-500/15 text-red-400 border-red-500/25',
  CANCELLED: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
  CANCEL_REQUESTED: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  PENDING: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  CAPTURED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
};

const STATUSES = ['', 'CONFIRMED', 'TICKETED', 'CREATED', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED'];

export default function AgentBookingsPage() {
  const router = useRouter();
  const { sessionToken } = useAuthStore();
  const [bookings, setBookings] = useState<AgentBooking[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchBookings = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.set('search', search);
      if (status) params.set('status', status);

      const res = await fetch(`/api/agent/bookings?${params}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings);
        setTotal(data.total);
        setPages(data.pages);
      }
    } catch (err) {
      console.error('Failed to load bookings:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, page, search, status]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchBookings();
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">My Bookings</h1>
          <p className="text-sm text-slate-400 mt-1">{total} booking{total !== 1 ? 's' : ''} total</p>
        </div>
        <button
          onClick={fetchBookings}
          className="p-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-slate-400 hover:text-white transition-all"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <form onSubmit={handleSearch} className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by FBR, PNR, customer name, or email..."
            className="w-full pl-11 pr-4 py-3 rounded-xl bg-slate-800/50 border border-white/10 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-[#1ABC9C]/50 transition-all"
          />
        </form>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="appearance-none pl-10 pr-8 py-3 rounded-xl bg-slate-800/50 border border-white/10 text-white text-sm focus:outline-none focus:border-[#1ABC9C]/50 cursor-pointer"
          >
            <option value="">All Status</option>
            {STATUSES.filter(Boolean).map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bookings list */}
      <div className="bg-slate-900/80 border border-white/[0.06] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-slate-800/50 animate-pulse" />
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <div className="p-16 text-center">
            <Plane className="w-12 h-12 text-slate-700 mx-auto mb-4" />
            <p className="text-sm text-slate-500 font-medium">No bookings found</p>
            <p className="text-xs text-slate-600 mt-1">
              {search || status ? 'Try adjusting your search or filters' : 'Create your first booking'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {bookings.map((b) => (
              <div
                key={b.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 px-6 py-4 hover:bg-white/[0.02] transition-all"
              >
                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-mono font-bold text-[#1ABC9C]">{b.masterBookingReference}</span>
                    {b.pnrs?.[0] && (
                      <span className="text-[10px] font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                        PNR: {b.pnrs[0].pnrCode}
                      </span>
                    )}
                    <span className={cn(
                      'inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border',
                      STATUS_COLORS[b.bookingStatus] || 'bg-slate-500/15 text-slate-400 border-slate-500/25'
                    )}>
                      {b.bookingStatus.replace(/_/g, ' ')}
                    </span>
                    <span className={cn(
                      'inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border',
                      STATUS_COLORS[b.paymentStatus] || 'bg-slate-500/15 text-slate-400 border-slate-500/25'
                    )}>
                      {b.paymentStatus.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white">
                    {b.originAirport} {b.tripType?.toLowerCase().includes('round') ? '⇄' : '→'} {b.destinationAirport}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    <span>{b.customerName}</span>
                    <span>•</span>
                    <span>{new Date(b.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    <span>•</span>
                    <span className="font-semibold text-white">${b.totalAmount.toLocaleString()}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => router.push(`/agent/bookings/${b.masterBookingReference}`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-all"
                  >
                    <Eye className="w-3 h-3" /> View
                  </button>
                  <button
                    onClick={() => router.push(`/agent/bookings/${b.masterBookingReference}?tab=passengers`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-all"
                  >
                    <UserCog className="w-3 h-3" /> Update
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.06]">
            <p className="text-xs text-slate-500">
              Page {page} of {pages} ({total} total)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg bg-white/[0.04] border border-white/10 text-slate-400 hover:text-white disabled:opacity-30 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(Math.min(pages, page + 1))}
                disabled={page >= pages}
                className="p-2 rounded-lg bg-white/[0.04] border border-white/10 text-slate-400 hover:text-white disabled:opacity-30 transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
