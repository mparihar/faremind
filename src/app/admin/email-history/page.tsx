'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch, useAdminStore } from '@/store/useAdminStore';
import {
  RefreshCw, Search, Mail, Clock, User, CheckCircle2, XCircle,
  AlertTriangle, Filter, Send, Eye, ChevronRight, MailOpen, Trash2, CalendarDays, Loader2,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

// ── Types ────────────────────────────────────────────────────────────────────

type EmailStatus = 'SENT' | 'DELIVERED' | 'OPENED' | 'FAILED' | 'BOUNCED';

interface EmailRecord {
  id: string;
  recipient: string;
  recipientName: string;
  subject: string;
  template: string;
  status: EmailStatus;
  sentAt: string;
  openedAt?: string | null;
  bookingRef?: string | null;
  provider: string;
  errorMessage?: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<EmailStatus, { cls: string; icon: React.ElementType }> = {
  SENT:      { cls: 'bg-blue-400/15 text-blue-400',     icon: Send },
  DELIVERED: { cls: 'bg-emerald-400/15 text-emerald-400', icon: CheckCircle2 },
  OPENED:    { cls: 'bg-[#1ABC9C]/15 text-[#1ABC9C]',   icon: MailOpen },
  FAILED:    { cls: 'bg-red-400/15 text-red-400',        icon: XCircle },
  BOUNCED:   { cls: 'bg-amber-400/15 text-amber-400',    icon: AlertTriangle },
};

const TEMPLATES = [...new Set([
  // From notify.ts (frontend + backend)
  'Booking Confirmation', 'Booking Pending', 'Booking Failed', 'Cancellation Notice',
  'Booking Updated', 'Passenger Updated', 'Date Change Requested', 'Date Change Approved',
  'Date Change Rejected', 'Flight Changed', 'Seat Updated', 'Payment Receipt',
  'Payment Failed', 'Price Alert', 'Price Drop Refund', 'Check-in Reminder',
  'Trip Reminder', 'Support Request',
  // Admin copies (backend notify.ts)
  '[Admin] Booking Confirmation', '[Admin] Booking Pending', '[Admin] Booking Failed',
  '[Admin] Cancellation Notice', '[Admin] Booking Updated', '[Admin] Passenger Updated',
  '[Admin] Flight Changed', '[Admin] Seat Updated', '[Admin] Payment Receipt',
  '[Admin] Payment Failed', '[Admin] Price Drop Refund', '[Admin] Support Request',
  '[Admin] Date Change Requested', '[Admin] Date Change Approved', '[Admin] Date Change Rejected',
  // From email.ts (admin console emails)
  'OTP Verification', 'Support Role Granted', 'Ticket Assigned',
  'Failed Booking Assigned', 'Failed Booking Resolved',
  // From manage-booking-emails.ts
  'Refund Processed', 'Refund Initiated', 'Seat Changed', 'Itinerary',
  'Admin Notification', 'General',
])].sort();

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EmailHistoryPage() {
  const router = useRouter();
  const { user: adminUser } = useAdminStore();
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EmailStatus | ''>('');
  const [templateFilter, setTemplateFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const handleDeleteEmail = async (emailId: string) => {
    if (!confirm('Delete this email record?')) return;
    setDeleting(emailId);
    try {
      const res = await adminFetch(`/api/admin/email-history/${emailId}`, { method: 'DELETE' });
      if (res.ok) {
        setEmails(prev => prev.filter(e => e.id !== emailId));
        if (expandedId === emailId) setExpandedId(null);
      } else {
        alert('Failed to delete email record');
      }
    } catch (e) {
      console.error('Delete failed', e);
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!rangeFrom || !rangeTo) return;
    const from = new Date(rangeFrom);
    const to = new Date(rangeTo);
    if (from > to) { alert('"From" date must be before "To" date'); return; }
    const count = filtered.filter(e => {
      const d = new Date(e.sentAt);
      return d >= from && d <= new Date(new Date(rangeTo).setHours(23, 59, 59, 999));
    }).length;
    if (!window.confirm(`Delete ${count} email record(s) from ${rangeFrom} to ${rangeTo}?`)) return;
    setBulkDeleting(true);
    try {
      const res = await adminFetch('/api/admin/email-history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: rangeFrom, to: rangeTo }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Deleted ${data.deletedCount} email record(s)`);
        setRangeFrom(''); setRangeTo('');
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to delete');
      }
    } catch { alert('Network error'); }
    setBulkDeleting(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/email-history');
      if (res.ok) {
        const json = await res.json();
        setEmails(json.emails || []);
      } else {
        setEmails([]);
      }
    } catch (e) {
      console.error('Failed to load email history', e);
      setEmails([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = emails.filter(e => {
    if (statusFilter && e.status !== statusFilter) return false;
    if (templateFilter && e.template !== templateFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.id.toLowerCase().includes(q) ||
        e.recipient.toLowerCase().includes(q) ||
        e.recipientName.toLowerCase().includes(q) ||
        e.subject.toLowerCase().includes(q) ||
        (e.bookingRef?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  const stats = {
    total: emails.length,
    delivered: emails.filter(e => e.status === 'DELIVERED' || e.status === 'OPENED').length,
    opened: emails.filter(e => e.status === 'OPENED').length,
    failed: emails.filter(e => e.status === 'FAILED' || e.status === 'BOUNCED').length,
  };

  const deliveryRate = stats.total > 0 ? Math.round((stats.delivered / stats.total) * 100) : 0;
  const openRate = stats.delivered > 0 ? Math.round((stats.opened / stats.delivered) * 100) : 0;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Email Notification History</h1>
          <p className="text-slate-400 text-sm mt-0.5">{emails.length} emails · {deliveryRate}% delivery rate · {openRate}% open rate</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Sent', value: stats.total, icon: Send, color: 'text-blue-400', bg: 'bg-blue-400/10 border-blue-400/20' },
          { label: 'Delivered', value: stats.delivered, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/20' },
          { label: 'Opened', value: stats.opened, icon: MailOpen, color: 'text-[#1ABC9C]', bg: 'bg-[#1ABC9C]/10 border-[#1ABC9C]/20' },
          { label: 'Failed / Bounced', value: stats.failed, icon: XCircle, color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/20' },
        ].map(s => (
          <div key={s.label} className={`p-4 rounded-2xl border ${s.bg}`}>
            <div className="flex items-center gap-2 mb-2">
              <s.icon size={14} className={s.color} />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{s.label}</span>
            </div>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by email, recipient, booking ref…"
            className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as EmailStatus | '')}
          className="px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
        >
          <option value="">All Statuses</option>
          {(Object.keys(STATUS_STYLES) as EmailStatus[]).map(s => (
            <option key={s} value={s} className="bg-slate-800">{s}</option>
          ))}
        </select>
        <select
          value={templateFilter}
          onChange={e => setTemplateFilter(e.target.value)}
          className="px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
        >
          <option value="">All Templates</option>
          {TEMPLATES.map(t => (
            <option key={t} value={t} className="bg-slate-800">{t}</option>
          ))}
        </select>
      </div>

      {/* Date Range Bulk Delete */}
      <div className="flex items-center gap-3 mb-5 p-4 bg-slate-800/50 border border-slate-700/50 rounded-2xl flex-wrap">
        <CalendarDays size={14} className="text-slate-400 shrink-0" />
        <span className="text-xs text-slate-400 font-semibold shrink-0">Delete Range:</span>
        <input
          type="date"
          value={rangeFrom}
          onChange={e => setRangeFrom(e.target.value)}
          className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-300 text-xs focus:outline-none focus:border-[#1ABC9C] transition-all [color-scheme:dark]"
        />
        <span className="text-slate-600 text-xs">to</span>
        <input
          type="date"
          value={rangeTo}
          onChange={e => setRangeTo(e.target.value)}
          className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-300 text-xs focus:outline-none focus:border-[#1ABC9C] transition-all [color-scheme:dark]"
        />
        <button
          onClick={handleBulkDelete}
          disabled={!rangeFrom || !rangeTo || bulkDeleting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {bulkDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          Delete Range
        </button>
      </div>

      {/* Emails table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50">
              {['ID', 'Recipient', 'Subject', 'Template', 'Booking', 'Status', 'Provider', 'Created At', 'Actions'].map(h => (
                <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {loading ? (
              <tr><td colSpan={9} className="px-5 py-12 text-center">
                <RefreshCw size={20} className="text-[#1ABC9C] animate-spin mx-auto" />
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-5 py-12 text-center text-slate-500">No emails found</td></tr>
            ) : (
              filtered.map(email => {
                const StatusIcon = STATUS_STYLES[email.status]?.icon ?? Mail;
                const isExpanded = expandedId === email.id;
                return (
                  <Fragment key={email.id}>
                    <tr
                      className="hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : email.id)}
                    >
                      <td className="px-5 py-3.5">
                        <span className="text-[#1ABC9C] font-bold text-xs">{email.id}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div>
                          <p className="text-white text-xs font-semibold">{email.recipientName}</p>
                          <p className="text-slate-500 text-[10px]">{email.recipient}</p>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-slate-300 text-xs truncate max-w-[220px]">{email.subject}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-slate-400 text-xs">{email.template}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        {email.bookingRef ? (
                          <span className="text-[#1ABC9C] text-xs font-semibold">{email.bookingRef}</span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_STYLES[email.status]?.cls ?? ''}`}>
                          <StatusIcon size={10} />
                          {email.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-slate-500 text-xs">{email.provider}</span>
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        <p className="text-slate-300">{format(new Date(email.sentAt), 'dd MMM yyyy')}</p>
                        <p className="text-slate-500 text-[10px]">{format(new Date(email.sentAt), 'HH:mm:ss')}</p>
                      </td>
                      <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : email.id)}
                            className="p-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
                            title="View details"
                          >
                            <ChevronRight size={13} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          </button>
                          <button
                            onClick={() => handleDeleteEmail(email.id)}
                            disabled={deleting === email.id}
                            className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-30"
                            title="Delete email record"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${email.id}-detail`}>
                        <td colSpan={9} className="px-5 py-4 bg-slate-900/50">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                            <div>
                              <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Sent At</p>
                              <p className="text-slate-300">{format(new Date(email.sentAt), 'dd MMM yyyy HH:mm:ss')}</p>
                            </div>
                            {email.openedAt && (
                              <div>
                                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Opened At</p>
                                <p className="text-slate-300">{format(new Date(email.openedAt), 'dd MMM yyyy HH:mm:ss')}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Provider</p>
                              <p className="text-slate-300">{email.provider}</p>
                            </div>
                            {email.errorMessage && (
                              <div>
                                <p className="text-[10px] text-red-400 uppercase font-bold mb-1">Error</p>
                                <p className="text-red-300">{email.errorMessage}</p>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
