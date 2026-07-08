'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { Mail, MessageSquare, Clock, Check, ChevronDown, ChevronUp, Headphones, Phone } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import WhatsAppUrgentSupport from '@/components/support/WhatsAppUrgentSupport';

const FAQ = [
  {
    q: 'How do I cancel my booking?',
    a: 'Go to My Trips, open your booking, and click "Cancel Booking" in the Actions panel. You\'ll see the estimated refund before confirming.',
  },
  {
    q: 'When will I receive my refund?',
    a: 'Refunds are processed to your original payment method within 5–10 business days after cancellation is confirmed.',
  },
  {
    q: 'Can I change my flight dates?',
    a: 'Yes — open your booking and click "Change Flight Date". Date changes are subject to airline fare rules and availability fees.',
  },
  {
    q: 'How do I get my e-ticket?',
    a: 'Open your booking detail page and click "Download E-Ticket". You can also re-send your itinerary to your email from the same page.',
  },
  {
    q: 'How do I update passenger details?',
    a: 'Open your booking and click "Update Passenger". You can edit contact information. Name changes require airline approval.',
  },
  {
    q: 'Why isn\'t my booking showing up?',
    a: 'Make sure you\'re logged in with the same email used to book. If the booking was made as a guest, use the Manage Booking page instead.',
  },
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

export default function SupportPage() {
  const { user } = useAuthStore();
  const [subject, setSubject] = useState('');
  const [bookingRef, setBookingRef] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [ticketNumber, setTicketNumber] = useState('');
  const [error, setError] = useState('');

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
          name: user?.name || 'Customer',
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
    <div>
      <h1 className="text-2xl font-black text-white mb-6">Help & Support</h1>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Contact Form */}
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
                <p className="text-slate-500 text-xs mt-2">Please save your ticket number for future reference.</p>
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

        {/* Sidebar info + FAQ */}
        <div className="lg:col-span-2 space-y-4">
          {/* Response time */}
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

          {/* WhatsApp Urgent Support */}
          <WhatsAppUrgentSupport defaultName={user?.name || undefined} defaultEmail={user?.email || undefined} />

          {/* Direct Contact */}
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
