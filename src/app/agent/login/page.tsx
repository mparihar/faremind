// FILE: src/app/agent/login/page.tsx
'use client';

import { useState, useEffect, useRef, KeyboardEvent, ClipboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase, Mail, ArrowRight, Loader2, Shield, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { apiUrl } from '@/lib/api-client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0]}*@${domain}`;
  return `${user[0]}${'*'.repeat(user.length - 2)}${user[user.length - 1]}@${domain}`;
}

// ── 6-box OTP Input ───────────────────────────────────────────────────────────

function OtpInput({ value, onChange, disabled }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, ' ').split('').slice(0, 6);

  useEffect(() => { inputs.current[0]?.focus(); }, []);

  function focus(i: number) { inputs.current[Math.min(5, Math.max(0, i))]?.focus(); }

  function handleChange(i: number, raw: string) {
    const ch = raw.replace(/\D/g, '').slice(-1);
    const arr = [...digits.map(d => (d === ' ' ? '' : d))];
    arr[i] = ch;
    onChange(arr.join(''));
    if (ch) focus(i + 1);
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const arr = [...digits.map(d => (d === ' ' ? '' : d))];
      if (arr[i]) { arr[i] = ''; onChange(arr.join('')); }
      else { focus(i - 1); }
    }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); focus(i - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); focus(i + 1); }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    onChange(pasted.padEnd(6, '').slice(0, 6));
    focus(Math.min(5, pasted.length));
  }

  return (
    <div className="flex gap-3 justify-center">
      {Array.from({ length: 6 }).map((_, i) => {
        const char = digits[i]?.trim() ?? '';
        return (
          <input
            key={i}
            ref={el => { inputs.current[i] = el; }}
            type="tel"
            inputMode="numeric"
            maxLength={1}
            value={char}
            disabled={disabled}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={e => e.target.select()}
            className={`w-12 h-14 text-center text-2xl font-black rounded-xl border-2 bg-slate-800 text-white outline-none transition-all duration-150 disabled:opacity-50 ${
              char
                ? 'border-[#1ABC9C] shadow-[0_0_0_2px_rgba(26,188,156,0.2)]'
                : 'border-slate-600 focus:border-[#1ABC9C] focus:shadow-[0_0_0_2px_rgba(26,188,156,0.15)]'
            }`}
          />
        );
      })}
    </div>
  );
}

export default function AgentLoginPage() {
  const router = useRouter();
  const { user, verifyOtp, loadSession } = useAuthStore();

  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already logged in as agent, redirect
  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (user?.role === 'FAREMIND_AGENT') {
      router.replace('/agent/dashboard');
    }
  }, [user, router]);

  async function handleSendOtp() {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);

    try {
      // Check if user exists and is an agent
      const checkRes = await fetch(apiUrl('/api/auth/check-user'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const checkData = await checkRes.json();

      if (!checkData.exists) {
        setError('No agent account found with this email.');
        setLoading(false);
        return;
      }

      // Send OTP
      const res = await fetch(apiUrl('/api/auth/send-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      if (res.ok) {
        setStep('otp');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to send verification code.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (otp.replace(/\s/g, '').length < 6) return;
    setLoading(true);
    setError(null);

    try {
      const success = await verifyOtp(email.trim().toLowerCase(), otp.trim());

      if (success) {
        // Check role after login
        const stored = localStorage.getItem('faremind_session');
        if (stored) {
          const { user: loggedUser } = JSON.parse(stored);
          if (loggedUser?.role !== 'FAREMIND_AGENT') {
            setError('This account does not have agent access. Please contact your administrator.');
            // Logout the non-agent user
            useAuthStore.getState().logout();
            setLoading(false);
            return;
          }
        }
        router.push('/agent/dashboard');
      } else {
        setError('Invalid or expired code. Please try again.');
      }
    } catch {
      setError('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // Auto-submit when all 6 digits are filled
  useEffect(() => {
    if (step === 'otp' && otp.replace(/\s/g, '').length === 6 && !loading) {
      handleVerifyOtp();
    }
  }, [otp]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center px-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#1ABC9C]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#009CA6]/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#1ABC9C] to-[#009CA6] shadow-lg shadow-[#1ABC9C]/25 mb-4">
            <Briefcase className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-white mb-1">Agent Portal</h1>
          <p className="text-sm text-slate-400">
            Sign in with your FareMind agent credentials
          </p>
        </div>

        {/* Card */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          {step === 'email' ? (
            <div className="space-y-5">
              <div>
                <label className="block text-sm text-slate-400 uppercase tracking-wider font-bold mb-2">
                  Agent Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
                    placeholder="agent@company.com"
                    autoFocus
                    className="w-full pl-12 pr-4 py-4 rounded-xl bg-slate-800/50 border border-white/10 text-white placeholder-slate-500 text-base focus:outline-none focus:border-[#1ABC9C]/50 focus:ring-1 focus:ring-[#1ABC9C]/25 transition-all"
                  />
                </div>
              </div>

              <button
                onClick={handleSendOtp}
                disabled={loading || !email.trim()}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-[#1ABC9C] to-[#009CA6] hover:from-[#16A085] hover:to-[#008B94] text-white font-bold text-base shadow-lg shadow-[#1ABC9C]/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Header */}
              <div className="text-center">
                <div className="w-12 h-12 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto mb-3">
                  <Shield className="w-6 h-6 text-[#1ABC9C]" />
                </div>
                <h2 className="text-white font-bold text-xl">Enter OTP</h2>
                <p className="text-slate-400 text-sm mt-1">
                  Code sent to <span className="text-white font-semibold">{maskEmail(email)}</span>
                  <br />
                  <span className="text-slate-500 text-xs">Valid for 5 minutes</span>
                </p>
              </div>

              {/* OTP boxes */}
              <OtpInput value={otp} onChange={setOtp} disabled={loading} />

              <button
                onClick={handleVerifyOtp}
                disabled={loading || otp.replace(/\s/g, '').length < 6}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-[#1ABC9C] to-[#009CA6] hover:from-[#16A085] hover:to-[#008B94] text-white font-bold text-base shadow-lg shadow-[#1ABC9C]/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Verifying…</>
                ) : (
                  'Verify OTP'
                )}
              </button>

              <button
                onClick={() => { setStep('email'); setOtp(''); setError(null); }}
                className="w-full text-center text-sm text-slate-500 hover:text-white transition-colors"
              >
                ← Use a different email
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 flex items-start gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-slate-600 mt-6">
          Not an agent? <a href="/auth/login" className="text-[#1ABC9C] hover:underline">Sign in as customer</a>
        </p>
      </div>
    </div>
  );
}
