'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Plane, ArrowLeft, Loader2, AlertCircle, User, MapPin, Calendar, ChevronDown, ChevronUp, X, Check, XCircle, Luggage, CreditCard, Ticket, Mail, Download, Printer, Shield, RefreshCw } from 'lucide-react';
import { useManageBookingStore } from '@/store/useManageBookingStore';
import { useAuthStore } from '@/store/useAuthStore';
import CancelBookingModal from '@/components/manage-booking/CancelBookingModal';
import { DateChangeModal } from '@/components/manage-booking/BookingModals';
import { generateItineraryHtmlFromBooking } from '@/lib/fare-utils';
import { apiFetch } from '@/lib/api-client';
import { canAddBaggage } from '@/lib/booking-capabilities';
function StatusBadge({ status }: { status: string }) {
  const m: Record<string, [string, string]> = { CONFIRMED: ['bg-emerald-500/10 text-emerald-400', 'Confirmed'], TICKETED: ['bg-emerald-500/10 text-emerald-400', 'Ticketed'], CANCELLED: ['bg-red-500/10 text-red-400', 'Cancelled'], CREATED: ['bg-amber-500/10 text-amber-400', 'Processing'], COMPLETED: ['bg-blue-500/10 text-blue-400', 'Completed'] };
  const [cls, label] = m[status] || ['bg-slate-500/10 text-slate-400', status];
  return <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${cls}`}>{label}</span>;
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 ${className}`}>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">{children}</p>;
}

