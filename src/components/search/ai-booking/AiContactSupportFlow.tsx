/**
 * AiContactSupportFlow — Conversational support-case creation inside the AI Bot.
 * Collects issue details step-by-step via text/voice, creates a case using
 * POST /api/support/case, and displays Case ID + SLA to the user.
 *
 * Follows the same UI pattern as AiManageBookingFlow.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, X, ChevronLeft, Headphones, Check, Send, Loader2, AlertCircle, Edit3 } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import {
  isSpeechRecognitionSupported,
  startListening,
  stopListening,
} from '@/services/speechRecognitionService';

// ── Chat bubble matching other AI flows ──────────────────────────────────────

function AiBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5 mb-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles className="w-3.5 h-3.5 text-[#1ABC9C]" />
        <span className="text-[13px] font-bold">
          <span className="text-white">FARE</span>
          <span style={{ color: '#009CA6' }}>MIND</span>{' '}
          <span className="text-[#1ABC9C]">AI</span>
        </span>
      </div>
      <div className="text-[15px] text-white/90 leading-relaxed">{children}</div>
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

type FlowStep =
  | 'category'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'booking_ref'
  | 'issue_details'
  | 'review'
  | 'submitting'
  | 'success';

interface Props {
  onExit: () => void;
}

const CATEGORIES = [
  'Flight Today / Urgent Issue',
  'Ticket Not Issued',
  'Payment Issue',
  'Booking Failed',
  'Cancellation Help',
  'Passenger Update',
  'Application / Technical Issue',
  'General Question',
  'Other',
];

const URGENT_SET = new Set([
  'Flight Today / Urgent Issue',
  'Ticket Not Issued',
  'Payment Issue',
  'Booking Failed',
]);

// ── Validation helpers ──────────────────────────────────────────────────────

const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function validateEmail(v: string) {
  return emailRegex.test(v.trim());
}

function validatePhone(v: string) {
  const digits = v.replace(/[^\d]/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function formatPhoneDisplay(raw: string): string {
  const stripped = raw.replace(/[^\d+]/g, '');
  if (stripped.startsWith('+1') && stripped.length >= 12) {
    return `+1 (${stripped.slice(2, 5)}) ${stripped.slice(5, 8)}-${stripped.slice(8, 12)}`;
  }
  if (stripped.startsWith('1') && stripped.length >= 11) {
    return `+1 (${stripped.slice(1, 4)}) ${stripped.slice(4, 7)}-${stripped.slice(7, 11)}`;
  }
  return raw;
}

/**
 * Collapse spelled-out letters from voice input.
 * When a user spells "d e c a i" the speech API returns spaced single chars.
 * This detects that pattern and joins them: "d e c a i" → "decai".
 * Normal multi-word speech like "John Smith" is left untouched.
 */
function collapseSpelledLetters(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= 1) return text.trim();
  const singleCharCount = words.filter(w => w.length === 1).length;
  // If more than half the words are single characters, user was spelling
  if (singleCharCount > words.length / 2) {
    return words.join('');
  }
  return text.trim();
}

// ── Component ───────────────────────────────────────────────────────────────

