'use client';

/**
 * Duffel Assistant — Standalone Admin Page
 *
 * Accessible from the admin sidebar. Allows admin/support staff to:
 * 1. Search for any Duffel booking by FBR, PNR, passenger name, or Duffel order ID
 * 2. Select a booking and open the Duffel Assistant for it
 *
 * Internal-only — never exposed to customers.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { adminFetch, useAdminStore } from '@/store/useAdminStore';
import {
  Search, RefreshCw, MessageCircle, Headset, Shield, AlertTriangle,
  Loader2, ExternalLink, ChevronDown, Plane, User, Hash, Package,
} from 'lucide-react';
import { format } from 'date-fns';

interface DuffelBooking {
  id: string;
  masterBookingReference: string;
  primaryProvider: string;
  providerOrderId: string | null;
  customerName: string;
  customerEmail: string;
  masterPnr: string | null;
  bookingStatus: string;
  departureDate: string | null;
  originAirport: string | null;
  destinationAirport: string | null;
  tripType: string | null;
  providerSupportSessionCount: number;
  lastProviderSupportOpenedAt: string | null;
  lastProviderSupportOpenedBy: string | null;
}

const ISSUE_TYPES = [
  { value: 'change', label: 'Change Request' },
  { value: 'cancellation', label: 'Cancellation' },
  { value: 'other', label: 'Other' },
] as const;

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: 'bg-emerald-500/15 text-emerald-400',
  PENDING: 'bg-amber-400/15 text-amber-400',
  TICKETED: 'bg-blue-400/15 text-blue-400',
  CANCELLED: 'bg-red-400/15 text-red-400',
  FAILED: 'bg-red-400/15 text-red-400',
  VOID: 'bg-slate-400/15 text-slate-400',
};

export default function DuffelAssistantPage() {
  const { user } = useAdminStore();
  const [bookings, setBookings] = useState<DuffelBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedBooking, setSelectedBooking] = useState<DuffelBooking | null>(null);
  const [issueType, setIssueType] = useState('other');
  const [summary, setSummary] = useState('');
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionSuccess, setSessionSuccess] = useState(false);

  // ── Load Duffel bookings ──
  const loadBookings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        provider: 'duffel',
        limit: '100',
        ...(search ? { q: search } : {}),
      });
      const res = await adminFetch(`/api/admin/bookings?${params}`);
      if (res.ok) {
        const data = await res.json();
        // Filter to only show bookings with providerOrderId (can use Duffel Assistant)
        const all = (data.bookings ?? []).filter(
          (b: any) => b.primaryProvider?.toLowerCase() === 'duffel',
        );
        setBookings(all);
      }
    } catch (err) {
      console.error('[duffel-assistant] Failed to load bookings:', err);
    }
    setLoading(false);
  }, [search]);

  useEffect(() => {
    loadBookings();
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => loadBookings(), 400);
    return () => clearTimeout(timer);
  }, [search]);

  // ── Open Duffel Assistant ──
  async function openAssistant() {
    if (!selectedBooking) return;
    setSessionLoading(true);
    setSessionError(null);
    setSessionSuccess(false);

    try {
      const res = await adminFetch(
        `/api/admin/bookings/${selectedBooking.id}/provider-support/duffel-assistant`,
        {
          method: 'POST',
          body: JSON.stringify({ issueType, summary }),
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        setSessionError(data.error || `Request failed (${res.status})`);
        return;
      }

      const session = await res.json();

      // Dynamically load the Duffel Assistant script
      if (!document.querySelector('script[src*="duffel.com/assistant"]')) {
        const script = document.createElement('script');
        script.src = 'https://assets.duffel.com/assistant/custom-element.js';
        script.type = 'text/javascript';
        script.async = true;
        document.head.appendChild(script);
        await new Promise<void>((resolve) => {
          script.onload = () => resolve();
          setTimeout(() => resolve(), 3000);
        });
      }

      // Open the Duffel Assistant
      if (typeof (window as any).openDuffelAssistant === 'function') {
        (window as any).openDuffelAssistant({
          clientKey: session.clientKey,
          ...(session.context?.orderId ? { orderId: session.context.orderId } : {}),
        });
        setSessionSuccess(true);
      } else {
        let el = document.querySelector('duffel-assistant');
        if (!el) {
          el = document.createElement('duffel-assistant');
          document.body.appendChild(el);
        }
        el.setAttribute('client-key', session.clientKey);
        if (session.context?.orderId) el.setAttribute('order-id', session.context.orderId);
        setSessionSuccess(true);
      }

      // Refresh the booking list to show updated session count
      loadBookings();
    } catch (err: any) {
      setSessionError(err.message || 'Failed to open Duffel Assistant');
    } finally {
      setSessionLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-7xl w-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/25 flex items-center justify-center">
            <MessageCircle size={20} className="text-purple-400" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">Duffel Assistant</h1>
            <p className="text-slate-400 text-xs">Contact Duffel provider support for any booking</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1.5 rounded-full text-[10px] font-bold bg-amber-400/10 text-amber-400 border border-amber-400/20 flex items-center gap-1.5">
            <Shield size={10} />
            INTERNAL ONLY
          </span>
          <button
            onClick={loadBookings}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── Left: Booking list ── */}
        <div className="lg:col-span-3 space-y-4">

          {/* Search bar */}
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by FBR, PNR, passenger name, or Duffel order ID..."
              className="w-full pl-11 pr-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white text-sm focus:outline-none focus:border-purple-400/50 transition-all placeholder:text-slate-600"
            />
          </div>

          {/* Results */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-700/40 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Duffel Bookings
              </span>
              <span className="text-[11px] text-slate-500">
                {bookings.length} booking{bookings.length !== 1 ? 's' : ''}
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw size={20} className="text-purple-400 animate-spin" />
              </div>
            ) : bookings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <Package size={32} className="mb-3 opacity-30" />
                <p className="text-sm font-semibold">No Duffel bookings found</p>
                <p className="text-xs mt-1">Try adjusting your search</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-700/30 max-h-[600px] overflow-y-auto">
                {bookings.map((b) => {
                  const isSelected = selectedBooking?.id === b.id;
                  const hasOrderId = !!b.providerOrderId;
                  return (
                    <button
                      key={b.id}
                      onClick={() => {
                        setSelectedBooking(b);
                        setSessionError(null);
                        setSessionSuccess(false);
                      }}
                      disabled={!hasOrderId}
                      className={`w-full text-left px-5 py-3.5 transition-all ${
                        isSelected
                          ? 'bg-purple-500/10 border-l-2 border-purple-400'
                          : hasOrderId
                          ? 'hover:bg-white/3 border-l-2 border-transparent'
                          : 'opacity-40 cursor-not-allowed border-l-2 border-transparent'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[#1ABC9C] font-mono font-bold text-xs">
                              {b.masterBookingReference}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${STATUS_COLORS[b.bookingStatus] ?? 'bg-slate-400/15 text-slate-400'}`}>
                              {b.bookingStatus}
                            </span>
                            {b.providerSupportSessionCount > 0 && (
                              <span className="text-[9px] text-purple-400 font-bold">
                                {b.providerSupportSessionCount}× opened
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-white text-sm font-semibold">
                            <User size={12} className="text-slate-500 shrink-0" />
                            <span className="truncate">{b.customerName}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            {b.originAirport && b.destinationAirport && (
                              <span className="flex items-center gap-1 text-slate-400 text-xs">
                                <Plane size={10} />
                                {b.originAirport} → {b.destinationAirport}
                              </span>
                            )}
                            {b.masterPnr && (
                              <span className="flex items-center gap-1 text-slate-500 text-xs font-mono">
                                <Hash size={10} />
                                {b.masterPnr}
                              </span>
                            )}
                            {b.departureDate && (
                              <span className="text-slate-500 text-xs">
                                {format(new Date(b.departureDate), 'dd MMM yyyy')}
                              </span>
                            )}
                          </div>
                          {!hasOrderId && (
                            <p className="text-red-400/60 text-[10px] mt-1">
                              Missing Duffel Order ID — assistant unavailable
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Assistant panel ── */}
        <div className="lg:col-span-2">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden sticky top-6">
            <div className="px-5 py-4 border-b border-slate-700/40 flex items-center gap-3">
              <Headset size={18} className="text-purple-400" />
              <div>
                <h3 className="text-sm font-bold text-white">Open Support Session</h3>
                <p className="text-[11px] text-slate-500">Select a booking from the left</p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {selectedBooking ? (
                <>
                  {/* Selected booking context */}
                  <div className="bg-slate-900/50 rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[#1ABC9C] font-mono font-bold text-sm">
                        {selectedBooking.masterBookingReference}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[selectedBooking.bookingStatus] ?? 'bg-slate-400/15 text-slate-400'}`}>
                        {selectedBooking.bookingStatus}
                      </span>
                    </div>
                    <InfoLine label="Passenger" value={selectedBooking.customerName} />
                    <InfoLine label="PNR" value={selectedBooking.masterPnr} mono />
                    <InfoLine label="Duffel Order" value={selectedBooking.providerOrderId} mono />
                    {selectedBooking.originAirport && selectedBooking.destinationAirport && (
                      <InfoLine
                        label="Route"
                        value={`${selectedBooking.originAirport} → ${selectedBooking.destinationAirport}`}
                      />
                    )}
                  </div>

                  {/* Previous sessions */}
                  {selectedBooking.providerSupportSessionCount > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/30 text-slate-400 text-xs">
                      <span>
                        Previously opened <strong className="text-white">{selectedBooking.providerSupportSessionCount}</strong> time{selectedBooking.providerSupportSessionCount !== 1 ? 's' : ''}
                      </span>
                      {selectedBooking.lastProviderSupportOpenedAt && (
                        <span className="text-slate-500">
                          · Last: {format(new Date(selectedBooking.lastProviderSupportOpenedAt), 'dd MMM yyyy')}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Issue type */}
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Issue Type
                    </label>
                    <div className="relative">
                      <select
                        value={issueType}
                        onChange={(e) => setIssueType(e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-purple-400 transition-all appearance-none cursor-pointer"
                      >
                        {ISSUE_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* Summary */}
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Internal Summary
                    </label>
                    <textarea
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      placeholder="Describe the issue — e.g. customer requests flight date change, refund query, etc."
                      rows={3}
                      className="w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-purple-400 transition-all resize-none placeholder:text-slate-600"
                    />
                  </div>

                  {/* Error */}
                  {sessionError && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                      <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                      <span className="text-red-400 text-xs">{sessionError}</span>
                    </div>
                  )}

                  {/* Success */}
                  {sessionSuccess && (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <ExternalLink size={14} className="text-emerald-400" />
                      <span className="text-emerald-400 text-xs font-semibold">
                        Duffel Assistant opened — check the assistant panel.
                      </span>
                    </div>
                  )}

                  {/* Open button */}
                  <button
                    onClick={openAssistant}
                    disabled={sessionLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-all duration-200"
                  >
                    {sessionLoading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Creating session...
                      </>
                    ) : (
                      <>
                        <Headset size={16} />
                        Open Duffel Assistant
                      </>
                    )}
                  </button>

                  <p className="text-[10px] text-slate-600 text-center leading-relaxed">
                    Do not share this screen or provider conversation with customers.
                  </p>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                  <MessageCircle size={32} className="mb-3 opacity-20" />
                  <p className="text-sm font-semibold">No booking selected</p>
                  <p className="text-xs mt-1 text-center">Select a Duffel booking from the list to open the provider support assistant</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Small helper ──────────────────────────────────────────────────────────────

function InfoLine({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold shrink-0">{label}</span>
      <span className={`text-xs text-white font-semibold truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
