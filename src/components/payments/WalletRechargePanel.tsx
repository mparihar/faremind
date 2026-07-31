'use client';

/**
 * Agent Wallet Recharge (agent-only). Shows read-only agent identity + wallet
 * summary, a recharge amount (min from DB policy), and SEPARATE consents for
 * saving the card and enabling auto-recharge. Credits happen only after the
 * Stripe webhook confirms.
 */
import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { Loader2, AlertTriangle, CheckCircle2, ArrowLeft, Wallet, RefreshCw, Zap } from 'lucide-react';
import PaymentCardForm from './PaymentCardForm';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');

interface Info {
  agent: { id: string; name: string; email: string; active: boolean };
  policy: { currency: string; minimumRechargeAmount: number; lowThreshold: number; disableThreshold: number; reactivationThreshold: number; autoRechargeGloballyEnabled: boolean; automaticRechargeAmount: number; automaticRechargeTargetBalance: number; termsVersion: string };
  wallet: { walletAmount: number; utilized: number; remaining: number; currency: string; status: string; savedCard: { present: boolean }; autoRecharge: { enabled: boolean }; saveCardConsentAt: string | null };
}

export default function WalletRechargePanel({ sessionToken, onBack }: { sessionToken: string; onBack?: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [phase, setPhase] = useState<'form' | 'pay' | 'done'>('form');
  const [amount, setAmount] = useState('');
  const [saveCard, setSaveCard] = useState(false);
  const [enableAuto, setEnableAuto] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [paymentId, setPaymentId] = useState('');

  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` };
  const c = info?.policy.currency || 'USD';
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);

  const load = () => fetch('/api/agent/wallet/recharge', { headers: authHeaders })
    .then((r) => r.json())
    .then((d) => { if (d.error) setError(d.error); else { setInfo(d); if (!amount) setAmount(String(d.policy.minimumRechargeAmount)); if (d.wallet.savedCard.present) setSaveCard(true); } })
    .catch(() => setError('Failed to load wallet info.'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Enabling auto-recharge implies saving the card.
  useEffect(() => { if (enableAuto) setSaveCard(true); }, [enableAuto]);

  async function createRecharge() {
    setError('');
    const amt = parseFloat(amount);
    if (!info) return;
    if (!amt || amt < info.policy.minimumRechargeAmount) { setError(`Minimum recharge is ${fmt(info.policy.minimumRechargeAmount)}.`); return; }
    if (enableAuto && !termsAccepted) { setError('Please accept the auto-recharge terms.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/agent/wallet/recharge', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ amount: amt, saveCard: saveCard || enableAuto, enableAutoRecharge: enableAuto, termsAccepted }),
      });
      const data = await res.json();
      if (res.ok && data.clientSecret) { setClientSecret(data.clientSecret); setPaymentId(data.paymentId); setPhase('pay'); }
      else setError(data.error || 'Failed to start recharge.');
    } catch { setError('Network error.'); }
    setLoading(false);
  }

  const cls = 'w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]/40 transition-all placeholder:text-slate-600';

  if (!info && !error) return <div className="py-16 text-center text-slate-500"><Loader2 className="animate-spin mx-auto" /></div>;

  if (phase === 'done') {
    return (
      <div className="text-center py-12">
        <div className="w-20 h-20 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center mx-auto mb-5"><CheckCircle2 size={36} className="text-emerald-400" /></div>
        <h2 className="text-2xl font-black text-white mb-2">Recharge Submitted</h2>
        <p className="text-slate-400 text-sm mb-2">Your payment of <strong className="text-white">{fmt(parseFloat(amount))}</strong> was received.</p>
        <p className="text-slate-500 text-xs mb-6">Your wallet is credited once the payment is confirmed (usually seconds). If your account was disabled, it will be reactivated automatically.</p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => { setPhase('form'); setClientSecret(''); load(); }} className="px-6 py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white font-semibold text-sm">Recharge Again</button>
          {onBack && <button onClick={onBack} className="px-6 py-2.5 rounded-xl bg-[#1ABC9C] text-white font-semibold text-sm hover:bg-[#16a085]">Done</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {onBack && <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-white text-xs font-medium"><ArrowLeft size={12} /> Back</button>}
      {error && <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}

      {info && (
        <>
          {/* Agent identity (read-only) + wallet summary */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl">
              <p className="text-slate-500 text-[10px] uppercase font-bold mb-1">Agent</p>
              <p className="text-white font-semibold text-sm">{info.agent.name}</p>
              <p className="text-slate-500 text-xs">{info.agent.email}</p>
              {!info.agent.active && <span className="inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">DISABLED — recharge to reactivate</span>}
            </div>
            <div className={`px-4 py-3 rounded-xl border ${info.wallet.status === 'DISABLED' ? 'border-red-500/30 bg-red-500/[0.05]' : info.wallet.status === 'LOW' ? 'border-amber-500/30 bg-amber-500/[0.05]' : 'border-[#1ABC9C]/25 bg-[#1ABC9C]/[0.05]'}`}>
              <p className="text-slate-500 text-[10px] uppercase font-bold mb-1 flex items-center gap-1"><Wallet size={10} /> Wallet Balance</p>
              <p className={`text-2xl font-black ${info.wallet.status === 'DISABLED' ? 'text-red-400' : info.wallet.status === 'LOW' ? 'text-amber-400' : 'text-[#1ABC9C]'}`}>{fmt(info.wallet.remaining)}</p>
              <p className="text-slate-500 text-[11px]">of {fmt(info.wallet.walletAmount)} · utilized {fmt(info.wallet.utilized)}</p>
            </div>
          </div>

          {phase === 'form' && (
            <>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Recharge Amount ({c}) <span className="text-slate-600 normal-case">· fixed by policy</span></label>
                <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#1ABC9C]/[0.06] border border-[#1ABC9C]/20">
                  <span className="text-2xl font-black text-[#1ABC9C]">{fmt(info.policy.minimumRechargeAmount)}</span>
                  <span className="text-[11px] text-slate-500">Configured recharge amount</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">Recharge is a fixed amount set by the administrator; it cannot be changed here.</p>
              </div>

              {/* Consent: save card */}
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} disabled={enableAuto} className="mt-0.5 accent-[#1ABC9C]" />
                <span className="text-xs text-slate-400">Save this card securely for future recharges (Stripe stores the card; FareMind keeps a reference only).</span>
              </label>

              {/* Consent: enable auto-recharge (separate) */}
              {info.policy.autoRechargeGloballyEnabled && (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={enableAuto} onChange={(e) => setEnableAuto(e.target.checked)} className="mt-0.5 accent-[#1ABC9C]" />
                    <span className="text-xs text-slate-300 flex items-center gap-1"><Zap size={11} className="text-amber-400" /> Enable automatic recharge when my balance runs low</span>
                  </label>
                  {enableAuto && (
                    <>
                      <p className="text-[11px] text-slate-500 pl-6">We'll automatically charge this saved card {fmt(info.policy.automaticRechargeAmount)} (topping up toward {fmt(info.policy.automaticRechargeTargetBalance)}) whenever your balance falls to {fmt(info.policy.lowThreshold)}. You can turn this off anytime.</p>
                      <label className="flex items-start gap-2 cursor-pointer select-none pl-6">
                        <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} className="mt-0.5 accent-[#1ABC9C]" />
                        <span className="text-[11px] text-slate-400">I authorize FareMind to charge my saved card automatically under these terms (v{info.policy.termsVersion}).</span>
                      </label>
                    </>
                  )}
                </div>
              )}

              <button onClick={createRecharge} disabled={loading} className="w-full py-3 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm hover:bg-[#16a085] disabled:opacity-40 flex items-center justify-center gap-1">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Proceed to Pay {amount ? fmt(parseFloat(amount)) : ''}
              </button>
            </>
          )}

          {phase === 'pay' && clientSecret && (
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
              <p className="text-white font-bold text-sm mb-4">Enter Card Details — {fmt(parseFloat(amount))}</p>
              <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#1ABC9C' } } }}>
                <PaymentCardForm clientSecret={clientSecret} paymentId={paymentId} submitLabel={`Recharge ${fmt(parseFloat(amount))}`} onSuccess={() => setPhase('done')} />
              </Elements>
            </div>
          )}
        </>
      )}
    </div>
  );
}
