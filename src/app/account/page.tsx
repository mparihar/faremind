'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Plane, Calendar, ChevronRight, CreditCard, TrendingDown,
  Bell, Ticket, Headphones, Clock, ArrowRight, Loader2,
  CheckCircle2, XCircle, Luggage, ClipboardList, Timer,
  Armchair, UtensilsCrossed, PhoneCall, Zap, Gift, ArrowLeftRight,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useManageBookingStore } from '@/store/useManageBookingStore';

const fmt = (n: string | number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n));

function daysUntil(dateStr: string): number {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000));
}
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function durationStr(mins: number) {
  const h = Math.floor(mins / 60); const m = mins % 60;
  return `${h}h ${m}m`;
}

/* ── Countdown Timer ── */
function TripCountdown({ departureDate, destCity }: { departureDate: string; destCity: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const diff = Math.max(0, new Date(departureDate).getTime() - now);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const boxes = [
    { v: String(d).padStart(2, '0'), l: 'Days' },
    { v: String(h).padStart(2, '0'), l: 'Hours' },
    { v: String(m).padStart(2, '0'), l: 'Mins' },
    { v: String(s).padStart(2, '0'), l: 'Secs' },
  ];
  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
      <h3 className="text-white text-sm font-bold flex items-center gap-2 mb-3">
        <Timer size={14} className="text-[#1ABC9C]" /> Trip Countdown
      </h3>
      <div className="grid grid-cols-4 gap-2 mb-2">
        {boxes.map(b => (
          <div key={b.l} className="bg-slate-800 border border-white/[0.08] rounded-xl py-2 text-center">
            <p className="text-white text-xl font-black leading-none">{b.v}</p>
            <p className="text-slate-500 text-[9px] font-semibold uppercase mt-1">{b.l}</p>
          </div>
        ))}
      </div>
      <p className="text-slate-500 text-[10px] text-center">Until your trip to {destCity}</p>
    </div>
  );
}

/* ── Quick Actions Grid ── */
function QuickActions() {
  const actions = [
    { icon: ClipboardList, label: 'Manage\nBooking', href: '/account/manage-booking' },
    { icon: Armchair, label: 'Change\nSeat', href: '/account/manage-booking' },
    { icon: Luggage, label: 'Add\nBaggage', href: '/account/manage-booking' },
    { icon: Ticket, label: 'Check-\nin', href: '/account/manage-booking' },
    { icon: UtensilsCrossed, label: 'Meal\nPreference', href: '/account/manage-booking' },
    { icon: PhoneCall, label: 'Contact\nSupport', href: '/account/support' },
  ];
  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
      <h3 className="text-white text-sm font-bold flex items-center gap-2 mb-3">
        <Zap size={14} className="text-[#1ABC9C]" /> Quick Actions
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {actions.map(a => {
          const Icon = a.icon;
          return (
            <Link key={a.label} href={a.href}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.07] hover:border-[#1ABC9C]/20 transition-all group">
              <div className="w-9 h-9 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center group-hover:bg-[#1ABC9C]/20 transition-all">
                <Icon size={16} className="text-[#1ABC9C]" />
              </div>
              <span className="text-[10px] text-slate-400 font-semibold text-center leading-tight whitespace-pre-line group-hover:text-white transition-colors">{a.label}</span>
            </Link>
          );
        })}
      </div>
      <Link href="/account/manage-booking" className="flex items-center justify-end gap-1 mt-2.5 text-[#1ABC9C] text-[10px] font-semibold hover:underline">
        View All Actions <ArrowRight size={10} />
      </Link>
    </div>
  );
}

