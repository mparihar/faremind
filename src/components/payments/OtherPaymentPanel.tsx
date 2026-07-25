'use client';

/**
 * Other Payment — generic authenticated payment (customer or agent).
 * Flow: details → confirm → pay (Stripe) → success.
 * Payer identity is read-only (server-derived). Amount/note validated server-side.
 */
import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { Loader2, AlertTriangle, CheckCircle2, ArrowLeft, CreditCard, FileText } from 'lucide-react';
import PaymentCardForm from './PaymentCardForm';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');

interface Policy { currency: string; noteMin: number; noteMax: number; maxAmount: number; }
interface Payer { name: string; email: string; }

export default function OtherPaymentPanel({ sessionToken, initialRef, onBack }: { sessionToken: string; initialRef?: string; onBack?: () => void }) {
  const [phase, setPhase] = useState<'form' | 'confirm' | 'pay' | 'done'>('form');
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [payer, setPayer] = useState<Payer | null>(null);
  const [lockedRequest, setLockedRequest] = useState<{ reference: string; amount: number; currency: string; note: string } | null>(null);

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [supportCaseId, setSupportCaseId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [paymentId, setPaymentId] = useState('');

  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` };
  const fmt = (n: number, c = policy?.currency || 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);

  useEffect(() => {
    const url = initialRef ? `/api/payments/other?ref=${encodeURIComponent(initialRef)}` : '/api/payments/other';
    fetch(url, { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setPolicy(d.policy); setPayer(d.payer);
        if (d.request) {
          setLockedRequest(d.request);
          setAmount(String(d.request.amount));
          setNote(d.request.note);
        }
      })
      .catch(() => setError('Failed to load payment info.'));
  }, [initialRef]);

  function toReview() {
    setError('');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Please enter a valid amount.'); return; }
    if (policy && amt > policy.maxAmount && !lockedRequest) { setError(`Amount exceeds the maximum of ${fmt(policy.maxAmount)}. Contact support for a payment request.`); return; }
    if (!lockedRequest) {
      const clean = note.trim();
      if (policy && clean.length < policy.noteMin) { setError(`The payment note must be at least ${policy.noteMin} characters.`); return; }
    }
    setPhase('confirm');
  }

  async function createPayment() {
    setLoading(true); setError('');
    try {
      const body: any = lockedRequest
        ? { paymentRequestReference: lockedRequest.reference }
        : { amount: parseFloat(amount), currency: policy?.currency, note: note.trim(), supportCaseId: supportCaseId.trim() || undefined };
      const res = await fetch('/api/payments/other', { method: 'POST', headers: authHeaders, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok && data.clientSecret) { setClientSecret(data.clientSecret); setPaymentId(data.paymentId); setPhase('pay'); }
      else setError(data.error || 'Failed to create payment.');
    } catch { setError('Network error.'); }
    setLoading(false);
  }

  const cls = 'w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]/40 transition-all placeholder:text-slate-600';

  if (phase === 'done') {
    return (
      <div className="text-center py-12">
        <div className="w-20 h-20 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center mx-auto mb-5"><CheckCircle2 size={36} className="text-emerald-400" /></div>
        <h2 className="text-2xl font-black text-white mb-2">Payment Successful!</h2>
        <p className="text-slate-400 text-sm mb-6">Your payment of <strong className="text-white">{fmt(parseFloat(amount))}</strong> has been received. Our team has been notified.</p>
        {onBack && <button onClick={onBack} className="px-6 py-2.5 rounded-xl bg-[#1ABC9C] text-white font-semibold text-sm hover:bg-[#16a085]">Done</button>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {onBack && <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-white text-xs font-medium transition-colors"><ArrowLeft size={12} /> Back</button>}

      {/* Read-only payer identity */}
      {payer && (
        <div className="px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl">
          <p className="text-slate-500 text-[10px] uppercase font-bold mb-1">Paying as</p>
          <p className="text-white font-semibold text-sm">{payer.name}</p>
          <p className="text-slate-500 text-xs">{payer.email}</p>
        </div>
      )}

      {lockedRequest && (
        <div className="px-4 py-3 bg-[#1ABC9C]/[0.06] border border-[#1ABC9C]/20 rounded-xl">
          <p className="text-[#1ABC9C] text-[10px] uppercase font-bold mb-1 flex items-center gap-1"><FileText size={10} /> Payment Request {lockedRequest.reference}</p>
          <p className="text-white text-sm">{lockedRequest.note}</p>
        </div>
      )}

      {error && <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}

      {phase === 'form' && (
        <>
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Amount ({policy?.currency || 'USD'}) *</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1ABC9C] font-bold">$</span>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!!lockedRequest} placeholder="0.00" min="0.50" step="0.01" className={`${cls} pl-8 text-lg font-bold disabled:opacity-60`} />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Payment Note * <span className="text-slate-600 normal-case">({policy?.noteMin ?? 5}–{policy?.noteMax ?? 500} chars)</span></label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={!!lockedRequest} rows={3} placeholder="What is this payment for?" className={`${cls} resize-none disabled:opacity-60`} />
          </div>
          {!lockedRequest && (
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Support Case Reference (optional)</label>
              <input value={supportCaseId} onChange={(e) => setSupportCaseId(e.target.value)} placeholder="e.g. FM-1234" className={cls} />
            </div>
          )}
          <button onClick={toReview} className="w-full py-3 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm hover:bg-[#16a085] transition-all">Review Payment</button>
        </>
      )}

      {phase === 'confirm' && (
        <>
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 space-y-2 text-sm">
            <p className="text-white font-bold mb-2">Confirm your payment</p>
            <div className="flex justify-between"><span className="text-slate-400">Note</span><span className="text-white text-right max-w-[60%]">{note}</span></div>
            {supportCaseId && <div className="flex justify-between"><span className="text-slate-400">Support Case</span><span className="text-white">{supportCaseId}</span></div>}
            <div className="flex justify-between border-t border-white/[0.06] pt-2"><span className="text-white font-bold">Total</span><span className="text-[#1ABC9C] font-black text-lg">{fmt(parseFloat(amount))}</span></div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setPhase('form')} className="flex-1 py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white font-semibold text-sm">Edit</button>
            <button onClick={createPayment} disabled={loading} className="flex-1 py-3 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm hover:bg-[#16a085] disabled:opacity-40 flex items-center justify-center gap-1">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />} Proceed to Pay
            </button>
          </div>
        </>
      )}

      {phase === 'pay' && clientSecret && (
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
          <p className="text-white font-bold text-sm mb-4">Enter Card Details — {fmt(parseFloat(amount))}</p>
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#1ABC9C' } } }}>
            <PaymentCardForm clientSecret={clientSecret} paymentId={paymentId} submitLabel={`Pay ${fmt(parseFloat(amount))}`} onSuccess={() => setPhase('done')} />
          </Elements>
        </div>
      )}
    </div>
  );
}
