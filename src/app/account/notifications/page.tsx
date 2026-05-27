'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Bell, BellOff, Check, CheckCircle2, Clock, Plane,
  CreditCard, Calendar, XCircle, AlertCircle, Mail,
  Ticket, Loader2, Filter,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useManageBookingStore } from '@/store/useManageBookingStore';

type NotificationType = 'all' | 'booking' | 'cancellation' | 'refund' | 'alert';

const FILTER_TABS: { key: NotificationType; label: string; icon: any }[] = [
  { key: 'all', label: 'All', icon: Bell },
  { key: 'booking', label: 'Bookings', icon: Ticket },
  { key: 'cancellation', label: 'Cancellations', icon: XCircle },
  { key: 'refund', label: 'Refunds', icon: CreditCard },
  { key: 'alert', label: 'Alerts', icon: AlertCircle },
];

interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  time: string;
  read: boolean;
  icon: any;
  color: string;
}

function generateNotificationsFromBookings(bookings: any[]): NotificationItem[] {
  const notifications: NotificationItem[] = [];

  bookings.forEach(b => {
    // Booking created notification
    notifications.push({
      id: `${b.id}-created`,
      type: 'booking',
      title: 'Booking Confirmed',
      body: `Your booking ${b.masterBookingReference} (${b.originAirport} → ${b.destinationAirport}) has been confirmed.`,
      time: b.departureDate,
      read: true,
      icon: CheckCircle2,
      color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
    });

    if (b.bookingStatus === 'CANCELLED') {
      notifications.push({
        id: `${b.id}-cancelled`,
        type: 'cancellation',
        title: 'Booking Cancelled',
        body: `Your booking ${b.masterBookingReference} has been cancelled. A refund is being processed.`,
        time: b.departureDate,
        read: false,
        icon: XCircle,
        color: 'text-red-400 bg-red-400/10 border-red-400/20',
      });
    }
  });

  return notifications.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}

export default function NotificationsPage() {
  const { user } = useAuthStore();
  const { bookings, bookingsLoading, loadUserBookings, setBookingsFilter: setStoreFilter } = useManageBookingStore();
  const [filter, setFilter] = useState<NotificationType>('all');
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.id) return;
    setStoreFilter('all');
    loadUserBookings(user.id);
  }, [user?.id]);

  const allNotifications = generateNotificationsFromBookings(bookings);
  const filtered = filter === 'all' ? allNotifications : allNotifications.filter(n => n.type === filter);
  const unreadCount = allNotifications.filter(n => !n.read && !readIds.has(n.id)).length;

  function markRead(id: string) {
    setReadIds(prev => new Set([...prev, id]));
  }

  function markAllRead() {
    setReadIds(new Set(allNotifications.map(n => n.id)));
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            Notifications
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#1ABC9C] text-white">
                {unreadCount}
              </span>
            )}
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">Stay updated on your bookings and travel alerts</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-400 text-xs font-semibold hover:bg-white/[0.06] hover:text-white transition-all">
            <Check size={13} />
            Mark All Read
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-5 overflow-x-auto scrollbar-hide pb-1">
        {FILTER_TABS.map(tab => {
          const Icon = tab.icon;
          const active = filter === tab.key;
          const count = tab.key === 'all' ? allNotifications.length : allNotifications.filter(n => n.type === tab.key).length;
          return (
            <button key={tab.key} onClick={() => setFilter(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${active
                ? 'bg-[#1ABC9C] text-white shadow-lg shadow-[#1ABC9C]/20'
                : 'bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.07]'}`}>
              <Icon size={14} />
              {tab.label}
              {count > 0 && <span className={`text-[11px] ${active ? 'opacity-70' : 'text-slate-400'}`}>({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Notification list */}
      {bookingsLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 text-[#1ABC9C] animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
            <BellOff size={24} className="text-slate-600" />
          </div>
          <p className="text-white font-bold mb-1">No notifications</p>
          <p className="text-slate-400 text-sm">
            {filter === 'all' ? "You're all caught up!" : `No ${filter} notifications.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((n, i) => {
            const Icon = n.icon;
            const isRead = n.read || readIds.has(n.id);
            return (
              <motion.div key={n.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => markRead(n.id)}
                className={`flex items-start gap-3.5 p-4 rounded-2xl border transition-all cursor-pointer ${isRead
                  ? 'bg-white/[0.02] border-white/[0.05]'
                  : 'bg-white/[0.04] border-white/[0.1] hover:bg-white/[0.06]'}`}
              >
                {/* Icon */}
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${n.color}`}>
                  <Icon size={15} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className={`text-sm font-semibold ${isRead ? 'text-slate-200' : 'text-white'}`}>{n.title}</p>
                    {!isRead && <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C] shrink-0" />}
                  </div>
                  <p className={`text-sm leading-relaxed ${isRead ? 'text-slate-300' : 'text-slate-200'}`}>{n.body}</p>
                  <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
                    <Clock size={9} />
                    {new Date(n.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
