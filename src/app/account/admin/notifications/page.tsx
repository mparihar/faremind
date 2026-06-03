'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Plus, Trash2, Mail, User, Check, X,
  Bell, AlertTriangle, ChevronDown, ToggleLeft, ToggleRight,
  Crown, CheckCircle2, Loader2,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

const EVENT_TYPES = [
  { value: 'BOOKING_CONFIRMED', label: 'Booking Confirmed', color: '#10b981' },
  { value: 'BOOKING_PENDING', label: 'Booking Pending', color: '#f59e0b' },
  { value: 'BOOKING_FAILED', label: 'Booking Failed', color: '#ef4444' },
  { value: 'BOOKING_CANCELLED', label: 'Booking Cancelled', color: '#ef4444' },
  { value: 'BOOKING_UPDATED', label: 'Booking Updated', color: '#3b82f6' },
  { value: 'PASSENGER_INFO_UPDATED', label: 'Passenger Updated', color: '#8b5cf6' },
  { value: 'FLIGHT_CHANGE_CONFIRMED', label: 'Flight Changed', color: '#f97316' },
  { value: 'SEAT_SELECTION_UPDATED', label: 'Seat Changed', color: '#06b6d4' },
  { value: 'PAYMENT_SUCCESS', label: 'Payment Success', color: '#10b981' },
  { value: 'PAYMENT_FAILED', label: 'Payment Failed', color: '#ef4444' },
  { value: 'PRICE_DROP_REFUND', label: 'Price Drop Refund', color: '#1abc9c' },
];

