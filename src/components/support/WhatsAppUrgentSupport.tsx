'use client';

import { useState, useCallback } from 'react';
import { RefreshCw, Check, X, AlertTriangle, ExternalLink } from 'lucide-react';

const ISSUE_TYPES = [
  'Flight Today',
  'Ticket Not Issued',
  'Payment Issue',
  'Booking Failed',
  'Cancellation Help',
  'Passenger Update',
  'Other',
];

// ── Validation helpers ────────────────────────────────────────────────────────

/** Strip everything except digits and leading + */
function stripPhone(raw: string): string {
  return raw.replace(/[^\d+]/g, '');
}

/** Format phone for display: +1 (945) 369-5543 style */
function formatPhoneDisplay(raw: string): string {
  const stripped = stripPhone(raw);
  if (stripped.startsWith('+1') && stripped.length >= 12) {
    const area = stripped.slice(2, 5);
    const mid = stripped.slice(5, 8);
    const last = stripped.slice(8, 12);
    return `+1 (${area}) ${mid}-${last}`;
  }
  if (stripped.startsWith('1') && stripped.length >= 11) {
    const area = stripped.slice(1, 4);
    const mid = stripped.slice(4, 7);
    const last = stripped.slice(7, 11);
    return `+1 (${area}) ${mid}-${last}`;
  }
  return raw;
}

/** Validate phone: must have 10+ digits */
function validatePhone(raw: string): { valid: boolean; error: string } {
  const stripped = stripPhone(raw);
  const digitsOnly = stripped.replace(/\+/g, '');

  if (!digitsOnly) return { valid: false, error: 'Phone number is required.' };
  if (digitsOnly.length < 10) return { valid: false, error: 'Phone number must have at least 10 digits.' };
  if (digitsOnly.length > 15) return { valid: false, error: 'Phone number is too long (max 15 digits).' };

  return { valid: true, error: '' };
}

/** Validate email */
function validateEmail(email: string): { valid: boolean; error: string } {
  if (!email.trim()) return { valid: false, error: 'Email is required.' };
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!re.test(email.trim())) return { valid: false, error: 'Please enter a valid email address.' };
  return { valid: true, error: '' };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  defaultName?: string;
  defaultEmail?: string;
}

