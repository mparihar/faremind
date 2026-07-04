/**
 * AiManageBookingFlow — Main orchestrator for manage-booking inside the AI Bot.
 * Handles: auth check → booking lookup/selection → action dispatch (cancel/update).
 * Reuses existing useManageBookingStore and backend APIs.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles, ChevronLeft, Settings, X, Loader2, AlertCircle, Mail, Send, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useManageBookingStore } from '@/store/useManageBookingStore';

import AiManageBookingLookup from './AiManageBookingLookup';
import AiManageBookingTiles from './AiManageBookingTiles';
import AiCancelBookingFlow from './AiCancelBookingFlow';
import AiPassengerUpdateFlow from './AiPassengerUpdateFlow';

// Chat bubble matching AiBookFlightFlow's AiBubble
function AiBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5 mb-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles className="w-3.5 h-3.5 text-[#1ABC9C]" />
        <span className="text-[13px] font-bold">
          <span className="text-white">FARE</span>
          <span style={{ color: '#009CA6' }}>MIND</span>{' '}
          <span className="text-[#1ABC9C]">AI</span>
        </span>
      </div>
      <div className="text-[15px] text-white/90 leading-relaxed">{children}</div>
    </div>
  );
}

type FlowStep =
  | 'choose_method'   // Guest: show sign-in vs PNR lookup
  | 'guest_lookup'    // Guest: PNR + Last Name form
  | 'otp_verify'      // Guest: OTP verification
  | 'loading_bookings'// Loading user bookings
  | 'select_booking'  // Show booking tiles
  | 'choose_action'   // Choose cancel / update passenger
  | 'cancel'          // Cancel booking sub-flow
  | 'update_passenger' // Update passenger sub-flow
  | 'email_itinerary'; // Email itinerary sub-flow

interface Props {
  /** Pre-selected intent from chat message (e.g. 'cancel' or 'update_passenger') */
  preselectedAction?: 'cancel' | 'update_passenger' | 'manage' | null;
  onExit: () => void;
}

