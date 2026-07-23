'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Ban, RotateCcw, ArrowLeftRight, Search, Loader2, CheckCircle2,
  XCircle, AlertTriangle, Clock, DollarSign, FileText, Copy, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Agent Post-Booking Servicing Page — MYSTIFLY ONLY
 *
 * This page handles Post-Ticketing Requests (PTR) exclusively for
 * Mystifly bookings. Duffel has a completely different servicing
 * model and is NOT handled here.
 *
 * Supported operations:
 *   - Void Quote / Void
 *   - Refund Quote / Refund
 *   - Reissue Quote / Reissue
 *   - PTR Status Search
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

export default function AgentPostBookingPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<PtrTab>('void');

  // State for each PTR type
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
  const [copied, setCopied] = useState(false);

  // DB records
  const [ptrRecords, setPtrRecords] = useState<any[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  // Load existing PTR records for the booking
  useEffect(() => {
    if (bookingId) loadPtrRecords();
  }, [bookingId]);

  async function loadPtrRecords() {
    setRecordsLoading(true);
    try {
      const res = await fetch(`/api/agent/mystifly-ptr/records?bookingId=${bookingId}`);
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
      const body: any = { uniqueId: uniqueId.trim(), requestedBy: 'agent' };
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
      const body: any = { uniqueId: uniqueId.trim(), requestedBy: 'agent' };
      if (quoteResult?.ptrId) body.ptrId = quoteResult.ptrId;
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

  async function handleForceCancel() {
    const target = (bookingId.trim() || uniqueId.trim());
    if (!target) { setExecResult({ error: 'Enter a Booking ID (or MFRef) first.' }); return; }
    if (!window.confirm('Force Cancel + Refund this booking?\n\nThis executes the provider cancellation (void/refund PTR) AND refunds the customer via Stripe. This cannot be undone.')) return;
    const amtStr = window.prompt('Confirmed refund amount in USD (leave blank to use the provider/auto amount):', '');
    if (amtStr === null) return; // user cancelled
    const reason = window.prompt('Reason (optional):', '') || '';
    const overrideRefundAmount = amtStr.trim() && !isNaN(parseFloat(amtStr)) ? parseFloat(amtStr) : undefined;
    setExecLoading(true);
    setExecResult(null);
    try {
      const res = await fetch(`/api/agent/bookings/${encodeURIComponent(target)}/force-cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideRefundAmount, reason }),
      });
      const data = await res.json();
      setExecResult(data);
      if (bookingId) loadPtrRecords();
    } catch (e: any) {
      setExecResult({ error: e.message });
    }
    setExecLoading(false);
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

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Booking ID (optional — links PTR to database)</label>
              <input value={bookingId} onChange={e => setBookingId(e.target.value)}
                placeholder="FareMind booking ID (for tracking)..."
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-[#1ABC9C]" />
            </div>
          </div>

          {/* ── Force Cancel + Refund (one-click: provider PTR → Stripe refund → cancel) ── */}
          <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-red-300">Force Cancel + Refund</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Executes the provider void/refund PTR, refunds the customer via Stripe, and cancels the booking. Use for refundable tickets the auto-quote couldn&apos;t process.</p>
              </div>
              <button
                onClick={handleForceCancel}
                disabled={execLoading || (!bookingId.trim() && !uniqueId.trim())}
                className="shrink-0 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-bold"
              >
                {execLoading ? 'Processing…' : 'Force Cancel + Refund'}
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
    </div>
  );
}
