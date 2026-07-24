'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Ban, RotateCcw, ArrowLeftRight, Search, Loader2, CheckCircle2,
  XCircle, Clock, DollarSign, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { adminFetch } from '@/store/useAdminStore';

/**
 * Admin Post-Booking Servicing Page — MYSTIFLY ONLY
 *
 * Admin-side mirror of the agent Post-Booking console. Handles Post-Ticketing
 * Requests (PTR) exclusively for Mystifly bookings. Duffel has a different
 * servicing model and is NOT handled here.
 *
 * Supported operations:
 *   - Void Quote / Void
 *   - Refund Quote / Refund
 *   - Reissue Quote / Reissue
 *   - PTR Status Search
 *   - Force Cancel + Refund   (provider PTR → Stripe refund → cancel)
 *   - Reissue + Collect Difference (quote → charge card → provider reissue)
 *
 * Admin-gated flows (force-cancel, reissue, PTR history) go through the admin
 * API proxies (adminFetch); raw Mystifly PTR quote/execute call the backend
 * directly like the agent console.
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type PtrTab = 'void' | 'refund' | 'reissue' | 'status';

const TABS: { key: PtrTab; label: string; icon: any; description: string }[] = [
  { key: 'void', label: 'Void', icon: Ban, description: 'Void a ticketed Mystifly booking' },
  { key: 'refund', label: 'Refund', icon: RotateCcw, description: 'Request refund on a Mystifly booking' },
  { key: 'reissue', label: 'Reissue', icon: ArrowLeftRight, description: 'Exchange/reissue a Mystifly ticket' },
  { key: 'status', label: 'PTR Status', icon: Search, description: 'Check Mystifly PTR request status' },
];

const STATUS_COLORS: Record<string, string> = {
  'QUOTE_PENDING': 'bg-amber-400/15 text-amber-400 border-amber-400/20',
  'QUOTE_RECEIVED': 'bg-blue-400/15 text-blue-400 border-blue-400/20',
  'AWAITING_APPROVAL': 'bg-violet-400/15 text-violet-400 border-violet-400/20',
  'EXECUTING': 'bg-amber-400/15 text-amber-400 border-amber-400/20',
  'COMPLETED': 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
  'FAILED': 'bg-red-400/15 text-red-400 border-red-400/20',
};

export default function AdminPostBookingPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<PtrTab>('void');

  // Inputs
  const [uniqueId, setUniqueId] = useState(searchParams.get('mfRef') || '');
  const [bookingId, setBookingId] = useState(searchParams.get('bookingId') || '');
  const [notes, setNotes] = useState('');
  const [newFSC, setNewFSC] = useState('');

  // Results
  const [quoteResult, setQuoteResult] = useState<any>(null);
  const [execResult, setExecResult] = useState<any>(null);
  const [statusResult, setStatusResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [execLoading, setExecLoading] = useState(false);

  // DB records
  const [ptrRecords, setPtrRecords] = useState<any[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  // Force Cancel + Refund modal
  const [fcOpen, setFcOpen] = useState(false);
  const [fcQuote, setFcQuote] = useState<any>(null);
  const [fcLoadingQuote, setFcLoadingQuote] = useState(false);
  const [fcAmount, setFcAmount] = useState('');
  const [fcReason, setFcReason] = useState('');
  const [fcSubmitting, setFcSubmitting] = useState(false);
  const [fcResult, setFcResult] = useState<any>(null);
  const [fcError, setFcError] = useState<string | null>(null);

  // Reissue + Collect Difference modal
  const [riOpen, setRiOpen] = useState(false);
  const [riQuote, setRiQuote] = useState<any>(null);
  const [riLoadingQuote, setRiLoadingQuote] = useState(false);
  const [riSubmitting, setRiSubmitting] = useState(false);
  const [riResult, setRiResult] = useState<any>(null);
  const [riError, setRiError] = useState<string | null>(null);

  useEffect(() => {
    if (bookingId) loadPtrRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  async function loadPtrRecords() {
    setRecordsLoading(true);
    try {
      const res = await adminFetch(`/api/admin/mystifly-ptr/records?bookingId=${encodeURIComponent(bookingId)}`);
      if (res.ok) {
        const data = await res.json();
        setPtrRecords(data.records || []);
      }
    } catch {}
    setRecordsLoading(false);
  }

  async function handleQuote(type: 'void-quote' | 'refund-quote' | 'reissue-quote') {
    if (!uniqueId.trim()) return;
    setLoading(true);
    setQuoteResult(null);
    setExecResult(null);
    try {
      const body: any = { uniqueId: uniqueId.trim(), requestedBy: 'admin' };
      if (bookingId) body.bookingId = bookingId;
      if (notes) body.notes = notes;
      if (type === 'reissue-quote' && newFSC) body.newFareSourceCode = newFSC;

      const res = await fetch(`${BACKEND_URL}/api/mystifly-ptr/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setQuoteResult(data);
      if (bookingId) loadPtrRecords();
    } catch (e: any) {
      setQuoteResult({ error: e.message });
    }
    setLoading(false);
  }

  async function handleExecute(type: 'void' | 'refund' | 'reissue') {
    if (!uniqueId.trim()) return;
    setExecLoading(true);
    setExecResult(null);
    try {
      const body: any = { uniqueId: uniqueId.trim(), requestedBy: 'admin' };
      if (quoteResult?.ptrId) body.ptrId = quoteResult.ptrId;
      if (quoteResult?.providerPtrId) body.providerPtrId = quoteResult.providerPtrId; // Mystifly PTR id (required to accept refund)
      if (bookingId) body.bookingId = bookingId;
      if (type === 'reissue' && newFSC) body.newFareSourceCode = newFSC;

      const res = await fetch(`${BACKEND_URL}/api/mystifly-ptr/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setExecResult(data);
      if (bookingId) loadPtrRecords();
    } catch (e: any) {
      setExecResult({ error: e.message });
    }
    setExecLoading(false);
  }

  const fcTarget = () => (bookingId.trim() || uniqueId.trim());

  function openForceCancel() {
    if (!fcTarget()) { setExecResult({ error: 'Enter a Booking ID (or MFRef) first.' }); return; }
    setFcOpen(true); setFcQuote(null); setFcResult(null); setFcError(null); setFcAmount(''); setFcReason('');
    loadForceCancelQuote();
  }

  async function loadForceCancelQuote() {
    const target = fcTarget();
    if (!target) return;
    setFcLoadingQuote(true); setFcError(null);
    try {
      const res = await adminFetch(`/api/admin/bookings/${encodeURIComponent(target)}/force-cancel`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'quote' }),
      });
      const data = await res.json();
      if (!res.ok) setFcError(data?.error || `Quote failed (HTTP ${res.status})`);
      else { setFcQuote(data); setFcAmount(data?.providerRefund != null ? String(data.providerRefund) : ''); }
    } catch (e: any) { setFcError(e?.message || 'Quote failed'); }
    setFcLoadingQuote(false);
  }

  async function submitForceCancel() {
    const target = fcTarget();
    if (!target) return;
    const overrideRefundAmount = fcAmount.trim() && !isNaN(parseFloat(fcAmount)) ? parseFloat(fcAmount) : undefined;
    setFcSubmitting(true); setFcResult(null); setFcError(null);
    try {
      const res = await adminFetch(`/api/admin/bookings/${encodeURIComponent(target)}/force-cancel`, {
        method: 'POST',
        body: JSON.stringify({ overrideRefundAmount, reason: fcReason }),
      });
      const data = await res.json();
      if (!res.ok) setFcError(data?.error || `Force cancel failed (HTTP ${res.status})`);
      else { setFcResult(data); if (bookingId) loadPtrRecords(); }
    } catch (e: any) { setFcError(e?.message || 'Force cancel failed'); }
    setFcSubmitting(false);
  }

  function openReissue() {
    if (!fcTarget()) { setExecResult({ error: 'Enter a Booking ID (or MFRef) first.' }); return; }
    if (!newFSC.trim()) { setExecResult({ error: 'Enter the new FareSourceCode above first.' }); return; }
    setRiOpen(true); setRiQuote(null); setRiResult(null); setRiError(null);
    loadReissueQuote();
  }

  async function loadReissueQuote() {
    const target = fcTarget();
    if (!target) return;
    setRiLoadingQuote(true); setRiError(null);
    try {
      const res = await adminFetch(`/api/admin/bookings/${encodeURIComponent(target)}/reissue`, {
        method: 'POST',
        body: JSON.stringify({ newFareSourceCode: newFSC.trim(), mode: 'quote' }),
      });
      const data = await res.json();
      if (!res.ok) setRiError(data?.error || `Quote failed (HTTP ${res.status})`);
      else setRiQuote(data);
    } catch (e: any) { setRiError(e?.message || 'Quote failed'); }
    setRiLoadingQuote(false);
  }

  async function submitReissue() {
    const target = fcTarget();
    if (!target) return;
    setRiSubmitting(true); setRiResult(null); setRiError(null);
    try {
      const res = await adminFetch(`/api/admin/bookings/${encodeURIComponent(target)}/reissue`, {
        method: 'POST',
        body: JSON.stringify({ newFareSourceCode: newFSC.trim() }),
      });
      const data = await res.json();
      if (!res.ok) setRiError(data?.error || `Reissue failed (HTTP ${res.status})`);
      else { setRiResult(data); if (bookingId) loadPtrRecords(); }
    } catch (e: any) { setRiError(e?.message || 'Reissue failed'); }
    setRiSubmitting(false);
  }

  async function handleStatusSearch() {
    if (!uniqueId.trim()) return;
    setLoading(true);
    setStatusResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/mystifly-ptr/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uniqueId: uniqueId.trim() }),
      });
      setStatusResult(await res.json());
    } catch (e: any) {
      setStatusResult({ error: e.message });
    }
    setLoading(false);
  }

  const fmt = (n: number, c = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-400/15 flex items-center justify-center">
            <RotateCcw size={20} className="text-red-400" />
          </div>
          Post-Booking Servicing
          <span className="px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-400 text-[10px] font-bold uppercase tracking-wider border border-violet-500/20">
            Mystifly Only
          </span>
        </h1>
        <p className="text-slate-400 text-sm mt-1 ml-[52px]">
          Void, refund, and reissue Mystifly-ticketed bookings via Post-Ticketing Requests
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setQuoteResult(null); setExecResult(null); setStatusResult(null); }}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all',
                activeTab === tab.key
                  ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/20'
                  : 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:text-white hover:bg-slate-800'
              )}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Panel */}
        <div className="lg:col-span-2 bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6">

          {/* Common inputs */}
          <div className="space-y-3 mb-4">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Mystifly UniqueID (MFRef) *</label>
              <input value={uniqueId} onChange={e => setUniqueId(e.target.value)}
                placeholder="Enter Mystifly booking UniqueID..."
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-[#1ABC9C]" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Booking ID or Reference (optional — links PTR to database)</label>
              <input value={bookingId} onChange={e => setBookingId(e.target.value)}
                placeholder="FareMind booking ID / reference (for tracking)..."
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-[#1ABC9C]" />
            </div>
          </div>

          {/* ── Force Cancel + Refund (one-click: provider PTR → Stripe refund → cancel) ── */}
          <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-red-300">Force Cancel + Refund</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Executes the provider void/refund PTR, refunds the customer via Stripe (net of the FareMind service fee), and cancels the booking.</p>
              </div>
              <button
                onClick={openForceCancel}
                disabled={!bookingId.trim() && !uniqueId.trim()}
                className="shrink-0 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-bold"
              >
                Force Cancel + Refund
              </button>
            </div>
          </div>

          {/* ── Void Tab ── */}
          {activeTab === 'void' && (
            <div>
              <h3 className="text-white font-black text-lg mb-1">Void Mystifly Ticket</h3>
              <p className="text-slate-400 text-sm mb-4">Step 1: Get void quote → Step 2: Execute void</p>
              <div className="flex gap-3 mb-4">
                <button onClick={() => handleQuote('void-quote')} disabled={loading || !uniqueId.trim()}
                  className="flex items-center gap-2 px-5 py-3 bg-amber-500/15 border border-amber-400/20 rounded-xl text-amber-400 text-sm font-bold hover:bg-amber-500/25 disabled:opacity-50">
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Get Void Quote
                </button>
                <button onClick={() => handleExecute('void')} disabled={execLoading || !uniqueId.trim() || !quoteResult?.success}
                  className="flex items-center gap-2 px-5 py-3 bg-red-500/15 border border-red-400/20 rounded-xl text-red-400 text-sm font-bold hover:bg-red-500/25 disabled:opacity-50">
                  {execLoading ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Execute Void
                </button>
              </div>
            </div>
          )}

          {/* ── Refund Tab ── */}
          {activeTab === 'refund' && (
            <div>
              <h3 className="text-white font-black text-lg mb-1">Refund Mystifly Ticket</h3>
              <p className="text-slate-400 text-sm mb-4">Step 1: Get refund quote (with penalty details) → Step 2: Execute refund</p>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Refund reason / notes (optional)..."
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] resize-none mb-3" />
              <div className="flex gap-3 mb-4">
                <button onClick={() => handleQuote('refund-quote')} disabled={loading || !uniqueId.trim()}
                  className="flex items-center gap-2 px-5 py-3 bg-amber-500/15 border border-amber-400/20 rounded-xl text-amber-400 text-sm font-bold hover:bg-amber-500/25 disabled:opacity-50">
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <DollarSign size={14} />} Get Refund Quote
                </button>
                <button onClick={() => handleExecute('refund')} disabled={execLoading || !uniqueId.trim() || !quoteResult?.success}
                  className="flex items-center gap-2 px-5 py-3 bg-emerald-500/15 border border-emerald-400/20 rounded-xl text-emerald-400 text-sm font-bold hover:bg-emerald-500/25 disabled:opacity-50">
                  {execLoading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Execute Refund
                </button>
              </div>
            </div>
          )}

          {/* ── Reissue Tab ── */}
          {activeTab === 'reissue' && (
            <div>
              <h3 className="text-white font-black text-lg mb-1">Reissue / Exchange Mystifly Ticket</h3>
              <p className="text-slate-400 text-sm mb-4">Step 1: Get reissue quote → Step 2: Execute reissue</p>
              <input value={newFSC} onChange={e => setNewFSC(e.target.value)}
                placeholder="New FareSourceCode (for exchange to new fare)..."
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-[#1ABC9C] mb-3" />
              <div className="flex gap-3 mb-4">
                <button onClick={() => handleQuote('reissue-quote')} disabled={loading || !uniqueId.trim()}
                  className="flex items-center gap-2 px-5 py-3 bg-amber-500/15 border border-amber-400/20 rounded-xl text-amber-400 text-sm font-bold hover:bg-amber-500/25 disabled:opacity-50">
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Get Reissue Quote
                </button>
                <button onClick={() => handleExecute('reissue')} disabled={execLoading || !uniqueId.trim() || !quoteResult?.success}
                  className="flex items-center gap-2 px-5 py-3 bg-blue-500/15 border border-blue-400/20 rounded-xl text-blue-400 text-sm font-bold hover:bg-blue-500/25 disabled:opacity-50">
                  {execLoading ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />} Execute Reissue
                </button>
              </div>
              <div className="mt-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-emerald-300">Reissue + Collect Difference</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">One click: quote (fare difference + service fee) → charge the customer&apos;s card → execute the reissue. Enter the new FareSourceCode above first.</p>
                  </div>
                  <button onClick={openReissue} disabled={!newFSC.trim() || (!bookingId.trim() && !uniqueId.trim())}
                    className="shrink-0 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-bold">
                    Reissue + Collect
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Status Tab ── */}
          {activeTab === 'status' && (
            <div>
              <h3 className="text-white font-black text-lg mb-1">PTR Status Search</h3>
              <p className="text-slate-400 text-sm mb-4">Check Mystifly Post-Ticketing Request status by UniqueID</p>
              <button onClick={handleStatusSearch} disabled={loading || !uniqueId.trim()}
                className="flex items-center gap-2 px-5 py-3 bg-[#1ABC9C]/15 border border-[#1ABC9C]/20 rounded-xl text-[#1ABC9C] text-sm font-bold hover:bg-[#1ABC9C]/25 disabled:opacity-50 mb-4">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Search PTR Status
              </button>
            </div>
          )}

          {/* Quote Result */}
          {quoteResult && (
            <div className={`p-4 rounded-xl border mb-3 ${quoteResult.error ? 'bg-red-400/10 border-red-400/20' : 'bg-emerald-400/10 border-emerald-400/20'}`}>
              {quoteResult.error ? (
                <p className="text-red-400 text-sm font-semibold flex items-center gap-2"><XCircle size={14} /> {quoteResult.error}</p>
              ) : (
                <div>
                  <p className="text-emerald-400 text-sm font-bold flex items-center gap-2 mb-2"><CheckCircle2 size={14} /> Quote received</p>
                  {quoteResult.quote && (
                    <div className="grid grid-cols-3 gap-3 mb-2">
                      {quoteResult.quote.TotalAmount != null && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase">Total</p>
                          <p className="text-sm font-black text-white">{fmt(quoteResult.quote.TotalAmount, quoteResult.quote.Currency)}</p>
                        </div>
                      )}
                      {quoteResult.quote.PenaltyAmount != null && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase">Penalty</p>
                          <p className="text-sm font-black text-amber-400">{fmt(quoteResult.quote.PenaltyAmount, quoteResult.quote.Currency)}</p>
                        </div>
                      )}
                      {quoteResult.quote.RefundAmount != null && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase">Refund Amount</p>
                          <p className="text-sm font-black text-emerald-400">{fmt(quoteResult.quote.RefundAmount, quoteResult.quote.Currency)}</p>
                        </div>
                      )}
                    </div>
                  )}
                  <details className="bg-slate-900/50 border border-slate-700/30 rounded-xl mt-2">
                    <summary className="px-3 py-2 text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-300 uppercase tracking-wider">Raw Response</summary>
                    <pre className="px-3 pb-3 text-xs text-slate-400 font-mono overflow-x-auto max-h-48">{JSON.stringify(quoteResult, null, 2)}</pre>
                  </details>
                </div>
              )}
            </div>
          )}

          {/* Exec Result */}
          {execResult && (
            <div className={`p-4 rounded-xl border mb-3 ${execResult.error ? 'bg-red-400/10 border-red-400/20' : 'bg-emerald-400/10 border-emerald-400/20'}`}>
              <p className={`text-sm font-bold flex items-center gap-2 ${execResult.error ? 'text-red-400' : 'text-emerald-400'}`}>
                {execResult.error ? <><XCircle size={14} /> {execResult.error}</> : <><CheckCircle2 size={14} /> Operation completed successfully</>}
              </p>
              <details className="bg-slate-900/50 border border-slate-700/30 rounded-xl mt-2">
                <summary className="px-3 py-2 text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-300 uppercase tracking-wider">Raw Response</summary>
                <pre className="px-3 pb-3 text-xs text-slate-400 font-mono overflow-x-auto max-h-48">{JSON.stringify(execResult, null, 2)}</pre>
              </details>
            </div>
          )}

          {/* Status Result */}
          {statusResult && (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <pre className="text-xs text-slate-400 font-mono overflow-x-auto max-h-80">{JSON.stringify(statusResult, null, 2)}</pre>
            </div>
          )}
        </div>

        {/* Right Panel — PTR History */}
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4">
          <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
            <Clock size={14} className="text-slate-500" /> PTR History
            <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 text-[9px] font-bold uppercase">Mystifly</span>
          </h3>
          {recordsLoading ? (
            <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-slate-500" /></div>
          ) : ptrRecords.length === 0 ? (
            <p className="text-slate-500 text-xs text-center py-8">
              {bookingId ? 'No PTR records for this booking' : 'Enter a Booking ID to see history'}
            </p>
          ) : (
            <div className="space-y-2">
              {ptrRecords.map((r: any) => (
                <div key={r.id} className="bg-slate-900/50 border border-slate-700/30 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-white">{r.requestType.replace(/_/g, ' ')}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border ${STATUS_COLORS[r.status] || 'bg-slate-700/50 text-slate-400 border-slate-600/30'}`}>
                      {r.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 space-y-0.5">
                    <p>MFRef: <span className="text-slate-400 font-mono">{r.providerUniqueId}</span></p>
                    {r.quoteTotalAmount && <p>Quote: <span className="text-amber-400 font-bold">{fmt(Number(r.quoteTotalAmount), r.quoteCurrency)}</span></p>}
                    {r.quoteRefundAmount && <p>Refund: <span className="text-emerald-400 font-bold">{fmt(Number(r.quoteRefundAmount), r.quoteCurrency)}</span></p>}
                    <p>By: {r.requestedBy} · {new Date(r.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Force Cancel + Refund modal ── */}
      {fcOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => { if (!fcSubmitting) setFcOpen(false); }}>
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <h3 className="text-white font-bold text-base flex items-center gap-2">
                <RotateCcw size={16} className="text-red-400" /> Force Cancel + Refund
              </h3>
              <button onClick={() => { if (!fcSubmitting) setFcOpen(false); }} className="text-slate-400 hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {fcResult ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-200">
                  <p className="font-bold text-emerald-300 mb-1">✓ Cancellation submitted</p>
                  <p>Refund: <span className="font-bold">{fcResult?.refundAmount ?? fcResult?.netRefundAmount ?? '—'} {fcResult?.refundCurrency ?? ''}</span></p>
                  <p>Status: {fcResult?.paymentStatus ?? fcResult?.newStatus ?? 'CANCELLED'}</p>
                  <p className="text-emerald-400/70 text-xs mt-1">The customer&apos;s Stripe refund is processing — check the booking timeline.</p>
                  <button onClick={() => setFcOpen(false)} className="mt-3 px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-bold">Close</button>
                </div>
              ) : (
                <>
                  {fcLoadingQuote && <p className="text-slate-400 text-sm">Fetching live provider quote…</p>}
                  {fcError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{fcError}</div>}
                  {fcQuote && (
                    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-300 space-y-1">
                      <div className="flex justify-between"><span className="text-slate-500">Route</span><span>{fcQuote.route}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Airline PNR</span><span className="font-mono">{fcQuote.airlinePnr ?? '—'}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Method</span><span className="font-bold">{fcQuote.method}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">PTR #</span><span className="font-mono">{fcQuote.ptrNumber}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Provider refund</span><span>{fcQuote.providerRefund} {fcQuote.refundCurrency}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Airline penalty</span><span>{fcQuote.airlinePenalty ?? '—'}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">FareMind service fee</span><span className="text-amber-400">− {fcQuote.serviceFee ?? 0} USD</span></div>
                      <div className="flex justify-between border-t border-slate-700 pt-1 mt-1"><span className="text-slate-400 font-bold">Net refund to customer</span><span className="font-bold text-[#1ABC9C]">{fcQuote.netRefund ?? '—'} USD</span></div>
                    </div>
                  )}
                  {fcQuote?.notice && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-300 leading-snug">
                      ⚠ {fcQuote.notice}
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Confirmed refund to customer (USD)</label>
                    <input value={fcAmount} onChange={e => setFcAmount(e.target.value)} placeholder="Leave blank to use provider/auto amount"
                      className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-[#1ABC9C]" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Reason (optional)</label>
                    <input value={fcReason} onChange={e => setFcReason(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-[#1ABC9C]" />
                  </div>
                  <p className="text-[11px] text-amber-400/80">Executes the provider cancellation (PTR) and refunds the customer via Stripe. This cannot be undone.</p>
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setFcOpen(false)} disabled={fcSubmitting} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm font-bold disabled:opacity-40">Cancel</button>
                    <button onClick={submitForceCancel} disabled={fcSubmitting || fcLoadingQuote} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-bold disabled:opacity-40">
                      {fcSubmitting ? 'Processing…' : 'Confirm Cancel + Refund'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Reissue + Collect Difference modal ── */}
      {riOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => { if (!riSubmitting) setRiOpen(false); }}>
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <h3 className="text-white font-bold text-base flex items-center gap-2">
                <ArrowLeftRight size={16} className="text-emerald-400" /> Reissue + Collect Difference
              </h3>
              <button onClick={() => { if (!riSubmitting) setRiOpen(false); }} className="text-slate-400 hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {riResult ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-200">
                  <p className="font-bold text-emerald-300 mb-1">✓ Reissued</p>
                  <p>Collected: <span className="font-bold">{riResult?.collected ?? '—'} {riResult?.currency ?? 'USD'}</span> (fare diff {riResult?.fareDifference ?? '—'} + service fee {riResult?.serviceFee ?? '—'})</p>
                  <p>PTR #: <span className="font-mono">{riResult?.ptrNumber ?? '—'}</span></p>
                  <button onClick={() => setRiOpen(false)} className="mt-3 px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-bold">Close</button>
                </div>
              ) : (
                <>
                  {riLoadingQuote && <p className="text-slate-400 text-sm">Fetching reissue quote…</p>}
                  {riError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">{riError}</div>}
                  {riQuote && (
                    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-300 space-y-1">
                      <div className="flex justify-between"><span className="text-slate-500">Route</span><span>{riQuote.route}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Airline PNR</span><span className="font-mono">{riQuote.airlinePnr ?? '—'}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">PTR #</span><span className="font-mono">{riQuote.ptrNumber}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Fare difference</span><span>{riQuote.fareDifference} {riQuote.currency}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Airline penalty</span><span>{riQuote.penalty} {riQuote.currency}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Service fee</span><span>{riQuote.serviceFee} {riQuote.currency}</span></div>
                      <div className="flex justify-between border-t border-slate-700 pt-1 mt-1 font-bold text-white"><span>Total to charge customer</span><span>{riQuote.totalCollect} {riQuote.currency}</span></div>
                    </div>
                  )}
                  <p className="text-[11px] text-amber-400/80">Confirm charges the customer&apos;s card for the total above, then reissues the ticket. If the charge fails, the reissue is NOT executed.</p>
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setRiOpen(false)} disabled={riSubmitting} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm font-bold disabled:opacity-40">Cancel</button>
                    <button onClick={submitReissue} disabled={riSubmitting || riLoadingQuote || !riQuote} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-40">
                      {riSubmitting ? 'Processing…' : 'Confirm Reissue + Charge'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