export default function WhatsAppUrgentSupport({ defaultName, defaultEmail }: Props) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState(defaultName?.split(' ')[0] || '');
  const [lastName, setLastName] = useState(defaultName?.split(' ').slice(1).join(' ') || '');
  const [email, setEmail] = useState(defaultEmail || '');
  const [phone, setPhone] = useState('');
  const [fbr, setFbr] = useState('');
  const [pnr, setPnr] = useState('');
  const [issueType, setIssueType] = useState('');
  const [issueDetails, setIssueDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ caseNumber: string; whatsappUrl: string } | null>(null);
  const [error, setError] = useState('');

  // Track blur for inline errors
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const phoneValidation = validatePhone(phone);
  const emailValidation = validateEmail(email);

  const iCls = 'w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-[15px] focus:outline-none focus:border-[#25D366] transition-all placeholder:text-slate-600';
  const errCls = 'w-full px-4 py-3 bg-white/[0.04] border border-red-500/40 rounded-xl text-white text-[15px] focus:outline-none focus:border-red-400 transition-all placeholder:text-slate-600';

  const canSend = firstName.trim() && emailValidation.valid && phoneValidation.valid && issueDetails.trim();

  const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.replace(/[^\d+\s\-()]/g, '');
    setPhone(cleaned);
  }, []);

  const handlePhoneBlur = useCallback(() => {
    setPhoneTouched(true);
    if (phoneValidation.valid) {
      const formatted = formatPhoneDisplay(phone);
      if (formatted !== phone) setPhone(formatted);
    }
  }, [phone, phoneValidation.valid]);

  async function handleSubmit() {
    setPhoneTouched(true);
    setEmailTouched(true);

    if (!canSend) {
      if (!firstName.trim()) setError('First name is required.');
      else if (!emailValidation.valid) setError(emailValidation.error);
      else if (!phoneValidation.valid) setError(phoneValidation.error);
      else if (!issueDetails.trim()) setError('Issue details are required.');
      return;
    }

    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/support/urgent-whatsapp-case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          fbr: fbr.trim() || null,
          pnr: pnr.trim() || null,
          issueType: issueType || 'Other',
          issueDetails: issueDetails.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult({ caseNumber: data.caseNumber, whatsappUrl: data.whatsappUrl });
        window.open(data.whatsappUrl, '_blank', 'noopener,noreferrer');
      } else {
        setError(data.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setError('Network error. Please try again or call +1 (945) 369-5543.');
    }
    setSending(false);
  }

  function resetForm() {
    setResult(null);
    setIssueType('');
    setIssueDetails('');
    setFbr('');
    setPnr('');
    setPhone('');
    setPhoneTouched(false);
    setEmailTouched(false);
    if (!defaultName) { setFirstName(''); setLastName(''); }
    if (!defaultEmail) setEmail('');
  }

  const WhatsAppIcon = ({ size = 20, className = '' }: { size?: number; className?: string }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );

  const showPhoneErr = phoneTouched && !phoneValidation.valid && phone.length > 0;
  const showEmailErr = emailTouched && !emailValidation.valid && email.length > 0;

  return (
    <>
      {/* Urgent WhatsApp CTA Card */}
      <div className="bg-gradient-to-br from-[#25D366]/10 to-[#128C7E]/10 border border-[#25D366]/25 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={16} className="text-amber-400" />
          <p className="text-white font-bold text-base">Urgent Issues</p>
        </div>
        <p className="text-slate-400 text-sm mb-4 leading-relaxed">
          Flight today or urgent booking concern? Contact FareMind Support on WhatsApp.
        </p>
        <button
          onClick={() => { setOpen(true); setResult(null); setError(''); }}
          className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl bg-[#25D366] hover:bg-[#22c55e] text-white font-bold text-sm transition-all shadow-lg shadow-[#25D366]/20"
        >
          <WhatsAppIcon size={18} />
          Contact WhatsApp Support
        </button>
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-slate-900 border-b border-slate-700/50 px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#25D366]/15 flex items-center justify-center">
                  <WhatsAppIcon size={18} className="text-[#25D366]" />
                </div>
                <div>
                  <p className="text-white font-bold text-sm">WhatsApp Urgent Support</p>
                  <p className="text-slate-500 text-[11px]">We&apos;ll create a case before opening WhatsApp</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5">
              {result ? (
                <div className="text-center py-4">
                  <div className="w-14 h-14 rounded-full bg-[#25D366]/10 border border-[#25D366]/20 flex items-center justify-center mx-auto mb-3">
                    <Check size={26} className="text-[#25D366]" />
                  </div>
                  <p className="text-white font-bold text-lg mb-1">Urgent Case Created</p>
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl mb-3">
                    <span className="text-slate-400 text-sm">Case ID</span>
                    <span className="text-red-400 font-black text-lg font-mono">{result.caseNumber}</span>
                  </div>
                  <p className="text-slate-400 text-sm mb-2">
                    WhatsApp should have opened with your message pre-filled.<br />
                    <strong className="text-white">Please press Send in WhatsApp.</strong>
                  </p>
                  <p className="text-slate-500 text-xs mb-4">
                    If WhatsApp didn&apos;t open, click below:
                  </p>
                  <a
                    href={result.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#25D366] hover:bg-[#22c55e] rounded-xl text-white font-bold text-sm transition-all"
                  >
                    <WhatsAppIcon size={16} />
                    Open WhatsApp
                    <ExternalLink size={12} />
                  </a>
                  <div className="mt-4">
                    <button onClick={() => { resetForm(); setOpen(false); }}
                      className="px-4 py-2 text-slate-400 text-sm font-medium hover:text-white transition-colors">
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {error && (
                    <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium">
                      {error}
                    </div>
                  )}

                  {/* Issue Type Chips */}
                  <div>
                    <label className="text-xs text-slate-500 uppercase font-bold mb-2 block tracking-wide">Issue Type</label>
                    <div className="flex flex-wrap gap-2">
                      {ISSUE_TYPES.map(type => (
                        <button
                          key={type}
                          onClick={() => setIssueType(issueType === type ? '' : type)}
                          className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                            issueType === type
                              ? 'bg-[#25D366]/20 border-[#25D366]/40 text-[#25D366]'
                              : 'bg-white/[0.03] border-white/[0.08] text-slate-400 hover:text-white hover:border-white/20'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Name fields */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">
                        First Name <span className="text-red-400">*</span>
                      </label>
                      <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="John" className={iCls} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Last Name</label>
                      <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Anderson" className={iCls} />
                    </div>
                  </div>

                  {/* Email & Phone with validation */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">
                        Email <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        onBlur={() => setEmailTouched(true)}
                        placeholder="john@example.com"
                        className={showEmailErr ? errCls : iCls}
                      />
                      {showEmailErr && (
                        <p className="text-red-400 text-[11px] mt-1 font-medium">{emailValidation.error}</p>
                      )}
                      {emailTouched && emailValidation.valid && (
                        <p className="text-green-400 text-[11px] mt-1 font-medium flex items-center gap-1">
                          <Check size={10} /> Valid email
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">
                        Phone <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={handlePhoneChange}
                        onBlur={handlePhoneBlur}
                        placeholder="+1 (214) 555-1234"
                        maxLength={20}
                        className={showPhoneErr ? errCls : iCls}
                      />
                      {showPhoneErr && (
                        <p className="text-red-400 text-[11px] mt-1 font-medium">{phoneValidation.error}</p>
                      )}
                      {phoneTouched && phoneValidation.valid && (
                        <p className="text-green-400 text-[11px] mt-1 font-medium flex items-center gap-1">
                          <Check size={10} /> Valid phone number
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Booking Reference & PNR */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">FareMind Booking Ref</label>
                      <input value={fbr} onChange={e => setFbr(e.target.value)} placeholder="e.g. FM-XXXXXXXX" className={iCls} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Airline PNR</label>
                      <input value={pnr} onChange={e => setPnr(e.target.value)} placeholder="e.g. ABC123" className={iCls} />
                    </div>
                  </div>

                  {/* Issue Details */}
                  <div>
                    <label className="text-xs text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">
                      Issue Details <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={issueDetails}
                      onChange={e => setIssueDetails(e.target.value)}
                      rows={4}
                      placeholder="Please describe your urgent issue in detail…"
                      className={`${iCls} resize-none`}
                    />
                  </div>

                  {/* Submit */}
                  <button
                    onClick={handleSubmit}
                    disabled={!canSend || sending}
                    className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-[#25D366] hover:bg-[#22c55e] text-white font-bold text-[15px] disabled:opacity-40 transition-all shadow-lg shadow-[#25D366]/20"
                  >
                    {sending ? (
                      <><RefreshCw size={16} className="animate-spin" /> Creating Case…</>
                    ) : (
                      <><WhatsAppIcon size={16} /> Send via WhatsApp</>
                    )}
                  </button>

                  <p className="text-slate-600 text-[11px] text-center leading-relaxed">
                    A support case will be created first. WhatsApp will open with a pre-filled message — you must press Send manually.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
