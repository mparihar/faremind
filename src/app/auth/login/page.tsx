'use client';

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import type { KeyboardEvent as RKE, ClipboardEvent as RCE } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Plane, ArrowRight, Loader2, AlertCircle, User, Phone, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { apiUrl } from '@/lib/api-client';

type AuthStep = 'email' | 'register' | 'otp';

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return email;
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

  function handleKeyDown(i: number, e: RKE<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const arr = [...digits.map(d => (d === ' ' ? '' : d))];
      if (arr[i]) { arr[i] = ''; onChange(arr.join('')); }
      else { focus(i - 1); }
    }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); focus(i - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); focus(i + 1); }
  }

  function handlePaste(e: RCE<HTMLInputElement>) {
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

// ── Resend Timer ──────────────────────────────────────────────────────────────

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

// ── Main ──────────────────────────────────────────────────────────────────────

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') ?? '/account';
  const isDnaRedirect = redirectTo.includes('dna=1');
  const { verifyOtp, loading: authLoading, error, setError } = useAuthStore();

  const [step, setStep]         = useState<AuthStep>('email');
  const [email, setEmail]       = useState('');
  const [otp, setOtp]           = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [phone, setPhone]         = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  const [success, setSuccess]   = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaWidgetId = useRef<number | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement>(null);

  const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_GOOGLE_RECAPTCHA_SITE_KEY;

  // Load reCAPTCHA script and render widget
  useEffect(() => {
    if (!RECAPTCHA_SITE_KEY) return;

    // Define the global callback before loading the script
    (window as any).__onRecaptchaLoad_user = () => {
      if (captchaContainerRef.current && captchaWidgetId.current === null) {
        captchaWidgetId.current = (window as any).grecaptcha.render(captchaContainerRef.current, {
          sitekey: RECAPTCHA_SITE_KEY,
          callback: (token: string) => setCaptchaToken(token),
          'expired-callback': () => setCaptchaToken(null),
          theme: 'dark',
        });
      }
    };

    // Check if script is already loaded
    if ((window as any).grecaptcha?.render) {
      (window as any).__onRecaptchaLoad_user();
      return;
    }

    // Load script if not already present
    if (!document.querySelector('script[src*="recaptcha/api.js"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.google.com/recaptcha/api.js?onload=__onRecaptchaLoad_user&render=explicit';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    return () => {
      delete (window as any).__onRecaptchaLoad_user;
    };
  }, [RECAPTCHA_SITE_KEY]);

  function resetCaptcha() {
    setCaptchaToken(null);
    try {
      if (captchaWidgetId.current !== null && (window as any).grecaptcha) {
        (window as any).grecaptcha.reset(captchaWidgetId.current);
      }
    } catch { /* ignore */ }
  }

  const isLoading = localLoading || authLoading;
  const prevOtpLenRef = useRef(0);

  // Auto-submit only when the 6th digit is freshly entered (not on re-edit)
  useEffect(() => {
    const len = otp.replace(/\s/g, '').length;
    if (step === 'otp' && len === 6 && prevOtpLenRef.current < 6 && !isLoading && !success) {
      handleVerifyOtp();
    }
    prevOtpLenRef.current = len;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  async function handleCheckUser(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!email) { setError('Please enter your email'); return; }
    setError(null);
    setLocalLoading(true);
    try {
      const res  = await fetch(apiUrl('/api/auth/check-user'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, captchaToken }),
      });
      const data = await res.json();
      if (res.ok && data.exists) {
        const otpRes = await fetch(apiUrl('/api/auth/send-otp'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (otpRes.ok) { setStep('otp'); setOtp(''); }
        else setError('Failed to send OTP. Try again.');
      } else if (res.ok && !data.exists) {
        setStep('register');
      } else {
        setError('Error checking user. Try again.');
      }
    } catch { setError('Network error'); }
    finally { setLocalLoading(false); resetCaptcha(); }
  }

  async function handleRegister(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!firstName || !lastName) { setError('First and last name are required'); return; }
    setError(null);
    setLocalLoading(true);
    try {
      const res  = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, first_name: firstName, last_name: lastName, phone }),
      });
      if (res.ok) { setStep('otp'); setOtp(''); }
      else {
        const data = await res.json();
        setError(data.detail || data.error || 'Registration failed');
      }
    } catch { setError('Network error'); }
    finally { setLocalLoading(false); }
  }

  async function handleVerifyOtp() {
    if (otp.replace(/\s/g, '').length < 6) return;
    setError(null);
    const ok = await verifyOtp(email, otp);
    if (ok) {
      setSuccess(true);
      setTimeout(() => router.push(redirectTo), 600);
    }
  }

  async function handleResendOtp() {
    setError(null);
    setOtp('');
    try {
      await fetch(apiUrl('/api/auth/resend-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch { /* silent */ }
  }

  const inputCls = 'w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#1ABC9C] focus:ring-1 focus:ring-[#1ABC9C] transition-all text-sm';
  const labelCls = 'block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider';
  const btnCls   = 'w-full py-3 bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white font-bold rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4 pb-48">
      <div className="w-full max-w-md">

        {/* Logo + title */}
        <div className="text-center mb-8">

          <h1 className="text-2xl font-black"><span className="text-white">FARE</span><span className="text-[#009CA6]">MIND</span></h1>
          <p className="text-slate-400 text-sm mt-1">{isDnaRedirect ? 'Sign in to activate your Travel DNA' : 'Sign in to your account'}</p>
        </div>

        {/* DNA-specific banner */}
        {isDnaRedirect && (
          <div className="mb-4 bg-gradient-to-r from-[#1ABC9C]/10 to-[#009CA6]/10 border border-[#1ABC9C]/20 rounded-xl p-5 text-center">
            <p className="text-sm font-bold tracking-wide">
              ✨ <span className="text-white">FARE</span><span className="text-[#009CA6]">MIND</span> <span className="text-[#1ABC9C]">DNA Search</span>
            </p>
            <p className="text-slate-300 text-xs mt-2 leading-relaxed">
              Sign in or create an account to unlock personalized flight<br />recommendations powered by your <span className="text-[#1ABC9C] font-semibold">Travel DNA</span>.
            </p>
          </div>
        )}

        {/* Card */}
        <div
          className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm"
          style={{ animation: 'fadeSlideUp 0.3s ease both' }}
        >
          <AnimatePresence mode="wait">

            {/* ── EMAIL STEP ──────────────────────────────────── */}
            {step === 'email' && (
              <motion.form
                key="email"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleCheckUser}
                className="space-y-5"
              >
                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto mb-3">
                    <Mail size={22} className="text-[#1ABC9C]" />
                  </div>
                  <h2 className="text-white font-bold text-lg">Welcome back</h2>
                  <p className="text-slate-400 text-sm mt-1">Enter your email to receive a one-time code</p>
                </div>

                <div>
                  <label className={labelCls}>Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoFocus
                    placeholder="your@email.com"
                    className={inputCls}
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
                    <AlertCircle size={14} className="shrink-0" />
                    {error}
                  </div>
                )}

                {RECAPTCHA_SITE_KEY && (
                  <div className="w-full rounded-xl overflow-hidden">
                    <div ref={captchaContainerRef} className="flex justify-center [&>div]:!w-full [&_iframe]:!w-full" />
                  </div>
                )}

                <button type="submit" disabled={isLoading || !email || (!!RECAPTCHA_SITE_KEY && !captchaToken)} className={btnCls}>
                  {isLoading
                    ? <><Loader2 size={16} className="animate-spin" /> Sending OTP…</>
                    : <><ArrowRight size={16} /> Send OTP</>}
                </button>
              </motion.form>
            )}

            {/* ── REGISTER STEP ───────────────────────────────── */}
            {step === 'register' && (
              <motion.form
                key="register"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleRegister}
                className="space-y-4"
              >
                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto mb-3">
                    <User size={22} className="text-[#1ABC9C]" />
                  </div>
                  <h2 className="text-white font-bold text-lg">Create your account</h2>
                  <p className="text-slate-400 text-sm mt-1">
                    New to FAREMIND? Fill in your details to get started
                  </p>
                </div>

                <div>
                  <label className={labelCls}>Email</label>
                  <input type="email" value={email} disabled className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-slate-400 text-sm cursor-not-allowed" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>First Name</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                      placeholder="Jane"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Last Name</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={e => setLastName(e.target.value)}
                      placeholder="Doe"
                      className={inputCls}
                    />
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Phone <span className="text-slate-500 normal-case font-normal">(optional)</span></label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+1 555 000 0000"
                    className={inputCls}
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
                    <AlertCircle size={14} className="shrink-0" />
                    {error}
                  </div>
                )}

                <button type="submit" disabled={isLoading} className={btnCls}>
                  {isLoading
                    ? <><Loader2 size={16} className="animate-spin" /> Creating account…</>
                    : <><ArrowRight size={16} /> Register &amp; Send OTP</>}
                </button>

                <button
                  type="button"
                  onClick={() => { setStep('email'); setError(null); }}
                  className="w-full text-slate-500 hover:text-slate-300 text-sm transition-colors"
                >
                  ← Use a different email
                </button>
              </motion.form>
            )}

            {/* ── OTP STEP ────────────────────────────────────── */}
            {step === 'otp' && (
              <motion.div
                key="otp"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <div className="text-center">
                  {success ? (
                    <div className="w-14 h-14 rounded-full bg-[#1ABC9C]/20 border border-[#1ABC9C]/30 flex items-center justify-center mx-auto mb-3">
                      <CheckCircle2 size={28} className="text-[#1ABC9C]" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto mb-3">
                      <Mail size={22} className="text-[#1ABC9C]" />
                    </div>
                  )}
                  <h2 className="text-white font-bold text-lg">
                    {success ? 'Verified!' : 'Check your inbox'}
                  </h2>
                  {!success && (
                    <p className="text-slate-400 text-sm mt-1">
                      Code sent to{' '}
                      <span className="text-white font-semibold">{maskEmail(email)}</span>
                      <br />
                      <span className="text-slate-500 text-xs">Valid for 5 minutes</span>
                    </p>
                  )}
                </div>

                {!success && (
                  <>
                    <OtpInput value={otp} onChange={setOtp} disabled={isLoading} />

                    {error && (
                      <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5 justify-center">
                        <AlertCircle size={14} className="shrink-0" />
                        {error}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleVerifyOtp}
                      disabled={isLoading || otp.replace(/\s/g, '').length < 6}
                      className={btnCls}
                    >
                      {isLoading
                        ? <><Loader2 size={16} className="animate-spin" /> Verifying…</>
                        : 'Verify OTP'}
                    </button>

                    <ResendTimer key={email} onResend={handleResendOtp} />

                    <button
                      type="button"
                      onClick={() => { setStep('email'); setError(null); setOtp(''); }}
                      className="w-full text-slate-500 hover:text-slate-300 text-sm transition-colors"
                    >
                      ← Use a different email
                    </button>
                  </>
                )}

                {success && (
                  <p className="text-[#1ABC9C] text-sm text-center font-semibold">
                    {isDnaRedirect ? '🧬 Activating your Travel DNA...' : 'Redirecting to dashboard…'}
                  </p>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">FAREMIND · Secure Sign In</p>
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

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}
