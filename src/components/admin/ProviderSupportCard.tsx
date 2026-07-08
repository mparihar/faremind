'use client';

/**
 * ProviderSupportCard — Admin Portal
 *
 * Internal-only provider support card shown on the admin booking detail page.
 * Only renders for Duffel bookings with a valid providerOrderId.
 *
 * This component is NEVER rendered in customer-facing routes.
 */

import React, { useState } from 'react';
import { adminFetch } from '@/store/useAdminStore';
import { Headset, AlertTriangle, ChevronDown, Loader2, ExternalLink, Shield } from 'lucide-react';

interface ProviderSupportCardProps {
  booking: {
    id: string;
    masterBookingReference?: string;
    primaryProvider?: string;
    providerOrderId?: string | null;
    duffelCustomerUserId?: string | null;
    customerName?: string;
    masterPnr?: string | null;
    bookingStatus?: string;
    providerSupportSessionCount?: number;
    lastProviderSupportOpenedAt?: string | null;
    lastProviderSupportOpenedBy?: string | null;
  } | null;
}

const ISSUE_TYPES = [
  { value: 'change', label: 'Change Request' },
  { value: 'cancellation', label: 'Cancellation' },
  { value: 'other', label: 'Other' },
] as const;

export default function ProviderSupportCard({ booking }: ProviderSupportCardProps) {
  const [issueType, setIssueType] = useState<string>('other');
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // ── Visibility check: only render for eligible bookings ──
  if (!booking) return null;
  if (booking.primaryProvider?.toLowerCase() !== 'duffel') return null;
  if (!booking.providerOrderId) return null;

  async function openAssistant() {
    if (!booking) return;
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await adminFetch(
        `/api/admin/bookings/${booking.id}/provider-support/duffel-assistant`,
        {
          method: 'POST',
          body: JSON.stringify({ issueType, summary }),
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        setError(data.error || `Request failed (${res.status})`);
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

        // Wait for script to load
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Duffel Assistant'));
          setTimeout(() => resolve(), 3000); // Safety timeout
        });
      }

      // Open the Duffel Assistant
      if (typeof (window as any).openDuffelAssistant === 'function') {
        (window as any).openDuffelAssistant({
          clientKey: session.clientKey,
          ...(session.context?.orderId ? { orderId: session.context.orderId } : {}),
        });
        setSuccess(true);
      } else {
        // Fallback: create the custom element directly
        let assistantEl = document.querySelector('duffel-assistant');
        if (!assistantEl) {
          assistantEl = document.createElement('duffel-assistant');
          document.body.appendChild(assistantEl);
        }
        assistantEl.setAttribute('client-key', session.clientKey);
        if (session.context?.orderId) {
          assistantEl.setAttribute('order-id', session.context.orderId);
        }
        setSuccess(true);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to open Duffel Assistant');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden mt-6">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-500/15 flex items-center justify-center">
            <Headset size={18} className="text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Duffel Support Assistant</h3>
            <p className="text-[11px] text-slate-500">Contact Duffel support for provider-level help</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-400/10 text-amber-400 border border-amber-400/20 flex items-center gap-1">
            <Shield size={10} />
            INTERNAL ONLY
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        {/* Booking context info */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <ContextField label="Booking Ref" value={booking.masterBookingReference} mono />
          <ContextField label="Duffel Order ID" value={booking.providerOrderId} mono />
          <ContextField label="PNR" value={booking.masterPnr} mono />
          <ContextField label="Passenger" value={booking.customerName} />
          <ContextField label="Status" value={booking.bookingStatus} badge />
          <ContextField label="Provider" value="Duffel" />
        </div>

        {/* Previous support sessions */}
        {(booking.providerSupportSessionCount ?? 0) > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/30 text-slate-400 text-xs">
            <span>
              Previously opened <strong className="text-white">{booking.providerSupportSessionCount}</strong> time{booking.providerSupportSessionCount !== 1 ? 's' : ''}
            </span>
            {booking.lastProviderSupportOpenedAt && (
              <span className="text-slate-500">
                · Last: {new Date(booking.lastProviderSupportOpenedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        )}

        {/* Issue type dropdown */}
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

        {/* Summary text area */}
        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            Internal Summary
          </label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Please assist Faremind support with this Duffel booking. Customer has requested a flight change/cancellation/refund clarification."
            rows={3}
            className="w-full px-3 py-2.5 bg-slate-700/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-purple-400 transition-all resize-none placeholder:text-slate-600"
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
            <span className="text-red-400 text-xs">{error}</span>
          </div>
        )}

        {/* Success message */}
        {success && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <ExternalLink size={14} className="text-emerald-400" />
            <span className="text-emerald-400 text-xs font-semibold">
              Duffel Assistant opened. Check the assistant panel.
            </span>
          </div>
        )}

        {/* Open button */}
        <button
          onClick={openAssistant}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-all duration-200"
        >
          {loading ? (
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

        {/* Disclaimer */}
        <p className="text-[10px] text-slate-600 text-center leading-relaxed">
          Duffel Assistant is an internal provider-support tool. Do not share this screen, link, or provider conversation with customers.
        </p>
      </div>
    </div>
  );
}

// ── Small helper component ────────────────────────────────────────────────────

function ContextField({
  label,
  value,
  mono = false,
  badge = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  badge?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">{label}</span>
      {badge ? (
        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-400/15 text-emerald-400">
          {value.replace(/_/g, ' ')}
        </span>
      ) : (
        <p className={`text-sm text-white font-semibold truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
      )}
    </div>
  );
}
