// FILE: src/app/checkout/payment/page.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Lock,
  CreditCard,
  ShieldCheck,
  AlertCircle,
  Loader2,
  ChevronDown,
  Plane,
  Shield,
} from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { CheckoutHeader } from '@/components/checkout/CheckoutStepNav';
import { useOfferGuard } from '@/hooks/useOfferGuard';
import { useOfferSessionStore } from '@/store/useOfferSessionStore';
import { cn } from '@/lib/utils';
import { useCheckoutStore, buildLocalPricing } from '@/store/useCheckoutStore';
import { useAuthStore } from '@/store/useAuthStore';
import { apiFetch } from '@/lib/api-client';
import { useFeeLoader } from '@/hooks/useFeeLoader';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_INDEX = 6;

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
);

const fmt = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);

// ─── Country options ──────────────────────────────────────────────────────────

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

// ─── Stripe Elements style ───────────────────────────────────────────────────

const STRIPE_ELEMENT_STYLE = {
  base: {
    fontSize: '14px',
    color: '#0F172A',
    fontFamily: 'Inter, system-ui, sans-serif',
    '::placeholder': {
      color: '#94A3B8',
    },
    letterSpacing: '0.025em',
  },
  invalid: {
    color: '#EF4444',
    iconColor: '#EF4444',
  },
};

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

// ─── Inner Payment Form (has access to Stripe hooks) ─────────────────────────

