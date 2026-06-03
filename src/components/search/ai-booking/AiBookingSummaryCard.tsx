// ═══════════════════════════════════════════════
// AiBookingSummaryCard
// Final comprehensive booking summary card
// rendered inside the AI chatbot before checkout.
// ═══════════════════════════════════════════════

'use client';

import {
  Plane,
  Clock,
  ArrowRight,
  User,
  Armchair,
  UtensilsCrossed,
  Package,
  Shield,
  Heart,
  Lock,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import type { UnifiedFlight } from '@/lib/types';
import type { AiFareDetails, AiPassengerData, AiSeatPreference, AiPriceSummary } from '@/lib/ai-booking-types';
import type { SelectedSeatData } from '@/lib/ai-seat/ai-seat-types';
import { formatPrice, formatDuration, getStopsLabel } from '@/lib/utils';

// ─── Props ────────────────────────────────────────────────────────────────────

import type { PassengerSeatSelection, PassengerMealSelection } from '@/lib/ai-booking-types';

interface Props {
  flight: UnifiedFlight;
  fareDetails: AiFareDetails;
  passengers: AiPassengerData[];
  passengerCount: number;
  seatPreference: AiSeatPreference;
  passengerSeats: PassengerSeatSelection[];
  passengerMeals: PassengerMealSelection[];
  selectedSeat?: SelectedSeatData | null;
  selectedReturnSeat?: SelectedSeatData | null;
  mealLabel: string;
  extraBags: number;
  travelInsurance: boolean;
  priceProtection: boolean;
  protectionFee: number;
  priceSummary: AiPriceSummary;
  onContinueToReview: () => void;
  isNavigating: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEAT_POSITION_LABELS: Record<string, string> = {
  front: 'Front', middle_plane: 'Middle', rear: 'Rear',
  near_restroom: 'Near restroom', away_from_restroom: 'Away from restroom', any: 'Any',
};
const SEAT_TYPE_LABELS: Record<string, string> = {
  window: 'Window', aisle: 'Aisle', middle: 'Middle', any: 'Any',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AiBookingSummaryCard({
  flight,
  fareDetails,
  passengers,
  passengerCount,
  seatPreference,
  passengerSeats,
  passengerMeals,
  selectedSeat,
  selectedReturnSeat,
  mealLabel,
  extraBags,
  travelInsurance,
  priceProtection,
  protectionFee: _protectionFee,
  priceSummary,
  onContinueToReview,
  isNavigating,
}: Props) {
  const firstSeg = flight.segments[0];
  const lastSeg = flight.segments[flight.segments.length - 1];
  const origin = firstSeg?.departure.airport ?? '???';
  const dest = lastSeg?.arrival.airport ?? '???';
  const airline = flight.airline.name;
  const currency = priceSummary.currency || 'USD';
  const passenger = passengers[0]; // primary contact

  return (
    <div className="space-y-2.5">
      {/* ── Flight Card ── */}
      <div className="bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Plane className="w-3 h-3 text-[#1ABC9C]" />
          <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">Flight</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[14px] font-extrabold text-slate-900">{origin}</span>
          <ArrowRight className="w-3 h-3 text-slate-400" />
          <span className="text-[14px] font-extrabold text-slate-900">{dest}</span>
          <span className="text-[12px] text-slate-400 ml-auto">{airline}</span>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-slate-500">
          <span className="flex items-center gap-0.5">
            <Clock className="w-2.5 h-2.5" />
            {formatDuration(flight.totalDuration)}
          </span>
          <span>{getStopsLabel(flight.stops)}</span>
          <span className="flex items-center gap-0.5 ml-auto text-[#1ABC9C] font-bold">
            <Sparkles className="w-2.5 h-2.5" />
            AI {fareDetails.aiScore}
          </span>
        </div>
      </div>

      {/* ── Fare ── */}
      <div className="bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200 p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">Fare</span>
          <span className="text-[12px] font-bold text-[#1ABC9C]">{fareDetails.name}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {fareDetails.includedFeatures.slice(0, 3).map((f, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium border border-emerald-200/50">
              ✓ {f}
            </span>
          ))}
        </div>
      </div>

      {/* ── Passengers ── */}
      <div className="bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <User className="w-3 h-3 text-[#1ABC9C]" />
          <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">
            {passengerCount > 1 ? `${passengerCount} Passengers` : 'Passenger'}
          </span>
        </div>
        {passengers.map((pax, i) => (
          <div key={i} className={i > 0 ? 'mt-1.5 pt-1.5 border-t border-slate-100' : ''}>
            <p className="text-[13px] font-bold text-slate-900">
              {passengerCount > 1 && <span className="text-[#1ABC9C] mr-1">T{i + 1}</span>}
              {pax.firstName} {pax.lastName}
            </p>
            {i === 0 && (
              <p className="text-[11px] text-slate-400">{pax.email} · {pax.phone}</p>
            )}
            <p className="text-[11px] text-slate-400">
              Passport: {pax.passportNumber.slice(0, 2)}{'•'.repeat(4)}{pax.passportNumber.slice(-2)}
            </p>
          </div>
        ))}
      </div>

      {/* ── Services (compact) ── */}
      <div className="bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="flex items-center gap-1 mb-0.5">
              <Armchair className="w-2.5 h-2.5 text-[#1ABC9C]" />
              <span className="text-[11px] text-slate-400 font-bold uppercase">Seats</span>
            </div>
            {selectedSeat ? (
              <>
                <p className="text-[12px] text-slate-700 font-medium">
                  ✈️ <span className="font-bold text-[#1ABC9C]">{selectedSeat.seatNumber}</span>
                  <span className="text-slate-400 ml-1">(outbound)</span>
                </p>
                {selectedReturnSeat && (
                  <p className="text-[12px] text-slate-700 font-medium mt-0.5">
                    🔄 <span className="font-bold text-[#1ABC9C]">{selectedReturnSeat.seatNumber}</span>
                    <span className="text-slate-400 ml-1">(return)</span>
                  </p>
                )}
              </>
            ) : (
              <p className="text-[12px] text-slate-700 font-medium">
                {SEAT_POSITION_LABELS[seatPreference.position]} · {SEAT_TYPE_LABELS[seatPreference.type]}
              </p>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1 mb-0.5">
              <UtensilsCrossed className="w-2.5 h-2.5 text-[#1ABC9C]" />
              <span className="text-[11px] text-slate-400 font-bold uppercase">Meal</span>
            </div>
            {(() => {
              // Derive outbound & return meal labels from passengerMeals
              const obMeals = passengerMeals.filter(m => m.journeyType === 'outbound');
              const rtMeals = passengerMeals.filter(m => m.journeyType === 'return');

              if (obMeals.length === 0 && rtMeals.length === 0) {
                return <p className="text-[12px] text-slate-700 font-medium">{mealLabel || 'Standard'}</p>;
              }

              const uniqueCodes = (meals: typeof obMeals) => [...new Set(meals.map(m => m.mealCode))];
              const formatCodes = (codes: string[]) => codes.length === 1 ? codes[0] : codes.join(', ');

              const obCodes = uniqueCodes(obMeals);
              const rtCodes = uniqueCodes(rtMeals);

              return (
                <>
                  {obCodes.length > 0 && (
                    <p className="text-[12px] text-slate-700 font-medium">
                      ✈️ <span className="font-bold text-[#1ABC9C]">{formatCodes(obCodes)}</span>
                      <span className="text-slate-400 ml-1">(outbound)</span>
                    </p>
                  )}
                  {rtCodes.length > 0 && (
                    <p className="text-[12px] text-slate-700 font-medium mt-0.5">
                      🔄 <span className="font-bold text-[#1ABC9C]">{formatCodes(rtCodes)}</span>
                      <span className="text-slate-400 ml-1">(return)</span>
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* Add-ons */}
        {(extraBags > 0 || travelInsurance || priceProtection) && (
          <div className="mt-2 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap gap-1.5">
              {extraBags > 0 && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-200/50">
                  <Package className="w-2 h-2" /> {extraBags} bag{extraBags > 1 ? 's' : ''}
                </span>
              )}
              {travelInsurance && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-pink-50 text-pink-700 text-[10px] font-bold border border-pink-200/50">
                  <Heart className="w-2 h-2" /> Insurance
                </span>
              )}
              {priceProtection && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200/50">
                  <Shield className="w-2 h-2" /> Protection
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Price Breakdown ── */}
      <div className="bg-gradient-to-br from-[#0F172A] to-[#1e293b] rounded-xl border border-white/10 p-3 text-white">
        <span className="text-[12px] font-bold text-[#1ABC9C] uppercase tracking-wider block mb-2">
          Price Breakdown
        </span>

        <div className="space-y-1">
          <div className="flex justify-between text-[12px]">
            <span className="text-white/60">Base fare</span>
            <span className="text-white/80 font-medium">{formatPrice(priceSummary.baseFare, currency)}</span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span className="text-white/60">Taxes & fees</span>
            <span className="text-white/80 font-medium">{formatPrice(priceSummary.taxes, currency)}</span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span className="text-white/60">Service fee</span>
            <span className="text-white/80 font-medium">{formatPrice(priceSummary.serviceFee, currency)}</span>
          </div>
          {priceSummary.baggageFee > 0 && (
            <div className="flex justify-between text-[12px]">
              <span className="text-white/60">Extra bags</span>
              <span className="text-white/80 font-medium">+{formatPrice(priceSummary.baggageFee, currency)}</span>
            </div>
          )}
          {priceSummary.insuranceFee > 0 && (
            <div className="flex justify-between text-[12px]">
              <span className="text-white/60">Travel insurance</span>
              <span className="text-white/80 font-medium">+{formatPrice(priceSummary.insuranceFee, currency)}</span>
            </div>
          )}
          {priceSummary.protectionFee > 0 && (
            <div className="flex justify-between text-[12px]">
              <span className="text-[#1ABC9C]/80">Price protection</span>
              <span className="text-[#1ABC9C]/80 font-medium">+{formatPrice(priceSummary.protectionFee, currency)}</span>
            </div>
          )}
          {priceSummary.seatSelectionFee > 0 && (
            <div className="flex justify-between text-[12px]">
              <span className="text-white/60">Seat selection</span>
              <span className="text-white/80 font-medium">+{formatPrice(priceSummary.seatSelectionFee, currency)}</span>
            </div>
          )}
        </div>

        <div className="border-t border-white/10 mt-2 pt-2 flex items-baseline justify-between">
          <span className="text-[13px] font-bold text-white/80">Total</span>
          <span className="text-[18px] font-black text-[#F97316]">
            {formatPrice(priceSummary.total, currency)}
          </span>
        </div>
      </div>

      {/* ── CTA ── */}
      <button
        onClick={onContinueToReview}
        disabled={isNavigating}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-[#1ABC9C] to-emerald-500 hover:from-emerald-500 hover:to-[#1ABC9C] text-white text-[14px] font-bold transition-all shadow-lg shadow-[#1ABC9C]/30 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isNavigating ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Preparing checkout…
          </>
        ) : (
          <>
            <Lock className="w-3.5 h-3.5" />
            Continue to Review
            <ChevronRight className="w-4 h-4" />
          </>
        )}
      </button>

      <p className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1">
        <Lock className="w-2.5 h-2.5" />
        Secure checkout · Your data is encrypted
      </p>
    </div>
  );
}
