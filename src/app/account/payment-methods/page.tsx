'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { CreditCard, Trash2, Check, AlertCircle, Plus, Loader2 } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');

interface PaymentMethod {
  id: string;
  cardBrand: string;
  cardLast4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  status: string;
}

function AddCardForm({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    setError(null);

    // Validate the elements first
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || 'Failed to validate card.');
      setProcessing(false);
      return;
    }

    const { error: setupError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });

    if (setupError) {
      setError(setupError.message || 'Failed to save card.');
      setProcessing(false);
      return;
    }

    if (setupIntent?.status === 'succeeded') {
      try {
        const authStore = useAuthStore.getState();

        const res = await fetch('/api/payment-methods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: authStore.user?.id,
            providerPaymentMethodId: setupIntent.payment_method,
            providerCustomerId: null, // the backend can resolve this if needed
          }),
        });

        if (!res.ok) {
           setError('Failed to save payment method to our system.');
           setProcessing(false);
           return;
        }

        onSuccess();
      } catch (e: any) {
         setError(e.message || 'An error occurred.');
      }
    } else {
      setError('Unexpected status: ' + setupIntent?.status);
    }
    setProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="p-4 bg-white rounded-xl">
        <PaymentElement options={{ layout: 'tabs', terms: { card: 'never' } as any }} />
      </div>
      <p className="text-[11px] text-slate-400 mt-2 px-1">
        By providing your card information, you allow <span className="font-bold text-white">FARE</span><span className="font-bold text-[#009CA6]">MIND</span> to charge your card for future payments in accordance with their terms.
      </p>
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={processing}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-white/10 hover:bg-white/20 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || processing}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#1ABC9C] hover:bg-emerald-500 transition-colors flex items-center gap-2"
        >
          {processing ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : 'Save Card'}
        </button>
      </div>
    </form>
  );
}

function AddCardWrapper({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { user } = useAuthStore();
  const [clientSecret, setClientSecret] = useState('');

  useEffect(() => {
    if (!user) return;
    fetch('/api/payment-methods/setup-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, email: user.email, name: user.name }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.clientSecret) setClientSecret(d.clientSecret);
      });
  }, [user]);

  if (!clientSecret) return <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Preparing secure form...</div>;

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
      <AddCardForm onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}

export default function PaymentMethodsPage() {
  const { user } = useAuthStore();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);

  const fetchMethods = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/payment-methods?userId=${user.id}`);
      const data = await res.json();
      if (data.success) {
        setMethods(data.paymentMethods);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMethods();
  }, [user]);

  const handleMakeDefault = async (id: string) => {
    if (!user) return;
    await fetch(`/api/payment-methods/${id}/default`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id })
    });
    fetchMethods();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this card?')) return;
    await fetch(`/api/payment-methods/${id}`, { method: 'DELETE' });
    fetchMethods();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black text-white">Payment Methods</h1>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#1ABC9C] hover:bg-emerald-500 transition-all"
          >
            <Plus size={16} />
            Add New Card
          </button>
        )}
      </div>

      {isAdding && (
        <div className="mb-6 bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
          <h2 className="text-sm font-bold text-white mb-4">Add a Payment Method</h2>
          <AddCardWrapper 
            onCancel={() => setIsAdding(false)} 
            onSuccess={() => {
              setIsAdding(false);
              fetchMethods();
            }} 
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Loading payment methods...</span>
        </div>
      ) : methods.length === 0 ? (
        <div className="text-center py-12 bg-white/[0.04] border border-white/[0.08] rounded-2xl">
          <CreditCard size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-400 text-sm">No saved payment methods found.</p>
        </div>
      ) : (
        <div className="grid gap-4 max-w-2xl">
          {methods.map((method) => (
            <div key={method.id} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-8 bg-white rounded flex items-center justify-center">
                  <span className="text-xs font-bold text-slate-800 uppercase">{method.cardBrand === 'Unknown' ? 'CARD' : method.cardBrand}</span>
                </div>
                <div>
                  <p className="text-white text-sm font-bold">•••• •••• •••• {method.cardLast4}</p>
                  <p className="text-slate-400 text-xs mt-0.5">Expires {method.expMonth.toString().padStart(2, '0')}/{method.expYear}</p>
                </div>
                {method.isDefault && (
                  <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-[#1ABC9C]/10 text-[#1ABC9C] border border-[#1ABC9C]/20 flex items-center gap-1">
                    <Check size={10} /> Default
                  </span>
                )}
                {method.status === 'EXPIRED' && (
                  <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                    Expired
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {!method.isDefault && method.status !== 'EXPIRED' && (
                  <button onClick={() => handleMakeDefault(method.id)} className="text-xs font-semibold text-slate-400 hover:text-white transition-colors">
                    Make Default
                  </button>
                )}
                <button onClick={() => handleDelete(method.id)} className="text-slate-500 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-white/5">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
