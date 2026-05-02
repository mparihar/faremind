'use client';

import { useState, useRef, useEffect, FormEvent, ClipboardEvent, KeyboardEvent, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminStore } from '@/store/useAdminStore';
import { Shield, Loader2, Mail, ArrowRight, RefreshCw } from 'lucide-react';

type Step = 'email' | 'otp';

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
  const digits  = value.padEnd(6, ' ').split('').slice(0, 6);

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
            className={`w-11 h-14 text-center text-2xl font-black rounded-xl border-2 bg-slate-800 text-white outline-none transition-all duration-150 disabled:opacity-50 ${
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

// ── ResendTimer ────────────────────────────────────────────────────────────────

function ResendTimer({ onResend }: { onResend: () => void }) {
  const [secs, setSecs] = useState(30);

  useEffect(() => {
    const id = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  if (secs > 0) {
    return (
      <p className="text-slate-500 text-sm text-center">
        Resend OTP in <span className="text-slate-300 font-bold tabular-nums">{secs}s</span>
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={onResend}
      className="flex items-center gap-1.5 mx-auto text-[#1ABC9C] text-sm font-bold hover:underline transition-all"
    >
      <RefreshCw size={13} />
      Resend OTP
    </button>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function AdminLoginPage() {
  const router = useRouter();
  const { setUser } = useAdminStore();

  const [step, setStep]     = useState<Step>('email');
  const [email, setEmail]   = useState('');
  const [otp, setOtp]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [success, setSuccess] = useState(false);

  // ── Step 1: Send OTP ────────────────────────────────────────────────────────

  async function handleSendOtp(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to send OTP'); return; }
      setStep('otp');
      setOtp('');
    } catch {
      setError('Network error — please check your connection and retry');
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Verify OTP ──────────────────────────────────────────────────────

  async function handleVerify() {
    if (otp.replace(/\s/g, '').length < 6) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth/verify-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Verification failed'); return; }
      setSuccess(true);
      setUser(data.user);
      setTimeout(() => router.replace('/admin/dashboard'), 600);
    } catch {
      setError('Network error — please retry');
    } finally {
      setLoading(false);
    }
  }

  // Auto-submit when all 6 digits filled
  useEffect(() => {
    if (step === 'otp' && otp.replace(/\s/g, '').length === 6 && !loading && !success) {
      handleVerify();
    }
  }, [otp]);

  // ── Resend ──────────────────────────────────────────────────────────────────

  async function handleResend() {
    setError('');
    setOtp('');
    try {
      await fetch('/api/admin/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch { /* silent */ }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#1ABC9C]/20 border border-[#1ABC9C]/30 mb-4">
            <Shield size={32} className="text-[#1ABC9C]" />
          </div>
          <h1 className="text-2xl font-black text-white">FareMind Admin</h1>
          <p className="text-slate-400 text-sm mt-1">Operations Console</p>
        </div>

        {/* Card */}
        <div
          className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm"
          style={{ animation: 'fadeSlideUp 0.3s ease both' }}
        >

          {/* ── EMAIL STEP ─────────────────────────────────── */}
          {step === 'email' && (
            <form onSubmit={handleSendOtp} className="space-y-5">
              <div className="text-center mb-6">
                <div className="w-12 h-12 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto mb-3">
                  <Mail size={22} className="text-[#1ABC9C]" />
                </div>
                <h2 className="text-white font-bold text-lg">Sign in with OTP</h2>
                <p className="text-slate-400 text-sm mt-1">Enter your admin email to receive a one-time code</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  placeholder="admin@faremind.com"
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#1ABC9C] focus:ring-1 focus:ring-[#1ABC9C] transition-all text-sm"
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-3 bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white font-bold rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading
                  ? <><Loader2 size={16} className="animate-spin" /> Sending OTP…</>
                  : <><ArrowRight size={16} /> Send OTP</>
                }
              </button>
            </form>
          )}

          {/* ── OTP STEP ────────────────────────────────────── */}
          {step === 'otp' && (
            <div
              className="space-y-6"
              style={{ animation: 'fadeSlideUp 0.25s ease both' }}
            >
              {/* Header */}
              <div className="text-center">
                {success ? (
                  <div className="w-14 h-14 rounded-full bg-[#1ABC9C]/20 border border-[#1ABC9C]/30 flex items-center justify-center mx-auto mb-3" style={{ animation: 'pulse 0.6s ease' }}>
                    <span className="text-2xl">✓</span>
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto mb-3">
                    <Shield size={22} className="text-[#1ABC9C]" />
                  </div>
                )}
                <h2 className="text-white font-bold text-lg">
                  {success ? 'Verified!' : 'Enter OTP'}
                </h2>
                {!success && (
                  <p className="text-slate-400 text-sm mt-1">
                    Code sent to <span className="text-white font-semibold">{maskEmail(email)}</span>
                    <br />
                    <span className="text-slate-500 text-xs">Valid for 5 minutes</span>
                  </p>
                )}
              </div>

              {/* OTP boxes */}
              {!success && (
                <>
                  <OtpInput value={otp} onChange={setOtp} disabled={loading} />

                  {error && (
                    <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5 text-center">
                      {error}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleVerify}
                    disabled={loading || otp.replace(/\s/g, '').length < 6}
                    className="w-full py-3 bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white font-bold rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {loading
                      ? <><Loader2 size={16} className="animate-spin" /> Verifying…</>
                      : 'Verify OTP'
                    }
                  </button>

                  <ResendTimer key={email} onResend={handleResend} />

                  <button
                    type="button"
                    onClick={() => { setStep('email'); setError(''); setOtp(''); }}
                    className="w-full text-slate-500 hover:text-slate-300 text-sm transition-colors"
                  >
                    ← Use a different email
                  </button>
                </>
              )}

              {success && (
                <p className="text-[#1ABC9C] text-sm text-center font-semibold">
                  Redirecting to dashboard…
                </p>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">FareMind Operations Console · Restricted Access</p>
      </div>

      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
