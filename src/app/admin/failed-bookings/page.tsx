'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import { useAdminStore } from '@/store/useAdminStore';
import {
  RefreshCw, Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  AlertTriangle, Phone, Mail, Trash2, CheckCircle2, X, Plane, Clock,
  Users, DollarSign, ShieldAlert, Inbox
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

const ERROR_CODE_LABELS: Record<string, { label: string; color: string }> = {
  PROVIDER_ORDER_FAILED:    { label: 'Provider Failed',     color: 'bg-red-500/15 text-red-400' },
  PASSENGER_COUNT_MISMATCH: { label: 'Pax Mismatch',        color: 'bg-amber-500/15 text-amber-400' },
  UNEXPECTED_ERROR:         { label: 'Unexpected',           color: 'bg-purple-500/15 text-purple-400' },
  MISSING_PAYMENT:          { label: 'Missing Payment',      color: 'bg-orange-500/15 text-orange-400' },
  MISSING_OFFER_ID:         { label: 'Missing Offer',        color: 'bg-yellow-500/15 text-yellow-400' },
  PROVIDER_NOT_CONFIGURED:  { label: 'Not Configured',       color: 'bg-slate-500/15 text-slate-400' },
};

const STATUS_STYLES: Record<string, { cls: string; icon: React.ElementType }> = {
  OPEN:              { cls: 'bg-blue-400/15 text-blue-400',    icon: Inbox },
  IN_PROGRESS:       { cls: 'bg-amber-400/15 text-amber-400', icon: Clock },
  RESOLVED:          { cls: 'bg-emerald-400/15 text-emerald-400', icon: CheckCircle2 },
  CLOSED:            { cls: 'bg-slate-400/15 text-slate-400',  icon: X },
};

const REFUND_STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  REFUND_ISSUED:     { label: 'Refunded',       cls: 'bg-emerald-500/15 text-emerald-400' },
  REFUND_PENDING:    { label: 'Refund Pending',  cls: 'bg-amber-500/15 text-amber-400' },
  REFUND_FAILED:     { label: 'Refund Failed',   cls: 'bg-red-500/15 text-red-400' },
  NOT_APPLICABLE:    { label: 'Not Charged',     cls: 'bg-slate-500/15 text-slate-400' },
};

function getErrorBadge(code: string) {
  const entry = ERROR_CODE_LABELS[code] ?? { label: code, color: 'bg-slate-500/15 text-slate-400' };
  return entry;
}

