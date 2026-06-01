'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  TrendingUp, BookOpen, XCircle, AlertTriangle, DollarSign,
  GitMerge, Bell, RefreshCw, ArrowRight, Plane,
} from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';

interface Stats {
  totalBookings: number;
  confirmedToday: number;
  cancelledToday: number;
  pendingWork: number;
  pendingChanges: number;
  pendingCancellations: number;
  openAlerts: number;
  weekRevenue: number;
  monthRevenue: number;
}

interface RecentBooking {
  id: string;
  pnr: string | null;
  status: string;
  originAirport: string;
  destinationAirport: string;
  departureTime: string;
  totalPrice: number;
  currency: string;
  createdAt: string;
  user: { firstName: string; lastName: string; email: string };
  payments: { status: string; amount: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED:  'bg-emerald-400/15 text-emerald-400',
  TICKETED:   'bg-[#1ABC9C]/15 text-[#1ABC9C]',
  PENDING:    'bg-amber-400/15 text-amber-400',
  CANCELLED:  'bg-red-400/15 text-red-400',
  FAILED:     'bg-red-500/15 text-red-500',
  COMPLETED:  'bg-slate-400/15 text-slate-400',
  REBOOKED:   'bg-purple-400/15 text-purple-400',
};

function StatCard({ label, value, sub, icon: Icon, color, href }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; href?: string;
}) {
  const content = (
    <div className={`bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 h-full ${href ? 'hover:bg-slate-800 hover:border-slate-600 transition-all cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">{label}</p>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={18} />
        </div>
      </div>
      <p className="text-3xl font-black text-white">{value}</p>
      {sub && <p className="text-slate-400 text-xs mt-1">{sub}</p>}
    </div>
  );

  if (href) {
    return <Link href={href} className="block h-full">{content}</Link>;
  }
  return content;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<RecentBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const res = await adminFetch('/api/admin/dashboard');
      if (res.status === 401) { router.replace('/admin/login'); return; }
      const data = await res.json();
      setStats(data.stats);
      setRecent(data.recentBookings ?? []);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-white">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Real-time operations overview</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Bookings"   value={stats?.totalBookings ?? 0}       icon={BookOpen}      color="bg-blue-400/10 text-blue-400" href="/admin/bookings" />
        <StatCard label="Confirmed Today"  value={stats?.confirmedToday ?? 0}      icon={TrendingUp}    color="bg-emerald-400/10 text-emerald-400" sub="bookings confirmed today" href="/admin/bookings" />
        <StatCard label="Cancelled Today"  value={stats?.cancelledToday ?? 0}      icon={XCircle}       color="bg-red-400/10 text-red-400" href="/admin/bookings" />
        <StatCard label="Pending Work"     value={stats?.pendingWork ?? 0}          icon={AlertTriangle} color="bg-amber-400/10 text-amber-400"
          sub={`${stats?.pendingChanges ?? 0} changes · ${stats?.pendingCancellations ?? 0} cancellations`} href="/admin/work-queues" />
        <StatCard label="Week Revenue"     value={fmt(stats?.weekRevenue ?? 0)}     icon={DollarSign}    color="bg-[#1ABC9C]/10 text-[#1ABC9C]" sub="last 7 days" />
        <StatCard label="Month Revenue"    value={fmt(stats?.monthRevenue ?? 0)}    icon={DollarSign}    color="bg-purple-400/10 text-purple-400" sub="this month" />
        <StatCard label="Price Alerts"     value={stats?.openAlerts ?? 0}           icon={Bell}          color="bg-orange-400/10 text-orange-400" sub="open alerts" />
        <StatCard label="Work Queue Items" value={(stats?.pendingChanges ?? 0) + (stats?.pendingCancellations ?? 0)} icon={GitMerge} color="bg-sky-400/10 text-sky-400" href="/admin/work-queues" />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <button
          onClick={() => router.push('/admin/work-queues')}
          className="flex items-center justify-between p-5 bg-amber-400/5 border border-amber-400/20 rounded-2xl hover:bg-amber-400/10 transition-all group"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-400/15 flex items-center justify-center">
              <GitMerge size={20} className="text-amber-400" />
            </div>
            <div className="text-left">
              <p className="text-white font-bold text-sm">Open Work Queue</p>
              <p className="text-amber-400 text-xs">{stats?.pendingWork ?? 0} items need attention</p>
            </div>
          </div>
          <ArrowRight size={16} className="text-slate-500 group-hover:text-amber-400 transition-colors" />
        </button>

        <button
          onClick={() => router.push('/admin/bookings')}
          className="flex items-center justify-between p-5 bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-2xl hover:bg-[#1ABC9C]/10 transition-all group"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#1ABC9C]/15 flex items-center justify-center">
              <Plane size={20} className="text-[#1ABC9C]" />
            </div>
            <div className="text-left">
              <p className="text-white font-bold text-sm">All Bookings</p>
              <p className="text-[#1ABC9C] text-xs">Search, filter, manage bookings</p>
            </div>
          </div>
          <ArrowRight size={16} className="text-slate-500 group-hover:text-[#1ABC9C] transition-colors" />
        </button>
      </div>

      {/* Recent bookings */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <h2 className="text-white font-bold text-sm">Recent Bookings</h2>
          <button
            onClick={() => router.push('/admin/bookings')}
            className="text-[#1ABC9C] text-xs font-bold hover:underline flex items-center gap-1"
          >
            View all <ArrowRight size={12} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50">
                {['AIRLINE PNR', 'Passenger', 'Route', 'Departure', 'Amount', 'Status'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {recent.map(b => (
                <tr
                  key={b.id}
                  className="hover:bg-white/2 cursor-pointer transition-colors"
                  onClick={() => router.push(`/admin/bookings/${b.id}`)}
                >
                  <td className="px-6 py-3.5 font-mono text-[#1ABC9C] font-bold text-sm">{b.pnr ?? b.id.slice(0, 8)}</td>
                  <td className="px-6 py-3.5">
                    <p className="text-white font-semibold text-sm">{b.user.firstName} {b.user.lastName}</p>
                    <p className="text-slate-500 text-xs">{b.user.email}</p>
                  </td>
                  <td className="px-6 py-3.5 font-bold text-white text-sm">{b.originAirport} → {b.destinationAirport}</td>
                  <td className="px-6 py-3.5 text-slate-300 text-sm">
                    {format(new Date(b.departureTime), 'dd MMM yyyy hh:mm a')}
                  </td>
                  <td className="px-6 py-3.5 font-bold text-white text-sm">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: b.currency }).format(Number(b.totalPrice))}
                  </td>
                  <td className="px-6 py-3.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[b.status] ?? 'bg-slate-400/15 text-slate-400'}`}>
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500 text-sm">No bookings yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
