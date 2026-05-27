'use client';

import { useState, useEffect, useRef } from 'react';
import type { KeyboardEvent as RKE, ClipboardEvent as RCE } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Loader2, AlertCircle, ArrowRight, Plane,
  Calendar, User, Clock, ChevronRight, RefreshCw, Mail,
  Ticket, MapPin, X as XIcon, CheckCircle2, Luggage,
  XCircle, CalendarDays, ArrowLeftRight, Shield, CreditCard,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useManageBookingStore, type MasterBookingSummary } from '@/store/useManageBookingStore';

// ═══════════════════════════════════════════════
// OTP Input (reusable — same pattern as login)
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

// ═══════════════════════════════════════════════
// Resend Timer
// ═══════════════════════════════════════════════

function ResendTimer({ onResend }: { onResend: () => void }) {
  const [secs, setSecs] = useState(30);

  useEffect(() => {
    setSecs(30);
    const id = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [onResend]);

  if (secs > 0) {
    return (
      <p className="text-slate-500 text-sm text-center">
        Resend OTP in <span className="text-slate-300 font-bold tabular-nums">{secs}s</span>
      </p>
    );
  }

  return (
    <button type="button" onClick={onResend}
      className="flex items-center gap-1.5 mx-auto text-[#1ABC9C] text-sm font-bold hover:underline transition-all">
      <RefreshCw size={13} />
      Resend OTP
    </button>
  );
}

// ═══════════════════════════════════════════════
// Status Badge
// ═══════════════════════════════════════════════

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    CONFIRMED: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Confirmed' },
    TICKETED: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Ticketed' },
    CREATED: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'Processing' },
    CANCELLED: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Cancelled' },
    COMPLETED: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Completed' },
    FAILED: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Failed' },
  };
  const s = map[status] || { bg: 'bg-slate-500/10', text: 'text-slate-400', label: status };
  return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${s.bg} ${s.text}`}>{s.label}</span>;
}

// ═══════════════════════════════════════════════
// Booking Card
// ═══════════════════════════════════════════════

function BookingCard({ booking, onClick }: { booking: MasterBookingSummary; onClick: () => void }) {
  const dep = new Date(booking.departureDate);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const isRoundTrip = booking.tripType === 'ROUND_TRIP';
  return (
    <motion.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onClick={onClick}
      className="w-full text-left bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] hover:border-white/[0.15] rounded-2xl p-5 transition-all duration-200 group">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-white font-bold text-sm tracking-wide">{booking.masterBookingReference || booking.masterPnr}</p>
            <StatusBadge status={booking.bookingStatus} />
          </div>
          <p className="text-slate-500 text-xs">{booking.customerName}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[#F97316] font-black text-lg leading-none">${Number(booking.totalAmount).toLocaleString()}</p>
          <p className="text-slate-500 text-[10px] uppercase mt-0.5">{booking.currency}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="text-center">
          <p className="text-white font-bold text-lg leading-none">{booking.originAirport}</p>
          <p className="text-slate-500 text-[11px] mt-0.5">{booking.originCity}</p>
        </div>
        <div className="flex-1 flex items-center gap-1.5">
          <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-white/5" />
          {isRoundTrip ? <ArrowLeftRight size={14} className="text-[#1ABC9C] shrink-0" /> : <Plane size={12} className="text-[#1ABC9C] rotate-90 shrink-0" />}
          <div className="h-px flex-1 bg-gradient-to-l from-white/10 to-white/5" />
        </div>
        <div className="text-center">
          <p className="text-white font-bold text-lg leading-none">{booking.destinationAirport}</p>
          <p className="text-slate-500 text-[11px] mt-0.5">{booking.destinationCity}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-slate-500 text-xs">
          <span className="flex items-center gap-1"><CalendarDays size={12} />{fmt(dep)}</span>
          <span className="flex items-center gap-1"><User size={12} />{booking.passengers?.length || 1} pax</span>
        </div>
        <ChevronRight size={16} className="text-slate-600 group-hover:text-[#1ABC9C] transition-colors" />
      </div>
    </motion.button>
  );
}

// ═══════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════

export default function ManageBookingPage() {
  const router = useRouter();
  const { user, loadSession } = useAuthStore();
  const store = useManageBookingStore();
  const [lookupStep, setLookupStep] = useState<'form' | 'otp' | 'loading'>('form');
  const [otp, setOtp] = useState('');
  const [resendKey, setResendKey] = useState(0);

  useEffect(() => { loadSession(); }, [loadSession]);

  // Auto-load bookings for logged-in users
  useEffect(() => {
    if (user?.id) { store.loadUserBookings(user.id); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, store.bookingsFilter]);

  // Auto-submit OTP
  useEffect(() => {
    if (lookupStep === 'otp' && otp.replace(/\s/g, '').length === 6 && !store.otpVerifying) handleVerifyOtp();
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
    if (bookingId) router.push(`/manage-booking/${bookingId}`);
  }

  const isLoggedIn = !!user;
  const inputCls = 'w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#1ABC9C] focus:ring-1 focus:ring-[#1ABC9C] transition-all text-sm';
  const labelCls = 'block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider';
  const btnCls = 'w-full py-3 bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white font-bold rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2';

  const filterTabs: { key: 'all' | 'upcoming' | 'past' | 'cancelled'; label: string; icon: any }[] = [
    { key: 'all', label: 'All', icon: Ticket },
    { key: 'upcoming', label: 'Upcoming', icon: Plane },
    { key: 'past', label: 'Past', icon: Clock },
    { key: 'cancelled', label: 'Cancelled', icon: XCircle },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#0f172a] to-slate-900 pt-20 pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {isLoggedIn ? (
          /* ── LOGGED-IN VIEW ──────────────────────────────── */
          <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-black text-white">Manage Bookings</h1>
                <p className="text-slate-500 text-sm mt-0.5">View, modify, or cancel your flight bookings</p>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-1.5 mb-6 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1">
              {filterTabs.map(tab => {
                const Icon = tab.icon;
                const active = store.bookingsFilter === tab.key;
                const count = tab.key === 'all' ? store.bookingCounts.total : store.bookingCounts[tab.key as keyof typeof store.bookingCounts] || 0;
                return (
                  <button key={tab.key} onClick={() => store.setBookingsFilter(tab.key)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${active ? 'bg-white/[0.08] text-white border border-white/[0.1]' : 'text-slate-500 hover:text-slate-300'}`}>
                    <Icon size={15} />
                    {tab.label}
                    <span className={`ml-0.5 text-[11px] px-1.5 py-0.5 rounded-full ${active ? 'bg-[#1ABC9C]/20 text-[#1ABC9C]' : 'bg-white/[0.05] text-slate-600'}`}>{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Bookings List */}
            {store.bookingsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 text-[#1ABC9C] animate-spin" />
              </div>
            ) : store.bookings.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto mb-4">
                  <Ticket size={28} className="text-slate-600" />
                </div>
                <p className="text-white font-bold mb-1">No bookings found</p>
                <p className="text-slate-500 text-sm">
                  {store.bookingsFilter === 'all' ? 'You haven\'t made any bookings yet.' : `No ${store.bookingsFilter} bookings.`}
                </p>
              </motion.div>
            ) : (
              <div className="grid gap-3">
                {store.bookings.map((b) => (
                  <BookingCard key={b.id} booking={b} onClick={() => router.push(`/manage-booking/${b.id}`)} />
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── GUEST LOOKUP VIEW ───────────────────────────── */
          <div className="relative">
            {/* Radial glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-[#1ABC9C]/5 blur-[120px] pointer-events-none" />

            {/* Hero text */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center mt-16 mb-8 relative z-10">
              <h1 className="text-3xl sm:text-4xl font-black text-white mb-3">Manage Your Booking</h1>
              <p className="text-slate-400 text-sm max-w-md mx-auto">
                Access your flight details, update passenger info, change dates, or request a cancellation — all in one place.
              </p>
              {/* Feature badges */}
              <div className="flex items-center justify-center gap-3 mt-5 flex-wrap">
                {[
                  { icon: Shield, label: 'Secure Access' },
                  { icon: RefreshCw, label: 'Real-time Status' },
                  { icon: CreditCard, label: 'Instant Refunds' },
                ].map(f => (
                  <span key={f.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] text-slate-400 font-medium">
                    <f.icon size={12} className="text-[#1ABC9C]" />
                    {f.label}
                  </span>
                ))}
              </div>
            </motion.div>

            {/* Lookup card */}
            <div className="max-w-md mx-auto relative z-10">
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-8 backdrop-blur-md shadow-2xl shadow-black/20">
                <AnimatePresence mode="wait">
                  {lookupStep === 'form' && (
                    <motion.form key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }} onSubmit={handleLookup} className="space-y-5">
                      <div className="text-center mb-2">
                        <div className="w-12 h-12 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto mb-3">
                          <Search size={22} className="text-[#1ABC9C]" />
                        </div>
                        <h2 className="text-white font-bold text-lg">Find Your Booking</h2>
                        <p className="text-slate-500 text-xs mt-1">Enter your booking reference and last name</p>
                      </div>

                      <div>
                        <label className={labelCls}>Booking Reference / PNR</label>
                        <input type="text" value={store.lookupRef} onChange={e => store.setLookupRef(e.target.value.toUpperCase())}
                          placeholder="e.g. FM2AX9K3" className={inputCls} autoFocus />
                      </div>

                      <div>
                        <label className={labelCls}>Last Name</label>
                        <input type="text" value={store.lookupLastName} onChange={e => store.setLookupLastName(e.target.value)}
                          placeholder="e.g. Smith" className={inputCls} />
                      </div>

                      {store.lookupError && (
                        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
                          <AlertCircle size={14} className="shrink-0" />{store.lookupError}
                        </div>
                      )}

                      <button type="submit" disabled={store.lookupLoading || !store.lookupRef || !store.lookupLastName} className={btnCls}>
                        {store.lookupLoading ? <><Loader2 size={16} className="animate-spin" /> Looking up…</> : <><ArrowRight size={16} /> Find Booking</>}
                      </button>

                      <div className="text-center pt-1">
                        <p className="text-slate-600 text-xs">Already have an account?{' '}
                          <a href="/auth/login?redirect=/manage-booking" className="text-[#1ABC9C] font-semibold hover:underline">Sign in</a>
                        </p>
                      </div>
                    </motion.form>
                  )}

                  {lookupStep === 'otp' && (
                    <motion.div key="otp" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }} className="space-y-6">
                      <div className="text-center">
                        <div className="w-12 h-12 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto mb-3">
                          <Mail size={22} className="text-[#1ABC9C]" />
                        </div>
                        <h2 className="text-white font-bold text-lg">Verify Your Identity</h2>
                        <p className="text-slate-400 text-sm mt-1">
                          Code sent to <span className="text-white font-semibold">{store.maskedEmail}</span>
                        </p>
                      </div>

                      <OtpInput value={otp} onChange={setOtp} disabled={store.otpVerifying} />

                      {store.lookupError && (
                        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5 justify-center">
                          <AlertCircle size={14} className="shrink-0" />{store.lookupError}
                        </div>
                      )}

                      <button type="button" onClick={handleVerifyOtp} disabled={store.otpVerifying || otp.replace(/\s/g, '').length < 6} className={btnCls}>
                        {store.otpVerifying ? <><Loader2 size={16} className="animate-spin" /> Verifying…</> : 'Verify & Access Booking'}
                      </button>

                      <ResendTimer key={resendKey} onResend={async () => { setOtp(''); await store.sendLookupOtp(); setResendKey(k => k + 1); }} />

                      <button type="button" onClick={() => { setLookupStep('form'); setOtp(''); store.reset(); }}
                        className="w-full text-slate-500 hover:text-slate-300 text-sm transition-colors">← Try a different booking</button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
