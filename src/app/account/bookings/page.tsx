'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Plane, Loader2, ChevronRight, Calendar, Search, User,
  ArrowLeftRight, Clock, Ticket, XCircle, Filter,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useManageBookingStore } from '@/store/useManageBookingStore';

type FilterKey = 'all' | 'upcoming' | 'past' | 'cancelled';

const TABS: { key: FilterKey; label: string; icon: any }[] = [
  { key: 'all', label: 'All Trips', icon: Ticket },
  { key: 'upcoming', label: 'Upcoming', icon: Plane },
  { key: 'past', label: 'Past', icon: Clock },
  { key: 'cancelled', label: 'Cancelled', icon: XCircle },
];

const STATUS_MAP: Record<string, { cls: string; dot: string; label: string }> = {
  CONFIRMED: { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400', label: 'Confirmed' },
  TICKETED:  { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400', label: 'Ticketed' },
  CREATED:   { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20', dot: 'bg-amber-400', label: 'Processing' },
  CANCELLED: { cls: 'bg-red-500/10 text-red-400 border-red-500/20', dot: 'bg-red-400', label: 'Cancelled' },
  COMPLETED: { cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20', dot: 'bg-blue-400', label: 'Completed' },
  FAILED:    { cls: 'bg-red-500/10 text-red-400 border-red-500/20', dot: 'bg-red-400', label: 'Failed' },
};

const STATUS_BORDER: Record<string, string> = {
  CONFIRMED: 'border-l-emerald-400/60',
  TICKETED:  'border-l-emerald-400/60',
  CREATED:   'border-l-amber-400/60',
  CANCELLED: 'border-l-red-400/60',
  COMPLETED: 'border-l-blue-400/60',
  FAILED:    'border-l-red-400/60',
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] || { cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20', dot: 'bg-slate-400', label: status };
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${s.cls}`}>
      <span className={`w-2 h-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

const fmt = (n: string | number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n));

function daysUntil(dateStr: string): number {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000));
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MyTripsPage() {
  const { user } = useAuthStore();
  const { bookings, bookingsLoading, bookingCounts, setBookingsFilter, loadUserBookings } = useManageBookingStore();
  const searchParams = useSearchParams();
  const initialFilter = (searchParams.get('filter') as FilterKey) || 'all';
  const [activeFilter, setActiveFilter] = useState<FilterKey>(initialFilter);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!user?.id) return;
    setBookingsFilter(activeFilter);
    loadUserBookings(user.id);
  }, [user?.id, activeFilter, setBookingsFilter, loadUserBookings]);

  const filtered = useMemo(() => {
    if (!search.trim()) return bookings;
    const q = search.toLowerCase();
    return bookings.filter(b =>
      (b.masterBookingReference || '').toLowerCase().includes(q) ||
      (b.masterPnr || '').toLowerCase().includes(q) ||
      (b.originAirport || '').toLowerCase().includes(q) ||
      (b.destinationAirport || '').toLowerCase().includes(q) ||
      (b.customerName || '').toLowerCase().includes(q)
    );
  }, [bookings, search]);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-black text-white">My Trips</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {bookingCounts.total} booking{bookingCounts.total !== 1 ? 's' : ''}
            {bookingCounts.upcoming > 0 && <span className="text-[#1ABC9C]"> · {bookingCounts.upcoming} upcoming</span>}
          </p>
        </div>
        <Link href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold transition-all hover:bg-[#16a085] shadow-lg shadow-[#1ABC9C]/15 hover:shadow-[#1ABC9C]/25 shrink-0 sm:ml-8">
          <Plane size={14} />
          Book New Flight
        </Link>
      </div>

      {/* Search + Filters row */}
      <div className="flex flex-col sm:flex-row gap-3 mb-8">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by reference, PNR, city…"
            className="w-full pl-9 pr-4 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-[#1ABC9C]/40 transition-all"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeFilter === tab.key;
            const count = tab.key === 'all' ? bookingCounts.total : bookingCounts[tab.key] || 0;
            return (
              <button key={tab.key} onClick={() => setActiveFilter(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${active
                  ? 'bg-[#1ABC9C] text-white shadow-lg shadow-[#1ABC9C]/20'
                  : 'bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.07]'}`}>
                <Icon size={14} />
                {tab.label}
                <span className={`text-[11px] ${active ? 'opacity-70' : 'text-slate-400'}`}>({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Booking list */}
      {bookingsLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-7 h-7 text-[#1ABC9C] animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
            <Plane size={24} className="text-slate-600" />
          </div>
          <p className="text-white font-bold mb-1">
            {search ? 'No matching bookings' : 'No trips found'}
          </p>
          <p className="text-slate-500 text-sm">
            {search
              ? `No bookings match "${search}". Try a different search.`
              : activeFilter === 'all'
                ? 'Your bookings will appear here once you book a flight.'
                : `No ${activeFilter} bookings found.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((b, idx) => {
            const journey = b.journeys?.[0];
            const outbound = b.journeys?.find((jj: any) => jj.direction === 'OUTBOUND') || journey;
            const ret = b.journeys?.find((jj: any) => jj.direction === 'RETURN');
            const isRT = (b.tripType || '').toLowerCase().includes('round');
            const paxCount = b.passengers?.length || 1;
            const isPast = new Date(b.departureDate) < new Date();
            const isCancelled = b.bookingStatus === 'CANCELLED';
            const days = daysUntil(b.departureDate);
            const borderColor = STATUS_BORDER[b.bookingStatus] || 'border-l-slate-600';

            // Build legs
            const legs: Array<{ j: any; label: string; isReturn: boolean }> = [];
            if (outbound) legs.push({ j: outbound, label: 'Outbound', isReturn: false });
            if (isRT && ret) legs.push({ j: ret, label: 'Return', isReturn: true });


            return (
              <motion.div key={b.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}>
                <Link href={`/account/bookings/${b.id}`}
                  className={`block bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden hover:border-[#1ABC9C]/30 hover:bg-white/[0.06] transition-all group border-l-[3px] ${borderColor}`}>
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Status row */}
                        <div className="flex items-center gap-3 mb-4 flex-wrap">
                          {b.masterBookingReference && b.masterPnr && (
                            <span className="text-[11px] text-slate-500 font-mono">
                              REFERENCE: <span className="text-slate-300 font-bold">{b.masterBookingReference}</span>
                            </span>
                          )}
                          <span className="text-sm text-slate-300 font-mono font-bold tracking-wider">
                            Airline PNR: {b.masterPnr || b.masterBookingReference}
                          </span>
                          <StatusBadge status={b.bookingStatus} />
                          {isRT && (
                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-white/[0.04] px-2.5 py-0.5 rounded-full border border-white/[0.06]">
                              Round Trip
                            </span>
                          )}
                          {!isPast && !isCancelled && days <= 7 && (
                            <span className="text-[11px] font-bold text-[#1ABC9C] bg-[#1ABC9C]/10 px-2.5 py-0.5 rounded-full border border-[#1ABC9C]/20">
                              {days === 0 ? 'TODAY' : days === 1 ? 'TOMORROW' : `${days} DAYS`}
                            </span>
                          )}
                        </div>

                        {/* Journey Legs */}
                        <div className="space-y-3 mb-4">
                          {legs.map((leg, legIdx) => {
                            const lj = leg.j;
                            const lOrigin = lj?.originAirport || b.originAirport;
                            const lDest = lj?.destinationAirport || b.destinationAirport;
                            const lOriginCity = lj?.originCity || b.originCity;
                            const lDestCity = lj?.destinationCity || b.destinationCity;
                            const lDepDate = lj?.departureDateTime || b.departureDate;
                            const lDepTime = new Date(lDepDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                            const lAirline = lj?.segments?.[0]?.airlineName || lj?.segments?.[0]?.airlineCode || '';
                            const lStops = lj?.totalStops ?? 0;

                            return (
                              <div key={legIdx}>
                                {/* Leg label for round trips */}
                                {legs.length > 1 && (
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className={`w-1.5 h-1.5 rounded-full ${leg.isReturn ? 'bg-purple-400' : 'bg-[#1ABC9C]'}`} />
                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${leg.isReturn ? 'text-purple-400' : 'text-[#1ABC9C]'}`}>
                                      {leg.label}
                                    </span>
                                    {lAirline && <span className="text-slate-500 text-[10px]">· {lAirline}</span>}
                                  </div>
                                )}

                                {/* Route row */}
                                <div className="flex items-center gap-4">
                                  <div>
                                    <p className={`text-white font-black leading-none ${legs.length > 1 ? 'text-2xl' : 'text-3xl'}`}>{lOrigin}</p>
                                    <p className="text-slate-400 text-sm mt-1">{lOriginCity}</p>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-1 max-w-[80px]">
                                    <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-white/5" />
                                    <Plane size={13} className={`shrink-0 ${leg.isReturn ? 'text-purple-400 -rotate-90' : 'text-[#1ABC9C] rotate-90'}`} />
                                    <div className="h-px flex-1 bg-gradient-to-l from-white/10 to-white/5" />
                                  </div>
                                  <div>
                                    <p className={`text-white font-black leading-none ${legs.length > 1 ? 'text-2xl' : 'text-3xl'}`}>{lDest}</p>
                                    <p className="text-slate-400 text-sm mt-1">{lDestCity}</p>
                                  </div>
                                </div>

                                {/* Date + Time + Stops */}
                                <div className="flex items-center gap-3 mt-2 text-sm text-slate-400">
                                  <span className="flex items-center gap-1.5">
                                    <Calendar size={13} className={leg.isReturn ? 'text-purple-400' : 'text-[#1ABC9C]'} />
                                    {formatDate(lDepDate)}
                                  </span>
                                  <span className="text-slate-600">·</span>
                                  <span className="flex items-center gap-1.5">
                                    <Clock size={13} className={leg.isReturn ? 'text-purple-400' : 'text-[#1ABC9C]'} />
                                    <span className="text-white font-semibold">{lDepTime}</span>
                                  </span>
                                  <span className="text-slate-600">·</span>
                                  <span>{lStops === 0 ? 'Nonstop' : lStops === 1 ? '1 stop' : `${lStops} stops`}</span>
                                </div>

                                {/* Divider between legs */}
                                {legIdx < legs.length - 1 && (
                                  <div className="border-t border-dashed border-white/[0.08] mt-3" />
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Meta: Pax + Provider */}
                        <div className="flex items-center gap-3 text-sm text-slate-400">
                          <span className="flex items-center gap-1.5">
                            <User size={13} />
                            {paxCount} pax
                          </span>
                          {b.primaryProvider && (
                            <>
                              <span className="text-slate-500">·</span>
                              <span className="capitalize">{b.primaryProvider}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Price + Manage */}
                      <div className="text-right shrink-0 flex flex-col items-end gap-2">
                        <div>
                          <p className="text-[#F97316] font-black text-2xl leading-none">
                            {fmt(b.totalAmount, b.currency)}
                          </p>
                          <p className="text-slate-400 text-sm mt-1 capitalize">
                            {(b.paymentStatus || '').replace(/_/g, ' ').toLowerCase()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 group-hover:text-[#1ABC9C] transition-colors">
                          Manage
                          <ChevronRight size={14} />
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
