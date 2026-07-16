'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2, AlertCircle, Check, Plane, Printer, User, Calendar } from 'lucide-react';
import { useManageBookingStore } from '@/store/useManageBookingStore';

// ── Seat Map Modal ──
export function SeatMapModal({ bookingId, onClose, provider }: { bookingId: string; onClose: () => void; provider?: string }) {
  const { seatMaps, seatMapLoading, loadSeatMap, selectSeat } = useManageBookingStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Duffel does NOT support post-booking seat changes
  const isDuffel = (provider || '').toLowerCase() === 'duffel';

  useEffect(() => { if (!isDuffel) loadSeatMap(bookingId, 'slice_0'); }, [bookingId, isDuffel]);
  const seatMap = seatMaps[0];
  const colorMap: Record<string, string> = {
    window: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
    aisle: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
    middle: 'bg-amber-500/20 border-amber-500/30 text-amber-400',
  };
  async function handleConfirm() {
    if (!selected) return;
    setSaving(true);
    await selectSeat(bookingId, { passengerId: 'pax_0', seatDesignator: selected, segmentId: 'seg_0' });
    setSaving(false);
    setDone(true);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg max-h-[80vh] bg-[#0f1525] border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
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
                    <span>Use the airline's online check-in (usually available 24-48hrs before departure)</span>
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
              {/* Provider notice */}
              <div className="mb-4 p-3 rounded-xl bg-amber-500/5 border border-amber-500/10 text-xs text-amber-400/70">
                <AlertCircle size={12} className="inline mr-1.5 -mt-0.5" />
                Seat assignments are subject to airline availability and confirmation. Post-booking changes may require airline assistance.
              </div>
              {done ? (
                <div className="text-center py-8">
                  <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3"><Check size={28} className="text-emerald-400" /></div>
                  <p className="text-white font-bold mb-1">Seat Request Submitted</p>
                  <p className="text-slate-400 text-sm mb-1">Requested: <strong className="text-[#1ABC9C]">{selected}</strong></p>
                  <p className="text-slate-500 text-xs mb-4">Status: Pending Airline Confirmation</p>
                  <p className="text-slate-600 text-[11px] mb-4">You will receive an email once the airline confirms.</p>
                  <button onClick={onClose} className="px-6 py-2.5 rounded-xl bg-[#1ABC9C] text-white font-semibold text-sm">Done</button>
                </div>
              ) : seatMapLoading ? <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-[#1ABC9C] animate-spin" /></div>
                : seatMap ? (
                  <div className="space-y-1">
                    <div className="flex justify-center gap-4 mb-4 text-[10px]">
                      {Object.entries(colorMap).map(([type, cls]) => (
                        <span key={type} className="flex items-center gap-1.5">
                          <span className={`w-4 h-4 rounded border ${cls}`} />
                          <span className="text-slate-400 capitalize">{type}</span>
                        </span>
                      ))}
                      <span className="flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded bg-slate-800 border border-slate-700" />
                        <span className="text-slate-400">Taken</span>
                      </span>
                    </div>
                    {seatMap.rows.slice(0, 25).map(row => (
                      <div key={row.row} className="flex items-center gap-1 justify-center">
                        <span className="w-6 text-right text-[10px] text-slate-600 mr-1">{row.row}</span>
                        {row.seats.map((seat, si) => (
                          <span key={seat.designator}>
                            {si === 3 && <span className="w-4 inline-block" />}
                            <button disabled={!seat.available} onClick={() => setSelected(seat.designator)}
                              className={`w-7 h-7 rounded text-[9px] font-bold border transition-all ${!seat.available
                                ? 'bg-slate-800 border-slate-700 text-slate-700 cursor-not-allowed'
                                : selected === seat.designator
                                  ? 'bg-[#1ABC9C] border-[#1ABC9C] text-white scale-110'
                                  : colorMap[seat.type] || 'bg-slate-700/30 border-slate-600 text-slate-500 hover:border-[#1ABC9C]/50'}`}>
                              {seat.designator.slice(-1)}
                            </button>
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-slate-500 text-center py-8">Seat map unavailable for this flight.</p>}
            </>
          )}
        </div>
        {selected && !done && !isDuffel && (
          <div className="p-5 border-t border-white/[0.06] flex items-center justify-between">
            <p className="text-white text-sm">Seat <strong className="text-[#1ABC9C]">{selected}</strong></p>
            <button onClick={handleConfirm} disabled={saving} className="px-5 py-2.5 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm disabled:opacity-50">
              {saving ? 'Submitting…' : 'Confirm Seat Request'}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Passenger Modal ──
export function PassengerModal({ bookingId, passengers, onClose }: { bookingId: string; passengers: any[]; onClose: () => void }) {
  const { updatePassenger } = useManageBookingStore();
  const [paxIdx, setPaxIdx] = useState(0);
  const pax = passengers[paxIdx] || {};
  const [form, setForm] = useState({ phone: pax.phone || '', email: pax.email || '', nationality: pax.nationality || '' });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { const p = passengers[paxIdx] || {}; setForm({ phone: p.phone || '', email: p.email || '', nationality: p.nationality || '' }); setDone(false); }, [paxIdx, passengers]);
  async function handleSave() {
    setSaving(true);
    const updates: Record<string, string> = {};
    if (form.phone !== (pax.phone || '')) updates.phone = form.phone;
    if (form.email !== (pax.email || '')) updates.email = form.email;
    if (form.nationality !== (pax.nationality || '')) updates.nationality = form.nationality;
    if (Object.keys(updates).length > 0) await updatePassenger(bookingId, pax.id, updates);
    setSaving(false); setDone(true); setTimeout(() => setDone(false), 1500);
  }
  const iCls = 'w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-[#0f1525] border border-white/10 rounded-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-white font-bold">Passenger Details</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>
        {passengers.length > 1 && (
          <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide">
            {passengers.map((p: any, i: number) => (
              <button key={p.id} onClick={() => setPaxIdx(i)} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${paxIdx === i ? 'bg-[#1ABC9C] text-white' : 'bg-white/[0.06] text-slate-400 hover:text-white'}`}>
                {p.firstName} {p.lastName}
              </button>
            ))}
          </div>
        )}
        {done ? (
          <div className="text-center py-6"><Check size={28} className="text-emerald-400 mx-auto mb-2" /><p className="text-white font-bold">Saved!</p></div>
        ) : (
          <div className="space-y-3">
            <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Name (not editable)</label>
              <input disabled value={`${pax.firstName || ''} ${pax.lastName || ''}`} className={`${iCls} opacity-40 cursor-not-allowed`} /></div>
            <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Email</label>
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={iCls} /></div>
            <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Phone</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={iCls} /></div>
            <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Nationality</label>
              <input value={form.nationality} onChange={e => setForm(f => ({ ...f, nationality: e.target.value }))} className={iCls} /></div>
            <button onClick={handleSave} disabled={saving} className="w-full py-3 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm disabled:opacity-50 mt-2">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Date Change Modal (Mystifly PTR ReIssue + Duffel unified) ──
export function DateChangeModal({ bookingId, booking, onClose }: { bookingId: string; booking: any; onClose: () => void }) {
  const {
    changeOffers, changeSearchLoading, changeSearchError,
    changeConfirmLoading, changeConfirmError, changeConfirmResult,
    searchChangeOptions, confirmChangeOption, resetChangeState,
    loadTimeline, loadActions,
  } = useManageBookingStore();
  const isRT = (booking.tripType || '').toLowerCase().includes('round');
  const [depDate, setDepDate] = useState('');
  const [step, setStep] = useState<'date' | 'offers' | 'review' | 'done'>('date');
  const [selectedOffer, setSelectedOffer] = useState<any>(null);
  const today = new Date().toISOString().split('T')[0];
  const iCls = 'w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all [color-scheme:dark] date-icon-orange';
  const fmt = (n: number, c = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);
  const fmtTime = (dt: string) => { try { return new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); } catch { return ''; } };
  const fmtDate = (dt: string) => { try { return new Date(dt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); } catch { return dt; } };

  useEffect(() => { resetChangeState(); }, []);
  useEffect(() => { if (changeConfirmResult?.success) { setStep('done'); loadTimeline(bookingId); loadActions(bookingId); } }, [changeConfirmResult]);

  async function handleSearch() {
    if (!depDate) return;
    const ok = await searchChangeOptions(bookingId, depDate, 0);
    if (ok) {
      setStep('offers');
    } else {
      // Automated search failed — submit a manual change request
      const { requestDateChange } = useManageBookingStore.getState();
      await requestDateChange(bookingId, depDate, undefined, 'Automated search unavailable — submitted via fallback').catch(() => {});
    }
  }

  async function handleConfirm() {
    if (!selectedOffer) return;
    await confirmChangeOption(bookingId, selectedOffer.id, selectedOffer.changeTotalAmount > 0 ? selectedOffer.changeTotalAmount : undefined, selectedOffer.changeTotalCurrency);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-[#0f1525] border border-white/10 rounded-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-white font-bold text-lg">Change Flight</h3>
            <span className="text-[10px] text-amber-400/80 font-medium">Subject to airline fare rules</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
        </div>

        {/* ── Step: Done ── */}
        {step === 'done' ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3"><Check size={28} className="text-emerald-400" /></div>
            <p className="text-white font-bold mb-1">{changeConfirmResult?.changeId ? 'Flight Changed Successfully' : 'Request Submitted'}</p>
            <p className="text-slate-400 text-sm mb-4">{changeConfirmResult?.message || 'Your itinerary has been updated.'}</p>
            {changeConfirmResult?.newTotalAmount > 0 && (
              <p className="text-[#1ABC9C] text-sm font-semibold mb-3">
                New booking total: {fmt(changeConfirmResult.newTotalAmount, changeConfirmResult.newTotalCurrency)}
              </p>
            )}
            <button onClick={onClose} className="px-6 py-2.5 rounded-xl bg-[#1ABC9C] text-white font-semibold text-sm">Done</button>
          </div>

        /* ── Step: Review (selected offer breakdown) ── */
        ) : step === 'review' && selectedOffer ? (
          <div className="space-y-4">
            {/* Itinerary comparison */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/[0.05]">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Review Your Flight Change</p>
              </div>
              <div className="px-4 py-3 space-y-3">
                {/* Current flight */}
                <div>
                  <p className="text-[9px] text-red-400 uppercase font-bold tracking-wider mb-1">Current Flight</p>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold text-sm">{booking.originAirport} → {booking.destinationAirport}</span>
                    <span className="text-slate-500 text-xs">·</span>
                    <span className="text-slate-400 text-xs">{fmtDate(booking.departureDate)}</span>
                  </div>
                </div>
                {/* New flight */}
                <div>
                  <p className="text-[9px] text-[#1ABC9C] uppercase font-bold tracking-wider mb-1">New Flight</p>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold text-sm">
                      {selectedOffer.newItinerary?.origin || booking.originAirport} → {selectedOffer.newItinerary?.destination || booking.destinationAirport}
                    </span>
                    <span className="text-slate-500 text-xs">·</span>
                    <span className="text-[#1ABC9C] text-xs font-medium">{fmtDate(depDate)}</span>
                  </div>
                  {(selectedOffer.newItinerary?.flightNumber || selectedOffer.newItinerary?.airline) && (
                    <p className="text-slate-500 text-xs mt-0.5">
                      {selectedOffer.newItinerary.airlineCode}{selectedOffer.newItinerary.flightNumber}
                      {selectedOffer.newItinerary.airline ? ` · ${selectedOffer.newItinerary.airline}` : ''}
                      {selectedOffer.newItinerary.departureDateTime && selectedOffer.newItinerary.departureDateTime !== `${depDate}T00:00:00`
                        ? ` · ${fmtTime(selectedOffer.newItinerary.departureDateTime)}`
                        : ''}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Fee breakdown */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/[0.05]">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Price Breakdown</p>
              </div>
              <div className="px-4 py-3 space-y-2 text-sm">
                {(selectedOffer.fareDifference ?? 0) !== 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Difference in ticket price</span>
                    <span className={`font-medium ${selectedOffer.fareDifference > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {selectedOffer.fareDifference > 0 ? '+' : ''}{fmt(selectedOffer.fareDifference, selectedOffer.changeTotalCurrency)}
                    </span>
                  </div>
                )}
                {(selectedOffer.taxDifference ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Taxes & other charges</span>
                    <span className="text-amber-400 font-medium">+{fmt(selectedOffer.taxDifference, selectedOffer.changeTotalCurrency)}</span>
                  </div>
                )}
                {(selectedOffer.airlineChangeFee ?? selectedOffer.penaltyAmount ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Airline change fee</span>
                    <span className="text-red-400 font-medium">+{fmt(selectedOffer.airlineChangeFee ?? selectedOffer.penaltyAmount, selectedOffer.changeTotalCurrency)}</span>
                  </div>
                )}
                {(selectedOffer.supplierFee ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Supplier fee</span>
                    <span className="text-red-400 font-medium">+{fmt(selectedOffer.supplierFee, selectedOffer.changeTotalCurrency)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-white/[0.05]">
                  <span className="text-white font-bold">
                    {selectedOffer.changeTotalAmount > 0 ? 'Amount to pay' : selectedOffer.changeTotalAmount < 0 ? 'Remaining ticket value' : 'No additional cost'}
                  </span>
                  <span className={`font-black text-lg ${selectedOffer.changeTotalAmount > 0 ? 'text-amber-400' : selectedOffer.changeTotalAmount < 0 ? 'text-emerald-400' : 'text-[#1ABC9C]'}`}>
                    {selectedOffer.changeTotalAmount !== 0
                      ? `${selectedOffer.changeTotalAmount > 0 ? '' : ''}${fmt(Math.abs(selectedOffer.changeTotalAmount), selectedOffer.changeTotalCurrency)}`
                      : '$0'}
                  </span>
                </div>
              </div>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2">
              <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-amber-200/70 text-xs">This action cannot be undone. Your current flight will be replaced.</p>
            </div>

            {changeConfirmError && (
              <div className="flex items-start gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>The airline could not process this change. Please contact FareMind Support.</span>
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3">
              <button onClick={() => { setStep('offers'); }} className="flex-1 py-3 rounded-xl border border-white/10 text-slate-400 font-semibold text-sm hover:bg-white/[0.04]">Back</button>
              <button onClick={handleConfirm} disabled={changeConfirmLoading}
                className="flex-1 py-3 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-bold text-sm disabled:opacity-50 transition-all">
                {changeConfirmLoading ? <Loader2 size={16} className="animate-spin mx-auto" /> : (
                  selectedOffer.changeTotalAmount > 0
                    ? `Confirm & Pay ${fmt(selectedOffer.changeTotalAmount, selectedOffer.changeTotalCurrency)}`
                    : 'Confirm Flight Change'
                )}
              </button>
            </div>
          </div>

        /* ── Step: Offers ── */
        ) : step === 'offers' ? (
          <div className="space-y-4">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 text-sm text-slate-400">
              Current: <span className="text-white font-medium">{booking.originAirport} → {booking.destinationAirport}</span>
              {' · '}Searching for: <span className="text-[#1ABC9C] font-medium">{fmtDate(depDate)}</span>
            </div>
            {changeOffers.length === 0 ? (
              <div className="text-center py-6">
                <AlertCircle size={24} className="text-amber-400 mx-auto mb-2" />
                <p className="text-white font-bold text-sm mb-1">No Alternatives Found</p>
                <p className="text-slate-400 text-xs">The airline has no available change options for this date.</p>
                <button onClick={() => setStep('date')} className="mt-3 px-4 py-2 text-xs rounded-lg border border-white/10 text-slate-400 hover:text-white">Try Another Date</button>
              </div>
            ) : (
              <>
                <p className="text-slate-500 text-xs">{changeOffers.length} option{changeOffers.length > 1 ? 's' : ''} from airline</p>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {changeOffers.map((o: any) => (
                    <button key={o.id} onClick={() => setSelectedOffer(o)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${selectedOffer?.id === o.id ? 'border-[#1ABC9C] bg-[#1ABC9C]/5' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/10'}`}>
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-white text-sm font-semibold">
                            {o.newItinerary?.departureDateTime && o.newItinerary.departureDateTime !== `${depDate}T00:00:00`
                              ? `${fmtDate(o.newItinerary.departureDateTime)} · ${fmtTime(o.newItinerary.departureDateTime)}`
                              : fmtDate(depDate)}
                          </p>
                          <p className="text-slate-500 text-xs">
                            {o.newItinerary?.airlineCode && o.newItinerary?.flightNumber
                              ? `${o.newItinerary.airlineCode}${o.newItinerary.flightNumber}`
                              : o.newSlices?.[0]?.segments?.map((s: any) => `${s.marketing_carrier?.iata_code || ''}${s.marketing_carrier_flight_number || ''}`).join(' → ')
                              || 'Flight details'}
                            {o.newItinerary?.airline ? ` · ${o.newItinerary.airline}` : ''}
                          </p>
                        </div>
                        <div className="text-right">
                          {o.changeTotalAmount !== 0 && (
                            <p className={`text-sm font-bold ${o.changeTotalAmount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                              {o.changeTotalAmount > 0 ? '+' : ''}{fmt(o.changeTotalAmount, o.changeTotalCurrency)}
                            </p>
                          )}
                          {o.changeTotalAmount === 0 && <p className="text-sm font-bold text-[#1ABC9C]">No extra cost</p>}
                          {(o.airlineChangeFee ?? o.penaltyAmount ?? 0) > 0 && (
                            <p className="text-[10px] text-slate-500">Includes {fmt(o.airlineChangeFee ?? o.penaltyAmount, o.penaltyCurrency)} change fee</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-slate-600 text-xs">Select an option and review the full price breakdown.</p>
                <div className="flex gap-3">
                  <button onClick={() => { setStep('date'); setSelectedOffer(null); }} className="flex-1 py-3 rounded-xl border border-white/10 text-slate-400 font-semibold text-sm hover:bg-white/[0.04]">Back</button>
                  <button onClick={() => { if (selectedOffer) setStep('review'); }} disabled={!selectedOffer}
                    className="flex-1 py-3 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-bold text-sm disabled:opacity-50 transition-all">
                    Review Change
                  </button>
                </div>
              </>
            )}
          </div>

        /* ── Step: Date selection ── */
        ) : (
          <div className="space-y-4">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 text-sm text-slate-400">
              Current: <span className="text-white font-medium">{booking.originAirport} → {booking.destinationAirport}</span>
              {' · '}{new Date(booking.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">New Departure Date</label>
              <input type="date" value={depDate} onChange={e => setDepDate(e.target.value)} min={today} className={iCls} /></div>
            <p className="text-slate-600 text-xs">We'll search the airline for available alternatives and pricing.</p>
            {changeSearchError && <div className="flex items-start gap-2 text-amber-400 text-sm bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2.5"><AlertCircle size={14} className="shrink-0 mt-0.5" /><span>Please contact FareMind Support, and our team will review available options with the airline/provider.</span></div>}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-slate-400 font-semibold text-sm hover:bg-white/[0.04] transition-all">Cancel</button>
              <button onClick={handleSearch} disabled={!depDate || changeSearchLoading} className="flex-1 py-3 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-bold text-sm disabled:opacity-50 transition-all">
                {changeSearchLoading ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'Search Options'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── E-Ticket Modal ──
export function ETicketModal({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const { eticket, eticketLoading, eticketError, loadETicket } = useManageBookingStore();
  useEffect(() => { loadETicket(bookingId); }, [bookingId]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg max-h-[85vh] bg-[#0f1525] border border-white/10 rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
          <h3 className="text-white font-bold text-lg">E-Ticket</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/[0.04] transition-all"><Printer size={14} /> Print</button>
            <button onClick={onClose} className="text-slate-500 hover:text-white ml-1"><X size={18} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {eticketLoading && <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-[#1ABC9C] animate-spin" /></div>}
          {eticketError && <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-4 justify-center"><AlertCircle size={14} />{eticketError}</div>}
          {eticket && (
            <div className="space-y-5">
              <div className="bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-xl p-4">
                <div className="flex justify-between items-start">
                  <div><p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Booking Reference</p><p className="text-white font-black text-xl">{eticket.bookingReference}</p>
                    {eticket.masterPnr && <p className="text-slate-400 text-xs font-mono mt-0.5">Airline PNR: {eticket.masterPnr}</p>}</div>
                  <div className="text-right"><p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Passenger</p><p className="text-white font-semibold text-sm">{eticket.customerName}</p></div>
                </div>
              </div>
              {(eticket.journeys || []).map((j: any, i: number) => (
                <div key={i} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                  <p className="text-[10px] font-bold text-[#1ABC9C] uppercase tracking-wider mb-2">{j.direction === 'RETURN' ? 'Return' : 'Outbound'}</p>
                  <div className="flex items-center gap-4 mb-3">
                    <p className="text-white font-black text-2xl">{j.originAirport}</p>
                    <div className="flex-1 flex items-center gap-1.5"><div className="h-px flex-1 bg-white/10" /><Plane size={14} className="text-[#1ABC9C] rotate-90" /><div className="h-px flex-1 bg-white/10" /></div>
                    <p className="text-white font-black text-2xl">{j.destinationAirport}</p>
                  </div>
                  {(j.segments || []).map((s: any, si: number) => (
                    <div key={si} className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                      <span className="font-bold text-slate-300">{s.flightNumber}</span><span>{s.airlineName}</span>
                      {s.cabinClass && <span className="px-1.5 py-0.5 rounded bg-white/[0.04] capitalize">{s.cabinClass}</span>}
                    </div>
                  ))}
                </div>
              ))}
              <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Passengers & Tickets</p>
                <div className="space-y-2">{(eticket.passengers || []).map((p: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                    <div><p className="text-white text-sm font-semibold">{p.name}</p><p className="text-slate-500 text-xs capitalize">{(p.passengerType || 'adult').toLowerCase()}</p></div>
                    {p.ticketNumber && <span className="text-[10px] font-mono text-slate-400 bg-white/[0.04] px-2 py-1 rounded">{p.ticketNumber}</span>}
                  </div>
                ))}</div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Refund Status Modal ──
export function RefundModal({ booking, onClose }: { booking: any; onClose: () => void }) {
  const steps = ['Cancellation Received', 'Airline Processing', 'Refund Initiated', 'Refund Complete'];
  const currentStep = booking.bookingStatus === 'CANCELLED' ? 2 : 3;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-[#0f1525] border border-white/10 rounded-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5"><h3 className="text-white font-bold text-lg">Refund Status</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button></div>
        <div className="space-y-4">
          <div className="bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-xl p-4">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Booking Reference</p>
            <p className="text-white font-black">{booking.masterBookingReference || booking.masterPnr}</p>
          </div>
          <div className="space-y-3 py-2">{steps.map((step, i) => {
            const isDone = i < currentStep; const isCurrent = i === currentStep;
            return (<div key={step} className="flex items-center gap-3">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center border shrink-0 ${isDone ? 'bg-[#1ABC9C] border-[#1ABC9C]' : isCurrent ? 'border-[#1ABC9C] bg-[#1ABC9C]/10' : 'border-white/10 bg-white/[0.03]'}`}>
                {isDone ? <Check size={13} className="text-white" /> : <span className={`text-[10px] font-bold ${isCurrent ? 'text-[#1ABC9C]' : 'text-slate-600'}`}>{i + 1}</span>}
              </div>
              <p className={`text-sm font-medium ${isDone ? 'text-white' : isCurrent ? 'text-[#1ABC9C]' : 'text-slate-600'}`}>{step}</p>
              {isCurrent && <span className="ml-auto text-[10px] text-[#1ABC9C] font-bold uppercase tracking-wider animate-pulse">In Progress</span>}
            </div>);
          })}</div>
          <p className="text-slate-500 text-xs text-center">Refunds typically process within 5–10 business days.</p>
          <button onClick={onClose} className="w-full py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm font-semibold hover:bg-white/[0.04] transition-all">Close</button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Support Modal ──
export function SupportModal({ booking, onClose }: { booking: any; onClose: () => void }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const iCls = 'w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-[#0f1525] border border-white/10 rounded-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5"><h3 className="text-white font-bold text-lg">Contact Support</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button></div>
        {sent ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 flex items-center justify-center mx-auto mb-3"><Check size={28} className="text-[#1ABC9C]" /></div>
            <p className="text-white font-bold mb-1">Message Sent</p><p className="text-slate-400 text-sm mb-4">Our team will respond within 24 hours.</p>
            <button onClick={onClose} className="px-6 py-2.5 rounded-xl bg-[#1ABC9C] text-white font-semibold text-sm">Done</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2 text-sm text-slate-400">
              Booking: <span className="text-white font-medium font-mono">{booking.masterBookingReference || booking.masterPnr}</span>
            </div>
            <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Subject</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Refund inquiry" className={iCls} /></div>
            <div><label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Message</label>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} placeholder="Describe your issue…" className={`${iCls} resize-none`} /></div>
            <button onClick={() => { if (message.trim()) setSent(true); }} disabled={!message.trim()} className="w-full py-3 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm disabled:opacity-40 transition-all">Send Message</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
