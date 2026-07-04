'use client';

import { useState, useEffect, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { apiUrl } from '@/lib/api-client';
import { DateChangeModal } from '@/components/manage-booking/BookingModals';

import {
  ArrowLeft,
  Plane,
  Users,
  CreditCard,
  Clock,
  Edit3,
  XCircle,
  Mail,
  RefreshCw,
  Check,
  AlertCircle,
  Info,
  Loader2,
  ChevronDown,
  ChevronUp,
  Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  TICKETED: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  CREATED: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  FAILED: 'bg-red-500/15 text-red-400 border-red-500/25',
  CANCELLED: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
  CANCEL_REQUESTED: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  PENDING: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  CAPTURED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
};

const EDITABLE_FIELDS = [
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'nationality', label: 'Nationality', type: 'text' },
  { key: 'passportNumber', label: 'Passport Number', type: 'text' },
  { key: 'passportExpiry', label: 'Passport Expiry', type: 'date' },
  { key: 'issuingCountry', label: 'Issuing Country', type: 'text' },
];

export default function AgentBookingDetailPage({ params }: { params: Promise<{ fbr: string }> }) {
  const { fbr } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { sessionToken } = useAuthStore();
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');
  const [editingPassenger, setEditingPassenger] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [eventsExpanded, setEventsExpanded] = useState(false);
  const [cancelQuote, setCancelQuote] = useState<any>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [cancelQuoteError, setCancelQuoteError] = useState<string | null>(null);
  const [cancelStep, setCancelStep] = useState<'review' | 'confirming' | 'success' | 'error'>('review');
  const [cancelSuccess, setCancelSuccess] = useState<any>(null);
  const [showDateChangeDialog, setShowDateChangeDialog] = useState(false);

  useEffect(() => {
    if (showCancelDialog && booking?.id) {
      setLoadingQuote(true);
      setCancelQuote(null);
      setCancelQuoteError(null);
      fetch(apiUrl(`/api/manage-booking/${booking.id}/cancel/quote`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
        .then(async (res) => {
          const data = await res.json();
          if (res.ok) {
            setCancelQuote(data);
          } else {
            setCancelQuoteError(data.error || 'Failed to load cancellation details.');
          }
        })
        .catch((err) => {
          console.error(err);
          setCancelQuoteError('Unable to connect to the cancellation service. Please try again later.');
        })
        .finally(() => setLoadingQuote(false));
    }
  }, [showCancelDialog, booking?.id]);

  useEffect(() => {
    if (!sessionToken) return;
    fetchBooking();
  }, [sessionToken, fbr]);

  async function fetchBooking() {
    setLoading(true);
    try {
      const res = await fetch(`/api/agent/bookings/${fbr}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBooking(data.booking);
      } else {
        setActionMsg({ type: 'error', text: 'Booking not found or access denied.' });
      }
    } catch {
      setActionMsg({ type: 'error', text: 'Failed to load booking.' });
    } finally {
      setLoading(false);
    }
  }

  async function handlePassengerUpdate(passengerId: string) {
    setSaving(true);
    setActionMsg(null);
    try {
      const res = await fetch('/api/agent/passenger-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ bookingReference: fbr, passengerId, updates: editValues }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg({ type: 'success', text: data.message || 'Passenger details saved.' });
        setEditingPassenger(null);
        fetchBooking();
      } else {
        setActionMsg({ type: 'error', text: data.error || 'Update failed.' });
      }
    } catch {
      setActionMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleCancellation() {
    if (!cancelQuote?.quoteId || !booking?.id) return;
    setSaving(true);
    setCancelStep('confirming');
    setActionMsg(null);
    try {
      const res = await fetch(apiUrl(`/api/manage-booking/${booking.id}/cancel/confirm`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: cancelQuote.quoteId, refundMethod: 'ORIGINAL_PAYMENT' }),
      });
      const data = await res.json();
      if (res.ok) {
        setCancelSuccess(data);
        setCancelStep('success');
        fetchBooking();
      } else {
        setCancelQuoteError(data.error || 'The airline could not process the cancellation. Please contact support.');
        setCancelStep('error');
      }
    } catch {
      setCancelQuoteError('Network error. Please try again.');
      setCancelStep('error');
    } finally {
      setSaving(false);
    }
  }

  async function handleResendItinerary() {
    setSaving(true);
    setActionMsg(null);
    try {
      const res = await fetch('/api/agent/resend-itinerary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ bookingReference: fbr }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg({ type: 'success', text: data.message });
      } else {
        setActionMsg({ type: 'error', text: data.error || 'Failed to resend.' });
      }
    } catch {
      setActionMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw className="w-6 h-6 text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <p className="text-white font-semibold">Booking not found</p>
        <button onClick={() => router.push('/agent/bookings')} className="text-[#1ABC9C] text-sm mt-2 hover:underline">
          Back to bookings
        </button>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Plane },
    { id: 'passengers', label: 'Passengers', icon: Users },
    { id: 'payments', label: 'Payments', icon: CreditCard },
    { id: 'timeline', label: 'Timeline', icon: Clock },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Back + Header */}
      <div className="mb-6">
        <button onClick={() => router.push('/agent/bookings')} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white mb-4 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to bookings
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-xl font-black text-white">{booking.masterBookingReference}</h1>
              <span className={cn('px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase border', STATUS_COLORS[booking.bookingStatus] || '')}>
                {booking.bookingStatus?.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-sm text-slate-400">
              {booking.originAirport} {(booking.tripType || '').toLowerCase().includes('round') ? '⇄' : '→'} {booking.destinationAirport} • {booking.customerName}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleResendItinerary}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-all"
            >
              <Mail className="w-3.5 h-3.5" /> Resend Itinerary
            </button>
            {!['CANCELLED', 'CANCEL_REQUESTED', 'FAILED'].includes(booking.bookingStatus) && (
              <>
                <button
                  onClick={() => setShowDateChangeDialog(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-purple-400 hover:text-purple-300 bg-purple-500/[0.06] hover:bg-purple-500/[0.12] border border-purple-500/20 transition-all"
                >
                  <Calendar className="w-3.5 h-3.5" /> Change Date
                </button>
                <button
                  onClick={() => { setCancelStep('review'); setCancelQuoteError(null); setCancelSuccess(null); setShowCancelDialog(true); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-red-400 hover:text-red-300 bg-red-500/[0.06] hover:bg-red-500/[0.12] border border-red-500/20 transition-all"
                >
                  <XCircle className="w-3.5 h-3.5" /> Cancel Booking
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Action message */}
      {actionMsg && (
        <div className={cn(
          'mb-4 flex items-start gap-2.5 p-3 rounded-xl border',
          actionMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'
        )}>
          {actionMsg.type === 'success' ? <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
          <p className={cn('text-xs', actionMsg.type === 'success' ? 'text-emerald-400' : 'text-red-400')}>{actionMsg.text}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/[0.06] mb-6">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all -mb-[1px]',
                activeTab === tab.id
                  ? 'text-[#1ABC9C] border-[#1ABC9C]'
                  : 'text-slate-500 border-transparent hover:text-white'
              )}
            >
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Flight details */}
          <div className="bg-slate-900/80 border border-white/[0.06] rounded-2xl p-6">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Plane className="w-4 h-4 text-[#1ABC9C]" /> Flight Details</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Route</p><p className="text-white font-semibold">{booking.originAirport} {(booking.tripType || '').toLowerCase().includes('round') ? '⇄' : '→'} {booking.destinationAirport}</p></div>
                <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Trip Type</p><p className="text-white">{booking.tripType?.replace(/_/g, ' ')}</p></div>
                <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Departure</p><p className="text-white">{new Date(booking.departureDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</p></div>
                {booking.returnDate && <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Return</p><p className="text-white">{new Date(booking.returnDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</p></div>}
              </div>

              {booking.pnrs?.length > 0 && (
                <div className="pt-3 border-t border-white/[0.06]">
                  <p className="text-[10px] text-slate-500 uppercase font-bold mb-2">PNR Codes</p>
                  <div className="flex flex-wrap gap-2">
                    {booking.pnrs.map((pnr: any, i: number) => (
                      <span key={i} className="px-3 py-1.5 rounded-lg bg-slate-800/60 text-xs font-mono text-white border border-white/[0.06]">
                        {pnr.pnrCode} <span className="text-slate-500 text-[10px]">({pnr.pnrType?.replace(/_/g, ' ')})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Fare Policy Indicators */}
              {booking.pnrs?.length > 0 && (() => {
                const isRefundable = booking.pnrs.some((p: any) => p.refundable);
                const isChangeable = booking.pnrs.some((p: any) => p.changeable);
                const cancellationFee = booking.pnrs.find((p: any) => p.cancellationFee != null)?.cancellationFee;
                const changeFee = booking.pnrs.find((p: any) => p.changeFee != null)?.changeFee;
                return (
                  <div className="pt-3 border-t border-white/[0.06]">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-2">Fare Policy</p>
                    <div className="flex flex-wrap gap-2">
                      {/* Refundable indicator */}
                      <span className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border',
                        isRefundable
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                          : 'bg-red-500/10 text-red-400 border-red-500/25'
                      )}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', isRefundable ? 'bg-emerald-400' : 'bg-red-400')} />
                        {isRefundable ? 'Refundable' : 'Non-Refundable'}
                      </span>

                      {/* Changeable indicator */}
                      <span className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border',
                        isChangeable
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/25'
                          : 'bg-orange-500/10 text-orange-400 border-orange-500/25'
                      )}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', isChangeable ? 'bg-blue-400' : 'bg-orange-400')} />
                        {isChangeable ? 'Changeable' : 'Non-Changeable'}
                      </span>

                      {/* Cancellation fee */}
                      {cancellationFee != null && Number(cancellationFee) > 0 && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800/60 text-slate-300 border border-white/[0.06]">
                          Cancel Fee: ${Number(cancellationFee).toLocaleString()}
                        </span>
                      )}

                      {/* Change fee */}
                      {changeFee != null && Number(changeFee) > 0 && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800/60 text-slate-300 border border-white/[0.06]">
                          Change Fee: ${Number(changeFee).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Customer + Payment */}
          <div className="bg-slate-900/80 border border-white/[0.06] rounded-2xl p-6">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Users className="w-4 h-4 text-[#1ABC9C]" /> Customer & Payment</h3>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Customer</p><p className="text-white font-semibold">{booking.customerName}</p></div>
                <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Email</p><p className="text-white truncate">{booking.customerEmail}</p></div>
                <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Total</p><p className="text-white font-bold">${Number(booking.totalAmount).toLocaleString()} {booking.currency}</p></div>
                <div><p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">Payment</p>
                  <span className={cn('inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase border', STATUS_COLORS[booking.paymentStatus] || '')}>
                    {booking.paymentStatus?.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Flight Segments — grouped by journey */}
          {(booking.journeys?.length > 0 || booking.segments?.length > 0) && (
            <div className="lg:col-span-2 bg-slate-900/80 border border-white/[0.06] rounded-2xl p-6">
              <h3 className="text-sm font-bold text-white mb-4">Flight Segments</h3>
              <div className="space-y-5">
                {booking.journeys?.length > 0 ? booking.journeys.map((j: any, ji: number) => {
                  const jSegs = (booking.segments || []).filter((s: any) => s.journeyId === j.id).sort((a: any, b: any) => (a.segmentOrder ?? 0) - (b.segmentOrder ?? 0));
                  const isReturn = j.direction === 'RETURN';
                  return (
                    <div key={ji}>
                      <div className={`flex items-center gap-2 mb-2 px-3 py-1.5 rounded-lg ${isReturn ? 'bg-amber-500/10' : 'bg-[#1ABC9C]/10'}`}>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${isReturn ? 'text-amber-400' : 'text-[#1ABC9C]'}`}>
                          {isReturn ? 'Return Flight' : 'Outbound Flight'}
                        </span>
                        <span className="ml-auto text-[10px] text-slate-400">{j.departureDate ? new Date(j.departureDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}</span>
                      </div>
                      <div className="space-y-2">
                        {jSegs.map((seg: any, si: number) => (
                          <div key={si} className="flex items-center gap-4 p-3 rounded-xl bg-slate-800/40 border border-white/[0.04]">
                            <div className="text-center shrink-0 min-w-[52px]">
                              <p className="text-sm font-bold text-white">{seg.originAirport}</p>
                              <p className="text-[10px] text-slate-500">{seg.departureDateTime ? new Date(seg.departureDateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                            </div>
                            <div className="flex-1 flex flex-col items-center gap-0.5">
                              <p className="text-[9px] text-slate-600 font-medium">
                                {seg.durationMinutes ? `${Math.floor(seg.durationMinutes / 60)}h ${seg.durationMinutes % 60}m` : ''}
                              </p>
                              <div className="w-full border-t border-dashed border-slate-700 relative">
                                <Plane className="w-3 h-3 text-[#1ABC9C] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800/40" />
                              </div>
                              <p className="text-[9px] text-slate-600 uppercase">{seg.cabin || ''}</p>
                            </div>
                            <div className="text-center shrink-0 min-w-[52px]">
                              <p className="text-sm font-bold text-white">{seg.destinationAirport}</p>
                              <p className="text-[10px] text-slate-500">{seg.arrivalDateTime ? new Date(seg.arrivalDateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                            </div>
                            <div className="shrink-0 text-right min-w-[90px]">
                              <p className="text-xs text-slate-400 font-medium">{seg.airlineName}</p>
                              <p className="text-[10px] font-mono text-slate-500">{seg.airlineCode}{seg.flightNumber}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }) : (
                  /* Fallback: flat segments if no journeys */
                  <div className="space-y-2">
                    {booking.segments.map((seg: any, i: number) => (
                      <div key={i} className="flex items-center gap-4 p-3 rounded-xl bg-slate-800/40 border border-white/[0.04]">
                        <div className="text-center shrink-0 min-w-[52px]">
                          <p className="text-sm font-bold text-white">{seg.originAirport}</p>
                          <p className="text-[10px] text-slate-500">{seg.departureDateTime ? new Date(seg.departureDateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                        </div>
                        <div className="flex-1 border-t border-dashed border-slate-700 relative">
                          <Plane className="w-3 h-3 text-[#1ABC9C] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800/40" />
                        </div>
                        <div className="text-center shrink-0 min-w-[52px]">
                          <p className="text-sm font-bold text-white">{seg.destinationAirport}</p>
                          <p className="text-[10px] text-slate-500">{seg.arrivalDateTime ? new Date(seg.arrivalDateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-slate-400">{seg.airlineName}</p>
                          <p className="text-[10px] font-mono text-slate-500">{seg.airlineCode}{seg.flightNumber}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'passengers' && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 mb-4">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-400">
              <strong>Identity fields</strong> (Name, DOB, Gender) cannot be edited directly after booking. Contact Admin for identity changes.
            </p>
          </div>

          {booking.passengers?.map((pax: any) => (
            <div key={pax.id} className="bg-slate-900/80 border border-white/[0.06] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-bold text-white">{pax.firstName} {pax.middleName || ''} {pax.lastName}</p>
                  <p className="text-xs text-slate-500">{pax.type || 'ADULT'} • {pax.gender || 'Not specified'} • DOB: {pax.dateOfBirth ? new Date(pax.dateOfBirth).toLocaleDateString() : 'N/A'}</p>
                </div>
                {editingPassenger !== pax.id && (
                  <button
                    onClick={() => {
                      setEditingPassenger(pax.id);
                      setEditValues({
                        email: pax.email || '',
                        phone: pax.phone || '',
                        nationality: pax.nationality || '',
                        passportNumber: pax.passportNumber || '',
                        passportExpiry: pax.passportExpiry ? new Date(pax.passportExpiry).toISOString().split('T')[0] : '',
                        issuingCountry: pax.issuingCountry || pax.passportCountry || '',
                      });
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#1ABC9C] hover:text-white bg-[#1ABC9C]/10 hover:bg-[#1ABC9C]/20 border border-[#1ABC9C]/20 transition-all"
                  >
                    <Edit3 className="w-3 h-3" /> Edit
                  </button>
                )}
              </div>

              {editingPassenger === pax.id ? (
                <div className="space-y-3 pt-3 border-t border-white/[0.06]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {EDITABLE_FIELDS.map((field) => (
                      <div key={field.key}>
                        <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">{field.label}</label>
                        <input
                          type={field.type}
                          value={editValues[field.key] || ''}
                          onChange={(e) => setEditValues({ ...editValues, [field.key]: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white text-sm focus:outline-none focus:border-[#1ABC9C]/50 transition-all"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={() => handlePassengerUpdate(pax.id)}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white bg-[#1ABC9C] hover:bg-[#16A085] transition-all disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                    </button>
                    <button
                      onClick={() => setEditingPassenger(null)}
                      className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-white/[0.04] transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-white/[0.06]">
                  {EDITABLE_FIELDS.map((field) => (
                    <div key={field.key}>
                      <p className="text-[10px] text-slate-500 uppercase font-bold mb-0.5">{field.label}</p>
                      <p className="text-xs text-white">{field.key === 'issuingCountry' ? ((pax as any).issuingCountry || (pax as any).passportCountry || '—') : field.key === 'passportExpiry' ? ((pax as any).passportExpiry ? new Date((pax as any).passportExpiry).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—') : ((pax as any)[field.key] || '—')}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="bg-slate-900/80 border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="divide-y divide-white/[0.04]">
            {booking.payments?.length ? booking.payments.map((p: any) => (
              <div key={p.id} className="flex items-center gap-4 px-6 py-4">
                <CreditCard className="w-5 h-5 text-slate-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-white font-semibold">${Number(p.amount).toLocaleString()} {p.currency}</p>
                  <p className="text-xs text-slate-500">{p.type} • {new Date(p.createdAt).toLocaleString()}</p>
                </div>
                <span className={cn('px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase border', STATUS_COLORS[p.status] || '')}>
                  {p.status}
                </span>
              </div>
            )) : (
              <div className="p-8 text-center text-sm text-slate-500">No payment records</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'timeline' && (
        <div className="bg-slate-900/80 border border-white/[0.06] rounded-2xl p-6">
          <div className="space-y-4">
            {booking.events?.slice(0, eventsExpanded ? undefined : 10).map((evt: any, i: number) => (
              <div key={i} className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-[#1ABC9C] mt-1.5 shrink-0" />
                <div>
                  <p className="text-sm text-white font-medium">{evt.title}</p>
                  {evt.description && <p className="text-xs text-slate-500 mt-0.5">{evt.description}</p>}
                  <p className="text-[10px] text-slate-600 mt-1">{new Date(evt.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
            {booking.events?.length > 10 && (
              <button
                onClick={() => setEventsExpanded(!eventsExpanded)}
                className="flex items-center gap-1.5 text-xs text-[#1ABC9C] hover:text-white transition-colors"
              >
                {eventsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {eventsExpanded ? 'Show less' : `Show all ${booking.events.length} events`}
              </button>
            )}
            {(!booking.events || booking.events.length === 0) && (
              <p className="text-sm text-slate-500">No events recorded</p>
            )}
          </div>
        </div>
      )}

      {/* Cancel dialog */}
      {showCancelDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">

            {/* ── Success State ── */}
            {cancelStep === 'success' && cancelSuccess && (
              <>
                <div className="px-5 pt-6 pb-4 text-center">
                  <div className="w-16 h-16 rounded-full bg-[#1ABC9C]/10 border border-[#1ABC9C]/30 flex items-center justify-center mx-auto mb-4">
                    <Check className="w-7 h-7 text-[#1ABC9C]" />
                  </div>
                  <h3 className="text-white font-black text-xl mb-1">Booking Cancelled</h3>
                  <p className="text-slate-400 text-sm">
                    Ref: <span className="font-mono font-bold text-white">{cancelSuccess.bookingReference}</span>
                  </p>
                </div>

                {/* Refund card */}
                <div className="mx-5 mb-4 bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 rounded-2xl p-4 text-center">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Estimated Refund</p>
                  <p className="text-3xl font-black text-[#1ABC9C]">
                    {cancelSuccess.refundAmount > 0
                      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: cancelSuccess.refundCurrency || 'USD' }).format(cancelSuccess.refundAmount)
                      : 'Non-refundable'}
                  </p>
                  {cancelSuccess.refundAmount > 0 && (
                    <div className="flex items-center justify-center gap-1.5 mt-2 text-xs text-slate-400">
                      <Clock className="w-3 h-3" />
                      <span>{cancelSuccess.refundTimeline || '5–10 business days'}</span>
                      <span>·</span>
                      <span>Original Payment Method</span>
                    </div>
                  )}
                </div>

                <p className="text-center text-xs text-slate-500 mb-4 px-5">
                  Cancellation confirmation has been sent to the customer, agent, and admin.
                </p>

                <div className="px-5 pb-5">
                  <button
                    onClick={() => { setShowCancelDialog(false); setCancelStep('review'); setCancelSuccess(null); }}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#1ABC9C] hover:bg-[#16a085] text-white font-bold text-sm transition-all"
                  >
                    Done
                  </button>
                </div>
              </>
            )}

            {/* ── Review / Confirming / Error States ── */}
            {cancelStep !== 'success' && (
              <>
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                      <XCircle className="w-4 h-4 text-red-400" />
                    </div>
                    <h3 className="text-white font-bold text-sm">Cancel Booking</h3>
                  </div>
                  <button onClick={() => { if (cancelStep !== 'confirming') setShowCancelDialog(false); }} className="text-slate-500 hover:text-white transition-colors p-1">
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>

                <div className="relative min-h-[200px] overflow-hidden">
                  {/* Processing overlay */}
                  {cancelStep === 'confirming' && (
                    <div className="absolute inset-0 z-10 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                      <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                        <Loader2 className="w-6 h-6 text-red-400 animate-spin" />
                      </div>
                      <p className="text-white font-bold text-base">Processing Cancellation</p>
                      <p className="text-slate-400 text-xs">Contacting the airline — please wait…</p>
                      <p className="text-slate-600 text-[10px] mt-2">Do not close this window</p>
                    </div>
                  )}

                  <div className={`px-5 py-4 space-y-4 ${cancelStep === 'confirming' ? 'opacity-30 pointer-events-none' : ''}`}>
                    {loadingQuote && (
                      <div className="flex items-center gap-2 py-4 justify-center">
                        <Loader2 className="w-5 h-5 text-[#1ABC9C] animate-spin" />
                        <span className="text-xs text-slate-400">Loading cancellation details...</span>
                      </div>
                    )}

                    {!loadingQuote && (cancelQuoteError || cancelStep === 'error') && (
                      <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                          <span className="text-xs font-bold text-red-400">Unable to Process Cancellation</span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">{cancelQuoteError}</p>
                        <button
                          onClick={() => setShowCancelDialog(false)}
                          className="w-full py-2 rounded-lg text-sm font-medium text-white bg-slate-800 hover:bg-slate-700 border border-white/10 transition-colors"
                        >
                          Close
                        </button>
                      </div>
                    )}

                    {!loadingQuote && !cancelQuoteError && cancelStep !== 'error' && cancelQuote && (
                      <>
                        {/* Booking Details */}
                        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
                          <div className="px-4 py-3 space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-slate-400">FareMind Reference</span>
                              <span className="text-white font-bold font-mono">{cancelQuote.bookingReference}</span>
                            </div>
                            {cancelQuote.airlinePnr && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">Airline PNR</span>
                                <span className="text-white font-bold font-mono">{cancelQuote.airlinePnr}</span>
                              </div>
                            )}
                            {cancelQuote.route && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">Route</span>
                                <span className="text-white font-medium">{cancelQuote.route}</span>
                              </div>
                            )}
                            {cancelQuote.departureDate && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">Departure</span>
                                <span className="text-white font-medium">{new Date(cancelQuote.departureDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Refund Estimate */}
                        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
                          <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Refund Estimate</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              cancelQuote.refundability === 'FULL_REFUND'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : cancelQuote.refundability === 'PARTIAL_REFUND'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}>
                              {cancelQuote.refundability === 'FULL_REFUND'
                                ? 'Fully Refundable'
                                : cancelQuote.refundability === 'PARTIAL_REFUND'
                                  ? 'Partially Refundable'
                                  : 'Non-refundable'}
                            </span>
                          </div>
                          <div className="px-4 py-3 space-y-2.5 text-sm">
                            <div className="flex justify-between text-xs text-slate-400">
                              <span>Original Fare</span>
                              <span className="text-white font-medium">
                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: cancelQuote.currency }).format(cancelQuote.originalAmount)}
                              </span>
                            </div>
                            {cancelQuote.airlinePenalty > 0 && (
                              <div className="flex justify-between text-xs text-slate-400">
                                <span>Airline Penalty</span>
                                <span className="text-red-400 font-medium">
                                  −{new Intl.NumberFormat('en-US', { style: 'currency', currency: cancelQuote.currency }).format(cancelQuote.airlinePenalty)}
                                </span>
                              </div>
                            )}
                            {cancelQuote.fareMindFee > 0 && (
                              <div className="flex justify-between text-xs text-slate-400">
                                <span>FAREMIND Service Fee</span>
                                <span className="text-red-400 font-medium">
                                  −{new Intl.NumberFormat('en-US', { style: 'currency', currency: cancelQuote.currency }).format(cancelQuote.fareMindFee)}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between items-center pt-2 border-t border-white/[0.05]">
                              <span className="text-white font-bold text-xs">Estimated Refund</span>
                              <span className={`font-black text-sm ${cancelQuote.estimatedRefund > 0 ? 'text-[#1ABC9C]' : 'text-red-400 italic'}`}>
                                {cancelQuote.estimatedRefund > 0
                                  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: cancelQuote.refundCurrency || cancelQuote.currency }).format(cancelQuote.estimatedRefund)
                                  : 'Non-refundable'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Payment method & timeline */}
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <CreditCard className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>
                            {cancelQuote.estimatedRefund > 0
                              ? `Original Payment · ${cancelQuote.refundTimeline || '5–10 business days'}`
                              : 'No refund will be issued for this non-refundable ticket'}
                          </span>
                        </div>

                        {/* Warning */}
                        {cancelQuote.warningMessage && (
                          <div className="flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2.5">
                            <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                            <p className="text-amber-200/70 text-xs leading-relaxed">{cancelQuote.warningMessage}</p>
                          </div>
                        )}

                        {/* Confirm text */}
                        <p className="text-xs text-slate-400 text-center">
                          Please confirm that you want to cancel booking <span className="text-white font-bold">{cancelQuote.bookingReference}</span>.
                        </p>

                        {/* Reason */}
                        <textarea
                          value={cancelReason}
                          onChange={(e) => setCancelReason(e.target.value)}
                          placeholder="Reason for cancellation (optional)"
                          className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-white/10 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-red-500/50 resize-none h-20"
                        />
                      </>
                    )}
                  </div>
                </div>

                {/* Footer buttons */}
                {!loadingQuote && !cancelQuoteError && cancelStep !== 'error' && (
                  <div className={`flex items-center justify-end gap-2 px-5 pb-5 ${cancelStep === 'confirming' ? 'opacity-30 pointer-events-none' : ''}`}>
                    <button
                      onClick={() => setShowCancelDialog(false)}
                      disabled={cancelStep === 'confirming'}
                      className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white transition-colors"
                    >
                      Keep Booking
                    </button>
                    <button
                      onClick={handleCancellation}
                      disabled={saving || loadingQuote || cancelStep === 'confirming'}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-all disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                      Confirm Cancellation
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Date Change Modal */}
      {showDateChangeDialog && booking && (
        <DateChangeModal bookingId={booking.id} booking={booking} onClose={() => setShowDateChangeDialog(false)} />
      )}
    </div>
  );
}
