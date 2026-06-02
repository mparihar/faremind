'use client';

/**
 * VoiceConfirmationCard
 *
 * Shows parsed flight search summary for user confirmation.
 * Used inside the FareMindTravelAssistantButton dropdown panel.
 */

import { motion } from 'framer-motion';
import { Plane, Users, Calendar, MapPin, Search, Pencil, RefreshCw, X, AlertTriangle } from 'lucide-react';
import type { VoiceFormData } from '@/actions/voiceActionEngine';

interface VoiceConfirmationCardProps {
  data: VoiceFormData;
  missingFields: string[];
  onSearch: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function cabinLabel(cabin: string): string {
  switch (cabin) {
    case 'premium_economy': return 'Premium Economy';
    case 'business': return 'Business';
    case 'first': return 'First Class';
    default: return 'Economy';
  }
}

export default function VoiceConfirmationCard({
  data,
  missingFields,
  onSearch,
  onRetry,
  onCancel,
}: VoiceConfirmationCardProps) {
  const totalPax = data.passengers.adults + data.passengers.children + data.passengers.infants;
  const hasMissing = missingFields.length > 0;

  const paxParts: string[] = [];
  if (data.passengers.adults > 0) paxParts.push(`${data.passengers.adults} Adult${data.passengers.adults > 1 ? 's' : ''}`);
  if (data.passengers.children > 0) paxParts.push(`${data.passengers.children} Child${data.passengers.children > 1 ? 'ren' : ''}`);
  if (data.passengers.infants > 0) paxParts.push(`${data.passengers.infants} Infant${data.passengers.infants > 1 ? 's' : ''}`);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="space-y-3"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-[#1ABC9C]/10 flex items-center justify-center">
          <Plane className="w-3 h-3 text-[#1ABC9C] -rotate-45" />
        </div>
        <p className="text-xs font-bold text-[#1ABC9C] uppercase tracking-wider">I found</p>
      </div>

      {/* Summary grid */}
      <div className="grid grid-cols-2 gap-2">
        {/* Origin */}
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
          <MapPin className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">From</p>
            <p className="text-sm font-bold text-white truncate">
              {data.originCode || <span className="text-red-400">Not detected</span>}
            </p>
            {data.origin && data.originCode && (
              <p className="text-[10px] text-slate-400 truncate">{data.origin}</p>
            )}
          </div>
        </div>

        {/* Destination */}
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
          <MapPin className="w-3.5 h-3.5 text-[#1ABC9C] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">To</p>
            <p className="text-sm font-bold text-white truncate">
              {data.destCode || <span className="text-red-400">Not detected</span>}
            </p>
            {data.destination && data.destCode && (
              <p className="text-[10px] text-slate-400 truncate">{data.destination}</p>
            )}
          </div>
        </div>

        {/* Departure */}
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
          <Calendar className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Departure</p>
            <p className="text-sm font-bold text-white">
              {data.departureDate ? formatDate(data.departureDate) : <span className="text-red-400">Not detected</span>}
            </p>
          </div>
        </div>

        {/* Return / Travelers */}
        {data.tripType === 'round_trip' ? (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <Calendar className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Return</p>
              <p className="text-sm font-bold text-white">
                {data.returnDate ? formatDate(data.returnDate) : '—'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <Plane className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Trip</p>
              <p className="text-sm font-bold text-white">One Way</p>
            </div>
          </div>
        )}
      </div>

      {/* Travelers + Cabin row */}
      <div className="flex items-center gap-3 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
        <Users className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-white">{paxParts.join(', ') || `${totalPax} Traveler${totalPax > 1 ? 's' : ''}`}</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400 font-semibold">{cabinLabel(data.cabinClass)}</span>
          {data.tripType === 'round_trip' && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400 font-semibold">Round Trip</span>
            </>
          )}
        </div>
      </div>

      {/* Missing fields warning */}
      {hasMissing && (
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/20">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-400 font-medium">
            I need {missingFields.join(' and ')}. Please retry or edit manually.
          </p>
        </div>
      )}

      {/* Confirmation prompt */}
      {!hasMissing && (
        <p className="text-xs text-slate-400 font-medium pl-0.5">
          Would you like me to search flights?
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={onSearch}
          disabled={hasMissing}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-white bg-[#1ABC9C] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-[#1ABC9C]/20"
        >
          <Search className="w-3.5 h-3.5" />
          Search Flights
        </button>
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
        <button
          onClick={onCancel}
          className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