function PaymentFormInner() {
  const router = useRouter();
  const { isExpired, OfferGuardUI } = useOfferGuard();
  const store = useCheckoutStore();
  const { user } = useAuthStore();
  const stripe = useStripe();
  const elements = useElements();

  const [processing, setProcessing] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [cardholderName, setCardholderName] = useState('');
  const [billingCountry, setBillingCountry] = useState('United States');
  const [billingAddress, setBillingAddress] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingZip, setBillingZip] = useState('');

  // Track Stripe Element completeness
  const [cardNumberComplete, setCardNumberComplete] = useState(false);
  const [cardExpiryComplete, setCardExpiryComplete] = useState(false);
  const [cardCvcComplete, setCardCvcComplete] = useState(false);

  const {
    selectedFare,
    sessionId,
    sourceFlight,
    sourceRoundTrip,
    passengers,
    currency,
    seatSelections,
    mealSelections,
  } = store;

  const pricing = buildLocalPricing(store);

  // Load DB-driven fees — populates computedFees in checkout store
  useFeeLoader();

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

  const airlineName = (() => {
    if (sourceRoundTrip) return sourceRoundTrip.airlines[0] ?? '';
    return sourceFlight?.airline.name ?? '';
  })();

  // ── Validation ─────────────────────────────────────────────────────────────
  const isFormValid =
    cardholderName.trim().length > 0 &&
    cardNumberComplete &&
    cardExpiryComplete &&
    cardCvcComplete &&
    billingCountry.trim().length > 0 &&
    billingAddress.trim().length > 0 &&
    billingCity.trim().length > 0 &&
    billingZip.trim().length > 0;

  // ── Booking flow ───────────────────────────────────────────────────────────
  const handleCompleteBooking = async () => {
    if (!isFormValid || processing || !stripe || !elements) return;

    // Pre-payment expiry guard
    const sessionStatus = useOfferSessionStore.getState().status;
    if (sessionStatus === 'EXPIRED') {
      setBookingError('This fare has expired. Please refresh flight results and select a new fare.');
      return;
    }

    setProcessing(true);
    setBookingError(null);
    store.setPaymentStatus('processing');

    try {
      // 1. Create Stripe PaymentIntent with the customer grand total
      const primaryPax = passengers[0];
      const intentRaw = await fetch('/api/checkout/payment/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: pricing.total,
          currency: currency ?? 'USD',
          description: `FAREMIND booking — ${routeLabel}`,
          customerEmail: primaryPax?.email || '',
          sessionId,
        }),
      });
      const intentRes = await intentRaw.json() as { paymentIntentId: string; clientSecret?: string; error?: string };

      if (!intentRaw.ok || !intentRes.paymentIntentId || !intentRes.clientSecret) {
        throw new Error(intentRes.error || 'Failed to create payment intent');
      }

      const { paymentIntentId, clientSecret } = intentRes;
      store.setPaymentIntent(paymentIntentId);

      // 2. Confirm payment via Stripe.js (PCI-compliant — card data never touches our server)
      const cardNumberElement = elements.getElement(CardNumberElement);
      if (!cardNumberElement) {
        throw new Error('Card input not ready. Please refresh and try again.');
      }

      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        {
          payment_method: {
            card: cardNumberElement,
            billing_details: {
              name: cardholderName,
              address: {
                line1: billingAddress,
                city: billingCity,
                postal_code: billingZip,
                country: billingCountry === 'United States' ? 'US'
                       : billingCountry === 'United Kingdom' ? 'GB'
                       : billingCountry === 'Canada' ? 'CA'
                       : billingCountry === 'Australia' ? 'AU'
                       : billingCountry === 'Germany' ? 'DE'
                       : billingCountry === 'France' ? 'FR'
                       : billingCountry === 'India' ? 'IN'
                       : billingCountry === 'Japan' ? 'JP'
                       : billingCountry === 'Singapore' ? 'SG'
                       : billingCountry === 'UAE' ? 'AE'
                       : 'US',
              },
              email: primaryPax?.email || undefined,
            },
          },
        }
      );

      if (stripeError) {
        throw new Error(stripeError.message || 'Payment was declined. Please check your card details.');
      }

      // With capture_method: 'manual', status will be 'requires_capture'
      if (paymentIntent?.status !== 'requires_capture' && paymentIntent?.status !== 'succeeded') {
        throw new Error(`Unexpected payment status: ${paymentIntent?.status}. Please try again.`);
      }

      console.log(`[Payment] ✅ Stripe authorization successful: ${paymentIntentId} (status: ${paymentIntent.status})`);

      // 3. Confirm booking — calls Next.js route directly (creates Duffel order + captures Stripe)
      const bookingRes = await fetch('/api/checkout/bookings/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentIntentId,
          sessionId,
          passengers: passengers.map((p) => ({
            id: p.id,
            firstName: p.firstName,
            middleName: p.middleName,
            lastName: p.lastName,
            gender: p.gender,
            dateOfBirth: p.dateOfBirth,
            email: p.email,
            phone: p.phone,
            nationality: p.nationality,
            passportNumber: p.passportNumber,
            passportExpiry: p.passportExpiry,
            passportCountry: p.passportCountry,
            type: p.type,
          })),
          selectedFare,
          pricing,
          routeLabel,
          extraBags: store.extraBags,
          priceProtection: store.priceProtection,
          travelInsurance: store.travelInsurance,
          seatSelections,
          mealSelections,
          sourceFlight,
          sourceRoundTrip,
          currency: currency ?? 'USD',
          userId: user?.id ?? null,
        }),
      })
        .then((r) => r.json()) as {
          success: boolean; pnr?: string; bookingId?: string; error?: string;
          errorCode?: string;
          masterBookingReference?: string;
          pnrStrategy?: string | null;
          isSplitTicket?: boolean;
          riskLabel?: string | null;
          riskExplanation?: string | null;
          pnrs?: Array<{ pnrCode: string; pnrType: string; journeyDirection: 'ALL'|'OUTBOUND'|'RETURN'; isPrimary: boolean; airlineCode?: string|null; airlineName?: string|null; displayLabel: string }>;
        };

      if (!bookingRes.success && 'error' in bookingRes && bookingRes.error) {
        // Use the customer-friendly message if available (e.g. "Your card was not charged")
        const displayMsg = (bookingRes as any).customerMessage || bookingRes.error;
        throw new Error(displayMsg);
      }

      // 4. Store confirmation
      const last4 = paymentIntent?.payment_method
        ? (paymentIntent as any).payment_method_details?.card?.last4 || '****'
        : '****';
      const pnr = bookingRes.pnr ?? `FM${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const bookingId = bookingRes.bookingId ?? `bk_${Date.now()}`;
      const passengerNames = passengers.map(
        (p) => `${p.firstName} ${p.lastName}`.trim() || 'Traveler'
      );
      store.setPricing(pricing);
      store.setConfirmation({
        pnr,
        masterBookingReference: bookingRes.masterBookingReference ?? pnr,
        bookingId,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        passengerNames,
        totalCharged: pricing.total,
        currency: currency ?? 'USD',
        pnrStrategy:    bookingRes.pnrStrategy ?? null,
        isSplitTicket:  bookingRes.isSplitTicket ?? false,
        riskLabel:      bookingRes.riskLabel ?? null,
        riskExplanation: bookingRes.riskExplanation ?? null,
        pnrs:           bookingRes.pnrs ?? [],
      });

      // 5. Send notification (non-blocking)
      apiFetch('/api/checkout/notifications/booking-confirm', {
        method: 'POST',
        body: JSON.stringify({
          pnr,
          bookingId,
          paymentIntentId,
          email: passengers[0]?.email,
          customerName: `${passengers[0]?.firstName ?? ''} ${passengers[0]?.lastName ?? ''}`.trim() || 'Traveler',
          passengerNames,
          passengers: passengers.map((p) => ({
            name: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' '),
            type: p.type === 'child' ? 'Child' : 'Adult',
            gender: p.gender ?? '',
            date_of_birth: p.dateOfBirth ?? '',
            email: p.email ?? '',
            phone: p.phone ?? '',
            nationality: p.nationality ?? '',
            passport_number: p.passportNumber ?? '',
            passport_expiry: p.passportExpiry ?? '',
            issuing_country: p.passportCountry ?? '',
          })),
          total: pricing.total,
          currency: currency ?? 'USD',
          routeLabel,
          airline: airlineName,
          fareClass: selectedFare.cabin.replace(/_/g, ' '),
          last4,
          // Full pricing breakdown for email templates
          pricing: {
            perPassenger: pricing.perPassenger.map((p, i) => ({
              name: passengers[i]
                ? `${passengers[i].firstName} ${passengers[i].lastName}`.trim()
                : `Passenger ${i + 1}`,
              type: p.type,
              fare: p.subtotal,
            })),
            seatFees:      pricing.seatFees,
            mealFees:      pricing.mealFees,
            baggageFees:   pricing.baggageFees,
            protectionFee: pricing.protectionFee,
            insuranceFee:  pricing.insuranceFee,
            serviceFee:    pricing.serviceFee,
            total:         pricing.total,
          },
        }),
      }).catch(() => {});

      store.setPaymentStatus('succeeded');
      useOfferSessionStore.getState().markBooked();
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

  // ── Stripe Element wrapper style ──────────────────────────────────────────
  const elementContainerClass =
    'w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus-within:border-[#1ABC9C]/50 focus-within:bg-white transition-all';

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <CheckoutHeader stepIndex={STEP_INDEX} />
      {OfferGuardUI()}

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
                {/* Card brand logos */}
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
                {/* Card number — Stripe Element */}
                <div>
                  <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                    Card Number <span className="text-red-400">*</span>
                  </label>
                  <div className={elementContainerClass}>
                    <CardNumberElement
                      options={{ style: STRIPE_ELEMENT_STYLE, showIcon: true }}
                      onChange={(e) => setCardNumberComplete(e.complete)}
                    />
                  </div>
                </div>

                {/* Cardholder name — regular input (not PCI-sensitive) */}
                <div>
                  <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                    Cardholder Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="John Doe"
                    value={cardholderName}
                    onChange={(e) => setCardholderName(e.target.value)}
                    autoComplete="cc-name"
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-[#1ABC9C]/50 focus:bg-white transition-all"
                  />
                </div>

                {/* Expiry + CVC — Stripe Elements */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                      Expiry (MM/YY) <span className="text-red-400">*</span>
                    </label>
                    <div className={elementContainerClass}>
                      <CardExpiryElement
                        options={{ style: STRIPE_ELEMENT_STYLE }}
                        onChange={(e) => setCardExpiryComplete(e.complete)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                      CVC <span className="text-red-400">*</span>
                    </label>
                    <div className={elementContainerClass}>
                      <CardCvcElement
                        options={{ style: STRIPE_ELEMENT_STYLE }}
                        onChange={(e) => setCardCvcComplete(e.complete)}
                      />
                    </div>
                  </div>
                </div>

                {/* Billing address — regular inputs */}
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
                    Billing Address
                  </p>
                  <div className="space-y-4">
                    {/* Country */}
                    <div>
                      <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                        Country <span className="text-red-400">*</span>
                      </label>
                      <div className="relative">
                        <select
                          value={billingCountry}
                          onChange={(e) => setBillingCountry(e.target.value)}
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
                        Address Line <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="123 Main Street"
                        value={billingAddress}
                        onChange={(e) => setBillingAddress(e.target.value)}
                        autoComplete="street-address"
                        className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-[#1ABC9C]/50 focus:bg-white transition-all"
                      />
                    </div>

                    {/* City + ZIP */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                          City <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="New York"
                          value={billingCity}
                          onChange={(e) => setBillingCity(e.target.value)}
                          autoComplete="address-level2"
                          className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-[#1ABC9C]/50 focus:bg-white transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                          ZIP / Postal Code <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="10001"
                          value={billingZip}
                          onChange={(e) => setBillingZip(e.target.value)}
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
                  All bookings include FAREMIND&apos;s 24/7 support and booking guarantee.
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
                disabled={processing || !isFormValid || !stripe}
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
                disabled={processing || !isFormValid || isExpired || !stripe}
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

              {!isFormValid && !processing && (
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

// ─── Page (wraps with Stripe Elements Provider) ──────────────────────────────

export default function PaymentPage() {
  return (
    <Elements
      stripe={stripePromise}
      options={{
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#1ABC9C',
            borderRadius: '12px',
          },
        },
      }}
    >
      <PaymentFormInner />
    </Elements>
  );
}