// Seat Map Modal (provider-aware)
function SeatMapModal({ bookingId, onClose, provider }: { bookingId: string; onClose: () => void; provider?: string }) {
  const { seatMaps, seatMapLoading, loadSeatMap, selectSeat } = useManageBookingStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);

  // Duffel does NOT support post-booking seat changes
  const isDuffel = (provider || '').toLowerCase() === 'duffel';

  useEffect(() => { if (!isDuffel) loadSeatMap(bookingId, 'slice_0'); }, [bookingId, loadSeatMap, isDuffel]);
  const seatMap = seatMaps[0];
  const colorMap: Record<string, string> = { window: 'bg-blue-500/20 border-blue-500/30 text-blue-400', aisle: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400', middle: 'bg-amber-500/20 border-amber-500/30 text-amber-400' };
  async function handleConfirm() {
    if (!selected) return;
    setSelecting(true);
    await selectSeat(bookingId, { passengerId: 'pax_0', seatDesignator: selected, segmentId: 'seg_0' });
    setSelecting(false); onClose();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-lg max-h-[80vh] bg-slate-900 border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
          <div>
            <h3 className="text-white font-bold text-lg">Change Seat</h3>
            {!isDuffel && <span className="text-[10px] text-amber-400/80 font-medium">If airline permits</span>}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {isDuffel ? (
            /* ── Duffel: Contact Airline Message ── */
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={28} className="text-amber-400" />
              </div>
              <p className="text-white font-bold text-lg mb-2">Post-Booking Seat Changes Unavailable</p>
              <p className="text-slate-400 text-sm mb-4 max-w-sm mx-auto">
                Your booking was made through Duffel (NDC), which does not support online seat changes after booking.
              </p>
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-4 text-left">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-2">How to change your seat</p>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex items-start gap-2">
                    <span className="text-[#1ABC9C] font-bold mt-0.5">1.</span>
                    <span>Contact the airline directly via their website or customer service</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#1ABC9C] font-bold mt-0.5">2.</span>
                    <span>Use the airline&apos;s online check-in (usually available 24-48hrs before departure)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#1ABC9C] font-bold mt-0.5">3.</span>
                    <span>Request a seat change at the airport check-in counter</span>
                  </li>
                </ul>
              </div>
              <p className="text-slate-600 text-xs mb-5">Your original seat selection (if any) was confirmed at the time of booking.</p>
              <button onClick={onClose} className="px-6 py-2.5 rounded-xl bg-[#1ABC9C] text-white font-semibold text-sm">Got it</button>
            </div>
          ) : (
            <>
              {seatMapLoading ? <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-[#1ABC9C] animate-spin" /></div> : seatMap ? (
                <div className="space-y-1">
                  {seatMap.rows.slice(0, 25).map(row => (
                    <div key={row.row} className="flex items-center gap-1 justify-center">
                      <span className="w-6 text-right text-[10px] text-slate-600 mr-1">{row.row}</span>
                      {row.seats.map((seat, si) => (
                        <span key={seat.designator}>
                          {si === 3 && <span className="w-4 inline-block" />}
                          <button disabled={!seat.available} onClick={() => setSelected(seat.designator)}
                            className={`w-7 h-7 rounded text-[9px] font-bold border transition-all ${!seat.available ? 'bg-slate-800 border-slate-700 text-slate-700 cursor-not-allowed' : selected === seat.designator ? 'bg-[#1ABC9C] border-[#1ABC9C] text-white scale-110' : colorMap[seat.type] || 'bg-slate-700/30 border-slate-600 text-slate-500 hover:border-[#1ABC9C]/50'}`}>
                            {seat.designator.slice(-1)}
                          </button>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              ) : <p className="text-slate-500 text-center py-8">Seat map not available</p>}
            </>
          )}
        </div>
        {selected && !isDuffel && (
          <div className="p-5 border-t border-white/[0.06] flex items-center justify-between">
            <p className="text-white text-sm">Seat <strong className="text-[#1ABC9C]">{selected}</strong></p>
            <button onClick={handleConfirm} disabled={selecting} className="px-5 py-2.5 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm disabled:opacity-50">{selecting ? 'Saving…' : 'Confirm Seat'}</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// Passenger Update Modal
function PassengerModal({ bookingId, passengers, onClose }: { bookingId: string; passengers: any[]; onClose: () => void }) {
  const { updatePassenger } = useManageBookingStore();
  const [pax] = useState(passengers[0] || {});
  const [form, setForm] = useState({ 
    phone: pax.phone || '', 
    email: pax.email || '', 
    nationality: pax.nationality || '',
    passportNumber: pax.passportNumber || '',
    passportExpiry: pax.passportExpiry ? new Date(pax.passportExpiry).toISOString().split('T')[0] : '',
    passportCountry: pax.passportCountry || ''
  });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  async function handleSave() {
    setSaving(true);
    const updates: Record<string, string> = {};
    if (form.phone !== (pax.phone || '')) updates.phone = form.phone;
    if (form.email !== (pax.email || '')) updates.email = form.email;
    if (form.nationality !== (pax.nationality || '')) updates.nationality = form.nationality;
    if (form.passportNumber !== (pax.passportNumber || '')) updates.passportNumber = form.passportNumber;
    if (form.passportCountry !== (pax.passportCountry || '')) updates.passportCountry = form.passportCountry;
    
    const existingExpiry = pax.passportExpiry ? new Date(pax.passportExpiry).toISOString().split('T')[0] : '';
    if (form.passportExpiry !== existingExpiry) {
      if (form.passportExpiry) {
        updates.passportExpiry = new Date(form.passportExpiry).toISOString();
      } else {
        updates.passportExpiry = null as any;
      }
    }

    if (Object.keys(updates).length > 0) await updatePassenger(bookingId, pax.id, updates);
    setSaving(false); setDone(true);
    setTimeout(onClose, 1000);
  }
  const iCls = 'w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all [color-scheme:dark]';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-white font-bold">Update Passenger</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>
        {done ? (
          <div className="text-center py-6"><Check size={28} className="text-emerald-400 mx-auto mb-2" /><p className="text-white font-bold">Updated!</p></div>
        ) : (
          <div className="space-y-4">
            <div><p className="text-white font-semibold text-sm mb-3">{pax.firstName} {pax.lastName}</p></div>
            <div className="grid gap-3">
              <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Name</label><input disabled value={`${pax.firstName} ${pax.lastName}`} className={`${iCls} opacity-50 cursor-not-allowed`} /></div>
              <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Email</label><input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={iCls} /></div>
              <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Phone</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={iCls} /></div>
              <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Nationality</label><input value={form.nationality} onChange={e => setForm(f => ({ ...f, nationality: e.target.value }))} className={iCls} /></div>
              <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Passport Number</label><input value={form.passportNumber} onChange={e => setForm(f => ({ ...f, passportNumber: e.target.value }))} className={iCls} /></div>
              <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Passport Expiry</label><input type="date" value={form.passportExpiry} onChange={e => setForm(f => ({ ...f, passportExpiry: e.target.value }))} className={`${iCls} date-icon-orange`} /></div>
              <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Issuing Country</label><input value={form.passportCountry} onChange={e => setForm(f => ({ ...f, passportCountry: e.target.value }))} className={iCls} /></div>
            </div>
            <p className="text-xs text-slate-500 italic">* Identity fields cannot be edited after booking.</p>
            <button onClick={handleSave} disabled={saving} className="w-full py-3 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// DateChangeModal is now imported from '@/components/manage-booking/BookingModals'
// which supports Mystifly PTR ReIssue + Duffel unified flow

// E-Ticket Modal
function ETicketModal({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const { eticket, eticketLoading, eticketError, loadETicket } = useManageBookingStore();
  useEffect(() => { loadETicket(bookingId); }, [bookingId, loadETicket]);

  function handlePrint() { window.print(); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-lg max-h-[85vh] bg-slate-900 border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
          <h3 className="text-white font-bold text-lg">E-Ticket</h3>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/[0.04] transition-all">
              <Printer size={14} /> Print
            </button>
            <button onClick={onClose} className="text-slate-500 hover:text-white ml-1"><X size={18} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {eticketLoading && <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-[#1ABC9C] animate-spin" /></div>}
          {eticketError && <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-4 justify-center"><AlertCircle size={14} />{eticketError}</div>}
          {eticket && (
            <div className="space-y-5">
              {/* Header */}
              <div className="bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-xl p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Booking Reference</p>
                    <p className="text-white font-black text-xl">{eticket.bookingReference}</p>
                    {eticket.masterPnr && <p className="text-slate-400 text-xs font-mono mt-0.5">Airline PNR: {eticket.masterPnr}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Passenger</p>
                    <p className="text-white font-semibold text-sm">{eticket.customerName}</p>
                    <p className="text-slate-400 text-xs">{eticket.customerEmail}</p>
                  </div>
                </div>
              </div>
              {/* Journeys */}
              {(eticket.journeys || []).map((j: any, i: number) => (
                <div key={i} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                  <p className="text-[10px] font-bold text-[#1ABC9C] uppercase tracking-wider mb-2">{j.direction === 'RETURN' ? 'Return Flight' : 'Outbound Flight'}</p>
                  <div className="flex items-center gap-4 mb-3">
                    <div className="text-center"><p className="text-white font-black text-2xl">{j.originAirport}</p></div>
                    <div className="flex-1 flex items-center gap-1.5"><div className="h-px flex-1 bg-white/10" /><Plane size={14} className="text-[#1ABC9C] rotate-90" /><div className="h-px flex-1 bg-white/10" /></div>
                    <div className="text-center"><p className="text-white font-black text-2xl">{j.destinationAirport}</p></div>
                  </div>
                  <p className="text-slate-400 text-xs mb-2">{(j.departureDateTime || j.departureDate) ? new Date(j.departureDateTime || j.departureDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ''}</p>
                  {(j.segments || []).map((s: any, si: number) => (
                    <div key={si} className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                      <span className="font-bold text-slate-300">{s.flightNumber}</span>
                      <span>{s.airlineName}</span>
                      {s.aircraft && <span>· {s.aircraft}</span>}
                      {s.cabinClass && <span className="px-1.5 py-0.5 rounded bg-white/[0.04] capitalize">{s.cabinClass}</span>}
                    </div>
                  ))}
                </div>
              ))}
              {/* Passengers */}
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Passengers & Tickets</p>
                <div className="space-y-2">
                  {(eticket.passengers || []).map((p: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                      <div>
                        <p className="text-white text-sm font-semibold">{p.name}</p>
                        <p className="text-slate-500 text-xs capitalize">{(p.passengerType || 'adult').toLowerCase()}{p.seatNumber ? ` · Seat ${p.seatNumber}` : ''}</p>
                      </div>
                      {p.ticketNumber && <span className="text-[10px] font-mono text-slate-400 bg-white/[0.04] px-2 py-1 rounded">{p.ticketNumber}</span>}
                    </div>
                  ))}
                </div>
              </div>
              {/* PNRs */}
              {(eticket.pnrs || []).length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Airline PNRs</p>
                  <div className="flex flex-wrap gap-2">
                    {eticket.pnrs.map((p: any, i: number) => (
                      <div key={i} className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                        <span className="text-white font-mono font-bold text-sm">{p.pnrCode}</span>
                        <span className="text-slate-500 text-xs ml-1.5 capitalize">{p.provider}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-slate-600 text-xs text-center">Issued {eticket.issuedAt ? new Date(eticket.issuedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''} · FAREMIND Travel</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// Email Itinerary Modal
function EmailItineraryModal({ bookingId, booking, onClose }: { bookingId: string; booking: any; onClose: () => void }) {
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  
  const email = booking.customerEmail || 'your email';

  async function handleSend() {
    try {
      setSending(true);
      setError('');
      const htmlContent = generateItineraryHtmlFromBooking(booking);
      // Convert HTML to base64 for the email attachment
      const pdfBase64 = btoa(unescape(encodeURIComponent(htmlContent)));
      
      await apiFetch(`/api/manage-booking/${bookingId}/email-itinerary`, {
        method: 'POST',
        body: JSON.stringify({ email, pdfBase64, isHtml: true }),
      });
      setDone(true);
    } catch (err) {
      setError('Failed to send email. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-white font-bold text-lg">Email Itinerary</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>
        
        {done ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3"><Check size={28} className="text-emerald-400" /></div>
            <p className="text-white font-bold mb-1">Itinerary emailed successfully to {email}.</p>
            <button onClick={onClose} className="mt-4 px-6 py-2.5 rounded-xl bg-slate-800 text-white font-semibold text-sm hover:bg-slate-700">Close</button>
          </div>
        ) : (
          <div className="space-y-4 text-center py-2">
            <div className="w-16 h-16 rounded-full bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto">
              <Mail size={24} className="text-[#1ABC9C]" />
            </div>
            <p className="text-slate-300 text-sm">We will send the full itinerary to:</p>
            <p className="text-[#1ABC9C] font-bold text-lg">{email}</p>
            {error && <div className="flex items-center justify-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2"><AlertCircle size={14} />{error}</div>}
            
            <div className="flex gap-3 pt-2">
              <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-slate-400 font-semibold text-sm hover:bg-white/[0.04] transition-all">Cancel</button>
              <button onClick={handleSend} disabled={sending} className="flex-1 py-3 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm disabled:opacity-50 transition-all hover:bg-[#16a085]">
                {sending ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'Send Itinerary'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BookingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const bookingId = params.bookingId as string;
  const { booking, bookingLoading, loadBookingDetail, actions, loadActions, fareRules, timeline, loadTimeline, activeModal, setActiveModal, guestToken } = useManageBookingStore();
  const { user, loadSession } = useAuthStore();

  useEffect(() => { loadSession(); }, [loadSession]);

  useEffect(() => {
    const stored = localStorage.getItem('faremind_session');
    if (!stored && !guestToken) { router.replace('/manage-booking'); }
  }, [user, guestToken, router]);

  useEffect(() => { if (bookingId) { loadBookingDetail(bookingId); loadActions(bookingId); loadTimeline(bookingId); } }, [bookingId, loadBookingDetail, loadActions, loadTimeline]);

  useEffect(() => {
    if (activeModal === 'download_full_itinerary' && booking) {
      const html = generateItineraryHtmlFromBooking(booking);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FAREMIND-Itinerary-${booking.masterBookingReference || booking.masterPnr || 'booking'}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setActiveModal(null);
    }
  }, [activeModal, booking, setActiveModal]);

  if (bookingLoading || !booking) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pt-20 flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#1ABC9C] animate-spin" />
    </div>
  );

  const b = booking;
  const isCancelled = b.bookingStatus === 'CANCELLED';
  const isPast = new Date(b.departureDate) < new Date();
  const depDate = new Date(b.departureDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: b.currency || 'USD', maximumFractionDigits: 0 }).format(n);

  // Check refundability from fareRules OR PNR data
  const primaryPnr = b.pnrs?.find((p: any) => p.isPrimary) ?? b.pnrs?.[0];
  const isNonRefundable = fareRules ? !fareRules.refundable : (primaryPnr?.refundable === false);

  // ── Action configs ──
  const manageActions = isCancelled ? [
    { key: 'refund_status', label: 'View Refund Status', icon: CreditCard, color: 'text-blue-400 border-blue-400/20 bg-blue-400/5', hoverColor: 'hover:bg-blue-400/10' },
  ] : [
    { key: 'cancel', label: 'Cancel Booking', icon: XCircle, color: 'text-red-400 border-red-400/20 bg-red-400/5', hoverColor: 'hover:bg-red-400/10', hide: isPast, badge: isNonRefundable ? 'Non-refundable' : null, badgeColor: 'text-red-400' },
    { key: 'date_change', label: 'Change Flight', icon: Calendar, color: 'text-purple-400 border-purple-400/20 bg-purple-400/5', hoverColor: 'hover:bg-purple-400/10', hide: isPast, disabled: fareRules ? !fareRules.changeable : false, disabledReason: 'Not allowed per fare rules' },
    { key: 'seat_change', label: 'Change Seat', icon: Ticket, color: 'text-blue-400 border-blue-400/20 bg-blue-400/5', hoverColor: 'hover:bg-blue-400/10', hide: isPast, disabled: (b.primaryProvider || '').toLowerCase() === 'duffel', disabledReason: 'Not supported by airline' },
    { key: 'add_baggage', label: 'Add Baggage', icon: Luggage, color: 'text-orange-400 border-orange-400/20 bg-orange-400/5', hoverColor: 'hover:bg-orange-400/10', hide: isPast, disabled: !canAddBaggage(b), disabledReason: `Baggage changes for this booking are not available through FareMind. Please contact the airline directly using your airline PNR.${b.masterPnr || b.pnrs?.[0]?.pnrCode ? ` Airline PNR: ${b.masterPnr || b.pnrs?.[0]?.pnrCode}` : ''}` },
    { key: 'passenger_update', label: 'Update Passenger', icon: User, color: 'text-amber-400 border-amber-400/20 bg-amber-400/5', hoverColor: 'hover:bg-amber-400/10' },
  ].filter(a => !a.hide);

  const documentActions = [
    { key: 'download_eticket', label: 'Download E-Ticket', icon: Download, color: 'text-[#1ABC9C] border-[#1ABC9C]/20 bg-[#1ABC9C]/5', hoverColor: 'hover:bg-[#1ABC9C]/10', hide: b.ticketingStatus !== 'ISSUED' },
    { key: 'download_full_itinerary', label: 'Download Full Itinerary', icon: Download, color: 'text-indigo-400 border-indigo-400/20 bg-indigo-400/5', hoverColor: 'hover:bg-indigo-400/10' },
    { key: 'email_itinerary', label: 'Email Itinerary', icon: Mail, color: 'text-pink-400 border-pink-400/20 bg-pink-400/5', hoverColor: 'hover:bg-pink-400/10' },
  ].filter(a => !a.hide);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pt-20 pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Back */}
        <button onClick={() => router.push('/manage-booking')} className="flex items-center gap-2 text-slate-500 hover:text-white text-sm mb-5 transition-colors">
          <ArrowLeft size={16} /> Back to bookings
        </button>

        {/* ── Main Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
          {/* Left Column (Hero + Flight Details) */}
          <div className="lg:col-span-2 space-y-4">
            {/* ── Hero Header ── */}
        <Card className="mb-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex-1">
              {/* Row 1: Booking ref + Status + Airline PNR */}
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h1 className="text-2xl font-black text-white tracking-tight">{b.masterBookingReference || b.masterPnr}</h1>
                <StatusBadge status={b.bookingStatus} />
                {b.masterPnr && b.masterPnr !== b.masterBookingReference && (
                  <div className="h-5 w-px bg-white/10" />
                )}
                {b.masterPnr && b.masterPnr !== b.masterBookingReference && (
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-black font-mono tracking-wider uppercase">AIRLINE PNR</span>
                    <span className="text-[#1ABC9C] text-sm font-black font-mono tracking-wider">{b.masterPnr}</span>
                  </div>
                )}
              </div>

              {/* Row 2: Journey Legs */}
              {(b.journeys || []).length > 0 ? (
                <div className="space-y-3 mb-2">
                  {(b.journeys || []).map((j: any, ji: number) => {
                    const isReturn = j.direction === 'RETURN';
                    const depDt = j.departureDateTime || j.departureDate || b.departureDate;
                    const arrDt = j.arrivalDateTime || j.arrivalDate;
                    const fmtTime = (dt: string) => new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                    const fmtDateShort = (dt: string) => new Date(dt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                    const fmtDur = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
                    const stops = j.totalStops ?? 0;
                    const dur = j.totalDurationMinutes ?? 0;
                    const airline = j.segments?.[0]?.airlineName || j.segments?.[0]?.airlineCode || '';
                    const flightNo = j.segments?.[0]?.flightNumber || '';
                    const cabin = j.segments?.[0]?.cabin || '';

                    return (
                      <div key={j.id || ji} className={`rounded-xl border p-4 ${isReturn ? 'border-purple-500/20 bg-purple-500/[0.03]' : 'border-[#1ABC9C]/20 bg-[#1ABC9C]/[0.03]'} ${ji > 0 ? '' : ''}`}>
                        {/* Leg label */}
                        <div className="flex items-center gap-2 mb-3">
                          <div className={`w-2 h-2 rounded-full ${isReturn ? 'bg-purple-400' : 'bg-[#1ABC9C]'}`} />
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${isReturn ? 'text-purple-400' : 'text-[#1ABC9C]'}`}>
                            {isReturn ? 'Return' : 'Outbound'}
                          </span>
                          <span className="text-[10px] text-slate-500">{fmtDateShort(depDt)}</span>
                          {airline && <span className="text-[10px] text-slate-600">· {airline}</span>}
                          {flightNo && <span className="text-[10px] text-slate-600 font-mono">{flightNo}</span>}
                          {cabin && <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full">{cabin}</span>}
                        </div>

                        {/* Route row */}
                        <div className="flex items-center gap-3">
                          <div className="text-center min-w-0">
                            <p className="text-white font-black text-xl leading-none">{j.originAirport || b.originAirport}</p>
                            <p className="text-slate-500 text-[11px] mt-0.5">{j.originCity || b.originCity}</p>
                            {depDt && <p className="text-white font-semibold text-xs mt-1">{fmtTime(depDt)}</p>}
                          </div>

                          <div className="flex-1 flex flex-col items-center gap-0.5 px-2">
                            {dur > 0 && <span className="text-[10px] text-slate-500 font-semibold">{fmtDur(dur)}</span>}
                            <div className="flex items-center gap-1 w-full">
                              <div className={`h-px flex-1 ${isReturn ? 'bg-purple-400/20' : 'bg-[#1ABC9C]/20'}`} />
                              <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${isReturn ? 'bg-purple-400/15 border-purple-400/30' : 'bg-[#1ABC9C]/15 border-[#1ABC9C]/30'}`}>
                                <Plane size={10} className={isReturn ? 'text-purple-400 -rotate-90' : 'text-[#1ABC9C] rotate-90'} />
                              </div>
                              <div className={`h-px flex-1 ${isReturn ? 'bg-purple-400/20' : 'bg-[#1ABC9C]/20'}`} />
                            </div>
                            <span className="text-[9px] text-slate-600">{stops === 0 ? 'Nonstop' : stops === 1 ? '1 stop' : `${stops} stops`}</span>
                          </div>

                          <div className="text-center min-w-0">
                            <p className="text-white font-black text-xl leading-none">{j.destinationAirport || b.destinationAirport}</p>
                            <p className="text-slate-500 text-[11px] mt-0.5">{j.destinationCity || b.destinationCity}</p>
                            {arrDt && <p className="text-white font-semibold text-xs mt-1">{fmtTime(arrDt)}</p>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-white font-bold text-lg">{b.originAirport}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div className="h-px w-6 bg-white/15" />
                    <Plane size={14} className="text-[#1ABC9C] rotate-90" />
                    <div className="h-px w-6 bg-white/15" />
                  </div>
                  <span className="text-white font-bold text-lg">{b.destinationAirport}</span>
                </div>
              )}

              {/* Row 3: Meta info */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span>{b.customerName}</span>
                <span>·</span>
                <span className="capitalize">{(b.tripType || '').replace('_', ' ').toLowerCase()}</span>
                <span>·</span>
                <span className="capitalize">{b.primaryProvider}</span>
                {b.ticketingStatus && <><span>·</span><span className="capitalize">{(b.ticketingStatus || '').replace('_', ' ').toLowerCase()}</span></>}
                {b.createdAt && <><span>·</span><span>{new Date(b.createdAt).toLocaleString()}</span></>}
              </div>
            </div>

            {/* Right: Total and Statuses */}
            <div className="text-right shrink-0 flex flex-col items-end gap-3">
              <div className="flex flex-col items-end">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Total Paid</p>
                <p className="text-3xl font-black text-[#1ABC9C] leading-tight">{fmt(Number(b.totalAmount))}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">Booking</p>
                  <p className={`text-[13px] font-bold capitalize ${b.bookingStatus === 'CONFIRMED' ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {(b.bookingStatus || '').toLowerCase()}
                  </p>
                </div>
                <div className="w-px h-6 bg-white/[0.15]" />
                <div className="text-center">
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">Payment</p>
                  <p className={`text-[13px] font-bold capitalize ${b.paymentStatus === 'SUCCEEDED' ? 'text-amber-500' : 'text-slate-300'}`}>
                    {(b.paymentStatus || '').toLowerCase()}
                  </p>
                </div>
                <div className="w-px h-6 bg-white/[0.15]" />
                <div className="text-center">
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">Ticketing</p>
                  <p className={`text-[13px] font-bold capitalize ${b.ticketingStatus === 'ISSUED' ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {(b.ticketingStatus || '').toLowerCase()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>

            {/* Flight Itinerary */}
            {/* Flight Itinerary */}
            <Card>
              <SectionTitle>Flight Itinerary</SectionTitle>
              <div className="space-y-4">
                {(b.journeys || []).map((j: any, i: number) => (
                  <div key={j.id} className={i > 0 ? 'pt-4 border-t border-white/[0.06]' : ''}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[10px] font-bold text-[#1ABC9C] uppercase tracking-wider bg-[#1ABC9C]/10 px-2.5 py-0.5 rounded-full">
                        {j.direction === 'RETURN' ? 'Return' : 'Outbound'}
                      </span>
                      <span className="text-xs text-slate-500">{new Date(j.departureDateTime || j.departureDate || b.departureDate).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-center"><p className="text-white font-bold text-xl">{j.originAirport || b.originAirport}</p><p className="text-slate-500 text-[11px]">{j.originCity || b.originCity}</p></div>
                      <div className="flex-1 flex items-center gap-1.5"><div className="h-px flex-1 bg-white/10" /><Plane size={14} className="text-[#1ABC9C] rotate-90" /><div className="h-px flex-1 bg-white/10" /></div>
                      <div className="text-center"><p className="text-white font-bold text-xl">{j.destinationAirport || b.destinationAirport}</p><p className="text-slate-500 text-[11px]">{j.destinationCity || b.destinationCity}</p></div>
                    </div>
                    {(j.segments || []).map((seg: any) => (
                      <div key={seg.id} className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                        <span className="font-semibold text-slate-300">{seg.flightNumber || seg.marketingFlightNumber}</span>
                        <span>{seg.airlineName}</span>
                        {seg.aircraft && <span>· {seg.aircraft}</span>}
                        {seg.cabinClass && <span className="px-2 py-0.5 rounded bg-white/[0.04] text-slate-400 capitalize">{seg.cabinClass}</span>}
                      </div>
                    ))}
                  </div>
                ))}
                {(!b.journeys || b.journeys.length === 0) && (
                  <div className="flex items-center gap-4">
                    <div className="text-center"><p className="text-white font-bold text-xl">{b.originAirport}</p><p className="text-slate-500 text-[11px]">{b.originCity}</p></div>
                    <div className="flex-1 flex items-center gap-1.5"><div className="h-px flex-1 bg-white/10" /><Plane size={14} className="text-[#1ABC9C] rotate-90" /><div className="h-px flex-1 bg-white/10" /></div>
                    <div className="text-center"><p className="text-white font-bold text-xl">{b.destinationAirport}</p><p className="text-slate-500 text-[11px]">{b.destinationCity}</p></div>
                  </div>
                )}
              </div>
            </Card>

            {/* Passengers */}
            <Card>
              <SectionTitle>Passengers</SectionTitle>
              <div className="space-y-2">
                {(b.passengers || []).map((p: any) => (
                  <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                    <div className="w-8 h-8 rounded-lg bg-[#1ABC9C]/10 flex items-center justify-center"><span className="text-xs font-bold text-[#1ABC9C]">{p.firstName?.[0]}{p.lastName?.[0]}</span></div>
                    <div className="flex-1 min-w-0"><p className="text-white text-sm font-semibold">{p.firstName} {p.lastName}</p><p className="text-slate-500 text-xs capitalize">{p.passengerType || 'Adult'}</p></div>
                    {p.ticketNumber && <span className="text-[10px] text-slate-500 font-mono">{p.ticketNumber}</span>}
                  </div>
                ))}
              </div>
            </Card>

            {/* Need Help */}
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
              <div className="w-9 h-9 rounded-lg bg-slate-700/50 flex items-center justify-center shrink-0">
                <Mail size={16} className="text-slate-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold">Need help with your booking?</p>
                <p className="text-slate-500 text-[11px]">Our support team is available 24/7 to assist you.</p>
              </div>
              <a href="/support" className="px-4 py-2 rounded-lg border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/[0.04] transition-all shrink-0">
                Contact Support
              </a>
            </div>
          </div>

          {/* Right Column: Actions + Documents */}
          <div className="flex flex-col gap-4 h-full">
            {/* Manage Booking */}
            <Card>
              <SectionTitle>Manage Booking</SectionTitle>
              <div className="space-y-2">
                {manageActions.map(a => (
                  <button key={a.key} onClick={() => !a.disabled && setActiveModal(a.key)} disabled={a.disabled}
                    title={a.disabled ? a.disabledReason : undefined}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${a.disabled ? 'opacity-40 cursor-not-allowed border-white/[0.06] bg-white/[0.02]' : `${a.color} ${a.hoverColor}`}`}>
                    <a.icon size={16} /><span className="text-sm font-semibold">{a.label}</span>
                    {a.disabled && <span className="ml-auto text-[10px] text-slate-500 font-medium">Not allowed</span>}
                    {!a.disabled && a.badge && <span className={`ml-auto text-[10px] font-semibold ${a.badgeColor || 'text-slate-500'}`}>{a.badge}</span>}
                  </button>
                ))}
              </div>
            </Card>

            {/* Documents */}
            <Card className="flex-1 flex flex-col">
              <SectionTitle>Documents</SectionTitle>
              <div className="space-y-2">
                {documentActions.map(a => (
                  <button key={a.key} onClick={() => setActiveModal(a.key)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${a.color} ${a.hoverColor}`}>
                    <a.icon size={16} /><span className="text-sm font-semibold">{a.label}</span>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        </div>


      </div>

      {/* Modals */}
      <AnimatePresence>
        {activeModal === 'cancel' && <CancelBookingModal bookingId={bookingId} onClose={() => setActiveModal(null)} />}
        {activeModal === 'seat_change' && <SeatMapModal bookingId={bookingId} onClose={() => setActiveModal(null)} provider={b.primaryProvider} />}
        {activeModal === 'passenger_update' && <PassengerModal bookingId={bookingId} passengers={b.passengers || []} onClose={() => setActiveModal(null)} />}
        {activeModal === 'date_change' && <DateChangeModal bookingId={bookingId} booking={b} onClose={() => setActiveModal(null)} />}
        {activeModal === 'download_eticket' && <ETicketModal bookingId={bookingId} onClose={() => setActiveModal(null)} />}
        {activeModal === 'email_itinerary' && <EmailItineraryModal bookingId={bookingId} booking={b} onClose={() => setActiveModal(null)} />}
      </AnimatePresence>
    </div>
  );
}