export default function FailedBookingsPage() {
  const router = useRouter();
  const { user: adminUser } = useAdminStore();
  const [records, setRecords] = useState<any[]>([]);
  const [supportStaff, setSupportStaff] = useState<any[]>([]);
  const [total, setTotal]     = useState(0);
  const [pages, setPages]     = useState(1);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [emailSearch, setEmailSearch] = useState('');
  const [dateFrom, setDateFrom]       = useState('');
  const [dateTo, setDateTo]           = useState('');
  const [errorCodeFilter, setErrorCodeFilter] = useState('');
  const [statusFilter, setStatusFilter]   = useState(''); 

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Resolve modal
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');
  const [resolving, setResolving] = useState(false);

  // Delete
  const [deleting, setDeleting] = useState<string | null>(null);

  const isOpsOrAbove = adminUser?.role === 'SUPER_ADMIN' || adminUser?.role === 'OPS_ADMIN';
  const isAdminOrSuper = adminUser?.role === 'SUPER_ADMIN' || adminUser?.role === 'ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    
    // Fetch users for assignment dropdown
    try {
      const usersRes = await adminFetch('/api/admin/users');
      if (usersRes.ok) {
        const json = await usersRes.json();
        setSupportStaff((json.users || []).filter((u: any) => ['SUPPORT', 'SUPER_ADMIN', 'OPS_ADMIN', 'ADMIN'].includes(u.role)));
      }
    } catch (e) {
      console.error(e);
    }

    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (emailSearch.trim()) params.set('email', emailSearch.trim());
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    if (errorCodeFilter) params.set('errorCode', errorCodeFilter);
    if (statusFilter === 'false') {
      params.set('resolved', 'false');
    } else if (statusFilter === 'true') {
      params.set('resolved', 'true');
    }

    const res = await adminFetch(`/api/admin/failed-bookings?${params}`);
    if (res.status === 401) { router.replace('/admin/login'); return; }
    const data = await res.json();
    setRecords(data.records ?? []);
    setTotal(data.total ?? 0);
    setPages(data.pages ?? 1);
    setLoading(false);
  }, [page, emailSearch, dateFrom, dateTo, errorCodeFilter, statusFilter, router]);

  useEffect(() => { load(); }, [load]);

  const updateBooking = async (id: string, updates: any) => {
    try {
      const res = await adminFetch(`/api/admin/failed-bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to update booking');
      } else {
        load();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleResolve = async () => {
    if (!resolveId) return;
    setResolving(true);
    await updateBooking(resolveId, { status: 'RESOLVED', resolutionNotes: resolveNotes });
    setResolveId(null);
    setResolveNotes('');
    setResolving(false);
  };

  const handleStatusChange = (id: string, currentStatus: string, newStatus: string) => {
    if (newStatus === 'RESOLVED') {
      setResolveId(id);
      setResolveNotes('');
    } else {
      updateBooking(id, { status: newStatus });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this failure audit record? This action cannot be undone.')) return;
    setDeleting(id);
    try {
      const res = await adminFetch(`/api/admin/failed-bookings/${id}`, { method: 'DELETE' });
      if (res.ok) load();
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/20 flex items-center justify-center">
            <ShieldAlert size={20} className="text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">Failed Bookings</h1>
            <p className="text-red-400 text-sm mt-0.5 font-bold">
              {total.toLocaleString()} failure record{total !== 1 ? 's' : ''}
              {statusFilter === 'false' && ' (unresolved)'}
              {statusFilter === 'true' && ' (resolved)'}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={emailSearch}
            onChange={e => { setEmailSearch(e.target.value); setPage(1); }}
            placeholder="Search by email…"
            className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Error Code</label>
          <select
            value={errorCodeFilter}
            onChange={e => { setErrorCodeFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
          >
            <option value="">All errors</option>
            {Object.entries(ERROR_CODE_LABELS).map(([code, { label }]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
          >
            <option value="">All</option>
            <option value="false">Unresolved</option>
            <option value="true">Resolved</option>
          </select>
        </div>

        {(emailSearch || dateFrom || dateTo || errorCodeFilter || statusFilter) && (
          <button
            onClick={() => { setEmailSearch(''); setDateFrom(''); setDateTo(''); setErrorCodeFilter(''); setStatusFilter(''); setPage(1); }}
            className="px-3 py-2.5 text-xs text-red-400 hover:text-red-300 font-semibold transition-all"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden min-h-[400px]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50">
                {['', 'Date', 'Customer', 'Route', 'Amount', 'Error', 'Refund', 'Assignee', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {loading ? (
                <tr><td colSpan={10} className="px-5 py-16 text-center">
                  <RefreshCw size={24} className="text-[#1ABC9C] animate-spin mx-auto" />
                </td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={10} className="px-5 py-16 text-center">
                  <AlertTriangle size={24} className="text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">No failed bookings found</p>
                </td></tr>
              ) : records.map((rec: any) => {
                const isExpanded = expandedId === rec.id;
                const badge = getErrorBadge(rec.errorCode);
                const passengers = (() => { try { return JSON.parse(rec.passengersJson); } catch { return []; } })();
                const StatusIcon = STATUS_STYLES[rec.status]?.icon ?? Clock;

                return (
                  <React.Fragment key={rec.id}>
                    <tr
                      className="hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                    >
                      <td className="px-3 py-3 text-slate-400">
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-slate-300 text-xs font-semibold">
                          {format(new Date(rec.createdAt), 'dd MMM yyyy')}
                        </p>
                        <p className="text-slate-500 text-[10px]">
                          {format(new Date(rec.createdAt), 'hh:mm:ss a')}
                        </p>
                      </td>

                      <td className="px-4 py-3">
                        <p className="text-white text-sm font-semibold">{rec.customerName}</p>
                        <p className="text-slate-400 text-xs">{rec.customerEmail}</p>
                        {rec.customerPhone && (
                          <p className="text-slate-500 text-[10px] mt-0.5">{rec.customerPhone}</p>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Plane size={12} className="text-slate-500" />
                          <span className="text-slate-300 text-sm font-medium">{rec.originAirport}</span>
                          <span className="text-slate-500">→</span>
                          <span className="text-slate-300 text-sm font-medium">{rec.destinationAirport}</span>
                        </div>
                        <p className="text-slate-500 text-[10px] mt-0.5">
                          {rec.tripType === 'ROUND_TRIP' ? 'Round Trip' : 'One Way'}
                          {rec.airline ? ` · ${rec.airline}` : ''}
                        </p>
                      </td>

                      <td className="px-4 py-3">
                        <p className="text-white text-sm font-bold">
                          ${Number(rec.totalAmount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </p>
                        <p className="text-slate-500 text-[10px]">{rec.currency}</p>
                      </td>

                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.color}`}>
                          {badge.label}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        {(() => {
                          const rs = REFUND_STATUS_STYLES[rec.refundStatus] ?? { label: '—', cls: 'bg-slate-500/10 text-slate-500' };
                          return (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${rs.cls}`}>
                              {rs.label}
                            </span>
                          );
                        })()}
                      </td>

                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <select 
                          value={rec.assignedToId || ''} 
                          onChange={(e) => updateBooking(rec.id, { assignedToId: e.target.value || null })}
                          className="bg-slate-800 border border-slate-700 rounded-lg text-xs text-white px-2 py-1 focus:outline-none focus:border-[#1ABC9C] max-w-[120px] cursor-pointer"
                        >
                          <option value="">Unassigned</option>
                          {supportStaff.map(staff => (
                            <option key={staff.id} value={staff.id}>{staff.fullName}</option>
                          ))}
                        </select>
                      </td>

                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                         <select 
                          value={rec.status} 
                          onChange={(e) => handleStatusChange(rec.id, rec.status, e.target.value)}
                          className={`bg-slate-800 border border-slate-700 rounded-lg text-xs text-white px-2 py-1 focus:outline-none focus:border-[#1ABC9C] max-w-[120px] cursor-pointer`}
                        >
                          {Object.keys(STATUS_STYLES).map(s => {
                            if (s === 'CLOSED' && !isAdminOrSuper) return null;
                            return <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>;
                          })}
                        </select>
                      </td>

                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          {rec.customerPhone && (
                            <a href={`tel:${rec.customerPhone}`} className="p-1.5 rounded-lg bg-[#1ABC9C]/10 text-[#1ABC9C] hover:bg-[#1ABC9C]/20 transition-all" title="Call customer">
                              <Phone size={12} />
                            </a>
                          )}
                          <a href={`mailto:${rec.customerEmail}`} className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all" title="Email customer">
                            <Mail size={12} />
                          </a>
                          {isOpsOrAbove && (
                            <button onClick={() => handleDelete(rec.id)} disabled={deleting === rec.id} className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-30" title="Delete record">
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={`${rec.id}-detail`} className="bg-slate-900/50">
                        <td colSpan={10} className="px-6 py-5">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div>
                              <h4 className="text-[10px] font-black text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <AlertTriangle size={12} /> Root Cause (Internal)
                              </h4>
                              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                                <p className="text-red-300 text-xs font-mono leading-relaxed break-all">
                                  {rec.errorMessage}
                                </p>
                              </div>

                              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider mt-4 mb-2">
                                Customer Message (Shown to User)
                              </h4>
                              <p className="text-slate-400 text-xs leading-relaxed">{rec.customerMessage}</p>

                              <div className="flex flex-wrap gap-4 mt-4 text-xs">
                                <div><span className="text-slate-500">Failure Stage:</span> <span className="text-slate-300 font-semibold">{rec.failureStage}</span></div>
                                {rec.stripePaymentIntentId && <div><span className="text-slate-500">Stripe PI:</span> <span className="text-slate-300 font-mono text-[11px]">{rec.stripePaymentIntentId}</span></div>}
                                {rec.offerId && <div><span className="text-slate-500">Offer ID:</span> <span className="text-slate-300 font-mono text-[11px]">{rec.offerId.slice(0, 24)}…</span></div>}
                                {rec.sessionId && <div><span className="text-slate-500">Session:</span> <span className="text-slate-300 font-mono text-[11px]">{rec.sessionId.slice(0, 16)}…</span></div>}
                                <div><span className="text-slate-500">Provider:</span> <span className="text-slate-300 font-semibold capitalize">{rec.provider || '—'}</span></div>
                              </div>

                              {/* ── Refund Details ── */}
                              {rec.refundStatus && rec.refundStatus !== 'NOT_APPLICABLE' && (
                                <div className="mt-4 p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                  <h4 className="text-[10px] font-black uppercase tracking-wider mb-2 flex items-center gap-1.5"
                                    style={{ color: rec.refundStatus === 'REFUND_ISSUED' ? '#10b981' : rec.refundStatus === 'REFUND_PENDING' ? '#f59e0b' : '#ef4444' }}>
                                    <DollarSign size={12} />
                                    Refund Details — {REFUND_STATUS_STYLES[rec.refundStatus]?.label || rec.refundStatus}
                                  </h4>
                                  <div className="grid grid-cols-2 gap-3 text-xs">
                                    {rec.refundId && <div><span className="text-slate-500">Refund ID:</span> <span className="text-slate-300 font-mono text-[11px]">{rec.refundId}</span></div>}
                                    {rec.refundAmount != null && <div><span className="text-slate-500">Amount:</span> <span className="text-emerald-400 font-bold">${Number(rec.refundAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>}
                                    {rec.refundedAt && <div><span className="text-slate-500">Refunded At:</span> <span className="text-slate-300 font-semibold">{format(new Date(rec.refundedAt), 'dd MMM yyyy hh:mm:ss a')}</span></div>}
                                    {rec.refundFailureReason && <div className="col-span-2"><span className="text-slate-500">Failure Reason:</span> <span className="text-red-400 font-mono text-[11px]">{rec.refundFailureReason}</span></div>}
                                  </div>
                                </div>
                              )}

                              {(rec.offerProvidedAt || rec.offerExpiresAt) && (
                                <div className="mt-4 p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                  <h4 className="text-[10px] font-black text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Clock size={12} /> Offer Lifecycle</h4>
                                  <div className="grid grid-cols-2 gap-3 text-xs">
                                    <div><span className="text-slate-500">Created:</span> <span className="text-slate-300 font-semibold">{rec.offerProvidedAt ? format(new Date(rec.offerProvidedAt), 'dd MMM hh:mm:ss a') : '—'}</span></div>
                                    <div><span className="text-slate-500">Expires:</span> <span className="text-slate-300 font-semibold">{rec.offerExpiresAt ? format(new Date(rec.offerExpiresAt), 'dd MMM hh:mm:ss a') : '—'}</span></div>
                                  </div>
                                </div>
                              )}

                              {rec.resolvedAt && rec.resolutionNotes && (
                                <div className="mt-4">
                                  <h4 className="text-[10px] font-black text-emerald-400 uppercase tracking-wider mb-1.5">Resolution Notes</h4>
                                  <p className="text-slate-300 text-xs leading-relaxed">{rec.resolutionNotes}</p>
                                  <p className="text-slate-500 text-[10px] mt-1">Resolved by {rec.resolvedBy} on {format(new Date(rec.resolvedAt), 'dd MMM yyyy hh:mm a')}</p>
                                </div>
                              )}
                            </div>

                            <div>
                              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <Users size={12} /> Passengers ({rec.passengerCount})
                              </h4>
                              <div className="space-y-2">
                                {passengers.map((pax: any, i: number) => (
                                  <div key={i} className="flex items-center gap-3 p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                    <div className="w-7 h-7 rounded-lg bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300">{i + 1}</div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-white text-sm font-semibold truncate">{pax.name || 'Unknown'}</p>
                                      <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5">
                                        <span className="uppercase font-bold text-slate-400">{pax.type}</span>
                                        {pax.email && <span>{pax.email}</span>}
                                        {pax.phone && <span>{pax.phone}</span>}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>

                              <div className="grid grid-cols-2 gap-3 mt-4">
                                <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Cabin</p>
                                  <p className="text-slate-300 text-sm font-semibold mt-1">{rec.cabinClass?.replace(/_/g, ' ') || '—'}</p>
                                </div>
                                <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Departure</p>
                                  <p className="text-slate-300 text-sm font-semibold mt-1">{rec.departureDate || '—'}</p>
                                </div>
                                {rec.returnDate && (
                                  <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Return</p>
                                    <p className="text-slate-300 text-sm font-semibold mt-1">{rec.returnDate}</p>
                                  </div>
                                )}
                                <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/30">
                                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Fare</p>
                                  <p className="text-slate-300 text-sm font-semibold mt-1">{rec.fareName || '—'}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-700/50">
          <p className="text-slate-400 text-xs">
            {total.toLocaleString()} records · page {page} of {pages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-all"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-all"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {resolveId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Mark as Resolved</h3>
              <button onClick={() => setResolveId(null)} className="p-1 text-slate-400 hover:text-white transition-all">
                <X size={16} />
              </button>
            </div>
            <p className="text-slate-400 text-sm mb-4">
              Add resolution notes (e.g., contacted customer, rebooked, issue identified).
            </p>
            <textarea
              value={resolveNotes}
              onChange={e => setResolveNotes(e.target.value)}
              rows={4}
              placeholder="Resolution notes…"
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-[#1ABC9C] transition-all"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setResolveId(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={resolving}
                className="px-5 py-2 bg-[#1ABC9C] hover:bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-[#1ABC9C]/20 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {resolving && <RefreshCw size={14} className="animate-spin" />}
                Resolve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
