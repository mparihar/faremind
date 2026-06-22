'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';

import {
  LayoutDashboard,
  PlaneTakeoff,
  Clock,
  UserCog,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Search,
  Plane,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DashStats {
  totalBookings: number;
  upcomingTrips: number;
  pendingUpdates: number;
  cancellationRequests: number;
  failedBookings: number;
}

interface AgentBooking {
  id: string;
  masterBookingReference: string;
  masterPnr: string | null;
  customerName: string;
  customerEmail: string;
  originAirport: string;
  destinationAirport: string;
  departureDate: string;
  tripType: string;
  bookingStatus: string;
  paymentStatus: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  pnrs: { pnrCode: string; pnrType: string; isPrimary: boolean }[];
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

export default function AgentDashboardPage() {
  const router = useRouter();
  const { user, sessionToken } = useAuthStore();
  const [stats, setStats] = useState<DashStats | null>(null);
  const [bookings, setBookings] = useState<AgentBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionToken) return;
    fetchDashboard();
  }, [sessionToken]);

  async function fetchDashboard() {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/dashboard', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
        setBookings(data.recentBookings);
      }
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  }

  const statCards = stats ? [
    { label: 'Total Bookings', value: stats.totalBookings, icon: LayoutDashboard, color: 'from-[#1ABC9C] to-[#009CA6]' },
    { label: 'Upcoming Trips', value: stats.upcomingTrips, icon: PlaneTakeoff, color: 'from-blue-500 to-blue-600' },
    { label: 'Pending Updates', value: stats.pendingUpdates, icon: UserCog, color: 'from-amber-500 to-amber-600' },
    { label: 'Cancel Requests', value: stats.cancellationRequests, icon: XCircle, color: 'from-orange-500 to-orange-600' },
    { label: 'Failed Bookings', value: stats.failedBookings, icon: AlertTriangle, color: 'from-red-500 to-red-600' },
  ] : [];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-white">Agent Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">
            Welcome back, <span className="text-[#1ABC9C] font-semibold">{user?.name?.split(' ')[0]}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchDashboard}
            className="p-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-slate-400 hover:text-white transition-all"
            title="Refresh"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
          <button
            onClick={() => router.push('/agent/new-booking')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#1ABC9C] to-[#009CA6] text-white font-bold text-sm shadow-lg shadow-[#1ABC9C]/20 hover:shadow-[#1ABC9C]/40 transition-all"
          >
            <PlaneTakeoff className="w-4 h-4" />
            New Booking
          </button>
        </div>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-800/50 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="relative overflow-hidden rounded-2xl bg-slate-900/80 border border-white/[0.06] p-5 group hover:border-white/10 transition-all"
              >
                <div className={cn('absolute top-0 right-0 w-24 h-24 rounded-full bg-gradient-to-br opacity-10 -translate-y-6 translate-x-6', card.color)} />
                <Icon className="w-5 h-5 text-slate-500 mb-3" />
                <p className="text-3xl font-black text-white">{card.value}</p>
                <p className="text-xs text-slate-500 mt-1 font-medium">{card.label}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent Bookings */}
      <div className="bg-slate-900/80 border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-bold text-white">Recent Bookings</h2>
          </div>
          <button
            onClick={() => router.push('/agent/bookings')}
            className="flex items-center gap-1.5 text-xs font-medium text-[#1ABC9C] hover:text-white transition-colors"
          >
            View All <ExternalLink className="w-3 h-3" />
          </button>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-slate-800/50 animate-pulse" />
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <div className="p-12 text-center">
            <Plane className="w-10 h-10 text-slate-700 mx-auto mb-3" />
            <p className="text-sm text-slate-500 font-medium">No bookings yet</p>
            <p className="text-xs text-slate-600 mt-1">Create your first booking to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {bookings.map((b) => (
              <button
                key={b.id}
                onClick={() => router.push(`/agent/bookings/${b.masterBookingReference}`)}
                className="w-full flex items-center gap-4 px-6 py-4 hover:bg-white/[0.02] transition-all text-left"
              >
                {/* Route */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono font-bold text-[#1ABC9C]">{b.masterBookingReference}</span>
                    {b.pnrs?.[0] && (
                      <span className="text-[10px] font-mono text-slate-500">PNR: {b.pnrs[0].pnrCode}</span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-white">
                    {b.originAirport} → {b.destinationAirport}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{b.customerName}</p>
                </div>

                {/* Date */}
                <div className="text-right shrink-0">
                  <p className="text-xs text-slate-400">
                    {new Date(b.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                  <p className="text-sm font-bold text-white mt-0.5">${b.totalAmount.toLocaleString()}</p>
                </div>

                {/* Status */}
                <div className="shrink-0">
                  <span className={cn(
                    'inline-block px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border',
                    STATUS_COLORS[b.bookingStatus] || 'bg-slate-500/15 text-slate-400 border-slate-500/25'
                  )}>
                    {b.bookingStatus.replace(/_/g, ' ')}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
