/**
 * AiManageBookingTiles — Compact selectable booking tile list
 * Shows user's bookings as compact cards inside the AI Bot.
 */

'use client';

import { motion } from 'framer-motion';
import { Plane, Users, ChevronRight } from 'lucide-react';
import type { MasterBookingSummary } from '@/store/useManageBookingStore';
import { formatBookingDate, getStatusColor } from '@/lib/ai-manage-booking-utils';

interface Props {
  bookings: MasterBookingSummary[];
  onSelect: (booking: MasterBookingSummary) => void;
  loading: boolean;
}

export default function AiManageBookingTiles({ bookings, onSelect, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="px-3 py-3 rounded-xl border border-slate-200 bg-white animate-pulse">
            <div className="h-3 w-24 bg-slate-200 rounded mb-2" />
            <div className="h-2.5 w-40 bg-slate-100 rounded mb-1.5" />
            <div className="h-2.5 w-32 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <Plane className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-[12px] font-semibold text-slate-500">No active bookings found</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Try a different reference or sign in</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {bookings.map((booking, idx) => {
        const status = getStatusColor(booking.bookingStatus);
        const primaryPnr = booking.pnrs?.[0]?.pnrCode;
        const passengerCount = booking.passengers?.length ?? 0;
        const primaryPassenger = booking.passengers?.[0];
        const primaryName = primaryPassenger
          ? `${primaryPassenger.firstName} ${primaryPassenger.lastName}`
          : booking.customerName;

        return (
          <motion.button
            key={booking.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.06 }}
            onClick={() => onSelect(booking)}
            className="w-full text-left px-3 py-3 rounded-xl border border-slate-200 bg-white hover:border-[#1ABC9C]/40 hover:bg-[#1ABC9C]/5 transition-all group cursor-pointer"
          >
            {/* Top row: FBR + Status */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-black text-slate-800 tracking-tight">
                  {booking.masterBookingReference}
                </span>
                {primaryPnr && (
                  <span className="text-[9px] font-semibold text-slate-400">
                    PNR: {primaryPnr}
                  </span>
                )}
              </div>
              <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider border ${status.bg} ${status.text} ${status.border}`}>
                {status.label}
              </span>
            </div>

            {/* Route + Date */}
            <div className="flex items-center gap-1.5 text-[11px] mb-1">
              <div className="w-4 h-4 rounded-md bg-[#1ABC9C]/10 flex items-center justify-center shrink-0">
                <Plane className="w-2.5 h-2.5 text-[#1ABC9C]" />
              </div>
              <span className="font-bold text-slate-700">
                {booking.originAirport} → {booking.destinationAirport}
              </span>
              <span className="text-slate-400 ml-auto shrink-0">
                {formatBookingDate(booking.departureDate)}
              </span>
            </div>

            {/* Passenger + Travelers */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-[10px] text-slate-500">
                <Users className="w-3 h-3 text-slate-400" />
                <span className="font-medium">{primaryName}</span>
                {passengerCount > 1 && (
                  <span className="text-slate-400">· {passengerCount} travelers</span>
                )}
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#1ABC9C] transition-colors" />
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