/* ── Benefits Card ── */
function BenefitsCard({ memberSince }: { memberSince: string }) {
  const items = [
    { icon: CreditCard, label: 'Travel Credits', value: '$120 Available' },
    { icon: Gift, label: 'Loyalty Points', value: '1,250 Points' },
    { icon: Calendar, label: 'Member Since', value: memberSince },
  ];
  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
      <h3 className="text-white text-sm font-bold flex items-center gap-2 mb-3">
        <Gift size={14} className="text-amber-400" /> Your Benefits
      </h3>
      <div className="space-y-0">
        {items.map((it, i) => {
          const Icon = it.icon;
          return (
            <div key={it.label} className={`flex items-center gap-3 py-2.5 ${i > 0 ? 'border-t border-white/[0.05]' : ''}`}>
              <div className="w-8 h-8 rounded-lg bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
                <Icon size={14} className="text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-semibold">{it.label}</p>
                <p className="text-[#1ABC9C] text-[10px] font-bold">{it.value}</p>
              </div>
              <ChevronRight size={12} className="text-slate-600" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Main Dashboard ── */
export default function AccountDashboard() {
  const { user } = useAuthStore();
  const { bookings, bookingCounts, bookingsLoading, loadUserBookings, setBookingsFilter } = useManageBookingStore();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    setBookingsFilter('all');
    loadUserBookings(user.id).then(() => setLoaded(true));
  }, [user?.id]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  })();

  const firstName = user?.name?.split(' ')[0] || 'there';

  const upcomingTrips = bookings
    .filter(b => b.bookingStatus !== 'CANCELLED' && new Date(b.departureDate) > new Date())
    .sort((a, b) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());

  const nextTrip = upcomingTrips[0] || null;
  const cancelledCount = bookings.filter(b => b.bookingStatus === 'CANCELLED').length;
  const pastCount = bookings.filter(b => b.bookingStatus !== 'CANCELLED' && new Date(b.departureDate) <= new Date()).length;
  const refundPendingCount = bookings.filter(b => b.bookingStatus === 'CANCELLED').length > 0 ? 1 : 0;

  const j = nextTrip?.journeys?.[0];
  const origin = j?.originAirport || nextTrip?.originAirport || '';
  const dest = j?.destinationAirport || nextTrip?.destinationAirport || '';
  const originCity = j?.originCity || nextTrip?.originCity || '';
  const destCity = j?.destinationCity || nextTrip?.destinationCity || '';
  const totalDur = j?.totalDurationMinutes || 0;
  const stops = j?.totalStops ?? 0;

  const pnr0 = nextTrip?.pnrs?.[0];
  const airlinePnr = pnr0?.pnrCode || nextTrip?.masterPnr || '—';
  const airlineName = pnr0?.airlineName || '';

  const memberSince = 'May 2024';

  const anim = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

  return (
    <motion.div initial="hidden" animate="show" transition={{ staggerChildren: 0.06 }}>
      {/* ── Main Grid: Center + Right ── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-5">
        {/* ── CENTER COLUMN ── */}
        <div className="space-y-5">
          {/* ── Hero Greeting ── */}
          <motion.div variants={anim} className="relative rounded-2xl overflow-hidden">
            <div className="absolute inset-0 bg-[#0b031e]">
              <img src="/dashboard_hero_final.png" alt="" className="w-full h-full object-cover opacity-90" style={{ objectPosition: 'center 50%' }} />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0b031e] via-[#0b031e]/80 via-[35%] to-transparent to-[50%]" />
            </div>
            <div className="relative px-8 pt-5 pb-16">
              <h1 className="text-2xl lg:text-3xl font-black text-white">
                {greeting}, {firstName}!
              </h1>
              <p className="text-slate-400 text-sm mt-1">Here&apos;s what&apos;s happening with your travel plans.</p>
            </div>
          </motion.div>

          {/* Upcoming Trip Cards */}
          <motion.div variants={anim}>
            {bookingsLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 text-[#1ABC9C] animate-spin" /></div>
            ) : upcomingTrips.length > 0 ? (
              <div>
                {/* Header row */}
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-white text-sm font-bold flex items-center gap-2">
                    <Plane size={14} className="text-[#1ABC9C]" /> Your Upcoming Trips
                    <span className="text-[10px] font-bold text-slate-400 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full">{upcomingTrips.length} booking{upcomingTrips.length !== 1 ? 's' : ''}</span>
                  </h2>
                  <Link href="/account/bookings"
                    className="text-[#1ABC9C] text-[11px] font-semibold flex items-center gap-1 hover:underline">
                    View All <ArrowRight size={10} />
                  </Link>
                </div>

                {/* Booking cards grid — 2 columns */}
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                  {upcomingTrips.map((trip: any) => {
                    const tj = trip.journeys?.[0];
                    const tOrigin = tj?.originAirport || trip.originAirport;
                    const tDest = tj?.destinationAirport || trip.destinationAirport;
                    const tOriginCity = tj?.originCity || trip.originCity;
                    const tDestCity = tj?.destinationCity || trip.destinationCity;
                    const tPnr = trip.pnrs?.[0]?.pnrCode || trip.masterPnr || '—';
                    const isRT = trip.tripType === 'ROUND_TRIP';
                    const depDate = tj?.departureDateTime || trip.departureDate;
                    const retJourney = trip.journeys?.find((jj: any) => jj.direction === 'RETURN');
                    const retDate = retJourney?.departureDateTime || trip.returnDate;

                    return (
                      <Link key={trip.id} href={`/account/bookings/${trip.id}`}
                        className="relative rounded-2xl overflow-hidden border border-white/[0.08] group hover:border-[#1ABC9C]/20 transition-all block">
                        {/* Background */}
                        <div className="absolute inset-0">
                          <img src="/travel_hero_banner.png" alt="" className="w-full h-full object-cover opacity-15" />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/95 to-slate-900/70" />
                        </div>
                        <div className="relative p-5">
                          {/* Top row: PNR + Trip type */}
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-400 font-mono">PNR: <span className="text-white font-black">{tPnr}</span></span>
                              {isRT && <span className="text-[9px] font-bold text-[#1ABC9C] bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 px-2 py-0.5 rounded-full uppercase tracking-wider">Round Trip</span>}
                            </div>
                            <span className="text-emerald-400 font-bold text-[10px] flex items-center gap-1">
                              <CheckCircle2 size={10} /> Confirmed
                            </span>
                          </div>

                          {/* Route */}
                          <div className="flex items-center justify-between gap-3 mb-4">
                            <div className="text-center min-w-0">
                              <p className="text-white text-2xl font-black leading-none">{tOrigin}</p>
                              <p className="text-slate-400 text-[11px] mt-1 truncate">{tOriginCity}</p>
                            </div>
                            <div className="flex-1 flex flex-col items-center gap-1 px-2">
                              <div className="w-full flex items-center gap-1">
                                <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/20" />
                                <div className="w-6 h-6 rounded-full border bg-[#1ABC9C]/20 border-[#1ABC9C]/30 flex items-center justify-center">
                                  {isRT
                                    ? <ArrowLeftRight size={10} className="text-[#1ABC9C]" />
                                    : <Plane size={10} className="text-[#1ABC9C] rotate-90" />
                                  }
                                </div>
                                <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/20" />
                              </div>
                            </div>
                            <div className="text-center min-w-0">
                              <p className="text-white text-2xl font-black leading-none">{tDest}</p>
                              <p className="text-slate-400 text-[11px] mt-1 truncate">{tDestCity}</p>
                            </div>
                          </div>

                          {/* Dates row */}
                          <div className="flex items-center gap-3 mb-4 text-xs">
                            <div className="flex items-center gap-1.5 text-slate-300">
                              <Calendar size={11} className="text-[#1ABC9C]" />
                              <span>{formatDate(depDate)}</span>
                            </div>
                            {isRT && retDate && (
                              <>
                                <span className="text-slate-600">—</span>
                                <span className="text-slate-300">{formatDate(retDate)}</span>
                              </>
                            )}
                          </div>

                          {/* Footer: Ref + Fare */}
                          <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wide">Ref </span>
                              <span className="text-white font-black font-mono text-[11px]">{trip.masterBookingReference}</span>
                            </div>
                            <span className="text-[#F97316] font-black text-lg">{fmt(trip.totalAmount, trip.currency)}</span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-8 text-center">
                <Plane size={28} className="text-slate-600 mx-auto mb-3" />
                <p className="text-white font-bold mb-1">No upcoming trips</p>
                <p className="text-slate-500 text-xs mb-4">Start planning your next adventure</p>
                <Link href="/" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] transition-all">
                  <Plane size={13} /> Search Flights
                </Link>
              </div>
            )}
          </motion.div>

          {/* ── My Trips + Price Alert row ── */}
          <motion.div variants={anim} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* My Trips Summary */}
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white text-sm font-bold flex items-center gap-2">
                  <Ticket size={14} className="text-[#1ABC9C]" /> My Trips
                </h3>
                <Link href="/account/bookings" className="text-[#1ABC9C] text-[10px] font-semibold flex items-center gap-1 hover:underline">
                  View All Trips <ArrowRight size={10} />
                </Link>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { n: upcomingTrips.length, l: 'Upcoming', c: 'text-[#1ABC9C]', filter: 'upcoming' },
                  { n: pastCount, l: 'Past', c: 'text-blue-400', filter: 'past' },
                  { n: cancelledCount, l: 'Cancelled', c: 'text-red-400', filter: 'cancelled' },
                  { n: refundPendingCount, l: 'Refund Pending', c: 'text-amber-400', filter: 'cancelled' },
                ].map(s => (
                  <Link key={s.l} href={`/account/bookings?filter=${s.filter}`} className="text-center py-3 rounded-xl hover:bg-white/[0.04] transition-all cursor-pointer group">
                    <p className={`text-3xl font-black leading-none ${s.c} group-hover:scale-110 transition-transform`}>{s.n}</p>
                    <p className="text-slate-500 text-xs font-semibold mt-1.5">{s.l}</p>
                  </Link>
                ))}
              </div>
            </div>

            {/* Price Alert */}
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white text-sm font-bold flex items-center gap-2">
                  <Bell size={14} className="text-purple-400" /> Price Alert
                </h3>
                <Link href="/account/alerts" className="text-[#1ABC9C] text-[10px] font-semibold flex items-center gap-1 hover:underline">
                  View All <ArrowRight size={10} />
                </Link>
              </div>
              {nextTrip ? (
                <div>
                  <p className="text-white text-xs font-semibold mb-1">{origin} → {dest}</p>
                  <p className="text-slate-500 text-[10px] mb-2">{formatDate(nextTrip.departureDate)}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 text-xs font-bold flex items-center gap-1">
                      <TrendingDown size={12} /> {fmt(120)}
                    </span>
                    <span className="text-emerald-400 text-[10px] font-semibold bg-emerald-400/10 px-2 py-0.5 rounded-full">Great time to book!</span>
                  </div>
                  {/* Mini chart placeholder */}
                  <div className="mt-3 h-10 flex items-end gap-px">
                    {[35, 50, 40, 55, 45, 60, 50, 65, 55, 70, 60, 45, 40, 35, 30].map((h, i) => (
                      <div key={i} className="flex-1 rounded-t-sm bg-gradient-to-t from-[#1ABC9C]/40 to-[#1ABC9C]/10" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-slate-500 text-xs">No active price alerts</p>
                  <Link href="/" className="text-[#1ABC9C] text-[10px] font-semibold mt-1 inline-block hover:underline">Search flights to track</Link>
                </div>
              )}
            </div>
          </motion.div>

          {/* ── Recent Activity + Support row ── */}
          <motion.div variants={anim} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Recent Activity */}
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
              <h3 className="text-white text-sm font-bold flex items-center gap-2 mb-3">
                <Clock size={14} className="text-[#1ABC9C]" /> Recent Activity
              </h3>
              {nextTrip ? (
                <div className="space-y-0">
                  {[
                    { icon: CheckCircle2, cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', title: 'Booking Confirmed', sub: `Your booking ${nextTrip.masterBookingReference} has been confirmed.`, time: 'May 10, 2026 · 10:30 AM' },
                    { icon: CreditCard, cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', title: 'Payment Succeeded', sub: `Payment of ${fmt(nextTrip.totalAmount, nextTrip.currency)} has been processed successfully.`, time: 'May 10, 2026 · 10:31 AM' },
                    { icon: Ticket, cls: 'text-blue-400 bg-blue-400/10 border-blue-400/20', title: 'E-Ticket Issued', sub: 'Your e-ticket has been issued.', time: 'May 10, 2026 · 10:35 AM' },
                  ].map((ev, i) => {
                    const Icon = ev.icon;
                    return (
                      <div key={i} className={`flex items-start gap-3 py-3 ${i > 0 ? 'border-t border-white/[0.05]' : ''}`}>
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${ev.cls}`}>
                          <Icon size={13} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-semibold">{ev.title}</p>
                          <p className="text-slate-500 text-[10px] leading-relaxed">{ev.sub}</p>
                        </div>
                        <p className="text-slate-600 text-[9px] shrink-0 whitespace-nowrap">{ev.time}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-slate-500 text-xs text-center py-6">No recent activity</p>
              )}
            </div>

            {/* Need Help */}
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 flex flex-col">
              <h3 className="text-white text-sm font-bold flex items-center gap-2 mb-3">
                <Headphones size={14} className="text-purple-400" /> Need Help?
              </h3>
              <div className="flex items-center gap-4 flex-1">
                <div className="flex-1">
                  <p className="text-white text-sm font-bold mb-1">We&apos;re here for you 24/7</p>
                  <p className="text-slate-400 text-[11px] leading-relaxed mb-3">Get quick support for your travel needs.</p>
                  <Link href="/account/support"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1ABC9C]/15 border border-[#1ABC9C]/25 text-[#1ABC9C] text-xs font-bold hover:bg-[#1ABC9C]/25 transition-all">
                    Contact Support
                  </Link>
                </div>
                <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-white/[0.08] shrink-0 hidden sm:block">
                  <img src="/support_avatar.png" alt="Support" className="w-full h-full object-cover" />
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Bottom Promo Banner ── */}
          <motion.div variants={anim}>
            <div className="bg-gradient-to-r from-purple-900/30 via-[#1ABC9C]/10 to-purple-900/30 border border-purple-500/15 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0">
                  <Bell size={16} className="text-purple-400" />
                </div>
                <div>
                  <p className="text-white text-sm font-bold">Save more with Price Alerts</p>
                  <p className="text-slate-400 text-[11px]">Get notified when prices drop for your favorite routes.</p>
                </div>
              </div>
              <Link href="/account/alerts"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.06] border border-white/[0.1] text-white text-xs font-bold hover:bg-white/[0.1] transition-all shrink-0">
                Create Alert
              </Link>
            </div>
          </motion.div>
        </div>

        {/* ── RIGHT SIDEBAR COLUMN ── */}
        <div className="space-y-4">
          {nextTrip && (
            <motion.div variants={anim}>
              <TripCountdown departureDate={nextTrip.departureDate} destCity={destCity} />
            </motion.div>
          )}
          <motion.div variants={anim}><QuickActions /></motion.div>
          <motion.div variants={anim}><BenefitsCard memberSince={memberSince} /></motion.div>
        </div>
      </div>
    </motion.div>
  );
}
