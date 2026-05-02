'use client';

import { useState, useEffect } from 'react';
import { apiUrl } from '@/lib/api-client';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Plane,
  TrendingDown,
  Bell,
  DollarSign,
  Clock,
  ChevronRight,
  Sparkles,
  BarChart3,
  Plus,
  Loader2,
  RefreshCcw,
  MapPin,
  Calendar,
  Luggage,
} from 'lucide-react';
import { formatPrice, formatTime, formatDuration, formatDate, getAirlineLogo, cn } from '@/lib/utils';
import Link from 'next/link';

interface DashboardBooking {
  id: string;
  pnr: string;
  status: string;
  provider: string;
  airlineCode: string;
  airlineName: string;
  originAirport: string;
  originCity: string;
  destinationAirport: string;
  destinationCity: string;
  departureTime: string;
  arrivalTime: string;
  totalDuration: number;
  stops: number;
  cabinClass: string;
  fareClass: string | null;
  totalPrice: number;
  currency: string;
  refundable: boolean;
  changeable: boolean;
  carryOnBags: number;
  checkedBags: number;
  priceTracking: boolean;
  currentTrackedPrice: number | null;
  createdAt: string;
  passengers: { firstName: string; lastName: string; email: string }[];
  segments: { depAirport: string; arrAirport: string; flightNumber: string; depTime: string; arrTime: string; duration: number }[];
  priceAlerts: { savings: number; percentDrop: number }[];
}

