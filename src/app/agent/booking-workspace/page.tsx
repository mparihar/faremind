'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, RefreshCw, Plane, CheckCircle2, XCircle, AlertTriangle,
  Clock, Ticket, Eye, ArrowRight, ChevronDown, Copy, Check,
  FileText, Armchair, StickyNote, Loader2, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type WorkspaceTab = 'lookup' | 'revalidate' | 'trip-details' | 'ticket-status' | 'fare-rules' | 'seat-map' | 'notes';

const TABS: { key: WorkspaceTab; label: string; icon: any; description: string }[] = [
  { key: 'lookup', label: 'Booking Lookup', icon: Search, description: 'Search by PNR or reference' },
  { key: 'revalidate', label: 'Revalidate', icon: RefreshCw, description: 'Check price & availability' },
  { key: 'trip-details', label: 'Trip Details', icon: Eye, description: 'Sync from provider' },
  { key: 'ticket-status', label: 'Ticket Status', icon: Ticket, description: 'Check ticketing status' },
  { key: 'fare-rules', label: 'Fare Rules', icon: FileText, description: 'View fare rules' },
  { key: 'seat-map', label: 'Seat Map', icon: Armchair, description: 'View seat map' },
  { key: 'notes', label: 'Booking Notes', icon: StickyNote, description: 'Add/view notes' },
];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    'CONFIRMED': 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
    'TICKETED': 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
    'TICKETING_PENDING': 'bg-amber-400/15 text-amber-400 border-amber-400/20',
    'CANCELLED': 'bg-red-400/15 text-red-400 border-red-400/20',
    'FAILED': 'bg-red-400/15 text-red-400 border-red-400/20',
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${colors[status] || 'bg-slate-700/50 text-slate-400 border-slate-600/30'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function BookingWorkspacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('lookup');

  // Lookup state
  const [lookupQuery, setLookupQuery] = useState(searchParams.get('ref') || '');
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');

  // Revalidate state
  const [revalFSC, setRevalFSC] = useState('');
  const [revalResult, setRevalResult] = useState<any>(null);
  const [revalLoading, setRevalLoading] = useState(false);

  // Trip Details state
  const [tripMFRef, setTripMFRef] = useState('');
  const [tripResult, setTripResult] = useState<any>(null);
  const [tripLoading, setTripLoading] = useState(false);

  // Ticket Status state
  const [ticketUniqueId, setTicketUniqueId] = useState('');
  const [ticketResult, setTicketResult] = useState<any>(null);
  const [ticketLoading, setTicketLoading] = useState(false);

  // Fare Rules state
  const [fareRuleFSC, setFareRuleFSC] = useState('');
  const [fareRuleResult, setFareRuleResult] = useState<any>(null);
  const [fareRuleLoading, setFareRuleLoading] = useState(false);

  // Seat Map state
  const [seatMapFSC, setSeatMapFSC] = useState('');
  const [seatMapResult, setSeatMapResult] = useState<any>(null);
  const [seatMapLoading, setSeatMapLoading] = useState(false);

  // Notes state
  const [notesUniqueId, setNotesUniqueId] = useState('');
  const [noteText, setNoteText] = useState('');
  const [notesResult, setNotesResult] = useState<any>(null);
  const [notesLoading, setNotesLoading] = useState(false);

  const [copied, setCopied] = useState(false);

  // Auto-lookup on mount if ref provided
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) { setLookupQuery(ref); handleLookup(ref); }
  }, []);

  async function handleLookup(q?: string) {
    const query = q || lookupQuery.trim();
    if (!query) return;
    setLookupLoading(true);
    setLookupError('');
    setLookupResult(null);
    try {
      const res = await fetch(`/api/agent/booking-workspace/lookup?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) { setLookupError(data.error || 'Booking not found'); }
      else { setLookupResult(data); }
    } catch { setLookupError('Network error'); }
    setLookupLoading(false);
  }

  async function handleRevalidate() {
    if (!revalFSC.trim()) return;
    setRevalLoading(true);
    setRevalResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/mystifly/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fareSourceCode: revalFSC.trim() }),
      });
      setRevalResult(await res.json());
    } catch (e: any) { setRevalResult({ error: e.message }); }
    setRevalLoading(false);
  }

  async function handleTripDetails() {
    if (!tripMFRef.trim()) return;
    setTripLoading(true);
    setTripResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/mystifly/trip-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uniqueId: tripMFRef.trim() }),
      });
      setTripResult(await res.json());
    } catch (e: any) { setTripResult({ error: e.message }); }
    setTripLoading(false);
  }

  async function handleTicketStatus() {
    if (!ticketUniqueId.trim()) return;
    setTicketLoading(true);
    setTicketResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/mystifly/ticket-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uniqueId: ticketUniqueId.trim() }),
      });
      setTicketResult(await res.json());
    } catch (e: any) { setTicketResult({ error: e.message }); }
    setTicketLoading(false);
  }

  async function handleFareRules() {
    if (!fareRuleFSC.trim()) return;
    setFareRuleLoading(true);
    setFareRuleResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/mystifly/fare-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fareSourceCode: fareRuleFSC.trim() }),
      });
      setFareRuleResult(await res.json());
    } catch (e: any) { setFareRuleResult({ error: e.message }); }
    setFareRuleLoading(false);
  }

  async function handleSeatMap() {
    if (!seatMapFSC.trim()) return;
    setSeatMapLoading(true);
    setSeatMapResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/mystifly/seat-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fareSourceCode: seatMapFSC.trim() }),
      });
      setSeatMapResult(await res.json());
    } catch (e: any) { setSeatMapResult({ error: e.message }); }
    setSeatMapLoading(false);
  }

  async function handleAddNote() {
    if (!notesUniqueId.trim() || !noteText.trim()) return;
    setNotesLoading(true);
    setNotesResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/mystifly/booking-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uniqueId: notesUniqueId.trim(), notes: [noteText.trim()] }),
      });
      const data = await res.json();
      setNotesResult(data);
      if (!data.error) setNoteText('');
    } catch (e: any) { setNotesResult({ error: e.message }); }
    setNotesLoading(false);
  }

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1ABC9C]/15 flex items-center justify-center">
            <Plane size={20} className="text-[#1ABC9C]" />
          </div>
          Booking Workspace
        </h1>
        <p className="text-slate-400 text-sm mt-1 ml-[52px]">
          Revalidate, manage, and service bookings across providers
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
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

      {/* Tab Content */}
      <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6">

        {/* ── Lookup ── */}
        {activeTab === 'lookup' && (
          <div>
            <h3 className="text-white font-black text-lg mb-1">Booking Lookup</h3>
            <p className="text-slate-400 text-sm mb-4">Search by booking reference, PNR, or Mystifly MFRef</p>
            <div className="flex gap-3 mb-4">
              <input
                value={lookupQuery}
                onChange={e => setLookupQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                placeholder="Enter booking reference, PNR, or MFRef..."
                className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-semibold focus:outline-none focus:border-[#1ABC9C]"
              />
              <button
                onClick={() => handleLookup()}
                disabled={lookupLoading || !lookupQuery.trim()}
                className="flex items-center gap-2 px-6 py-3 bg-[#1ABC9C] rounded-xl text-white text-sm font-bold hover:bg-[#16a085] transition-all disabled:opacity-50"
              >
                {lookupLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Search
              </button>
            </div>
            {lookupError && (
              <div className="p-4 rounded-xl bg-red-400/10 border border-red-400/20 text-red-400 text-sm font-semibold flex items-center gap-2">
                <XCircle size={16} /> {lookupError}
              </div>
            )}
            {lookupResult && (
              <div className="space-y-3">
                {/* Booking Summary */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-white font-black text-lg">
                        {lookupResult.booking?.bookingReference || lookupResult.booking?.id?.slice(0, 8)}
                      </span>
                      <StatusBadge status={lookupResult.booking?.status || 'UNKNOWN'} />
                    </div>
                    <button
                      onClick={() => handleCopy(JSON.stringify(lookupResult, null, 2))}
                      className="p-2 rounded-lg bg-white/5 text-slate-400 hover:text-white"
                    >
                      {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Provider', value: lookupResult.booking?.primaryProvider },
                      { label: 'PNR', value: lookupResult.booking?.pnrs?.[0]?.providerPnr },
                      { label: 'MFRef', value: lookupResult.booking?.mystiflyMfRef },
                      { label: 'Total', value: lookupResult.booking?.totalAmount ? `$${lookupResult.booking.totalAmount}` : '—' },
                      { label: 'Passengers', value: lookupResult.booking?.passengers?.length },
                      { label: 'Created', value: lookupResult.booking?.createdAt ? new Date(lookupResult.booking.createdAt).toLocaleDateString() : '—' },
                      { label: 'Ticketing', value: lookupResult.booking?.ticketingStatus },
                      { label: 'Payment', value: lookupResult.booking?.paymentStatus },
                    ].map(f => (
                      <div key={f.label}>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{f.label}</p>
                        <p className="text-sm font-semibold text-white mt-0.5">{f.value || '—'}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Quick Actions */}
                <div className="flex flex-wrap gap-2">
                  {lookupResult.booking?.mystiflyMfRef && (
                    <button
                      onClick={() => { setTripMFRef(lookupResult.booking.mystiflyMfRef); setActiveTab('trip-details'); }}
                      className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-400/20 rounded-xl text-blue-400 text-xs font-bold hover:bg-blue-500/20"
                    >
                      <Eye size={12} /> Trip Details
                    </button>
                  )}
                  {lookupResult.booking?.mystiflyMfRef && (
                    <button
                      onClick={() => { setTicketUniqueId(lookupResult.booking.mystiflyMfRef); setActiveTab('ticket-status'); }}
                      className="flex items-center gap-2 px-3 py-2 bg-violet-500/10 border border-violet-400/20 rounded-xl text-violet-400 text-xs font-bold hover:bg-violet-500/20"
                    >
                      <Ticket size={12} /> Ticket Status
                    </button>
                  )}
                  {lookupResult.booking?.mystiflyMfRef && (
                    <button
                      onClick={() => { setNotesUniqueId(lookupResult.booking.mystiflyMfRef); setActiveTab('notes'); }}
                      className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-400/20 rounded-xl text-amber-400 text-xs font-bold hover:bg-amber-500/20"
                    >
                      <StickyNote size={12} /> Add Note
                    </button>
                  )}
                </div>
                {/* Raw JSON */}
                <details className="bg-slate-900/50 border border-slate-700/30 rounded-xl">
                  <summary className="px-4 py-2.5 text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-300 uppercase tracking-wider">
                    Raw JSON
                  </summary>
                  <pre className="px-4 pb-4 text-xs text-slate-400 font-mono overflow-x-auto max-h-60">
                    {JSON.stringify(lookupResult, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        )}

        {/* ── Revalidate ── */}
        {activeTab === 'revalidate' && (
          <div>
            <h3 className="text-white font-black text-lg mb-1">Revalidate Flight</h3>
            <p className="text-slate-400 text-sm mb-4">Check if a fare is still available and get the latest price</p>
            <div className="flex gap-3 mb-4">
              <input value={revalFSC} onChange={e => setRevalFSC(e.target.value)} placeholder="FareSourceCode..."
                className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-[#1ABC9C]" />
              <button onClick={handleRevalidate} disabled={revalLoading || !revalFSC.trim()}
                className="px-6 py-3 bg-[#1ABC9C] rounded-xl text-white text-sm font-bold hover:bg-[#16a085] disabled:opacity-50 flex items-center gap-2">
                {revalLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Revalidate
              </button>
            </div>
            {revalResult && (
              <div className={`p-4 rounded-xl border ${revalResult.error ? 'bg-red-400/10 border-red-400/20' : 'bg-emerald-400/10 border-emerald-400/20'}`}>
                {revalResult.error ? (
                  <p className="text-red-400 text-sm font-semibold">{revalResult.error}</p>
                ) : (
                  <div>
                    <p className="text-emerald-400 text-sm font-bold flex items-center gap-2"><CheckCircle2 size={14} /> Fare is valid</p>
                    <pre className="mt-2 text-xs text-slate-400 font-mono overflow-x-auto max-h-60">{JSON.stringify(revalResult, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Trip Details ── */}
        {activeTab === 'trip-details' && (
          <div>
            <h3 className="text-white font-black text-lg mb-1">Trip Details</h3>
            <p className="text-slate-400 text-sm mb-4">Fetch booking details from Mystifly by MFRef</p>
            <div className="flex gap-3 mb-4">
              <input value={tripMFRef} onChange={e => setTripMFRef(e.target.value)} placeholder="Mystifly MFRef (UniqueID)..."
                className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-[#1ABC9C]" />
              <button onClick={handleTripDetails} disabled={tripLoading || !tripMFRef.trim()}
                className="px-6 py-3 bg-[#1ABC9C] rounded-xl text-white text-sm font-bold hover:bg-[#16a085] disabled:opacity-50 flex items-center gap-2">
                {tripLoading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Fetch
              </button>
            </div>
            {tripResult && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                <pre className="text-xs text-slate-400 font-mono overflow-x-auto max-h-96">{JSON.stringify(tripResult, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        {/* ── Ticket Status ── */}
        {activeTab === 'ticket-status' && (
          <div>
            <h3 className="text-white font-black text-lg mb-1">Ticket Status</h3>
            <p className="text-slate-400 text-sm mb-4">Check Mystifly ticketing status by UniqueID</p>
            <div className="flex gap-3 mb-4">
              <input value={ticketUniqueId} onChange={e => setTicketUniqueId(e.target.value)} placeholder="Mystifly UniqueID..."
                className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-[#1ABC9C]" />
              <button onClick={handleTicketStatus} disabled={ticketLoading || !ticketUniqueId.trim()}
                className="px-6 py-3 bg-[#1ABC9C] rounded-xl text-white text-sm font-bold hover:bg-[#16a085] disabled:opacity-50 flex items-center gap-2">
                {ticketLoading ? <Loader2 size={14} className="animate-spin" /> : <Ticket size={14} />} Check
              </button>
            </div>
            {ticketResult && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                {ticketResult.ticketStatus && (
                  <div className="mb-3">
                    <StatusBadge status={ticketResult.ticketStatus} />
                    {ticketResult.ticketNumbers?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {ticketResult.ticketNumbers.map((tn: string, i: number) => (
                          <span key={i} className="px-2 py-1 bg-emerald-400/10 border border-emerald-400/20 rounded text-xs text-emerald-400 font-mono">{tn}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <pre className="text-xs text-slate-400 font-mono overflow-x-auto max-h-60">{JSON.stringify(ticketResult, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        {/* ── Fare Rules ── */}
        {activeTab === 'fare-rules' && (
          <div>
            <h3 className="text-white font-black text-lg mb-1">Fare Rules</h3>
            <p className="text-slate-400 text-sm mb-4">View fare rules for a FareSourceCode</p>
            <div className="flex gap-3 mb-4">
              <input value={fareRuleFSC} onChange={e => setFareRuleFSC(e.target.value)} placeholder="FareSourceCode..."
                className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-[#1ABC9C]" />
              <button onClick={handleFareRules} disabled={fareRuleLoading || !fareRuleFSC.trim()}
                className="px-6 py-3 bg-[#1ABC9C] rounded-xl text-white text-sm font-bold hover:bg-[#16a085] disabled:opacity-50 flex items-center gap-2">
                {fareRuleLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Fetch
              </button>
            </div>
            {fareRuleResult && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                {fareRuleResult.FareRules && Array.isArray(fareRuleResult.FareRules) ? (
                  <div className="space-y-3">
                    {fareRuleResult.FareRules.map((rule: any, i: number) => (
                      <details key={i} className="bg-slate-900/50 border border-slate-700/30 rounded-xl">
                        <summary className="px-4 py-2.5 text-sm font-bold text-white cursor-pointer">
                          {rule.Category || rule.Title || `Rule ${i + 1}`}
                        </summary>
                        <div className="px-4 pb-4 text-xs text-slate-400 whitespace-pre-wrap font-mono">
                          {rule.Rules || rule.RuleText || JSON.stringify(rule, null, 2)}
                        </div>
                      </details>
                    ))}
                  </div>
                ) : (
                  <pre className="text-xs text-slate-400 font-mono overflow-x-auto max-h-96">{JSON.stringify(fareRuleResult, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Seat Map ── */}
        {activeTab === 'seat-map' && (
          <div>
            <h3 className="text-white font-black text-lg mb-1">Seat Map</h3>
            <p className="text-slate-400 text-sm mb-4">View available seats for a FareSourceCode</p>
            <div className="flex gap-3 mb-4">
              <input value={seatMapFSC} onChange={e => setSeatMapFSC(e.target.value)} placeholder="FareSourceCode..."
                className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-[#1ABC9C]" />
              <button onClick={handleSeatMap} disabled={seatMapLoading || !seatMapFSC.trim()}
                className="px-6 py-3 bg-[#1ABC9C] rounded-xl text-white text-sm font-bold hover:bg-[#16a085] disabled:opacity-50 flex items-center gap-2">
                {seatMapLoading ? <Loader2 size={14} className="animate-spin" /> : <Armchair size={14} />} Fetch
              </button>
            </div>
            {seatMapResult && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                <pre className="text-xs text-slate-400 font-mono overflow-x-auto max-h-96">{JSON.stringify(seatMapResult, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        {/* ── Booking Notes ── */}
        {activeTab === 'notes' && (
          <div>
            <h3 className="text-white font-black text-lg mb-1">Booking Notes</h3>
            <p className="text-slate-400 text-sm mb-4">Add internal remarks to a Mystifly booking</p>
            <div className="space-y-3 mb-4">
              <input value={notesUniqueId} onChange={e => setNotesUniqueId(e.target.value)} placeholder="Mystifly UniqueID..."
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-[#1ABC9C]" />
              <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Enter note text..."
                rows={3} className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] resize-none" />
              <button onClick={handleAddNote} disabled={notesLoading || !notesUniqueId.trim() || !noteText.trim()}
                className="px-6 py-3 bg-[#1ABC9C] rounded-xl text-white text-sm font-bold hover:bg-[#16a085] disabled:opacity-50 flex items-center gap-2">
                {notesLoading ? <Loader2 size={14} className="animate-spin" /> : <StickyNote size={14} />} Add Note
              </button>
            </div>
            {notesResult && (
              <div className={`p-4 rounded-xl border ${notesResult.error ? 'bg-red-400/10 border-red-400/20' : 'bg-emerald-400/10 border-emerald-400/20'}`}>
                <p className={`text-sm font-semibold ${notesResult.error ? 'text-red-400' : 'text-emerald-400'}`}>
                  {notesResult.error || 'Note added successfully'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
