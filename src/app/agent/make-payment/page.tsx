'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Wallet, Shield, TrendingDown, Heart, Armchair, Calendar,
  Luggage, ArrowUpCircle, HelpCircle, ChevronRight, CheckCircle2,
  Loader2, AlertTriangle, CreditCard, Lock, ArrowLeft, Hash, Ticket,
  ChevronDown, MapPin, User,
} from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardNumberElement, CardExpiryElement, CardCvcElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useAuthStore } from '@/store/useAuthStore';
import { motion, AnimatePresence } from 'framer-motion';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');
const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

const SERVICE_TYPES = [
  { value: 'CFAR', label: 'Cancel For Any Reason', icon: Shield, color: 'from-blue-500 to-cyan-500', desc: 'Full refund if you cancel for any reason' },
  { value: 'PRICE_DROP_PROTECTION', label: 'Price Drop Protection', icon: TrendingDown, color: 'from-[#1ABC9C] to-emerald-500', desc: 'Get refunded if the price drops after booking' },
  { value: 'TRAVEL_INSURANCE', label: 'Travel Insurance', icon: Heart, color: 'from-purple-500 to-violet-500', desc: 'Comprehensive travel insurance coverage' },
  { value: 'SEAT_CHANGE', label: 'Seat Change', icon: Armchair, color: 'from-amber-500 to-orange-500', desc: 'Change seat assignment on your booking' },
  { value: 'DATE_CHANGE', label: 'Flight Date Change', icon: Calendar, color: 'from-pink-500 to-rose-500', desc: 'Change your flight date' },
  { value: 'BAGGAGE_CHANGE', label: 'Baggage Change', icon: Luggage, color: 'from-teal-500 to-cyan-500', desc: 'Add or modify baggage allowance' },
  { value: 'UPGRADE', label: 'Upgrade', icon: ArrowUpCircle, color: 'from-yellow-500 to-amber-500', desc: 'Upgrade cabin class' },
  { value: 'OTHER', label: 'Other', icon: HelpCircle, color: 'from-slate-500 to-slate-600', desc: 'Other services or custom payment' },
];

const COUNTRIES = [
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
  'France', 'India', 'Japan', 'Singapore', 'UAE', 'Other',
] as const;

function countryToCode(country: string): string {
  const map: Record<string, string> = {
    'United States': 'US', 'United Kingdom': 'GB', 'Canada': 'CA', 'Australia': 'AU',
    'Germany': 'DE', 'France': 'FR', 'India': 'IN', 'Japan': 'JP', 'Singapore': 'SG', 'UAE': 'AE',
  };
  return map[country] || 'US';
}

const STRIPE_ELEM_OPTIONS = {
  style: {
    base: { color: '#fff', fontSize: '14px', fontFamily: 'Inter, sans-serif', '::placeholder': { color: '#64748b' } },
    invalid: { color: '#f87171' },
  },
};