export default function AiContactSupportFlow({ onExit }: Props) {
  const auth = useAuthStore();
  const isLoggedIn = !!auth.user;

  const [step, setStep] = useState<FlowStep>('category');
  const [category, setCategory] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [fbr, setFbr] = useState('');
  const [pnr, setPnr] = useState('');
  const [issueDetails, setIssueDetails] = useState('');
  const [error, setError] = useState('');
  const [inputVal, setInputVal] = useState('');
  const [caseResult, setCaseResult] = useState<{ caseNumber: string; urgency: string; slaMessage: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const voiceSupported = typeof window !== 'undefined' && isSpeechRecognitionSupported();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-prefill for logged-in users
  useEffect(() => {
    if (isLoggedIn && auth.user) {
      const parts = (auth.user.name || '').split(' ');
      setFirstName(parts[0] || '');
      setLastName(parts.slice(1).join(' ') || '');
      setEmail(auth.user.email || '');
    }
  }, [isLoggedIn, auth.user]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [step, error]);

  // Focus input when step changes
  useEffect(() => {
    const t = setTimeout(() => {
      if (step === 'issue_details') textareaRef.current?.focus();
      else inputRef.current?.focus();
    }, 150);
    return () => clearTimeout(t);
  }, [step]);

  // ── Voice input for current field ─────────────────────────────────────────
  const handleVoice = useCallback(async () => {
    if (isRecording) {
      stopListening();
      setIsRecording(false);
      return;
    }
    setIsRecording(true);
    try {
      const result = await startListening((interim) => {
        if (step === 'issue_details') setIssueDetails(interim);
        else setInputVal(collapseSpelledLetters(interim));
      }, { singleShot: step !== 'issue_details' });
      setIsRecording(false);
      if (result.transcript.trim()) {
        if (step === 'issue_details') {
          setIssueDetails(result.transcript.trim());
        } else {
          setInputVal(collapseSpelledLetters(result.transcript));
        }
      }
    } catch {
      setIsRecording(false);
    }
  }, [isRecording, step]);

  // ── Step advancement ──────────────────────────────────────────────────────

  function handleCategorySelect(cat: string) {
    setCategory(cat);
    setError('');
    // If logged-in, skip name/email collection if already prefilled
    if (isLoggedIn && firstName) {
      if (email && validateEmail(email)) {
        setStep('phone');
      } else {
        setStep('email');
      }
    } else {
      setStep('first_name');
    }
  }

  function handleInputSubmit() {
    const val = inputVal.trim();
    setError('');

    switch (step) {
      case 'first_name':
        if (!val) { setError('Please enter your first name.'); return; }
        setFirstName(val);
        setInputVal('');
        setStep('last_name');
        break;
      case 'last_name':
        setLastName(val); // Optional — can be empty
        setInputVal('');
        setStep('email');
        break;
      case 'email':
        if (!val) { setError('Please enter your email address.'); return; }
        if (!validateEmail(val)) { setError('Please enter a valid email address.'); return; }
        setEmail(val);
        setInputVal('');
        setStep('phone');
        break;
      case 'phone':
        if (!val) { setError('Please enter your phone number.'); return; }
        if (!validatePhone(val)) { setError('Phone number must have at least 10 digits.'); return; }
        setPhone(formatPhoneDisplay(val));
        setInputVal('');
        setStep('booking_ref');
        break;
      case 'booking_ref': {
        // Parse FBR/PNR from input
        const lower = val.toLowerCase();
        if (lower === 'skip' || lower === '' || lower === 'none' || lower === 'no' || lower === 'n/a') {
          setFbr('');
          setPnr('');
        } else if (val.toUpperCase().startsWith('FM')) {
          setFbr(val.toUpperCase());
        } else {
          // Treat as PNR if short alphanumeric, otherwise as FBR
          if (val.length <= 8 && /^[A-Za-z0-9]+$/.test(val)) {
            setPnr(val.toUpperCase());
          } else {
            setFbr(val);
          }
        }
        setInputVal('');
        setStep('issue_details');
        break;
      }
      default:
        break;
    }
  }

  function handleIssueSubmit() {
    if (!issueDetails.trim()) {
      setError('Please describe your issue.');
      return;
    }
    setError('');
    setStep('review');
  }

  function handleEdit() {
    // Go back to category to redo
    setStep('category');
  }

  async function handleSubmit() {
    setStep('submitting');
    setError('');
    try {
      const res = await fetch('/api/support/case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'AI_BOT',
          channel: 'CHATBOT',
          issueType: category,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          fbr: fbr.trim() || null,
          pnr: pnr.trim() || null,
          issueDetails: issueDetails.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCaseResult({
          caseNumber: data.caseNumber,
          urgency: data.urgency,
          slaMessage: data.slaMessage,
        });
        setStep('success');
      } else {
        setError(data.error || 'Failed to create support case. Please try again.');
        setStep('review');
      }
    } catch {
      setError('Network error. Please try again or call +1 (945) 369-5543.');
      setStep('review');
    }
  }

  // ── Navigate back ─────────────────────────────────────────────────────────
  const canGoBack = !['category', 'submitting', 'success'].includes(step);

  function goBack() {
    setError('');
    setInputVal('');
    switch (step) {
      case 'first_name': setStep('category'); break;
      case 'last_name': setStep('first_name'); break;
      case 'email':
        if (isLoggedIn && firstName) setStep('category');
        else setStep('last_name');
        break;
      case 'phone':
        if (isLoggedIn && email && validateEmail(email)) setStep('category');
        else setStep('email');
        break;
      case 'booking_ref': setStep('phone'); break;
      case 'issue_details': setStep('booking_ref'); break;
      case 'review': setStep('issue_details'); break;
      default: break;
    }
  }

  // ── Shared input row ──────────────────────────────────────────────────────
  const InputRow = ({ placeholder, type = 'text' }: { placeholder: string; type?: string }) => (
    <div className="space-y-1.5">
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-600 leading-snug">{error}</p>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type={type}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleInputSubmit(); } }}
          placeholder={placeholder}
          className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] text-slate-800 placeholder-slate-400 outline-none focus:border-[#1ABC9C]/60 focus:ring-1 focus:ring-[#1ABC9C]/20 transition-all"
          autoFocus
        />
        <button
          onClick={handleInputSubmit}
          disabled={!inputVal.trim()}
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-[#1ABC9C] to-[#0e9e83] text-white shadow-md shadow-[#1ABC9C]/25 disabled:opacity-30 disabled:shadow-none transition-all"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
        {voiceSupported && (
          <button
            onClick={handleVoice}
            className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all relative ${
              isRecording
                ? 'text-red-500 ring-2 ring-red-400/40 bg-red-50'
                : 'text-black/70 hover:text-black cursor-pointer'
            }`}
            title={isRecording ? 'Stop recording' : 'Voice input'}
          >
            {isRecording ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="relative z-10">
                <rect x="3" y="9" width="2" height="6" rx="1" fill="currentColor">
                  <animate attributeName="height" values="6;10;6" dur="1.2s" repeatCount="indefinite" />
                  <animate attributeName="y" values="9;7;9" dur="1.2s" repeatCount="indefinite" />
                </rect>
                <rect x="7.5" y="7" width="2" height="10" rx="1" fill="currentColor">
                  <animate attributeName="height" values="10;4;10" dur="0.9s" repeatCount="indefinite" />
                  <animate attributeName="y" values="7;10;7" dur="0.9s" repeatCount="indefinite" />
                </rect>
                <rect x="12" y="5" width="2" height="14" rx="1" fill="currentColor">
                  <animate attributeName="height" values="14;6;14" dur="1.1s" repeatCount="indefinite" />
                  <animate attributeName="y" values="5;9;5" dur="1.1s" repeatCount="indefinite" />
                </rect>
                <rect x="16.5" y="8" width="2" height="8" rx="1" fill="currentColor">
                  <animate attributeName="height" values="8;14;8" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="y" values="8;5;8" dur="1.4s" repeatCount="indefinite" />
                </rect>
                <rect x="21" y="10" width="2" height="4" rx="1" fill="currentColor">
                  <animate attributeName="height" values="4;10;4" dur="0.8s" repeatCount="indefinite" />
                  <animate attributeName="y" values="10;7;10" dur="0.8s" repeatCount="indefinite" />
                </rect>
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const isUrgent = URGENT_SET.has(category);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-gradient-to-r from-[#1ABC9C]/5 to-emerald-500/5 flex-none">
        <div className="flex items-center gap-1.5">
          {canGoBack && (
            <button
              onClick={goBack}
              className="flex items-center justify-center w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all mr-0.5"
              title="Go back"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <Headphones className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-[15px] font-bold bg-gradient-to-r from-[#1ABC9C] to-emerald-500 bg-clip-text text-transparent">
            Contact Support
          </span>
        </div>
        <button
          onClick={onExit}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable Content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0"
        style={{ background: 'linear-gradient(180deg, #f0fdfb 0%, #f8fffe 100%)', scrollbarWidth: 'none' }}
      >
        {/* ── Step: Category ──────────────────────────────────────────────── */}
        {step === 'category' && (
          <>
            <AiBubble>
              How can FareMind Support help you today?{'\n'}
              <span className="text-white/60 text-[13px]">Please choose a category:</span>
            </AiBubble>
            <div className="grid grid-cols-2 gap-1.5">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => handleCategorySelect(cat)}
                  className={`text-left px-3 py-2 rounded-xl border text-[11px] font-semibold transition-all ${
                    URGENT_SET.has(cat)
                      ? 'border-red-200 bg-red-50/50 text-red-700 hover:bg-red-50 hover:border-red-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-[#1ABC9C]/40 hover:bg-[#1ABC9C]/5'
                  }`}
                >
                  {URGENT_SET.has(cat) && <span className="text-red-400 mr-0.5">⚡</span>}
                  {cat}
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── Step: First Name ────────────────────────────────────────────── */}
        {step === 'first_name' && (
          <>
            <AiBubble>Please enter your first name.</AiBubble>
            <InputRow placeholder="First name" />
          </>
        )}

        {/* ── Step: Last Name ─────────────────────────────────────────────── */}
        {step === 'last_name' && (
          <>
            <AiBubble>
              Please enter your last name.
              <span className="text-white/50 text-[12px] block mt-0.5">You can press Enter to skip.</span>
            </AiBubble>
            <InputRow placeholder="Last name (optional)" />
          </>
        )}

        {/* ── Step: Email ─────────────────────────────────────────────────── */}
        {step === 'email' && (
          <>
            <AiBubble>Please enter your email address so we can contact you.</AiBubble>
            <InputRow placeholder="your@email.com" type="email" />
          </>
        )}

        {/* ── Step: Phone ─────────────────────────────────────────────────── */}
        {step === 'phone' && (
          <>
            <AiBubble>Please enter your phone number.</AiBubble>
            <InputRow placeholder="+1 (214) 555-1234" type="tel" />
          </>
        )}

        {/* ── Step: Booking Reference ─────────────────────────────────────── */}
        {step === 'booking_ref' && (
          <>
            <AiBubble>
              If this issue is related to an existing booking, please enter your FareMind Booking Reference or Airline PNR.
              <span className="text-orange-300 text-[12px] block mt-1">
                You can also type &quot;skip&quot; or press Enter to continue without one.
              </span>
            </AiBubble>
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-700 leading-snug">
                Providing your FareMind Booking Reference or Airline PNR helps us resolve booking issues faster.
              </p>
            </div>
            <InputRow placeholder="e.g. FM-XXXXXXXX or ABC123" />
          </>
        )}

        {/* ── Step: Issue Details ──────────────────────────────────────────── */}
        {step === 'issue_details' && (
          <>
            <AiBubble>
              Please describe your issue clearly.
              <span className="text-white/50 text-[12px] block mt-1">
                Example: &quot;My flight is today and my ticket is not issued.&quot;
              </span>
            </AiBubble>
            {error && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-600 leading-snug">{error}</p>
              </div>
            )}
            <div className="space-y-2">
              <textarea
                ref={textareaRef}
                value={issueDetails}
                onChange={e => setIssueDetails(e.target.value)}
                rows={4}
                placeholder="Describe your issue in detail…"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] text-slate-800 placeholder-slate-400 outline-none focus:border-[#1ABC9C]/60 focus:ring-1 focus:ring-[#1ABC9C]/20 transition-all resize-none"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleIssueSubmit}
                  disabled={!issueDetails.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-bold transition-all disabled:opacity-40 bg-gradient-to-r from-[#1ABC9C] to-emerald-500 text-white shadow-md shadow-[#1ABC9C]/20 hover:shadow-lg active:scale-[0.98]"
                >
                  <Send className="w-3.5 h-3.5" />
                  Continue to Review
                </button>
                {voiceSupported && (
                  <button
                    onClick={handleVoice}
                    className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all relative ${
                      isRecording
                        ? 'text-red-500 ring-2 ring-red-400/40 bg-red-50'
                        : 'text-black/70 hover:text-black border border-slate-200 cursor-pointer'
                    }`}
                    title={isRecording ? 'Stop recording' : 'Dictate issue'}
                  >
                    {isRecording ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="relative z-10">
                        <rect x="3" y="9" width="2" height="6" rx="1" fill="currentColor">
                          <animate attributeName="height" values="6;10;6" dur="1.2s" repeatCount="indefinite" />
                          <animate attributeName="y" values="9;7;9" dur="1.2s" repeatCount="indefinite" />
                        </rect>
                        <rect x="7.5" y="7" width="2" height="10" rx="1" fill="currentColor">
                          <animate attributeName="height" values="10;4;10" dur="0.9s" repeatCount="indefinite" />
                          <animate attributeName="y" values="7;10;7" dur="0.9s" repeatCount="indefinite" />
                        </rect>
                        <rect x="12" y="5" width="2" height="14" rx="1" fill="currentColor">
                          <animate attributeName="height" values="14;6;14" dur="1.1s" repeatCount="indefinite" />
                          <animate attributeName="y" values="5;9;5" dur="1.1s" repeatCount="indefinite" />
                        </rect>
                        <rect x="16.5" y="8" width="2" height="8" rx="1" fill="currentColor">
                          <animate attributeName="height" values="8;14;8" dur="1.4s" repeatCount="indefinite" />
                          <animate attributeName="y" values="8;5;8" dur="1.4s" repeatCount="indefinite" />
                        </rect>
                        <rect x="21" y="10" width="2" height="4" rx="1" fill="currentColor">
                          <animate attributeName="height" values="4;10;4" dur="0.8s" repeatCount="indefinite" />
                          <animate attributeName="y" values="10;7;10" dur="0.8s" repeatCount="indefinite" />
                        </rect>
                      </svg>
                    )}
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Step: Review ─────────────────────────────────────────────────── */}
        {step === 'review' && (
          <>
            <AiBubble>Please review your support request:</AiBubble>
            {error && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-600 leading-snug">{error}</p>
              </div>
            )}
            <div className="px-3 py-3 rounded-xl bg-white border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Category</span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  isUrgent ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-slate-100 text-slate-600'
                }`}>
                  {isUrgent ? '⚡ Urgent' : 'Normal'}
                </span>
              </div>
              <p className="text-[13px] font-semibold text-slate-800">{category}</p>

              <hr className="border-slate-100" />

              {[
                ['Name', `${firstName} ${lastName}`.trim()],
                ['Email', email],
                ['Phone', phone],
                ...(fbr ? [['FareMind Booking Ref', fbr]] : []),
                ...(pnr ? [['Airline PNR', pnr]] : []),
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between text-[11px]">
                  <span className="text-slate-400 font-medium">{label}</span>
                  <span className="text-slate-700 font-semibold text-right max-w-[60%] truncate">{value}</span>
                </div>
              ))}

              <hr className="border-slate-100" />

              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Issue</span>
                <p className="text-[12px] text-slate-700 leading-relaxed whitespace-pre-wrap">{issueDetails}</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="space-y-2">
              <button
                onClick={handleSubmit}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-bold transition-all bg-gradient-to-r from-[#1ABC9C] to-emerald-500 text-white shadow-md shadow-[#1ABC9C]/20 hover:shadow-lg active:scale-[0.98]"
              >
                <Check className="w-3.5 h-3.5" />
                Submit Support Request
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleEdit}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all"
                >
                  <Edit3 className="w-3 h-3" />
                  Edit Details
                </button>
                <button
                  onClick={onExit}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold border border-red-200 text-red-500 hover:bg-red-50 transition-all"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Step: Submitting ─────────────────────────────────────────────── */}
        {step === 'submitting' && (
          <AiBubble>
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#1ABC9C]" />
              Creating your support case…
            </div>
          </AiBubble>
        )}

        {/* ── Step: Success ────────────────────────────────────────────────── */}
        {step === 'success' && caseResult && (
          <>
            <AiBubble>
              {caseResult.urgency === 'URGENT'
                ? 'Your urgent support case has been created.'
                : 'Your support case has been created.'}
            </AiBubble>

            <div className="px-4 py-4 rounded-xl bg-white border border-[#1ABC9C]/30 shadow-sm text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto">
                <Check className="w-6 h-6 text-[#1ABC9C]" />
              </div>

              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Case ID</p>
                <p className={`text-lg font-black font-mono ${
                  caseResult.urgency === 'URGENT' ? 'text-red-500' : 'text-[#1ABC9C]'
                }`}>
                  {caseResult.caseNumber}
                </p>
              </div>

              <p className="text-[12px] text-slate-600 leading-relaxed px-2">
                {caseResult.slaMessage}
              </p>

              {caseResult.urgency === 'URGENT' && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-left">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-700 leading-snug">
                    For the fastest response, you can also reach us directly at <strong>+1 (945) 369-5543</strong>.
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={onExit}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