interface Recipient {
  id: string;
  email: string;
  name: string;
  role: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

export default function AdminNotificationsPage() {
  const { user } = useAuthStore();
  const callerEmail = user?.email || '';
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('support');
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchRecipients = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/notification-recipients');
      const data = await res.json();
      setRecipients(data.recipients || []);
    } catch {
      setError('Failed to load recipients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecipients(); }, [fetchRecipients]);

  const clearMessages = () => { setError(''); setSuccess(''); };

  const handleAdd = async () => {
    clearMessages();
    if (!newEmail.trim() || !newName.trim()) {
      setError('Email and name are required');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/notification-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim(), name: newName.trim(), role: newRole, events: newEvents, callerEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add');
      setSuccess(`${newName.trim()} added successfully`);
      setNewEmail(''); setNewName(''); setNewRole('support'); setNewEvents([]); setShowAddForm(false);
      fetchRecipients();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (recipient: Recipient) => {
    clearMessages();
    try {
      const res = await fetch(`/api/admin/notification-recipients/${recipient.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !recipient.isActive, callerEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update');
      fetchRecipients();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdateEvents = async (id: string, events: string[]) => {
    clearMessages();
    try {
      const res = await fetch(`/api/admin/notification-recipients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events, callerEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update');
      fetchRecipients();
      setSuccess('Events updated');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (recipient: Recipient) => {
    clearMessages();
    if (!confirm(`Remove ${recipient.name} (${recipient.email}) from notification recipients?`)) return;
    try {
      const res = await fetch(`/api/admin/notification-recipients/${recipient.id}?callerEmail=${encodeURIComponent(callerEmail)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove');
      setSuccess(`${recipient.name} removed`);
      fetchRecipients();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleNewEvent = (event: string) => {
    setNewEvents(prev => prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]);
  };

  const toggleRecipientEvent = (recipient: Recipient, event: string) => {
    const updated = recipient.events.includes(event)
      ? recipient.events.filter(e => e !== event)
      : [...recipient.events, event];
    handleUpdateEvents(recipient.id, updated);
  };

  const roleConfig: Record<string, { label: string; color: string; icon: typeof Crown }> = {
    super_admin: { label: 'Super Admin', color: '#f59e0b', icon: Crown },
    admin: { label: 'Admin', color: '#8b5cf6', icon: Shield },
    support: { label: 'Support', color: '#3b82f6', icon: User },
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-[#1ABC9C] animate-spin" />
          <p className="text-slate-500 text-sm">Loading recipients…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-[#1ABC9C]/15 border border-[#1ABC9C]/25 flex items-center justify-center">
              <Bell className="w-5 h-5 text-[#1ABC9C]" />
            </div>
            <h1 className="text-2xl font-black text-white">Email Recipients</h1>
          </div>
          <p className="text-slate-400 text-sm">
            Manage who receives platform notification emails for bookings, cancellations, payments, and more.
          </p>
        </div>
        <button
          onClick={() => { setShowAddForm(!showAddForm); clearMessages(); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] transition-all shadow-lg shadow-[#1ABC9C]/20"
        >
          <Plus size={16} />
          Add Recipient
        </button>
      </div>

      {/* Messages */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
            <AlertTriangle size={16} /> {error}
            <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
          </motion.div>
        )}
        {success && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mb-4 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm flex items-center gap-2">
            <CheckCircle2 size={16} /> {success}
            <button onClick={() => setSuccess('')} className="ml-auto"><X size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mb-6 overflow-hidden"
          >
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
              <h3 className="text-white font-bold text-sm mb-4">Add New Recipient</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="text-slate-400 text-xs font-bold mb-1.5 block uppercase tracking-wider">Email</label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input value={newEmail} onChange={e => setNewEmail(e.target.value)} type="email" placeholder="email@example.com"
                      className="w-full pl-9 pr-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-[#1ABC9C]/40" />
                  </div>
                </div>
                <div>
                  <label className="text-slate-400 text-xs font-bold mb-1.5 block uppercase tracking-wider">Name</label>
                  <div className="relative">
                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full Name"
                      className="w-full pl-9 pr-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-[#1ABC9C]/40" />
                  </div>
                </div>
                <div>
                  <label className="text-slate-400 text-xs font-bold mb-1.5 block uppercase tracking-wider">Role</label>
                  <select value={newRole} onChange={e => setNewRole(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]/40 appearance-none">
                    <option value="admin" className="bg-slate-900">Admin</option>
                    <option value="support" className="bg-slate-900">Support</option>
                  </select>
                </div>
              </div>

              {/* Event subscriptions */}
              <div className="mb-4">
                <label className="text-slate-400 text-xs font-bold mb-2 block uppercase tracking-wider">
                  Subscribe to events {newEvents.length === 0 && <span className="text-[#1ABC9C] normal-case font-normal">(All events by default)</span>}
                </label>
                <div className="flex flex-wrap gap-2">
                  {EVENT_TYPES.map(evt => (
                    <button key={evt.value} onClick={() => toggleNewEvent(evt.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                        newEvents.includes(evt.value)
                          ? 'border-[#1ABC9C]/40 bg-[#1ABC9C]/15 text-[#1ABC9C]'
                          : 'border-white/[0.06] bg-white/[0.02] text-slate-400 hover:border-white/[0.12] hover:text-slate-300'
                      }`}
                    >
                      {newEvents.includes(evt.value) && <Check size={12} className="inline mr-1" />}
                      {evt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button onClick={() => setShowAddForm(false)} className="px-4 py-2 rounded-xl text-slate-400 text-sm font-semibold hover:text-white hover:bg-white/[0.04] transition-all">Cancel</button>
                <button onClick={handleAdd} disabled={submitting}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] transition-all disabled:opacity-50">
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Add Recipient
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info banner */}
      <div className="mb-6 px-4 py-3 bg-amber-500/[0.06] border border-amber-500/15 rounded-xl flex items-start gap-3">
        <Crown size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <p className="text-amber-200/80 text-xs leading-relaxed">
          <strong className="text-amber-400">Super Admin</strong> always receives all platform notifications regardless of event configuration. 
          Other recipients can be configured per-event or receive all events.
        </p>
      </div>

      {/* Recipients list */}
      <div className="space-y-3">
        {recipients.map((r, i) => {
          const isSuperAdmin = r.role === 'super_admin';
          const config = roleConfig[r.role] || roleConfig.support;
          const RoleIcon = config.icon;
          const isExpanded = expandedId === r.id;
          
          return (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className={`bg-white/[0.03] border rounded-2xl overflow-hidden transition-all ${
                isSuperAdmin ? 'border-amber-500/20' : r.isActive ? 'border-white/[0.06]' : 'border-white/[0.04] opacity-60'
              }`}
            >
              {/* Main row */}
              <div className="px-5 py-4 flex items-center gap-4">
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0`}
                  style={{ background: `${config.color}18`, border: `1px solid ${config.color}30` }}>
                  <RoleIcon size={18} style={{ color: config.color }} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-white font-semibold text-sm truncate">{r.name}</p>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: config.color, background: `${config.color}15`, border: `1px solid ${config.color}25` }}>
                      {config.label}
                    </span>
                  </div>
                  <p className="text-slate-500 text-xs truncate">{r.email}</p>
                </div>

                {/* Event count */}
                <button onClick={() => setExpandedId(isExpanded ? null : r.id)}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-slate-400 text-xs font-medium hover:border-white/[0.12] hover:text-slate-300 transition-all">
                  <Bell size={12} />
                  {r.events.length === 0 ? 'All events' : `${r.events.length} events`}
                  <ChevronDown size={12} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Toggle active */}
                {!isSuperAdmin && (
                  <button onClick={() => handleToggle(r)} className="flex-shrink-0" title={r.isActive ? 'Deactivate' : 'Activate'}>
                    {r.isActive
                      ? <ToggleRight size={28} className="text-[#1ABC9C]" />
                      : <ToggleLeft size={28} className="text-slate-600" />
                    }
                  </button>
                )}
                {isSuperAdmin && (
                  <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider flex-shrink-0">Locked</span>
                )}

                {/* Delete */}
                {!isSuperAdmin && (
                  <button onClick={() => handleDelete(r)} className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              {/* Expanded events */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-4 pt-0 border-t border-white/[0.04]">
                      <p className="text-slate-400 text-xs font-bold uppercase tracking-wider my-3">
                        {isSuperAdmin ? 'Receives all events (cannot be changed)' : 'Subscribed events'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {EVENT_TYPES.map(evt => {
                          const isSubscribed = r.events.length === 0 || r.events.includes(evt.value);
                          return (
                            <button
                              key={evt.value}
                              disabled={isSuperAdmin}
                              onClick={() => !isSuperAdmin && toggleRecipientEvent(r, evt.value)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                                isSubscribed
                                  ? 'border-[#1ABC9C]/30 bg-[#1ABC9C]/10 text-[#1ABC9C]'
                                  : 'border-white/[0.06] bg-white/[0.02] text-slate-500 hover:border-white/[0.12] hover:text-slate-400'
                              } ${isSuperAdmin ? 'cursor-default' : 'cursor-pointer'}`}
                            >
                              {isSubscribed && <Check size={11} className="inline mr-1" />}
                              {evt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {recipients.length === 0 && (
        <div className="text-center py-16">
          <Bell className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">No notification recipients configured yet.</p>
          <p className="text-slate-500 text-xs mt-1">Click "Add Recipient" to get started.</p>
        </div>
      )}
    </div>
  );
}
