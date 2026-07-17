'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import {
  Mail, MessageSquare, Clock, Check, ChevronDown, ChevronUp, Headphones, Phone,
  Inbox, CheckCircle2, ArrowUpCircle, XCircle, RefreshCw, Ticket, User, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import WhatsAppUrgentSupport from '@/components/support/WhatsAppUrgentSupport';
import { formatDistanceToNow } from 'date-fns';

/* ─────── Status styling ─────── */
type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

const STATUS_CFG: Record<TicketStatus, { label: string; cls: string; icon: React.ElementType }> = {
  OPEN:              { label: 'Open',              cls: 'bg-blue-400/15 text-blue-400',       icon: Inbox },
  IN_PROGRESS:       { label: 'In Progress',       cls: 'bg-amber-400/15 text-amber-400',     icon: Clock },
  WAITING_CUSTOMER:  { label: 'Awaiting Reply',    cls: 'bg-purple-400/15 text-purple-400',   icon: User },
  ESCALATED:         { label: 'Escalated',          cls: 'bg-red-400/15 text-red-400',         icon: ArrowUpCircle },
  RESOLVED:          { label: 'Resolved',           cls: 'bg-emerald-400/15 text-emerald-400', icon: CheckCircle2 },
  CLOSED:            { label: 'Closed',             cls: 'bg-slate-400/15 text-slate-400',     icon: XCircle },
};

const CATEGORY_CLR: Record<string, string> = {
  Cancellation: 'text-red-400',
  'Cancellation Request': 'text-red-400',
  'Change Request': 'text-purple-400',
  'Flight Change Request': 'text-purple-400',
  'Booking Issue': 'text-amber-400',
  'Payment Problem': 'text-orange-400',
  'Refund Query': 'text-emerald-400',
};

