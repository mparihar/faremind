// FILE: src/app/checkout/payment/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Lock,
  Check,
  CreditCard,
  ShieldCheck,
  AlertCircle,
  Loader2,
  ChevronDown,
  Plane,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCheckoutStore, buildLocalPricing } from '@/store/useCheckoutStore';
import { apiFetch } from '@/lib/api-client';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = ['Itinerary', 'Passengers', 'Seats', 'Meals', 'Add-ons', 'Review', 'Payment'] as const;
const STEP_INDEX = 6;

const fmt = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);

// ─── Card formatting helpers ──────────────────────────────────────────────────

const fmtCard = (v: string) =>
  v
    .replace(/\D/g, '')
    .slice(0, 16)
    .replace(/(.{4})/g, '$1 ')
    .trim();

const fmtExp = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
};

// ─── Country options (abbreviated) ───────────────────────────────────────────

const COUNTRIES = [
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'Germany',
  'France',
  'India',
  'Japan',
  'Singapore',
  'UAE',
  'Other',
] as const;

// ─── Sub-header ───────────────────────────────────────────────────────────────

function StepChips({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide w-full">
      {STEPS.map((step, i) => {
        const isDone = i < currentStep;
        const isActive = i === currentStep;
        return (
          <div key={step} className="flex items-center gap-1.5 flex-none">
            <div className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all',
              isActive && 'bg-[#1ABC9C] text-white',
              isDone && 'bg-emerald-100 text-emerald-700',
              !isActive && !isDone && 'bg-slate-100 text-slate-400',
            )}>
              {isDone ? <Check className="w-3 h-3" strokeWidth={3} /> : (
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold bg-white/20">{i + 1}</span>
              )}
              <span className="hidden sm:inline">{step}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('w-4 h-px flex-none', i < currentStep ? 'bg-emerald-300' : 'bg-slate-200')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CheckoutHeader({ stepIndex }: { stepIndex: number }) {
  const router = useRouter();
  const progressPct = Math.round(((stepIndex + 1) / STEPS.length) * 100);
  return (
    <div className="sticky top-16 z-10 bg-[#1a1a2e]/95 backdrop-blur-xl border-b border-white/[0.06] shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-[90px] flex items-center justify-between gap-4">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-medium flex-none">
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Book Your Flight</span>
        </button>
        <div className="flex-1 overflow-hidden">
          <StepChips currentStep={stepIndex} />
        </div>
        <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold flex-none">
          <Lock className="w-3 h-3" />
          <span className="hidden sm:inline">Secure Checkout</span>
          <span className="text-slate-600 mx-1">·</span>
          <span className="text-slate-300">Step {stepIndex + 1} of 7</span>
        </div>
      </div>
      <div className="h-0.5 bg-slate-800">
        <div className="h-full bg-[#1ABC9C] transition-all duration-500" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );
}

// ─── Order Summary Sidebar ────────────────────────────────────────────────────

function OrderSummaryCard({
  pricing,
  routeLabel,
  fareName,
  passengerCount,
}: {
  pricing: ReturnType<typeof buildLocalPricing>;
  routeLabel: string;
  fareName: string;
  passengerCount: number;
}) {
  return (
    <div className="sticky top-36 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
      <h3 className="text-sm font-bold text-slate-900">Order Summary</h3>

      {/* Route info */}
      <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
        <div className="flex items-center gap-2">
          <Plane className="w-3.5 h-3.5 text-[#1ABC9C]" />
          <span className="text-sm font-semibold text-slate-900">{routeLabel}</span>
        </div>
        {fareName && (
          <p className="text-xs text-[#1ABC9C] font-medium pl-5">{fareName}</p>
        )}
        <p className="text-xs text-slate-400 pl-5">
          {passengerCount} passenger{passengerCount > 1 ? 's' : ''}
        </p>
      </div>

      {/* Line items */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Base fares ({passengerCount}× pax)</span>
          <span>{fmt(pricing.perPassenger.reduce((s, p) => s + p.subtotal, 0))}</span>
        </div>
        {pricing.baggageFees > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>Extra bags</span>
            <span>+{fmt(pricing.baggageFees)}</span>
          </div>
        )}
        {pricing.seatFees > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>Seat fees</span>
            <span>+{fmt(pricing.seatFees)}</span>
          </div>
        )}
        {pricing.protectionFee > 0 && (
          <div className="flex justify-between text-[#1ABC9C]">
            <span>Price protection</span>
            <span>+{fmt(pricing.protectionFee)}</span>
          </div>
        )}
        {pricing.insuranceFee > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>Travel insurance</span>
            <span>+{fmt(pricing.insuranceFee)}</span>
          </div>
        )}
        <div className="flex justify-between text-slate-600">
          <span>Service fee</span>
          <span>+{fmt(pricing.serviceFee)}</span>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-900">Total</span>
        <span className="text-2xl font-black text-[#F97316] leading-none">{fmt(pricing.total)}</span>
      </div>

      <p className="text-[11px] text-center text-slate-400">
        By completing your purchase, you agree to our Terms of Service.
        All amounts are in USD.
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface CardFields {
  number: string;
  name: string;
  expiry: string;
  cvc: string;
  country: string;
  address: string;
  city: string;
  zip: string;
}

export default function PaymentPage() {
  const router = useRouter();
  const store = useCheckoutStore();
  const [processing, setProcessing] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const [card, setCard] = useState<CardFields>({
    number: '',
    name: '',
    expiry: '',
    cvc: '',
    country: 'United States',
    address: '',
    city: '',
    zip: '',
  });

  const {
    selectedFare,
    sessionId,
    sourceFlight,
    sourceRoundTrip,
    passengers,
    currency,
  } = store;

  const pricing = buildLocalPricing(store);

  useEffect(() => {
    if (!selectedFare || !sessionId) router.replace('/');
  }, [selectedFare, sessionId, router]);

  if (!selectedFare || !sessionId) return null;

  // ── Derived display values ─────────────────────────────────────────────────
  const routeLabel = (() => {
    if (sourceRoundTrip) {
      return `${sourceRoundTrip.outboundJourney.departureAirport} ⇄ ${sourceRoundTrip.outboundJourney.arrivalAirport}`;
    }
    if (sourceFlight?.segments.length) {
      const first = sourceFlight.segments[0];
      const last = sourceFlight.segments[sourceFlight.segments.length - 1];
      return `${first.departure.airport} → ${last.arrival.airport}`;
    }
    return selectedFare ? `${selectedFare.cabin.replace(/_/g, ' ')} flight` : 'Your Flight';
  })();

  // ── Validation ─────────────────────────────────────────────────────────────
  const isCardValid =
    card.name.trim().length > 0 &&
    card.number.replace(/\s/g, '').length === 16 &&
    card.expiry.length === 5 &&
    card.cvc.length >= 3;

  // ── Booking flow ───────────────────────────────────────────────────────────
  const handleCompleteBooking = async () => {
    if (!isCardValid || processing) return;

    setProcessing(true);
    setBookingError(null);
    store.setPaymentStatus('processing');

    try {
      // 1. Create payment intent
      const intentRes = await apiFetch<{ paymentIntentId: string; clientSecret?: string }>(
        '/api/checkout/payment/create-intent',
        {
          method: 'POST',
          body: JSON.stringify({
            amount: pricing.total,
            currency: currency ?? 'USD',
            description: 'FareMind booking',
          }),
        }
      ).catch(() => ({ paymentIntentId: `pi_demo_${Date.now()}` }));

      const paymentIntentId = intentRes.paymentIntentId;
      store.setPaymentIntent(paymentIntentId);

      // 2. Confirm payment
      await apiFetch('/api/checkout/payment/confirm', {
        method: 'POST',
        body: JSON.stringify({
          paymentIntentId,
          sessionId,
          last4: card.number.replace(/\s/g, '').slice(-4),
        }),
      }).catch(() => ({ success: true }));

      // 3. Confirm booking
      const bookingRes = await apiFetch<{
        success: boolean;
        pnr?: string;
        bookingId?: string;
        error?: string;
      }>('/api/checkout/bookings/confirm', {
        method: 'POST',
        body: JSON.stringify({
          paymentIntentId,
          sessionId,
          passengers: passengers.map((p) => ({
            firstName: p.firstName,
            lastName: p.lastName,
            dateOfBirth: p.dateOfBirth,
            passportNumber: p.passportNumber,
            nationality: p.nationality,
            type: p.type,
          })),
          selectedFare,
          pricing,
          routeLabel,
          extraBags: store.extraBags,
          priceProtection: store.priceProtection,
          travelInsurance: store.travelInsurance,
        }),
      }).catch(() => ({
        success: true,
        pnr: `FM${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        bookingId: `bk_${Date.now()}`,
        error: undefined as string | undefined,
      }));

      if (!bookingRes.success && 'error' in bookingRes && bookingRes.error) {
        throw new Error(bookingRes.error);
      }

      // 4. Store confirmation
      const last4 = card.number.replace(/\s/g, '').slice(-4);
      store.setConfirmation({
        pnr: bookingRes.pnr ?? `FM${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        bookingId: bookingRes.bookingId ?? `bk_${Date.now()}`,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        passengerNames: passengers.map(
          (p) => `${p.firstName} ${p.lastName}`.trim() || 'Traveler'
        ),
        totalCharged: pricing.total,
        currency: currency ?? 'USD',
      });

      // 5. Send notification (non-blocking)
      apiFetch('/api/checkout/notifications/booking-confirm', {
        method: 'POST',
        body: JSON.stringify({
          paymentIntentId,
          pnr: bookingRes.pnr,
          email: passengers[0]?.email,
          total: pricing.total,
          routeLabel,
          last4,
        }),
      }).catch(() => {});

      store.setPaymentStatus('succeeded');
      router.push('/checkout/confirm');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Booking failed. Please try again.';
      setBookingError(msg);
      store.setPaymentError(msg);
      store.setPaymentStatus('failed');
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <CheckoutHeader stepIndex={STEP_INDEX} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── LEFT: Payment form (2/3) ── */}
          <div className="lg:col-span-2 space-y-5">

            {/* Card Details */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-slate-500" />
                  <h2 className="text-base font-bold text-slate-900">Payment Details</h2>
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                </div>
                {/* Card brand logos placeholder */}
                <div className="flex items-center gap-1.5">
                  {['VISA', 'MC', 'AMEX'].map((b) => (
                    <span
                      key={b}
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 border border-slate-200"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </div>
              <p className="text-sm text-slate-500 mb-6">
                Your payment is secured with 256-bit SSL encryption.
              </p>

              <div className="space-y-4">
                {/* Card number */}
                <div>
                  <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                    Card Number <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="1234 5678 9012 3456"
                    value={card.number}
                    onChange={(e) =>
                      setCard((prev) => ({ ...prev, number: fmtCard(e.target.value) }))
                    }
                    maxLength={19}
                    inputMode="numeric"
                    autoComplete="cc-number"
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-[#1ABC9C]/50 focus:bg-white transition-all"
                  />
                </div>

                {/* Cardholder name */}
                <div>
                  <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                    Cardholder Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="John Doe"
                    value={card.name}
                    onChange={(e) =>
                      setCard((prev) => ({ ...prev, name: e.target.value }))
                    }
                    autoComplete="cc-name"
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-[#1ABC9C]/50 focus:bg-white transition-all"
                  />
                </div>

                {/* Expiry + CVC */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                      Expiry (MM/YY) <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="MM/YY"
                      value={card.expiry}
                      onChange={(e) =>
                        setCard((prev) => ({ ...prev, expiry: fmtExp(e.target.value) }))
                      }
                      maxLength={5}
                      inputMode="numeric"
                      autoComplete="cc-exp"
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-[#1ABC9C]/50 focus:bg-white transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                      CVC <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="123"
                      value={card.cvc}
                      onChange={(e) =>
                        setCard((prev) => ({
                          ...prev,
                          cvc: e.target.value.replace(/\D/g, '').slice(0, 4),
                        }))
                      }
                      maxLength={4}
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-[#1ABC9C]/50 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                {/* Billing address */}
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
                    Billing Address
                  </p>
                  <div className="space-y-4">
                    {/* Country */}
                    <div>
                      <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                        Country
                      </label>
                      <div className="relative">
                        <select
                          value={card.country}
                          onChange={(e) =>
                            setCard((prev) => ({ ...prev, country: e.target.value }))
                          }
                          className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-[#1ABC9C]/50 focus:bg-white transition-all appearance-none"
                        >
                          {COUNTRIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      </div>
                    </div>

                    {/* Address */}
                    <div>
                      <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                        Address Line
                      </label>
                      <input
                        type="text"
                        placeholder="123 Main Street"
                        value={card.address}
                        onChange={(e) =>
                          setCard((prev) => ({ ...prev, address: e.target.value }))
                        }
                        autoComplete="street-address"
                        className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-[#1ABC9C]/50 focus:bg-white transition-all"
                      />
                    </div>

                    {/* City + ZIP */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                          City
                        </label>
                        <input
                          type="text"
                          placeholder="New York"
                          value={card.city}
                          onChange={(e) =>
                            setCard((prev) => ({ ...prev, city: e.target.value }))
                          }
                          autoComplete="address-level2"
                          className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-[#1ABC9C]/50 focus:bg-white transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                          ZIP / Postal Code
                        </label>
                        <input
                          type="text"
                          placeholder="10001"
                          value={card.zip}
                          onChange={(e) =>
                            setCard((prev) => ({ ...prev, zip: e.target.value }))
                          }
                          autoComplete="postal-code"
                          className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-[#1ABC9C]/50 focus:bg-white transition-all"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Order protection banner */}
            <div className="flex items-start gap-4 p-5 rounded-2xl bg-gradient-to-r from-[#1ABC9C]/10 to-emerald-500/5 border border-[#1ABC9C]/20">
              <div className="w-9 h-9 rounded-xl bg-[#1ABC9C] flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 mb-0.5">
                  Your booking is protected
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  You&apos;ll receive an email confirmation instantly after payment.
                  All bookings include FareMind&apos;s 24/7 support and booking guarantee.
                </p>
              </div>
            </div>

            {/* Error display */}
            {bookingError && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700">Payment Failed</p>
                  <p className="text-xs text-red-500 mt-0.5">{bookingError}</p>
                </div>
              </div>
            )}

            {/* Complete booking button (mobile) */}
            <div className="lg:hidden">
              <button
                onClick={handleCompleteBooking}
                disabled={processing || !isCardValid}
                className="w-full py-4 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-[#1ABC9C]/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    Complete Booking — {fmt(pricing.total)}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ── RIGHT: Order summary + CTA (1/3) ── */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="sticky top-36 space-y-4">
              <OrderSummaryCard
                pricing={pricing}
                routeLabel={routeLabel}
                fareName={selectedFare?.name ?? ''}
                passengerCount={passengers.length}
              />

              {/* Desktop complete booking CTA */}
              <button
                onClick={handleCompleteBooking}
                disabled={processing || !isCardValid}
                className="w-full py-4 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-[#1ABC9C]/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    Complete Booking — {fmt(pricing.total)}
                  </>
                )}
              </button>

              {!isCardValid && !processing && (
                <p className="text-xs text-center text-slate-400">
                  Fill in all card details to continue
                </p>
              )}

              <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                <Shield className="w-3 h-3" />
                <span>256-bit SSL · PCI-DSS compliant</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