interface DashboardStats {
  activeBookings: number;
  trackedFlights: number;
  newAlerts: number;
  totalSavings: number;
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  const [bookings, setBookings] = useState<DashboardBooking[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch bookings from API
  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await fetch(apiUrl('/api/bookings?userId=demo-user'));
        const data = await res.json();
        if (data.bookings) setBookings(data.bookings);
        if (data.stats) setStats(data.stats);
      } catch (err) {
        console.error('Failed to load dashboard:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  const activeBookings = bookings.filter((b) => ['CONFIRMED', 'TICKETED', 'PENDING'].includes(b.status));
  const completedBookings = bookings.filter((b) => ['COMPLETED', 'CANCELLED'].includes(b.status));
  const displayedBookings = activeTab === 'active' ? activeBookings : completedBookings;

  const totalSaved = stats?.totalSavings || 0;
  const trackedFlights = stats?.trackedFlights || bookings.filter((b) => b.priceTracking).length;
  const priceAlerts = stats?.newAlerts || 0;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
          <p className="text-sm text-slate-400">Loading your bookings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-rising-sun-image relative overflow-hidden">
      {/* Scenic Atmosphere */}
      <div className="absolute inset-0 scenic-overlay" />
      {/* Header */}
      <div className="glass-header relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <LayoutDashboard className="w-5 h-5 text-sun-orange" />
                <h1 className="text-2xl font-black text-slate-800 tracking-tight">Dashboard</h1>
              </div>
              <p className="text-sm text-slate-500 font-bold">Manage your bookings and price tracking</p>
            </div>
            <Link
              href="/"
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-white btn-primary-coral transition-all"
            >
              <Plus className="w-4 h-4" />
              New Booking
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              {
                icon: Plane,
                label: 'Active Bookings',
                value: activeBookings.length.toString(),
                color: 'brand',
              },
              {
                icon: BarChart3,
                label: 'Tracked Flights',
                value: trackedFlights.toString(),
                color: 'accent',
              },
              {
                icon: Bell,
                label: 'Price Alerts',
                value: priceAlerts.toString(),
                color: 'warning',
              },
              {
                icon: DollarSign,
                label: 'Total Saved',
                value: formatPrice(totalSaved),
                color: 'success',
              },
            ].map((stat, i) => {
              const Icon = stat.icon;
              const colorMap: Record<string, string> = {
                brand: 'bg-sun-gold/10 text-sun-gold border-sun-gold/20',
                accent: 'bg-vacation-blue/10 text-vacation-blue border-vacation-blue/20',
                warning: 'bg-sun-orange/10 text-sun-orange border-sun-orange/20',
                success: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
              };
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="glass-card-scenic p-4 border-white/60"
                >
                  <div className={`w-9 h-9 rounded-xl ${colorMap[stat.color]} border flex items-center justify-center mb-3 shadow-sm`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <p className="text-2xl font-black text-slate-800">{stat.value}</p>
                  <p className="text-[10px] text-slate-500 font-black uppercase tracking-wider mt-0.5">{stat.label}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Price Alert Banner */}
        {priceAlerts > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 rounded-2xl bg-white/40 backdrop-blur-md border border-emerald-500/30 flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
              <TrendingDown className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-black text-slate-800 uppercase tracking-tight">Price Drop Detected!</p>
              <p className="text-xs text-slate-500 font-bold">
                One of your tracked flights has dropped in price.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-black text-emerald-600 bg-emerald-500/15 border border-emerald-500/20">
                <Sparkles className="w-3 h-3" />
                {priceAlerts} alert{priceAlerts > 1 ? 's' : ''}
              </span>
            </div>
          </motion.div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1.5 rounded-2xl bg-white/30 backdrop-blur-md border border-white/60 w-fit mb-6">
          {[
            { key: 'active' as const, label: 'Active', count: activeBookings.length },
            { key: 'completed' as const, label: 'Past', count: completedBookings.length },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-wider transition-all ${
                activeTab === tab.key
                  ? 'bg-sun-orange text-white shadow-lg'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/20'
              }`}
            >
              {tab.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-black ${
                activeTab === tab.key
                  ? 'bg-white/30 text-white'
                  : 'bg-slate-200 text-slate-500'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Booking List */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {displayedBookings.map((booking, i) => (
            <motion.div
              key={booking.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="glass-card p-5 hover:border-white/[0.12] transition-all group"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/40 border border-white/60 flex items-center justify-center overflow-hidden shadow-sm">
                    <img
                      src={getAirlineLogo(booking.airlineCode)}
                      alt={booking.airlineName}
                      className="w-7 h-7 object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-800">{booking.airlineName}</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">PNR: <span className="text-sun-orange">{booking.pnr}</span></p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {booking.priceTracking && (
                    <span className="px-2 py-1 rounded-full text-[10px] font-semibold bg-brand-500/10 text-brand-400 border border-brand-500/20">
                      <Sparkles className="w-3 h-3 inline mr-1" />
                      Tracked
                    </span>
                  )}
                  <span className={cn(
                    'px-2.5 py-1 rounded-full text-[10px] font-semibold border',
                    booking.status === 'CONFIRMED' ? 'bg-success-500/10 text-success-400 border-success-500/20' :
                    booking.status === 'PENDING' ? 'bg-warning-400/10 text-warning-400 border-warning-400/20' :
                    booking.status === 'CANCELLED' ? 'bg-error-500/10 text-error-400 border-error-500/20' :
                    'bg-slate-500/10 text-slate-400 border-slate-500/20'
                  )}>
                    {booking.status}
                  </span>
                </div>
              </div>

              {/* Route */}
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/20 border border-white/40 mb-4">
                <div className="text-center">
                  <p className="text-xl font-black text-slate-800">{booking.originAirport}</p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase">{booking.originCity}</p>
                </div>
                <div className="flex-1 flex flex-col items-center gap-0.5">
                  <p className="text-[10px] text-slate-400 font-bold">{formatDuration(booking.totalDuration)}</p>
                  <div className="w-full h-[2px] bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-sun-orange" style={{ width: '100%' }} />
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold">
                    {booking.stops === 0 ? 'Nonstop' : `${booking.stops} stop${booking.stops > 1 ? 's' : ''}`}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black text-slate-800">{booking.destinationAirport}</p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase">{booking.destinationCity}</p>
                </div>
              </div>

              {/* Details */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-slate-500">
                    <Calendar className="w-3 h-3" />
                    {formatDate(booking.departureTime)}
                  </span>
                  <span className="flex items-center gap-1 text-slate-500">
                    <Clock className="w-3 h-3" />
                    {formatTime(booking.departureTime)}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-base font-bold gradient-text">{formatPrice(booking.totalPrice, booking.currency)}</p>
                  {booking.currentTrackedPrice && booking.currentTrackedPrice < booking.totalPrice && (
                    <p className="text-[10px] text-success-400">
                      Now {formatPrice(booking.currentTrackedPrice, booking.currency)} ↓
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {displayedBookings.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-surface-700 border border-white/[0.08] flex items-center justify-center">
              <Plane className="w-8 h-8 text-slate-600" />
            </div>
            <p className="text-lg font-semibold text-white">
              No {activeTab === 'active' ? 'active' : 'past'} bookings
            </p>
            <p className="text-sm text-slate-500">
              {activeTab === 'active'
                ? 'Search for flights and make your first booking!'
                : 'Your completed trips will appear here'}
            </p>
            {activeTab === 'active' && (
              <Link
                href="/"
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 shadow-lg shadow-brand-500/25 transition-all mt-2"
              >
                Search Flights
                <ChevronRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