interface UserTicket {
  id: string;
  ticketNumber: string | null;
  sequenceNumber: number | null;
  subject: string;
  category: string;
  priority: string;
  status: TicketStatus;
  channel: string;
  bookingRef: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

function getTicketNum(t: UserTicket): string {
  if (t.ticketNumber) return t.ticketNumber;
  if (t.sequenceNumber) return `FM-TKT-${String(t.sequenceNumber).padStart(4, '0')}`;
  return t.id.slice(-6).toUpperCase();
}

const FAQ = [
  { q: 'How do I cancel a booking?', a: 'Go to My Bookings, open the booking, and click "Cancel Booking" in the Actions panel. You\'ll see the estimated refund before confirming.' },
  { q: 'When will the customer receive their refund?', a: 'Refunds are processed to the original payment method within 5–10 business days after cancellation is confirmed.' },
  { q: 'Can I change flight dates for a customer?', a: 'Yes — open the booking and click "Change Flight Date". Date changes are subject to airline fare rules and availability fees.' },
  { q: 'How do I download an e-ticket?', a: 'Open the booking detail page and click "Download E-Ticket". You can also re-send the itinerary to the customer\'s email.' },
  { q: 'How do I update passenger details?', a: 'Open the booking and click "Update Passenger". You can edit contact information. Name changes require airline approval.' },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/[0.06] last:border-0">
      <button onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-4 text-left gap-4">
        <span className="text-white text-[15px] font-semibold">{q}</span>
        {open ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden">
            <p className="text-slate-400 text-sm pb-4 leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AgentSupportPage() {
  const router = useRouter();
  const { user, sessionToken } = useAuthStore();
  const [subject, setSubject] = useState('');
  const [bookingRef, setBookingRef] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [ticketNumber, setTicketNumber] = useState('');
  const [error, setError] = useState('');

  const [tickets, setTickets] = useState<UserTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  useEffect(() => {
    let token = sessionToken;
    if (!token) {
      try {
        const stored = localStorage.getItem('faremind_session');
        if (stored) token = JSON.parse(stored).token;
      } catch {}
    }
    if (!token) { setTicketsLoading(false); return; }
    (async () => {
      try {
        const res = await fetch('/api/user/support-tickets', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setTickets(data.tickets || []);
        }
      } catch { /* silent */ }
      setTicketsLoading(false);
    })();
  }, [sessionToken, sent]);

  const iCls = 'w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-[15px] focus:outline-none focus:border-[#1ABC9C] transition-all placeholder:text-slate-600';

  async function handleSend() {
    if (!message.trim()) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/support-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: user?.name || 'Agent',
          email: user?.email || '',
          subject: subject.trim(),
          message: message.trim(),
          category: category || 'other',
          bookingRef: bookingRef.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTicketNumber(data.ticketNumber || '');
        setSent(true);
      } else {
        setError(data.error || 'Something went wrong. Please try again.');
      }
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
    }
    setSending(false);
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-black text-white mb-6">Help & Support</h1>

      {/* ── My Tickets ───────────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Ticket size={18} className="text-[#1ABC9C]" />
            <p className="text-white font-bold text-base">My Support Tickets</p>
            {tickets.length > 0 && (
              <span className="ml-auto text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {ticketsLoading ? (
            <div className="flex items-center justify-center py-8 bg-white/[0.02] border border-white/[0.06] rounded-2xl">
              <RefreshCw size={16} className="text-[#1ABC9C] animate-spin" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-8 bg-white/[0.02] border border-white/[0.06] rounded-2xl">
              <Inbox size={28} className="text-slate-600 mx-auto mb-2" />
              <p className="text-slate-400 text-sm font-semibold">No support tickets yet</p>
              <p className="text-slate-500 text-xs mt-1">Submit a request below and it will appear here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tickets.map((t, i) => {
                const cfg = STATUS_CFG[t.status] || STATUS_CFG.OPEN;
                const StIcon = cfg.icon;
                const catClr = CATEGORY_CLR[t.category] || 'text-slate-400';
                return (
                  <motion.button
                    key={t.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => router.push(`/agent/support/${t.id}`)}
                    className="w-full text-left bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 hover:bg-white/[0.06] transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[#1ABC9C] font-mono font-bold text-xs bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 px-2 py-0.5 rounded-md shrink-0">
                        {getTicketNum(t)}
                      </span>
                      <span className="text-white font-semibold text-sm truncate flex-1 group-hover:text-[#1ABC9C] transition-colors">
                        {t.subject}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${cfg.cls}`}>
                        <StIcon size={10} />
                        {cfg.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-2 pl-[72px] text-[10px] text-slate-500">
                      <span className={`font-semibold ${catClr}`}>{t.category}</span>
                      {t.bookingRef && (
                        <>
                          <span className="text-slate-700">•</span>
                          <span className="font-mono">{t.bookingRef}</span>
                        </>
                      )}
                      <span className="text-slate-700">•</span>
                      <span>{formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}</span>
                      {t.messageCount > 0 && (
                        <>
                          <span className="text-slate-700">•</span>
                          <span className="flex items-center gap-0.5">
                            <MessageSquare size={9} /> {t.messageCount} {t.messageCount === 1 ? 'reply' : 'replies'}
                          </span>
                        </>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Contact Form + Sidebar ───────────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-5">
              <MessageSquare size={18} className="text-[#1ABC9C]" />
              <p className="text-white font-bold text-base">Send a Message</p>
            </div>

            {sent ? (
              <div className="text-center py-8">
                <div className="w-14 h-14 rounded-full bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto mb-3">
                  <Check size={26} className="text-[#1ABC9C]" />
                </div>
                <p className="text-white font-bold text-lg mb-1">Ticket Created</p>
                {ticketNumber && (
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 rounded-xl mb-3">
                    <span className="text-slate-400 text-sm">Your Ticket #</span>
                    <span className="text-[#1ABC9C] font-black text-lg font-mono">{ticketNumber}</span>
                  </div>
                )}
                <p className="text-slate-400 text-sm">Our support team will review your request and respond to <strong className="text-white">{user?.email}</strong> within 24 hours.</p>
                <button onClick={() => { setSent(false); setSubject(''); setMessage(''); setBookingRef(''); setCategory(''); setTicketNumber(''); }}
                  className="mt-5 px-5 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm font-semibold hover:bg-white/[0.04] transition-all">
                  Submit Another Request
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {error && (
                  <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium">
                    {error}
                  </div>
                )}
                <div>
                  <label className="text-xs text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Category</label>
                  <select value={category} onChange={e => setCategory(e.target.value)}
                    className={`${iCls} cursor-pointer bg-[#0f1525]`}>
                    <option value="" disabled className="bg-white text-slate-900">Select a topic</option>
                    <option value="cancellation" className="bg-white text-slate-900">Cancellation &amp; Refund</option>
                    <option value="change" className="bg-white text-slate-900">Flight Change</option>
                    <option value="ticket" className="bg-white text-slate-900">E-Ticket / Check-In</option>
                    <option value="baggage" className="bg-white text-slate-900">Baggage</option>
                    <option value="payment" className="bg-white text-slate-900">Payment Issue</option>
                    <option value="other" className="bg-white text-slate-900">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Booking Reference (optional)</label>
                  <input value={bookingRef} onChange={e => setBookingRef(e.target.value)}
                    placeholder="e.g. FM-XXXXXXXX" className={iCls} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Subject</label>
                  <input value={subject} onChange={e => setSubject(e.target.value)}
                    placeholder="Brief description of your issue" className={iCls} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 uppercase font-bold mb-1.5 block tracking-wide">Message</label>
                  <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5}
                    placeholder="Please describe your issue in as much detail as possible…"
                    className={`${iCls} resize-none`} />
                </div>
                <button onClick={handleSend} disabled={!message.trim() || sending}
                  className="w-full py-3.5 rounded-xl bg-[#1ABC9C] hover:bg-[#16a085] text-white font-bold text-[15px] disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                  {sending
                    ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Sending…</>
                    : <><Mail size={14} /> Send Message</>}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar info */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={18} className="text-[#1ABC9C]" />
              <p className="text-white font-bold text-base">Response Times</p>
            </div>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Email Support</span>
                <span className="text-white font-medium">Within 24h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Urgent (flight today)</span>
                <span className="text-[#1ABC9C] font-medium">1–2 hours</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Refund Processing</span>
                <span className="text-white font-medium">5–10 days</span>
              </div>
            </div>
          </div>

          <WhatsAppUrgentSupport defaultName={user?.name || undefined} defaultEmail={user?.email || undefined} />

          <div className="bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Headphones size={18} className="text-[#1ABC9C]" />
              <p className="text-white font-bold text-base">Direct Contact</p>
            </div>
            <div className="space-y-2">
              <a href="tel:+19453695543" className="flex items-center gap-2 text-[#1ABC9C] font-bold text-sm hover:underline">
                <Phone size={14} />
                +1 (945) 369-5543
              </a>
              <a href="mailto:support@faremind.ai" className="flex items-center gap-2 text-[#1ABC9C] font-bold text-sm hover:underline">
                <Mail size={14} />
                support@faremind.ai
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="mt-6 bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
        <p className="text-white font-bold text-base mb-1">Frequently Asked Questions</p>
        <p className="text-slate-500 text-sm mb-4">Quick answers to common questions</p>
        <div>
          {FAQ.map((item, i) => <FaqItem key={i} q={item.q} a={item.a} />)}
        </div>
      </div>
    </div>
  );
}
