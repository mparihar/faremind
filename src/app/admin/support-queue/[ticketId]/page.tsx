'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch, useAdminStore } from '@/store/useAdminStore';
import { 
  ArrowLeft, RefreshCw, Send, AlertTriangle, CheckCircle2, 
  Clock, Inbox, User, ArrowUpCircle, MessageSquare, Tag, 
  Trash2, XCircle, Plane, CreditCard, Calendar, MapPin,
  Phone, Mail, ExternalLink, ShieldAlert, Users,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  LOW:    'bg-slate-400/15 text-slate-400 border-slate-400/20',
  MEDIUM: 'bg-blue-400/15 text-blue-400 border-blue-400/20',
  HIGH:   'bg-amber-400/15 text-amber-400 border-amber-400/20',
  URGENT: 'bg-red-400/15 text-red-400 border-red-400/20',
};

const STATUS_STYLES: Record<TicketStatus, { cls: string; icon: React.ElementType }> = {
  OPEN:              { cls: 'bg-blue-400/15 text-blue-400',    icon: Inbox },
  IN_PROGRESS:       { cls: 'bg-amber-400/15 text-amber-400', icon: Clock },
  WAITING_CUSTOMER:  { cls: 'bg-purple-400/15 text-purple-400', icon: User },
  ESCALATED:         { cls: 'bg-red-400/15 text-red-400',     icon: ArrowUpCircle },
  RESOLVED:          { cls: 'bg-emerald-400/15 text-emerald-400', icon: CheckCircle2 },
  CLOSED:            { cls: 'bg-slate-400/15 text-slate-400',  icon: XCircle },
};

const CATEGORY_STYLES: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  'Cancellation Request': { bg: 'bg-red-500/10 border-red-500/20', text: 'text-red-400', icon: XCircle },
  'Flight Change Request': { bg: 'bg-purple-500/10 border-purple-500/20', text: 'text-purple-400', icon: Calendar },
  'Failed Booking':        { bg: 'bg-red-500/10 border-red-500/20', text: 'text-red-400', icon: ShieldAlert },
  'Booking Issue':         { bg: 'bg-amber-500/10 border-amber-500/20', text: 'text-amber-400', icon: AlertTriangle },
  'Payment Problem':       { bg: 'bg-orange-500/10 border-orange-500/20', text: 'text-orange-400', icon: CreditCard },
  'Cancellation':          { bg: 'bg-red-500/10 border-red-500/20', text: 'text-red-400', icon: XCircle },
  'Change Request':        { bg: 'bg-purple-500/10 border-purple-500/20', text: 'text-purple-400', icon: Calendar },
};

/**
 * Parse structured fields from the description text.
 * The backend writes descriptions in a known format with "Key: Value" lines.
 */
function parseStructuredFields(description: string): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!description) return fields;

  const lines = description.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Match "Key: Value" patterns — skip section headers (──)
    if (trimmed.includes('──') || !trimmed.includes(':')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 2 || colonIdx > 40) continue; // avoid matching timestamps or long prefixes
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (key && value && value !== 'N/A') {
      fields[key] = value;
    }
  }
  return fields;
}

/**
 * Parse passenger list from description text.
 */
function parsePassengers(description: string): { name: string; type: string; ticket?: string }[] {
  const passengers: { name: string; type: string; ticket?: string }[] = [];
  if (!description) return passengers;

  const lines = description.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('•')) continue;
    const content = trimmed.replace(/^•\s*/, '');
    // Pattern: "FirstName LastName (Type)" or "FirstName LastName (Type) — Ticket: XXX"
    const match = content.match(/^(.+?)\s*\(([^)]+)\)(?:\s*—\s*Ticket:\s*(.+))?$/);
    if (match) {
      passengers.push({ name: match[1].trim(), type: match[2].trim(), ticket: match[3]?.trim() });
    }
  }
  return passengers;
}