export default function AiManageBookingFlow({ preselectedAction, onExit }: Props) {
  const auth = useAuthStore();
  const mbStore = useManageBookingStore();
  const pathname = usePathname();

  // Detect if we're in agent mode (agent portal pages or agent booking context)
  const isAgentMode = pathname.startsWith('/agent') || (() => {
    try { return !!sessionStorage.getItem('agentBookingContext'); } catch { return false; }
  })();

  const [step, setStep] = useState<FlowStep>('choose_method');
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [lookupPnr, setLookupPnr] = useState('');
  const [lookupLastName, setLookupLastName] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [guestBookingId, setGuestBookingId] = useState<string | null>(null);
  const [otpValue, setOtpValue] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpVerifying, setOtpVerifying] = useState(false);

  // Email itinerary state
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailTarget, setEmailTarget] = useState('');
  const [customEmail, setCustomEmail] = useState('');

  const isLoggedIn = !!auth.user;

  // ── Auto-start for logged-in users ─────────────────────────────────────────
  useEffect(() => {
    if (isLoggedIn && auth.user) {
      loadUserBookings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reset manage-booking store on unmount ──────────────────────────────────
  useEffect(() => {
    return () => {
      mbStore.setCancelSuccess(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load user bookings ─────────────────────────────────────────────────────
  const loadUserBookings = useCallback(async () => {
    if (!auth.user) return;
    setStep('loading_bookings');
    await mbStore.loadUserBookings(auth.user.id, isAgentMode);

    // Read fresh state — mbStore ref is stale after await
    const freshBookings = useManageBookingStore.getState().bookings;
    const activeBookings = freshBookings.filter(
      (b) => !['CANCELLED', 'FAILED'].includes(b.bookingStatus)
    );

    if (activeBookings.length === 1 && preselectedAction && preselectedAction !== 'manage') {
      // Single booking + specific action → skip tile selection
      await selectBookingAndAction(activeBookings[0], preselectedAction);
    } else {
      setStep('select_booking');
    }
  }, [auth.user, preselectedAction, isAgentMode]);

  // ── Guest lookup ───────────────────────────────────────────────────────────
  const handleGuestLookup = async (pnr: string, lastName: string) => {
    setLookupLoading(true);
    setLookupError(null);
    setLookupLastName(lastName);

    // Store the PNR + Last Name in the manage booking store
    mbStore.setLookupRef(pnr);
    mbStore.setLookupLastName(lastName);

    try {
      const found = await mbStore.lookupBooking();
      if (!found) {
        setLookupError(
          mbStore.lookupError || 'We could not find a booking with that reference and last name. Please verify the details or sign in.'
        );
        setLookupLoading(false);
        return;
      }

      // Lookup found — send OTP for email verification
      const otpSent = await mbStore.sendLookupOtp();
      if (!otpSent) {
        setLookupError(mbStore.lookupError || 'Could not send verification code.');
        setLookupLoading(false);
        return;
      }

      // OTP sent — show the OTP input step
      setLookupLoading(false);
      setOtpValue('');
      setOtpError(null);
      setStep('otp_verify');
      
    } catch (err: any) {
      setLookupError(err.message || 'Lookup failed. Please try again.');
      setLookupLoading(false);
    }
  };

  // ── Verify OTP and load bookings ───────────────────────────────────────────
  const handleVerifyOtp = async () => {
    if (!otpValue.trim() || otpValue.trim().length < 6) {
      setOtpError('Please enter the 6-digit code.');
      return;
    }

    setOtpVerifying(true);
    setOtpError(null);

    try {
      const bookingId = await mbStore.verifyLookupOtp(otpValue.trim());
      if (!bookingId) {
        setOtpError(mbStore.lookupError || 'Invalid or expired code. Please try again.');
        setOtpVerifying(false);
        return;
      }

      setGuestBookingId(bookingId);

      // Load the booking detail directly
      await mbStore.loadBookingDetail(bookingId);

      // Also load user bookings using the guest session
      // The verify-otp response created a guest session with id 'guest_{bookingId}'
      await mbStore.loadUserBookings(`guest_${bookingId}`);

      setOtpVerifying(false);

      // Read fresh state — mbStore ref is stale after await
      const freshState = useManageBookingStore.getState();
      const activeBookings = freshState.bookings.filter(
        (b) => !['CANCELLED', 'FAILED'].includes(b.bookingStatus)
      );

      if (activeBookings.length === 1 && preselectedAction && preselectedAction !== 'manage') {
        await selectBookingAndAction(activeBookings[0], preselectedAction);
      } else if (activeBookings.length > 0) {
        setStep('select_booking');
      } else {
        // Fallback: use the looked-up booking directly
        if (freshState.booking) {
          setSelectedBooking(freshState.booking);
          setStep('choose_action');
        } else {
          setStep('select_booking');
        }
      }
    } catch (err: any) {
      setOtpError(err.message || 'Verification failed. Please try again.');
      setOtpVerifying(false);
    }
  };

  // ── Select booking and proceed to action ───────────────────────────────────
  const selectBookingAndAction = async (booking: any, action?: string) => {
    setSelectedBooking(booking);

    // Load full booking detail
    await mbStore.loadBookingDetail(booking.id);

    const targetAction = action || preselectedAction;
    if (targetAction === 'cancel') {
      // Reset cancel state before starting
      mbStore.setCancelSuccess(null);
      setStep('cancel');
    } else if (targetAction === 'update_passenger') {
      setStep('update_passenger');
    } else {
      setStep('choose_action');
    }
  };

  // ── Handle booking tile select ─────────────────────────────────────────────
  const handleBookingSelect = (booking: any) => {
    selectBookingAndAction(booking);
  };

  // ── Sign in redirect ───────────────────────────────────────────────────────
  const handleSignIn = () => {
    // Navigate to the sign-in page
    window.location.href = '/';
  };

  // ── Get booking meta ───────────────────────────────────────────────────────
  const getBookingMeta = () => {
    const b = selectedBooking;
    if (!b) return { ref: '', pnr: undefined as string | undefined, route: '', departureDate: '' };
    return {
      ref: b.masterBookingReference,
      pnr: b.pnrs?.[0]?.pnrCode as string | undefined,
      route: `${b.originAirport} → ${b.destinationAirport}`,
      departureDate: b.departureDate,
    };
  };

  // ── Can go back ────────────────────────────────────────────────────────────
  const canGoBack = step !== 'choose_method' && step !== 'loading_bookings' && !(isLoggedIn && step === 'select_booking');

  const handleGoBack = () => {
    switch (step) {
      case 'guest_lookup':
        setStep('choose_method');
        break;
      case 'otp_verify':
        setStep('choose_method');
        break;
      case 'select_booking':
        setStep(isLoggedIn ? 'select_booking' : 'choose_method');
        break;
      case 'choose_action':
        setStep('select_booking');
        break;
      case 'cancel':
      case 'update_passenger':
      case 'email_itinerary':
        setEmailSent(false);
        setEmailError(null);
        setStep('choose_action');
        break;
      default:
        break;
    }
  };

  const meta = getBookingMeta();

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-gradient-to-r from-[#1ABC9C]/5 to-emerald-500/5 flex-none">
        <div className="flex items-center gap-1.5">
          {canGoBack && (
            <button
              onClick={handleGoBack}
              className="flex items-center justify-center w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all mr-0.5"
              title="Go back"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <Settings className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-[15px] font-bold bg-gradient-to-r from-[#1ABC9C] to-emerald-500 bg-clip-text text-transparent">
            Manage Booking
          </span>
        </div>
        <button
          onClick={onExit}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable Content */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0"
        style={{ background: 'linear-gradient(180deg, #f0fdfb 0%, #f8fffe 100%)', scrollbarWidth: 'none' }}
      >
        {/* ── Step: Choose Method (Guest) ─────────────────────────────────── */}
        {step === 'choose_method' && !isLoggedIn && (
          <>
            <AiBubble>
              {preselectedAction === 'cancel'
                ? "I'll help you cancel your booking. How would you like to access it?"
                : preselectedAction === 'update_passenger'
                  ? "I'll help you update passenger details. How would you like to access your booking?"
                  : "I'll help you manage your booking. How would you like to access it?"}
            </AiBubble>
            <AiManageBookingLookup
              onFound={(pnr, lastName) => {
                setLookupPnr(pnr);
                handleGuestLookup(pnr, lastName);
              }}
              onSignIn={handleSignIn}
              loading={lookupLoading}
              error={lookupError}
            />
          </>
        )}

        {/* ── Step: Guest Lookup ──────────────────────────────────────────── */}
        {step === 'guest_lookup' && (
          <>
            <AiBubble>
              Please enter your booking reference and last name to find your booking.
            </AiBubble>
            <AiManageBookingLookup
              onFound={(pnr, lastName) => {
                setLookupPnr(pnr);
                handleGuestLookup(pnr, lastName);
              }}
              onSignIn={handleSignIn}
              loading={lookupLoading}
              error={lookupError}
            />
          </>
        )}

        {/* ── Step: OTP Verification ──────────────────────────────────────── */}
        {step === 'otp_verify' && (
          <>
            <AiBubble>
              We sent a verification code to <strong>{mbStore.maskedEmail || 'your email'}</strong>. Enter it below to access your booking.
            </AiBubble>

            <div className="space-y-3">
              {/* OTP Info */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1ABC9C]/5 border border-[#1ABC9C]/20">
                <Mail className="w-3.5 h-3.5 text-[#1ABC9C] shrink-0" />
                <p className="text-[11px] text-slate-600">
                  Check your email for the 6-digit code
                </p>
              </div>

              {/* OTP Input */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
                  Verification Code
                </label>
                <input
                  type="text"
                  value={otpValue}
                  onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-center text-[18px] font-black text-slate-800 tracking-[0.3em] placeholder-slate-300 outline-none focus:border-[#1ABC9C]/60 focus:ring-1 focus:ring-[#1ABC9C]/20 transition-all"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp(); }}
                />
              </div>

              {/* Error */}
              {otpError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-red-600 leading-snug">{otpError}</p>
                </div>
              )}

              {/* Verify Button */}
              <button
                onClick={handleVerifyOtp}
                disabled={otpVerifying || otpValue.length < 6}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-[#1ABC9C] to-emerald-500 text-white shadow-md shadow-[#1ABC9C]/20 hover:shadow-lg hover:shadow-[#1ABC9C]/30 active:scale-[0.98]"
              >
                {otpVerifying ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  'Verify & Continue'
                )}
              </button>

              {/* Resend link */}
              <button
                onClick={() => {
                  setOtpError(null);
                  setOtpValue('');
                  mbStore.sendLookupOtp();
                }}
                className="w-full text-[10px] text-slate-400 hover:text-[#1ABC9C] transition-colors font-semibold"
              >
                Didn't receive it? Resend code
              </button>
            </div>
          </>
        )}

        {/* ── Step: Loading Bookings ──────────────────────────────────────── */}
        {step === 'loading_bookings' && (
          <AiBubble>Loading your bookings…</AiBubble>
        )}

        {/* ── Step: Select Booking ───────────────────────────────────────── */}
        {step === 'select_booking' && (
          <>
            <AiBubble>
              {mbStore.bookings.length > 1
                ? 'Here are your bookings. Select one to continue.'
                : mbStore.bookings.length === 1
                  ? 'I found your booking. Select it to continue.'
                  : 'No active bookings found.'}
            </AiBubble>
            <AiManageBookingTiles
              bookings={mbStore.bookings.filter(
                (b) => !['FAILED'].includes(b.bookingStatus)
              )}
              onSelect={handleBookingSelect}
              loading={mbStore.bookingsLoading}
            />
          </>
        )}

        {/* ── Step: Choose Action ────────────────────────────────────────── */}
        {step === 'choose_action' && selectedBooking && (
          <>
            <AiBubble>
              What would you like to do with booking{' '}
              <strong>{selectedBooking.masterBookingReference}</strong>?
            </AiBubble>

            <div className="space-y-2">
              {/* Cancel Booking */}
              {selectedBooking.bookingStatus !== 'CANCELLED' && (
                <button
                  onClick={() => {
                    mbStore.setCancelSuccess(null);
                    setStep('cancel');
                  }}
                  className="w-full text-left px-4 py-3 rounded-xl border border-red-200 bg-red-50/30 hover:bg-red-50 hover:border-red-300 transition-all group"
                >
                  <p className="text-[12px] font-bold text-red-700 group-hover:text-red-800">
                    Cancel Booking
                  </p>
                  <p className="text-[10px] text-red-400 mt-0.5">
                    Check eligibility and estimated refund
                  </p>
                </button>
              )}

              {/* Update Passenger */}
              <button
                onClick={() => setStep('update_passenger')}
                className="w-full text-left px-4 py-3 rounded-xl border border-[#1ABC9C]/30 bg-[#1ABC9C]/5 hover:bg-[#1ABC9C]/10 hover:border-[#1ABC9C]/50 transition-all group"
              >
                <p className="text-[12px] font-bold text-slate-700 group-hover:text-slate-800">
                  Update Passenger Details
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Email, phone, passport, nationality
                </p>
              </button>

              {/* Email Itinerary */}
              <button
                onClick={() => {
                  setEmailSent(false);
                  setEmailError(null);
                  setCustomEmail('');
                  setStep('email_itinerary');
                }}
                className="w-full text-left px-4 py-3 rounded-xl border border-blue-200 bg-blue-50/30 hover:bg-blue-50 hover:border-blue-300 transition-all group"
              >
                <p className="text-[12px] font-bold text-blue-700 group-hover:text-blue-800">
                  Email Itinerary
                </p>
                <p className="text-[10px] text-blue-400 mt-0.5">
                  Send booking itinerary to email
                </p>
              </button>
            </div>
          </>
        )}

        {/* ── Step: Cancel Booking ───────────────────────────────────────── */}
        {step === 'cancel' && selectedBooking && (
          <>
            <AiBubble>
              Checking cancellation eligibility for booking{' '}
              <strong>{meta.ref}</strong>…
            </AiBubble>
            <AiCancelBookingFlow
              bookingId={selectedBooking.id}
              bookingReference={meta.ref}
              pnrCode={meta.pnr}
              route={meta.route}
              departureDate={meta.departureDate}
              onBack={() => setStep('choose_action')}
              onDone={onExit}
            />
          </>
        )}

        {/* ── Step: Update Passenger ─────────────────────────────────────── */}
        {step === 'update_passenger' && selectedBooking && (
          <>
            <AiBubble>
              Let's update passenger details for booking{' '}
              <strong>{meta.ref}</strong>.
            </AiBubble>
            <AiPassengerUpdateFlow
              bookingId={selectedBooking.id}
              bookingReference={meta.ref}
              pnrCode={meta.pnr}
              passengers={mbStore.booking?.passengers || selectedBooking.passengers || []}
              onBack={() => setStep('choose_action')}
              onDone={onExit}
            />
          </>
        )}

        {/* ── Step: Email Itinerary ──────────────────────────────────────── */}
        {step === 'email_itinerary' && selectedBooking && (
          <>
            <AiBubble>
              {emailSent ? (
                <p>Itinerary sent successfully! ✉️</p>
              ) : (
                <p>
                  Send itinerary for booking <strong>{meta.ref}</strong> to an email address.
                </p>
              )}
            </AiBubble>

            {emailSent ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <p className="text-[13px] font-bold text-emerald-700">Email Sent</p>
                </div>
                <p className="text-[11px] text-emerald-600">
                  Itinerary has been sent to <strong>{emailTarget}</strong>
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => { setEmailSent(false); setCustomEmail(''); }}
                    className="flex-1 py-2 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-[12px] font-semibold transition-colors"
                  >
                    Send to Another Email
                  </button>
                  <button
                    onClick={() => setStep('choose_action')}
                    className="flex-1 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[12px] font-semibold transition-colors"
                  >
                    Back to Actions
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Send to booking email */}
                {selectedBooking.customerEmail && (
                  <button
                    onClick={async () => {
                      setEmailSending(true);
                      setEmailError(null);
                      try {
                        const res = await fetch('/api/manage-booking/email-itinerary', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ bookingId: selectedBooking.id }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || 'Failed to send email');
                        setEmailTarget(data.sentTo);
                        setEmailSent(true);
                      } catch (err: any) {
                        setEmailError(err.message || 'Failed to send email');
                      } finally {
                        setEmailSending(false);
                      }
                    }}
                    disabled={emailSending}
                    className="w-full text-left px-4 py-3 rounded-xl border border-blue-200 bg-blue-50/30 hover:bg-blue-50 hover:border-blue-300 transition-all group disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2">
                      {emailSending ? (
                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 text-blue-500" />
                      )}
                      <div>
                        <p className="text-[12px] font-bold text-blue-700">
                          {emailSending ? 'Sending...' : 'Send to booking email'}
                        </p>
                        <p className="text-[10px] text-blue-400 mt-0.5">
                          {selectedBooking.customerEmail}
                        </p>
                      </div>
                    </div>
                  </button>
                )}

                {/* Send to custom email */}
                <div className="px-4 py-3 rounded-xl border border-slate-200 bg-white">
                  <p className="text-[12px] font-bold text-slate-700 mb-2">Or send to a different email:</p>
                  <div className="flex gap-1.5">
                    <input
                      type="email"
                      value={customEmail}
                      onChange={(e) => { setCustomEmail(e.target.value); setEmailError(null); }}
                      placeholder="Enter email address"
                      className="flex-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-[13px] placeholder-slate-400 focus:outline-none focus:border-blue-400 transition-colors min-w-0"
                    />
                    <button
                      onClick={async () => {
                        if (!customEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customEmail)) {
                          setEmailError('Please enter a valid email address');
                          return;
                        }
                        setEmailSending(true);
                        setEmailError(null);
                        try {
                          const res = await fetch('/api/manage-booking/email-itinerary', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ bookingId: selectedBooking.id, recipientEmail: customEmail.trim() }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || 'Failed to send email');
                          setEmailTarget(data.sentTo);
                          setEmailSent(true);
                        } catch (err: any) {
                          setEmailError(err.message || 'Failed to send email');
                        } finally {
                          setEmailSending(false);
                        }
                      }}
                      disabled={emailSending || !customEmail.trim()}
                      className="flex-none px-3 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {emailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {emailError && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-none" />
                    <p className="text-[11px] text-red-600">{emailError}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
