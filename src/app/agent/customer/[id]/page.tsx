'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  User, Mail, Phone, Calendar, Ticket, ChevronRight, Plane,
  Loader2, ArrowLeft, Clock, DollarSign,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  'CONFIRMED': 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
  'TICKETED': 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
  'CANCELLED': 'bg-red-400/15 text-red-400 border-red-400/20',
  'FAILED': 'bg-red-400/15 text-red-400 border-red-400/20',
  'CREATED': 'bg-amber-400/15 text-amber-400 border-amber-400/20',
};

const fmt = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);

export default function AgentCustomerPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;
  const [profile, setProfile] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/agent/customer/${customerId}`);
        if (res.ok) {
          const data = await res.json();
          setProfile(data.customer);
          setBookings(data.bookings || []);
        }
      } catch {}
      setLoading(false);
    }
    load();
  }, [customerId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={24} className="animate-spin text-slate-500" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-8 text-center">
        <p className="text-slate-400 text-sm font-semibold">Customer not found</p>
      </div>
    );
  }

  const totalSpend = bookings.reduce((s: number, b: any) => s + (b.totalAmount || 0), 0);
  const completedBookings = bookings.filter((b: any) => b.status === 'CONFIRMED' || b.status === 'TICKETED').length;

  return (
    <div className="p-8">
      {/* Back */}
      <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-4">
        <ArrowLeft size={14} /> Back
      </button>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1ABC9C] to-[#009CA6] flex items-center justify-center">
            <span className="text-white text-xl font-black">{profile.name?.charAt(0).toUpperCase() || '?'}</span>
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">{profile.name || 'Unknown'}</h1>
            <div className="flex items-center gap-3 mt-0.5">
              {profile.email && <span className="text-slate-400 text-sm flex items-center gap-1"><Mail size={12} /> {profile.email}</span>}
              {profile.phone && <span className="text-slate-400 text-sm flex items-center gap-1"><Phone size={12} /> {profile.phone}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Bookings', value: bookings.length, icon: Ticket, color: 'text-white' },
          { label: 'Completed', value: completedBookings, icon: Plane, color: 'text-emerald-400' },
          { label: 'Total Spend', value: fmt(totalSpend), icon: DollarSign, color: 'text-[#1ABC9C]' },
          { label: 'Member Since', value: new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), icon: Calendar, color: 'text-slate-300' },
        ].map((stat, i) => (
          <div key={stat.label} className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <stat.icon size={12} className="text-slate-500" />
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{stat.label}</p>
            </div>
            <p className={`text-lg font-black ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Booking History */}
      <h2 className="text-white font-black text-lg mb-3">Booking History</h2>
      {bookings.length === 0 ? (
        <div className="text-center py-12 bg-slate-800/30 border border-slate-700/50 rounded-xl">
          <p className="text-slate-500 text-sm">No bookings yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bookings.map((b: any, i: number) => (
            <motion.div
              key={b.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => router.push(`/agent/booking-workspace?ref=${b.bookingReference}`)}
              className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 hover:bg-slate-800/60 cursor-pointer transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 flex-1">
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Reference</p>
                    <p className="text-sm font-black text-white">{b.bookingReference}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Route</p>
                    <p className="text-sm font-semibold text-white">
                      {b.pnrs?.[0]?.originIata || '—'} → {b.pnrs?.[0]?.destinationIata || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Provider</p>
                    <p className="text-sm font-semibold text-white">{b.primaryProvider}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Amount</p>
                    <p className="text-sm font-black text-[#1ABC9C]">{fmt(b.totalAmount, b.currency)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</p>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${STATUS_STYLES[b.status] || 'bg-slate-700/50 text-slate-400 border-slate-600/30'}`}>
                      {b.status}
                    </span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-600 group-hover:text-[#1ABC9C] ml-4" />
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
