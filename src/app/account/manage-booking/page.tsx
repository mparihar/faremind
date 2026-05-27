'use client';

import { useState, useEffect, useRef } from 'react';
import type { KeyboardEvent as RKE, ClipboardEvent as RCE } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Loader2, AlertCircle, ArrowRight, RefreshCw, Mail,
  Shield, CreditCard, ClipboardList, Ticket, Plane, ChevronRight,
  Calendar, ArrowLeftRight, CheckCircle2, XCircle, Clock,
} from 'lucide-react';
import { useManageBookingStore } from '@/store/useManageBookingStore';
import { useAuthStore } from '@/store/useAuthStore';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════
const fmt = (n: string | number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n));

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_MAP: Record<string, { cls: string; dot: string; label: string }> = {
  CONFIRMED: { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400', label: 'Confirmed' },
  TICKETED:  { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400', label: 'Ticketed' },
  CREATED:   { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20', dot: 'bg-amber-400', label: 'Processing' },
  CANCELLED: { cls: 'bg-red-500/10 text-red-400 border-red-500/20', dot: 'bg-red-400', label: 'Cancelled' },
  COMPLETED: { cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20', dot: 'bg-blue-400', label: 'Completed' },
  FAILED:    { cls: 'bg-red-500/10 text-red-400 border-red-500/20', dot: 'bg-red-400', label: 'Failed' },
};

// ═══════════════════════════════════════════════
// OTP Input (reusable component)
// ═══════════════════════════════════════════════
function OtpInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, ' ').split('').slice(0, 6);
  useEffect(() => { inputs.current[0]?.focus(); }, []);
  function focus(i: number) { inputs.current[Math.min(5, Math.max(0, i))]?.focus(); }
  function handleChange(i: number, raw: string) {
    const ch = raw.replace(/\D/g, '').slice(-1);
    const arr = [...digits.map(d => (d === ' ' ? '' : d))];
    arr[i] = ch; onChange(arr.join(''));
    if (ch) focus(i + 1);
  }
  function handleKeyDown(i: number, e: RKE<HTMLInputElement>) {
    if (e.key === 'Backspace') { e.preventDefault(); const arr = [...digits.map(d => (d === ' ' ? '' : d))]; if (arr[i]) { arr[i] = ''; onChange(arr.join('')); } else focus(i - 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); focus(i - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); focus(i + 1); }
  }
  function handlePaste(e: RCE<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    onChange(pasted.padEnd(6, '').slice(0, 6)); focus(Math.min(5, pasted.length));
  }
  return (
    <div className="flex gap-3 justify-center">
      {Array.from({ length: 6 }).map((_, i) => {
        const char = digits[i]?.trim() ?? '';
        return (
          <input key={i} ref={el => { inputs.current[i] = el; }} type="tel" inputMode="numeric" maxLength={1} value={char} disabled={disabled}
            onChange={e => handleChange(i, e.target.value)} onKeyDown={e => handleKeyDown(i, e)} onPaste={handlePaste} onFocus={e => e.target.select()}
            className={`w-11 h-14 text-center text-2xl font-black rounded-xl border-2 bg-slate-800 text-white outline-none transition-all duration-150 disabled:opacity-50 ${char ? 'border-[#1ABC9C] shadow-[0_0_0_2px_rgba(26,188,156,0.2)]' : 'border-slate-600 focus:border-[#1ABC9C] focus:shadow-[0_0_0_2px_rgba(26,188,156,0.15)]'}`}
          />
        );
      })}
    </div>
  );
}

function ResendTimer({ onResend }: { onResend: () => void }) {
  const [secs, setSecs] = useState(30);
  useEffect(() => {
    setSecs(30);
    const id = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [onResend]);
  if (secs > 0) return <p className="text-slate-500 text-sm text-center">Resend OTP in <span className="text-slate-300 font-bold tabular-nums">{secs}s</span></p>;
  return <button type="button" onClick={onResend} className="flex items-center gap-1.5 mx-auto text-[#1ABC9C] text-sm font-bold hover:underline transition-all"><RefreshCw size={13} />Resend OTP</button>;
}

// ═══════════════════════════════════════════════
// Reservation Card
// ═══════════════════════════════════════════════
function ReservationCard({ booking }: { booking: any }) {
  const journey = booking.journeys?.[0];
  const origin = journey?.originAirport || booking.originAirport;
  const dest = journey?.destinationAirport || booking.destinationAirport;
  const originCity = journey?.originCity || booking.originCity;
  const destCity = journey?.destinationCity || booking.destinationCity;
  const isRT = (booking.tripType || '').toLowerCase().includes('round');
  const pnr = booking.pnrs?.[0]?.pnrCode || booking.masterPnr || '—';
  const isPast = new Date(booking.departureDate) < new Date();
  const isCancelled = booking.bookingStatus === 'CANCELLED';
  const status = STATUS_MAP[booking.bookingStatus] || { cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20', dot: 'bg-slate-400', label: booking.bookingStatus };

  const STATUS_BORDER: Record<string, string> = {
    CONFIRMED: 'border-l-emerald-400/60', TICKETED: 'border-l-emerald-400/60',
    CREATED: 'border-l-amber-400/60', CANCELLED: 'border-l-red-400/60',
    COMPLETED: 'border-l-blue-400/60', FAILED: 'border-l-red-400/60',
  };
  const borderColor = STATUS_BORDER[booking.bookingStatus] || 'border-l-slate-600';

  return (
    <Link href={`/account/bookings/${booking.id}`}
      className={`block bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden hover:border-[#1ABC9C]/30 hover:bg-white/[0.06] transition-all group border-l-[3px] ${borderColor}`}>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          {/* Left: Route + Meta */}
          <div className="flex-1 min-w-0">
            {/* Status + PNR row */}
            <div className="flex items-center gap-2.5 mb-3 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${status.cls}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                {status.label}
              </span>
              <span className="text-xs text-slate-500 font-mono tracking-wider">
                PNR: <span className="text-white font-black">{pnr}</span>
              </span>
              <span className="text-xs text-slate-500 font-mono tracking-wider">
                Ref: <span className="text-white font-black">{booking.masterBookingReference}</span>
              </span>
              {isRT && (
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider bg-white/[0.04] px-2 py-0.5 rounded-full border border-white/[0.06]">
                  Round Trip
                </span>
              )}
            </div>

            {/* Route */}
            <div className="flex items-center gap-2.5">
              <div>
                <p className="text-white font-black text-xl leading-none">{origin}</p>
                <p className="text-slate-400 text-xs mt-0.5">{originCity}</p>
              </div>
              <div className="flex items-center gap-1 flex-1 max-w-[60px]">
                <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-white/5" />
                {isRT
                  ? <ArrowLeftRight size={12} className="text-[#1ABC9C] shrink-0" />
                  : <Plane size={11} className="text-[#1ABC9C] rotate-90 shrink-0" />
                }
                <div className="h-px flex-1 bg-gradient-to-l from-white/10 to-white/5" />
              </div>
              <div>
                <p className="text-white font-black text-xl leading-none">{dest}</p>
                <p className="text-slate-400 text-xs mt-0.5">{destCity}</p>
              </div>
            </div>

            {/* Date */}
            <div className="flex items-center gap-1.5 mt-2.5 text-slate-400 text-xs">
              <Calendar size={12} />
              <span>{formatDate(booking.departureDate)}</span>
              {booking.returnDate && (
                <>
                  <span className="text-slate-600">—</span>
                  <span>{formatDate(booking.returnDate)}</span>
                </>
              )}
            </div>
          </div>

          {/* Right: Price + Arrow */}
          <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
            <p className="text-[#F97316] font-black text-xl leading-none">
              {fmt(booking.totalAmount, booking.currency)}
            </p>
            <div className="flex items-center gap-1 text-xs font-semibold text-slate-500 group-hover:text-[#1ABC9C] transition-colors">
              Manage <ChevronRight size={12} />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ═══════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════
export default function AccountManageBookingPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const store = useManageBookingStore();
  const [lookupStep, setLookupStep] = useState<'form' | 'otp' | 'loading'>('form');
  const [otp, setOtp] = useState('');
  const [resendKey, setResendKey] = useState(0);

  // Load user's bookings when page mounts
  useEffect(() => {
    if (!user?.id) return;
    store.setBookingsFilter('all');
    store.loadUserBookings(user.id);
  }, [user?.id]);

  // Auto-submit OTP
  useEffect(() => {
    if (lookupStep === 'otp' && otp.replace(/\s/g, '').length === 6 && !store.otpVerifying) {
      handleVerifyOtp();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  async function handleLookup(e: { preventDefault(): void }) {
    e.preventDefault();
    const found = await store.lookupBooking();
    if (found) {
      const sent = await store.sendLookupOtp();
      if (sent) { setLookupStep('otp'); setOtp(''); }
    }
  }

  async function handleVerifyOtp() {
    if (otp.replace(/\s/g, '').length < 6) return;
    const bookingId = await store.verifyLookupOtp(otp);
    // Redirect to the details view upon successful lookup
    if (bookingId) router.push(`/manage-booking/${bookingId}`);
  }

  async function handleResend() {
    await store.sendLookupOtp();
    setResendKey(k => k + 1);
  }

  const bookings = store.bookings || [];
  const upcomingBookings = bookings.filter(b => b.bookingStatus !== 'CANCELLED' && new Date(b.departureDate) > new Date())
    .sort((a, b) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());
  const pastBookings = bookings.filter(b => b.bookingStatus !== 'CANCELLED' && new Date(b.departureDate) <= new Date());
  const cancelledBookings = bookings.filter(b => b.bookingStatus === 'CANCELLED');

  const inputCls = 'w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#1ABC9C] focus:ring-1 focus:ring-[#1ABC9C] transition-all text-sm';
  const labelCls = 'block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider';
  const btnCls = 'w-full py-3.5 bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white font-bold rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-[#1ABC9C]/10';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <ClipboardList size={24} className="text-[#1ABC9C]" /> Manage Booking
          </h1>
          <p className="text-slate-500 text-sm mt-1">Look up, modify, or cancel existing reservations</p>
        </div>
      </div>

      {/* ═══ Your Reservations Section ═══ */}
      {user && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white text-sm font-bold flex items-center gap-2">
              <Ticket size={14} className="text-[#1ABC9C]" /> Your Reservations
              {bookings.length > 0 && (
                <span className="text-[10px] text-slate-400 font-medium ml-1">({bookings.length} booking{bookings.length !== 1 ? 's' : ''})</span>
              )}
            </h2>
            <Link href="/account/bookings" className="text-[#1ABC9C] text-[10px] font-semibold flex items-center gap-1 hover:underline">
              View All Trips <ArrowRight size={10} />
            </Link>
          </div>

          {store.bookingsLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 text-[#1ABC9C] animate-spin" />
            </div>
          ) : bookings.length === 0 ? (
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 text-center">
              <Plane size={24} className="text-slate-600 mx-auto mb-2" />
              <p className="text-white font-bold text-sm mb-1">No reservations found</p>
              <p className="text-slate-500 text-xs mb-3">Book a flight or use the search below to find an existing reservation</p>
              <Link href="/" className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] transition-all">
                <Plane size={13} /> Search Flights
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Upcoming */}
              {upcomingBookings.length > 0 && (
                <>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-1">
                    <CheckCircle2 size={10} className="text-emerald-400" /> Upcoming ({upcomingBookings.length})
                  </p>
                  {upcomingBookings.map(b => (
                    <ReservationCard key={b.id} booking={b} />
                  ))}
                </>
              )}

              {/* Past */}
              {pastBookings.length > 0 && (
                <>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mt-4 mb-1">
                    <Clock size={10} className="text-blue-400" /> Past ({pastBookings.length})
                  </p>
                  {pastBookings.map(b => (
                    <ReservationCard key={b.id} booking={b} />
                  ))}
                </>
              )}

              {/* Cancelled */}
              {cancelledBookings.length > 0 && (
                <>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mt-4 mb-1">
                    <XCircle size={10} className="text-red-400" /> Cancelled ({cancelledBookings.length})
                  </p>
                  {cancelledBookings.map(b => (
                    <ReservationCard key={b.id} booking={b} />
                  ))}
                </>
              )}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
