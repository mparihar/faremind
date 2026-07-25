'use client';

/**
 * Shared Stripe card form for the generic payment flows (Other Payment, Wallet
 * Recharge). Collects the card client-side, confirms the PaymentIntent, then
 * server-verifies via /api/service-payments/confirm (idempotent; the webhook is
 * the authoritative fulfiller). Never handles raw card data itself.
 */
import { useState } from 'react';
import { CardNumberElement, CardExpiryElement, CardCvcElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, Lock, AlertTriangle, User } from 'lucide-react';

const ELEM = {
  style: {
    base: { color: '#fff', fontSize: '14px', fontFamily: 'Inter, sans-serif', '::placeholder': { color: '#64748b' } },
    invalid: { color: '#f87171' },
  },
};

export interface PaymentCardFormProps {
  clientSecret: string;
  paymentId: string;
  submitLabel: string;
  /** Optional consent checkbox to save the card for future use. */
  saveCard?: boolean;
  onSaveCardChange?: (v: boolean) => void;
  showSaveCard?: boolean;
  onSuccess: () => void;
}

export default function PaymentCardForm({ clientSecret, paymentId, submitLabel, saveCard, onSaveCardChange, showSaveCard, onSuccess }: PaymentCardFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [cardholderName, setCardholderName] = useState('');

  async function handlePay() {
    if (!stripe || !elements) return;
    if (!cardholderName.trim()) { setError('Please enter the cardholder name.'); return; }
    const cardNumber = elements.getElement(CardNumberElement);
    if (!cardNumber) { setError('Card not loaded.'); return; }
    setProcessing(true); setError('');

    const result = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: cardNumber, billing_details: { name: cardholderName } },
      ...(showSaveCard && saveCard ? { setup_future_usage: 'off_session' as const } : {}),
    });

    if (result.error) {
      setError(result.error.message || 'Payment failed.');
      setProcessing(false);
      return;
    }
    if (result.paymentIntent?.status === 'succeeded') {
      // Server-verified, idempotent confirmation (webhook is authoritative).
      try {
        await fetch('/api/service-payments/confirm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId }),
        });
      } catch { /* webhook will finalize regardless */ }
      onSuccess();
      return;
    }
    setError('Payment not completed. Please try again.');
    setProcessing(false);
  }

  const cls = 'w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]/40 transition-all placeholder:text-slate-600';

  return (
    <div className="space-y-4">
      <div>
        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide flex items-center gap-1"><User size={9} /> Cardholder Name <span className="text-red-400">*</span></label>
        <input type="text" placeholder="John Doe" value={cardholderName} onChange={(e) => setCardholderName(e.target.value)} autoComplete="cc-name" className={cls} />
      </div>
      <div>
        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Card Number <span className="text-red-400">*</span></label>
        <div className="px-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl"><CardNumberElement options={ELEM} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Expiry <span className="text-red-400">*</span></label>
          <div className="px-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl"><CardExpiryElement options={ELEM} /></div>
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">CVC <span className="text-red-400">*</span></label>
          <div className="px-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl"><CardCvcElement options={ELEM} /></div>
        </div>
      </div>

      {showSaveCard && (
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={!!saveCard} onChange={(e) => onSaveCardChange?.(e.target.checked)} className="mt-0.5 accent-[#1ABC9C]" />
          <span className="text-xs text-slate-400">Securely save this card for future recharges (Stripe stores the card; FareMind keeps only a reference).</span>
        </label>
      )}

      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>
      )}
      <button onClick={handlePay} disabled={processing || !stripe} className="w-full py-3.5 rounded-xl bg-[#1ABC9C] hover:bg-[#16a085] text-white font-bold text-sm disabled:opacity-40 transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1ABC9C]/20">
        {processing ? <Loader2 size={16} className="animate-spin" /> : <Lock size={14} />}
        {processing ? 'Processing…' : submitLabel}
      </button>
      <p className="text-center text-slate-600 text-[10px] flex items-center justify-center gap-1"><Lock size={9} /> Secured by Stripe — 256-bit encryption</p>
    </div>
  );
}