/* ═══════════════════════════════════════════════ */
/*  PAYMENT FORM (inside Stripe Elements)         */
/* ═══════════════════════════════════════════════ */
function PaymentForm({ clientSecret, paymentId, onSuccess }: { clientSecret: string; paymentId: string; onSuccess: (ticketNumber?: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  // Billing details
  const [cardholderName, setCardholderName] = useState('');
  const [billingCountry, setBillingCountry] = useState('United States');
  const [billingAddress, setBillingAddress] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingZip, setBillingZip] = useState('');

  const billingComplete = cardholderName.trim().length > 0 &&
    billingAddress.trim().length > 0 &&
    billingCity.trim().length > 0 &&
    billingZip.trim().length > 0;

  async function handlePay() {
    if (!stripe || !elements) return;
    if (!billingComplete) { setError('Please fill in all billing details.'); return; }
    setProcessing(true);
    setError('');

    const cardNumber = elements.getElement(CardNumberElement);
    if (!cardNumber) { setError('Card not loaded'); setProcessing(false); return; }

    const result = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: cardNumber,
        billing_details: {
          name: cardholderName,
          address: {
            line1: billingAddress,
            city: billingCity,
            postal_code: billingZip,
            country: countryToCode(billingCountry),
          },
        },
      },
    });

    if (result.error) {
      setError(result.error.message || 'Payment failed');
      setProcessing(false);
    } else if (result.paymentIntent?.status === 'succeeded') {
      // Confirm on backend — creates support ticket automatically
      let ticketNum: string | undefined;
      try {
        const confirmRes = await fetch('/api/service-payments/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId }),
        });
        const confirmData = await confirmRes.json();
        ticketNum = confirmData.supportTicketNumber;
      } catch {}
      onSuccess(ticketNum);
    } else {
      setError('Payment not completed. Please try again.');
      setProcessing(false);
    }
  }

  const inputCls = 'w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]/40 transition-all placeholder:text-slate-600';

  return (
    <div className="space-y-4">
      {/* Cardholder Name */}
      <div>
        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide flex items-center gap-1">
          <User size={9} /> Cardholder Name <span className="text-red-400">*</span>
        </label>
        <input type="text" placeholder="John Doe" value={cardholderName}
          onChange={e => setCardholderName(e.target.value)} autoComplete="cc-name" className={inputCls} />
      </div>

      {/* Card Number */}
      <div>
        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Card Number <span className="text-red-400">*</span></label>
        <div className="px-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl">
          <CardNumberElement options={STRIPE_ELEM_OPTIONS} />
        </div>
      </div>

      {/* Expiry + CVC */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Expiry <span className="text-red-400">*</span></label>
          <div className="px-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl">
            <CardExpiryElement options={STRIPE_ELEM_OPTIONS} />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">CVC <span className="text-red-400">*</span></label>
          <div className="px-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl">
            <CardCvcElement options={STRIPE_ELEM_OPTIONS} />
          </div>
        </div>
      </div>

      {/* Billing Address */}
      <div className="border-t border-white/[0.06] pt-4">
        <p className="text-[10px] text-slate-500 uppercase font-bold mb-3 tracking-wide flex items-center gap-1">
          <MapPin size={9} /> Billing Address
        </p>
        <div className="space-y-3">
          {/* Country */}
          <div className="relative">
            <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Country <span className="text-red-400">*</span></label>
            <select value={billingCountry} onChange={e => setBillingCountry(e.target.value)}
              className={`${inputCls} appearance-none`}>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <ChevronDown className="absolute right-3 top-[calc(50%+8px)] -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          </div>
          {/* Address Line */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Address Line <span className="text-red-400">*</span></label>
            <input type="text" placeholder="123 Main Street" value={billingAddress}
              onChange={e => setBillingAddress(e.target.value)} autoComplete="street-address" className={inputCls} />
          </div>
          {/* City + ZIP */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">City <span className="text-red-400">*</span></label>
              <input type="text" placeholder="New York" value={billingCity}
                onChange={e => setBillingCity(e.target.value)} autoComplete="address-level2" className={inputCls} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">ZIP / Postal Code <span className="text-red-400">*</span></label>
              <input type="text" placeholder="10001" value={billingZip}
                onChange={e => setBillingZip(e.target.value)} autoComplete="postal-code" className={inputCls} />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      <button onClick={handlePay} disabled={processing || !stripe || !billingComplete}
        className="w-full py-3.5 rounded-xl bg-[#1ABC9C] hover:bg-[#16a085] text-white font-bold text-sm disabled:opacity-40 transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1ABC9C]/20">
        {processing ? <Loader2 size={16} className="animate-spin" /> : <Lock size={14} />}
        {processing ? 'Processing…' : 'Pay Now'}
      </button>
      <p className="text-center text-slate-600 text-[10px] flex items-center justify-center gap-1">
        <Lock size={9} /> Secured by Stripe — 256-bit encryption
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════ */
/*  MAIN PAGE                                      */
/* ═══════════════════════════════════════════════ */
export default function AgentMakePaymentPage() {
  const router = useRouter();
  const { user, sessionToken } = useAuthStore();

  const [step, setStep] = useState(1);
  const [bookings, setBookings] = useState<any[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [pnrCode, setPnrCode] = useState('');
  const [ticketNumber, setTicketNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [error, setError] = useState('');
  const [supportTicketRef, setSupportTicketRef] = useState('');

  // Load user's bookings
  useEffect(() => {
    if (!sessionToken) return;
    (async () => {
      try {
        const res = await fetch('/api/user/bookings', { headers: { Authorization: `Bearer ${sessionToken}` } });
        if (res.ok) {
          const data = await res.json();
          setBookings(data.bookings || []);
        }
      } catch {}
    })();
  }, [sessionToken]);

  const selectedBooking = useMemo(() => bookings.find(b => b.id === selectedBookingId), [bookings, selectedBookingId]);
  const selectedService = SERVICE_TYPES.find(s => s.value === selectedType);

  async function handleCreatePayment() {
    if (!selectedType || !amount || parseFloat(amount) <= 0) {
      setError('Please select a service type and enter a valid amount.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/service-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({
          bookingId: selectedBookingId || undefined,
          serviceType: selectedType,
          description: description || selectedService?.label || selectedType,
          amount: parseFloat(amount),
          pnrCode: pnrCode || undefined,
          ticketNumber: ticketNumber || undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.clientSecret) {
        setClientSecret(data.clientSecret);
        setPaymentId(data.paymentId);
        setStep(4);
      } else {
        setError(data.error || 'Failed to create payment.');
      }
    } catch {
      setError('Network error.');
    }
    setLoading(false);
  }

  // Success state
  if (step === 5) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', duration: 0.5 }}>
          <div className="w-20 h-20 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 size={36} className="text-emerald-400" />
          </div>
          <h2 className="text-2xl font-black text-white mb-2">Payment Successful!</h2>
          <p className="text-slate-400 text-sm mb-4">
            Your payment of <strong className="text-white">{fmt(parseFloat(amount))}</strong> for <strong className="text-[#1ABC9C]">{selectedService?.label}</strong> has been processed.
          </p>
          {supportTicketRef && (
            <div className="mb-4 px-4 py-3 bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 rounded-xl inline-block">
              <p className="text-[#1ABC9C] text-xs font-bold">Support Ticket Created</p>
              <p className="text-white font-mono font-bold text-sm">{supportTicketRef}</p>
            </div>
          )}
          <div className="space-y-1 mb-6">
            {pnrCode && <p className="text-slate-500 text-xs">PNR: <span className="text-white font-mono">{pnrCode}</span></p>}
            {ticketNumber && <p className="text-slate-500 text-xs">Ticket #: <span className="text-white font-mono">{ticketNumber}</span></p>}
          </div>
          <p className="text-slate-500 text-xs mb-6">Our support team has been notified and will process your request. Track progress in My Tickets.</p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button onClick={() => router.push('/agent/support')} className="px-6 py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white font-semibold text-sm hover:bg-white/[0.1] transition-all">
              View My Tickets
            </button>
            <button onClick={() => router.push('/agent')} className="px-6 py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white font-semibold text-sm hover:bg-white/[0.1] transition-all">
              Dashboard
            </button>
            <button onClick={() => { setStep(1); setClientSecret(''); setPaymentId(''); setAmount(''); setDescription(''); }} className="px-6 py-2.5 rounded-xl bg-[#1ABC9C] text-white font-semibold text-sm hover:bg-[#16a085] transition-all">
              Make Another Payment
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const iCls = 'w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]/40 transition-all placeholder:text-slate-600';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <Wallet size={22} className="text-[#1ABC9C]" /> Make a Payment
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">Pay for additional services for your bookings</p>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-6">
        {['Booking', 'Service', 'Details', 'Pay'].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              step > i + 1 ? 'bg-[#1ABC9C] text-white' :
              step === i + 1 ? 'bg-[#1ABC9C]/20 text-[#1ABC9C] border border-[#1ABC9C]/40' :
              'bg-white/[0.04] text-slate-600 border border-white/[0.08]'
            }`}>{step > i + 1 ? '✓' : i + 1}</div>
            <span className={`text-xs font-semibold ${step >= i + 1 ? 'text-white' : 'text-slate-600'}`}>{label}</span>
            {i < 3 && <div className={`w-8 h-px ${step > i + 1 ? 'bg-[#1ABC9C]' : 'bg-white/[0.08]'}`} />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Step 1: Select booking */}
      {step === 1 && (
        <div>
          <p className="text-white font-bold text-sm mb-3">Select a booking (optional)</p>
          <p className="text-slate-500 text-xs mb-4">Link this payment to a specific booking, or skip to pay without a booking reference.</p>
          <div className="space-y-2 max-h-[400px] overflow-y-auto mb-4">
            {bookings.map(b => (
              <button key={b.id} onClick={() => { setSelectedBookingId(b.id); setPnrCode(b.masterPnr || ''); }}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                  selectedBookingId === b.id ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30' : 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.06]'
                }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-white font-bold text-sm font-mono">{b.masterBookingReference}</span>
                    {b.masterPnr && <span className="text-slate-500 text-xs ml-2">PNR: {b.masterPnr}</span>}
                  </div>
                  <span className={`text-xs font-semibold ${b.bookingStatus === 'CONFIRMED' ? 'text-emerald-400' : 'text-amber-400'}`}>{b.bookingStatus}</span>
                </div>
                <p className="text-slate-500 text-xs mt-1">{b.originAirport} → {b.destinationAirport} · {new Date(b.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
              </button>
            ))}
            {bookings.length === 0 && <p className="text-slate-500 text-xs text-center py-8">No bookings found</p>}
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setSelectedBookingId(null); setStep(2); }}
              className="flex-1 py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white font-semibold text-sm hover:bg-white/[0.1] transition-all">
              Skip — No Booking
            </button>
            <button onClick={() => setStep(2)} disabled={!selectedBookingId}
              className="flex-1 py-3 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm hover:bg-[#16a085] disabled:opacity-40 transition-all flex items-center justify-center gap-1">
              Continue <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Select service type */}
      {step === 2 && (
        <div>
          <button onClick={() => setStep(1)} className="flex items-center gap-1 text-slate-400 hover:text-white text-xs font-medium mb-4 transition-colors">
            <ArrowLeft size={12} /> Back
          </button>
          <p className="text-white font-bold text-sm mb-3">Select service type</p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {SERVICE_TYPES.map(svc => {
              const Icon = svc.icon;
              const sel = selectedType === svc.value;
              return (
                <button key={svc.value} onClick={() => { setSelectedType(svc.value); setDescription(svc.label); }}
                  className={`text-left p-4 rounded-2xl border transition-all ${
                    sel ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30' : 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.06]'
                  }`}>
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${svc.color} flex items-center justify-center mb-2`}>
                    <Icon size={16} className="text-white" />
                  </div>
                  <p className="text-white text-xs font-bold">{svc.label}</p>
                  <p className="text-slate-500 text-[10px] mt-0.5">{svc.desc}</p>
                </button>
              );
            })}
          </div>
          <button onClick={() => setStep(3)} disabled={!selectedType}
            className="w-full py-3 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm hover:bg-[#16a085] disabled:opacity-40 transition-all flex items-center justify-center gap-1">
            Continue <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Step 3: Details */}
      {step === 3 && (
        <div>
          <button onClick={() => setStep(2)} className="flex items-center gap-1 text-slate-400 hover:text-white text-xs font-medium mb-4 transition-colors">
            <ArrowLeft size={12} /> Back
          </button>
          <p className="text-white font-bold text-sm mb-4">Payment Details</p>

          {/* Summary card */}
          {selectedBooking && (
            <div className="mb-4 px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl">
              <p className="text-slate-500 text-[10px] uppercase font-bold mb-1">Linked Booking</p>
              <p className="text-white font-mono font-bold text-sm">{selectedBooking.masterBookingReference}</p>
              <p className="text-slate-500 text-xs">{selectedBooking.originAirport} → {selectedBooking.destinationAirport}</p>
            </div>
          )}

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide flex items-center gap-1">
                  <Hash size={9} /> PNR Code
                </label>
                <input value={pnrCode} onChange={e => setPnrCode(e.target.value)} placeholder="e.g. ABC123" className={iCls} />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide flex items-center gap-1">
                  <Ticket size={9} /> Ticket Number
                </label>
                <input value={ticketNumber} onChange={e => setTicketNumber(e.target.value)} placeholder="e.g. 098-1234567890" className={iCls} />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Amount (USD) *</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1ABC9C] font-bold">$</span>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" min="0.50" step="0.01"
                  className={`${iCls} pl-8 text-lg font-bold`} />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Description *</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the service..." className={iCls} />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Notes (optional)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Additional notes..." className={`${iCls} resize-none`} />
            </div>
          </div>

          <button onClick={handleCreatePayment} disabled={loading || !amount || parseFloat(amount) <= 0}
            className="w-full mt-5 py-3 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm hover:bg-[#16a085] disabled:opacity-40 transition-all flex items-center justify-center gap-1">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
            {loading ? 'Creating…' : `Proceed to Pay ${amount ? fmt(parseFloat(amount)) : ''}`}
          </button>
        </div>
      )}

      {/* Step 4: Stripe Payment */}
      {step === 4 && clientSecret && (
        <div>
          <button onClick={() => setStep(3)} className="flex items-center gap-1 text-slate-400 hover:text-white text-xs font-medium mb-4 transition-colors">
            <ArrowLeft size={12} /> Back
          </button>

          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 mb-5">
            <p className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <CreditCard size={14} className="text-[#1ABC9C]" /> Payment Summary
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Service</span><span className="text-white font-semibold">{selectedService?.label}</span></div>
              {pnrCode && <div className="flex justify-between"><span className="text-slate-400">PNR</span><span className="text-white font-mono">{pnrCode}</span></div>}
              {ticketNumber && <div className="flex justify-between"><span className="text-slate-400">Ticket #</span><span className="text-white font-mono">{ticketNumber}</span></div>}
              <div className="flex justify-between border-t border-white/[0.06] pt-2">
                <span className="text-white font-bold">Total</span>
                <span className="text-[#1ABC9C] font-black text-lg">{fmt(parseFloat(amount))}</span>
              </div>
            </div>
          </div>

          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
            <p className="text-white font-bold text-sm mb-4 flex items-center gap-2">
              <Lock size={14} className="text-[#1ABC9C]" /> Enter Card Details
            </p>
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#1ABC9C' } } }}>
              <PaymentForm clientSecret={clientSecret} paymentId={paymentId} onSuccess={(tkn) => { if (tkn) setSupportTicketRef(tkn); setStep(5); }} />
            </Elements>
          </div>
        </div>
      )}
    </div>
  );
}