export default function TicketDetailPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const router = useRouter();
  const { user: adminUser } = useAdminStore();
  const { ticketId } = use(params);
  
  const [ticket, setTicket] = useState<any>(null);
  const [supportStaff, setSupportStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [message, setMessage] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ticketRes, usersRes] = await Promise.all([
        adminFetch(`/api/admin/support-tickets/${ticketId}`),
        adminFetch('/api/admin/users')
      ]);

      if (ticketRes.ok) {
        const json = await ticketRes.json();
        setTicket(json.ticket);
      } else {
        router.push('/admin/support-queue');
      }

      if (usersRes.ok) {
        const json = await usersRes.json();
        setSupportStaff((json.users || []).filter((u: any) => ['SUPPORT', 'SUPER_ADMIN', 'OPS_ADMIN'].includes(u.role)));
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [ticketId, router]);

  useEffect(() => { load(); }, [load]);

  const updateTicket = async (updates: any) => {
    try {
      const res = await adminFetch(`/api/admin/support-tickets/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        load();
      }
    } catch (e) {
      console.error('Update failed', e);
    }
  };

  const deleteTicket = async () => {
    if (!confirm('Are you sure you want to delete this ticket? This cannot be undone.')) return;
    try {
      const res = await adminFetch(`/api/admin/support-tickets/${ticketId}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/admin/support-queue');
      }
    } catch (e) {
      console.error('Delete failed', e);
    }
  };

  const sendMessage = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await adminFetch(`/api/admin/support-tickets/${ticketId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message, isInternal })
      });
      if (res.ok) {
        setMessage('');
        setIsInternal(false);
        load();
      }
    } catch (e) {
      console.error('Send message failed', e);
    }
    setSending(false);
  };

  if (loading) return <div className="p-12 flex justify-center"><RefreshCw className="animate-spin text-[#1ABC9C]" /></div>;
  if (!ticket) return null;

  const StatusIcon = STATUS_STYLES[ticket.status as TicketStatus]?.icon ?? Inbox;
  const isBookingRelated = !!(ticket.bookingRef || ticket.airlinePnr);
  const isCancellation = ticket.category === 'Cancellation Request' || ticket.category === 'Cancellation';
  const isFlightChange = ticket.category === 'Flight Change Request' || ticket.category === 'Change Request';
  const isFailedBooking = ticket.category === 'Failed Booking';
  const hasStructuredData = isCancellation || isFlightChange || isFailedBooking;

  // Parse structured fields from description
  const parsed = parseStructuredFields(ticket.description);
  const passengers = parsePassengers(ticket.description);

  // Derive display ticket number
  const displayTicketNum = ticket.ticketNumber
    || (ticket.sequenceNumber ? `FM-TKT-${String(ticket.sequenceNumber).padStart(4, '0')}` : null);

  // Category badge styling
  const catStyle = CATEGORY_STYLES[ticket.category];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.push('/admin/support-queue')} className="p-2 bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            {displayTicketNum && (
              <span className="text-[#1ABC9C] font-mono font-bold text-sm bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 px-2.5 py-1 rounded-lg shrink-0">
                {displayTicketNum}
              </span>
            )}
            <h1 className="text-2xl font-black text-white truncate">{ticket.subject}</h1>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${PRIORITY_STYLES[ticket.priority as TicketPriority]} shrink-0`}>
              {ticket.priority}
            </span>
          </div>
          <p className="text-slate-400 text-sm">
            Created {format(new Date(ticket.createdAt), 'PPpp')}
            {ticket.channel && ticket.channel !== 'WEB' && (
              <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide ${
                ticket.channel === 'WHATSAPP' ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                  : ticket.channel === 'CHATBOT' ? 'bg-violet-500/15 text-violet-400 border border-violet-500/20'
                  : ticket.channel === 'SYSTEM' ? 'bg-slate-500/15 text-slate-400 border border-slate-500/20'
                  : 'bg-slate-500/15 text-slate-400 border border-slate-500/20'
              }`}>
                {ticket.channel === 'WHATSAPP' ? 'WhatsApp' : ticket.channel === 'CHATBOT' ? 'AI Bot' : ticket.channel === 'SYSTEM' ? 'Auto' : ticket.channel}
              </span>
            )}
          </p>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={load} className="p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-400 hover:text-white transition-colors" title="Refresh">
            <RefreshCw size={16} />
          </button>
          {adminUser?.role === 'SUPER_ADMIN' && (
            <button onClick={deleteTicket} className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-xl text-sm font-semibold transition-all">
              <Trash2 size={16} /> Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main Content (Left) */}
        <div className="col-span-2 space-y-6">

          {/* ── Structured Booking Context Card ─────────────────────────────── */}
          {hasStructuredData && (
            <div className={`rounded-2xl border overflow-hidden ${
              isCancellation ? 'border-red-500/20 bg-red-500/[0.03]'
                : isFlightChange ? 'border-purple-500/20 bg-purple-500/[0.03]'
                : 'border-amber-500/20 bg-amber-500/[0.03]'
            }`}>
              <div className={`px-5 py-3 border-b flex items-center gap-2.5 ${
                isCancellation ? 'border-red-500/10 bg-red-500/5'
                  : isFlightChange ? 'border-purple-500/10 bg-purple-500/5'
                  : 'border-amber-500/10 bg-amber-500/5'
              }`}>
                {isCancellation && <XCircle size={15} className="text-red-400" />}
                {isFlightChange && <Calendar size={15} className="text-purple-400" />}
                {isFailedBooking && <ShieldAlert size={15} className="text-amber-400" />}
                <span className={`text-xs font-black uppercase tracking-wider ${
                  isCancellation ? 'text-red-400' : isFlightChange ? 'text-purple-400' : 'text-amber-400'
                }`}>
                  {ticket.category}
                </span>
              </div>

              <div className="p-5 space-y-4">
                {/* Primary Booking Details */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {/* FareMind Reference */}
                  {(ticket.bookingRef || parsed['Reference'] || parsed['Master Booking Ref']) && (
                    <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">FareMind Ref</p>
                      <p className="text-white text-sm font-bold font-mono">
                        {ticket.bookingRef || parsed['Reference'] || parsed['Master Booking Ref']}
                      </p>
                    </div>
                  )}

                  {/* Airline PNR */}
                  {(ticket.airlinePnr || parsed['Airline PNR'] || parsed['PNR (Airline)']) && (
                    <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Airline PNR</p>
                      <p className="text-[#1ABC9C] text-sm font-bold font-mono">
                        {ticket.airlinePnr || parsed['Airline PNR'] || parsed['PNR (Airline)']}
                      </p>
                    </div>
                  )}

                  {/* Route */}
                  {parsed['Route'] && (
                    <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Plane size={10} /> Route
                      </p>
                      <p className="text-white text-sm font-bold">{parsed['Route']}</p>
                    </div>
                  )}

                  {/* Departure */}
                  {parsed['Departure'] && (
                    <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Calendar size={10} /> {isFlightChange ? 'Current Departure' : 'Departure'}
                      </p>
                      <p className="text-slate-300 text-sm font-semibold">{parsed['Departure']}</p>
                    </div>
                  )}

                  {/* Current Departure (date change) */}
                  {parsed['Current Departure'] && (
                    <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Calendar size={10} /> Current Departure
                      </p>
                      <p className="text-slate-300 text-sm font-semibold">{parsed['Current Departure']}</p>
                    </div>
                  )}

                  {/* Requested New Departure (date change) */}
                  {parsed['Requested New Departure'] && (
                    <div className="p-3 bg-purple-500/5 rounded-xl border border-purple-500/20">
                      <p className="text-[10px] font-black text-purple-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Calendar size={10} /> Requested New Date
                      </p>
                      <p className="text-purple-300 text-sm font-bold">{parsed['Requested New Departure']}</p>
                    </div>
                  )}

                  {/* Amount */}
                  {(parsed['Amount'] || parsed['Booking Amount']) && (
                    <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <CreditCard size={10} /> Amount
                      </p>
                      <p className="text-white text-sm font-bold">{parsed['Amount'] || parsed['Booking Amount']}</p>
                    </div>
                  )}

                  {/* Provider */}
                  {parsed['Provider'] && (
                    <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Provider</p>
                      <p className="text-slate-300 text-sm font-semibold">{parsed['Provider']}</p>
                    </div>
                  )}

                  {/* Provider Order ID */}
                  {parsed['Provider Order ID'] && parsed['Provider Order ID'] !== 'N/A' && (
                    <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Provider Order ID</p>
                      <p className="text-slate-400 text-xs font-mono truncate" title={parsed['Provider Order ID']}>
                        {parsed['Provider Order ID'].length > 24 ? parsed['Provider Order ID'].slice(0, 24) + '…' : parsed['Provider Order ID']}
                      </p>
                    </div>
                  )}

                  {/* Booking Status */}
                  {parsed['Booking Status'] && (
                    <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Booking Status</p>
                      <p className="text-slate-300 text-sm font-semibold">{parsed['Booking Status']}</p>
                    </div>
                  )}

                  {/* Ticketing Status */}
                  {parsed['Ticketing Status'] && (
                    <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Ticketing Status</p>
                      <p className="text-slate-300 text-sm font-semibold">{parsed['Ticketing Status']}</p>
                    </div>
                  )}
                </div>

                {/* Passengers */}
                {passengers.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Users size={11} /> Passengers ({passengers.length})
                    </p>
                    <div className="space-y-1.5">
                      {passengers.map((pax, i) => (
                        <div key={i} className="flex items-center gap-3 p-2.5 bg-slate-800/50 rounded-lg border border-slate-700/30">
                          <div className="w-6 h-6 rounded-md bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300 shrink-0">{i + 1}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold truncate">{pax.name}</p>
                          </div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-700/50 px-2 py-0.5 rounded-full">{pax.type}</span>
                          {pax.ticket && <span className="text-[10px] font-mono text-slate-500">Ticket: {pax.ticket}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Failure Reason or Reason */}
                {(parsed['Reason'] || parsed['Failure Reason']) && (
                  <div className={`flex items-start gap-2.5 px-3.5 py-3 rounded-xl ${
                    isCancellation ? 'bg-red-500/5 border border-red-500/15'
                      : isFlightChange ? 'bg-purple-500/5 border border-purple-500/15'
                      : 'bg-amber-500/5 border border-amber-500/15'
                  }`}>
                    <AlertTriangle size={14} className={`shrink-0 mt-0.5 ${
                      isCancellation ? 'text-red-400' : isFlightChange ? 'text-purple-400' : 'text-amber-400'
                    }`} />
                    <div>
                      <p className={`text-[10px] font-black uppercase tracking-wider mb-0.5 ${
                        isCancellation ? 'text-red-400' : isFlightChange ? 'text-purple-400' : 'text-amber-400'
                      }`}>
                        {parsed['Failure Reason'] ? 'Failure Reason' : 'Reason'}
                      </p>
                      <p className="text-slate-300 text-xs leading-relaxed">{parsed['Reason'] || parsed['Failure Reason']}</p>
                    </div>
                  </div>
                )}

                {/* Link to booking */}
                {ticket.bookingRef && (
                  <button
                    onClick={() => router.push(`/admin/bookings/${ticket.bookingRef}`)}
                    className="flex items-center gap-2 px-4 py-2 bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 text-[#1ABC9C] rounded-xl text-sm font-semibold hover:bg-[#1ABC9C]/20 transition-all"
                  >
                    <ExternalLink size={14} />
                    Open Booking {ticket.bookingRef}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Initial Description ─────────────────────────────────────────── */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-white">
                {ticket.customerName.split(' ').map((n: string) => n[0]).join('')}
              </div>
              <div>
                <p className="text-white font-semibold">{ticket.customerName}</p>
                <p className="text-slate-400 text-sm">{ticket.customerEmail}</p>
              </div>
              <div className="ml-auto text-xs text-slate-500">
                {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
              </div>
            </div>
            <div className="text-slate-300 text-sm whitespace-pre-wrap leading-relaxed">
              {ticket.description}
            </div>
          </div>

          {/* ── Messages ────────────────────────────────────────────────────── */}
          {ticket.messages?.map((msg: any) => (
            <div key={msg.id} className={`p-6 rounded-2xl border ${msg.isInternal ? 'bg-amber-500/5 border-amber-500/20' : 'bg-slate-800/50 border-slate-700/50'}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${msg.sender ? 'bg-[#1ABC9C]/20 text-[#1ABC9C]' : 'bg-slate-700 text-white'}`}>
                  {msg.sender ? msg.sender.fullName[0] : ticket.customerName[0]}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">
                    {msg.sender ? msg.sender.fullName : ticket.customerName}
                    {msg.isInternal && <span className="ml-2 text-[10px] bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded uppercase font-bold tracking-wider">Internal Note</span>}
                  </p>
                </div>
                <div className="ml-auto text-xs text-slate-500">
                  {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                </div>
              </div>
              <div className={`text-sm whitespace-pre-wrap ${msg.isInternal ? 'text-amber-200/80' : 'text-slate-300'}`}>
                {msg.content}
              </div>
            </div>
          ))}

          {/* ── Reply Box ───────────────────────────────────────────────────── */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
            <textarea
              rows={4}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Type your reply..."
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#1ABC9C] mb-4 resize-y"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} className="accent-amber-500 w-4 h-4" />
                <span className="text-sm text-slate-400 font-medium select-none">Internal note (hidden from customer)</span>
              </label>
              <button 
                onClick={sendMessage} 
                disabled={sending || !message.trim()}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-bold text-sm transition-all shadow-lg ${
                  isInternal ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20' : 'bg-[#1ABC9C] hover:bg-[#16a085] shadow-[#1ABC9C]/20'
                } disabled:opacity-50`}
              >
                {sending ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                {isInternal ? 'Add Note' : 'Send Reply'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Sidebar (Right) ─────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Ticket Details */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-4">Ticket Details</h3>
            
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2">Status</label>
                <select 
                  value={ticket.status} 
                  onChange={e => updateTicket({ status: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
                >
                  {(Object.keys(STATUS_STYLES) as TicketStatus[]).map(s => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2">Assignee</label>
                <select 
                  value={ticket.assignedToId || ''} 
                  onChange={e => updateTicket({ assignedToId: e.target.value || null })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
                >
                  <option value="">Unassigned</option>
                  {supportStaff.map(staff => (
                    <option key={staff.id} value={staff.id}>{staff.fullName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2">Priority</label>
                <select 
                  value={ticket.priority} 
                  onChange={e => updateTicket({ priority: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
                >
                  {(Object.keys(PRIORITY_STYLES) as TicketPriority[]).map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              
              <div className="pt-4 border-t border-slate-700/50 space-y-3">
                {/* Category */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400">Category</span>
                  {catStyle ? (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${catStyle.bg} ${catStyle.text}`}>
                      <catStyle.icon size={11} />
                      {ticket.category}
                    </span>
                  ) : (
                    <span className="text-sm font-semibold text-white">{ticket.category}</span>
                  )}
                </div>

                {/* Channel */}
                {ticket.channel && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400">Channel</span>
                    <span className="text-sm font-semibold text-slate-300">{ticket.channel}</span>
                  </div>
                )}

                {/* Booking Ref */}
                {ticket.bookingRef && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400">Booking Ref</span>
                    <button
                      onClick={() => router.push(`/admin/bookings/${ticket.bookingRef}`)}
                      className="text-sm font-bold text-[#1ABC9C] hover:underline cursor-pointer"
                    >
                      {ticket.bookingRef}
                    </button>
                  </div>
                )}

                {/* Airline PNR */}
                {ticket.airlinePnr && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400">Airline PNR</span>
                    <span className="text-sm font-bold text-white font-mono">{ticket.airlinePnr}</span>
                  </div>
                )}

                {/* Messages count */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400">Messages</span>
                  <span className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
                    <MessageSquare size={12} /> {ticket.messages?.length ?? 0}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Customer Contact Card */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-4">Customer</h3>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-sm text-white">
                {ticket.customerName.split(' ').map((n: string) => n[0]).join('')}
              </div>
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">{ticket.customerName}</p>
              </div>
            </div>
            <div className="space-y-2">
              <a href={`mailto:${ticket.customerEmail}`} className="flex items-center gap-2.5 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/20 rounded-xl text-blue-400 text-sm font-semibold transition-all truncate">
                <Mail size={14} className="shrink-0" />
                <span className="truncate">{ticket.customerEmail}</span>
              </a>
              {ticket.customerPhone && (
                <a href={`tel:${ticket.customerPhone}`} className="flex items-center gap-2.5 px-3 py-2 bg-[#1ABC9C]/10 hover:bg-[#1ABC9C]/15 border border-[#1ABC9C]/20 rounded-xl text-[#1ABC9C] text-sm font-semibold transition-all">
                  <Phone size={14} className="shrink-0" />
                  {ticket.customerPhone}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
