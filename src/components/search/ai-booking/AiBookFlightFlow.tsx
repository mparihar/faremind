// ═══════════════════════════════════════════════
// AiBookFlightFlow
// Main orchestrator for the conversational AI
// booking flow inside the chatbot.
// Supports 1–9 passengers with per-passenger
// seat selection, meals, and add-ons.
// ═══════════════════════════════════════════════

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, RotateCcw, ChevronLeft, Mic, Clock, AlertTriangle, XCircle } from 'lucide-react';
import {
  isSpeechRecognitionSupported,
  startListening,
  stopListening,
  abortListening,
} from '@/services/speechRecognitionService';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import type {
  AiBookingStatus,
  AiSeatPreference,
  AiPassengerData,
  PassengerSeatSelection,
} from '@/lib/ai-booking-types';
import { SECONDARY_PASSENGER_FIELDS } from '@/lib/ai-booking-types';
import type { FareOption, FareSelectionPayload } from '@/lib/fare-types';
import type { RecommendedSeat, SeatRecommendationResponse, SeatPreferenceInput, GroupSeatBlock, GroupSeatResponse } from '@/lib/ai-seat/ai-seat-types';
import type { NormalizedAncillary } from '@/lib/providers/providerAncillaryNormalizer';

// ─── Step back mapping ────────────────────────────────────────────────────────

const PREVIOUS_STATUS: Partial<Record<AiBookingStatus, AiBookingStatus>> = {
  fare_selection:              'flight_selection',
  passenger_count:             'fare_selection',
  price_protection:            'passenger_count',
  itinerary_preview:           'price_protection',
  continue_prompt:             'itinerary_preview',
  passenger_details:           'itinerary_preview',
  passenger_confirm:           'passenger_details',
  seat_preference:             'passenger_confirm',
  seat_recommendations:        'seat_preference',
  seat_recommendations_return: 'seat_recommendations',
  seat_group_options:          'seat_preference',
  seat_return_prompt:          'seat_group_options',
  meal_preference:             'seat_recommendations',
  add_ons:                     'meal_preference',
  final_summary:               'add_ons',
};

import { useAiBookingStore } from '@/store/useAiBookingStore';
import { apiFetch } from '@/lib/api-client';
import { useCheckoutStore } from '@/store/useCheckoutStore';
import { useOfferSessionStore } from '@/store/useOfferSessionStore';

import AiFlightOptionTimeline from './AiFlightOptionTimeline';
import AiFareClassSelector from './AiFareClassSelector';
import AiPassengerDetailCollector from './AiPassengerDetailCollector';
import AiPassengerSummaryTable from './AiPassengerSummaryTable';
import AiMultiPaxProtectionStep from './AiMultiPaxProtectionStep';
import AiSeatPreferenceCollector from './AiSeatPreferenceCollector';
import AiSeatRecommendationList from './AiSeatRecommendationList';
import AiGroupSeatBlockList from './AiGroupSeatBlockList';
import AiMultiPaxMealStep from './AiMultiPaxMealStep';
import AiMultiPaxAddOnsStep from './AiMultiPaxAddOnsStep';
import AiBookingSummaryCard from './AiBookingSummaryCard';

// ─── Chat bubble ──────────────────────────────────────────────────────────────

function AiBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5 mb-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles className="w-3.5 h-3.5 text-[#1ABC9C]" />
        <span className="text-[13px] font-bold"><span className="text-white">FARE</span><span style={{ color: '#009CA6' }}>MIND</span> <span className="text-[#1ABC9C]">AI</span></span>
      </div>
      <div className="text-[15px] text-white/90 leading-relaxed">{children}</div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  flights: UnifiedFlight[];
  roundTripOptions?: RoundTripOption[];
  searchPassengers?: number;
  searchAdults?: number;
  searchChildren?: number;
  searchInfants?: number;
  onExit: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AiBookFlightFlow({ flights, roundTripOptions, searchPassengers, searchAdults, searchChildren, searchInfants, onExit }: Props) {
  const router = useRouter();
  const store = useAiBookingStore();
  const offerSession = useOfferSessionStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [voiceSupported] = useState(() => typeof window !== 'undefined' && isSpeechRecognitionSupported());
  const [fareOptions, setFareOptions] = useState<FareOption[]>([]);
  const [fareLoading, setFareLoading] = useState(false);
  const [fareError, setFareError] = useState<string | null>(null);

  // Provider ancillary state (live baggage pricing)
  const [providerBaggage, setProviderBaggage] = useState<NormalizedAncillary[]>([]);
  const [baggageLoading, setBaggageLoading] = useState(false);
  const [baggageUnavailable, setBaggageUnavailable] = useState(false);

  // Seat recommendation state
  const [seatRecommendations, setSeatRecommendations] = useState<RecommendedSeat[]>([]);
  const [seatLoading, setSeatLoading] = useState(false);
  const [seatError, setSeatError] = useState<string | null>(null);
  const [seatFallbackUsed, setSeatFallbackUsed] = useState(false);
  const [seatFallbackReason, setSeatFallbackReason] = useState<string | undefined>();

  // Multi-pax seat tracking
  const [seatPaxIndex, setSeatPaxIndex] = useState(0);
  const [seatJourney, setSeatJourney] = useState<'outbound' | 'return'>('outbound');
  const [selectedSeatNumbers, setSelectedSeatNumbers] = useState<string[]>([]);

  // Group seat state (multi-pax)
  const [groupSeatBlocks, setGroupSeatBlocks] = useState<GroupSeatBlock[]>([]);
  const [groupSeatLoading, setGroupSeatLoading] = useState(false);
  const [groupSeatError, setGroupSeatError] = useState<string | null>(null);
  const [groupSeatFallbackLevel, setGroupSeatFallbackLevel] = useState(0);
  const [groupSeatFallbackReason, setGroupSeatFallbackReason] = useState<string | undefined>();
  const [savedGroupPref, setSavedGroupPref] = useState<AiSeatPreference | null>(null);

  // Auto-scroll to bottom on status change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [store.status, seatPaxIndex, seatJourney]);

  // ── Listen for AI recommendation auto-select event ──────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.flightIndex !== undefined && store.status === 'flight_selection') {
        const idx = detail.flightIndex;
        if (idx >= 0 && idx < flights.length) {
          handleFlightSelect(idx);
        }
      }
    };
    window.addEventListener('ai-auto-select-flight', handler);
    return () => window.removeEventListener('ai-auto-select-flight', handler);
  }, [flights, store.status]);

  // ── Auto-set passenger count from search params (skip the question) ─────
  useEffect(() => {
    if (store.status === 'passenger_count' && searchPassengers && searchPassengers >= 1) {
      const count = Math.min(searchPassengers, 9);
      store.setPassengerCount(count);

      // Build passenger types array from search breakdown
      const types: ('adult' | 'child' | 'infant')[] = [];
      const nAdults = searchAdults ?? count;
      const nChildren = searchChildren ?? 0;
      const nInfants = searchInfants ?? 0;
      for (let i = 0; i < nAdults; i++) types.push('adult');
      for (let i = 0; i < nChildren; i++) types.push('child');
      for (let i = 0; i < nInfants; i++) types.push('infant');
      // Pad or trim to match count
      while (types.length < count) types.push('adult');
      if (types.length > count) types.length = count;
      store.setPassengerTypes(types);

      store.setStatus('price_protection');
    }
  }, [store.status, searchPassengers]);

  // ── Resolve round-trip option from flight ID ────────────────────────────────
  const resolveRoundTrip = useCallback((flightId: string): RoundTripOption | null => {
    if (!roundTripOptions?.length) return null;
    return roundTripOptions.find(rt => rt.id === flightId) ?? null;
  }, [roundTripOptions]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  // ── Fetch seat recommendations ──────────────────────────────────────────────
  const fetchSeatRecommendations = useCallback(async (segmentIndex: number = 0) => {
    setSeatLoading(true);
    setSeatError(null);
    setSeatRecommendations([]);
    setSeatFallbackUsed(false);
    setSeatFallbackReason(undefined);

    try {
      const flight = store.selectedFlight;
      const roundTrip = store.selectedRoundTrip;
      if (!flight) throw new Error('No flight selected');

      // Use the fare-level offer ID (from fare selection API) as the primary source.
      // The original search-level providerOfferId becomes stale after fare selection
      // because Duffel creates a new offer for the selected fare class.
      const selectedFare = store.selectedFareOption;
      const offerId = selectedFare?.offerId || roundTrip?.providerOfferId || flight.providerOfferId;
      const provider = flight.provider || 'duffel';
      const pref = store.seatPreference;

      const mappedPref: SeatPreferenceInput = {
        cabinZone:
          pref.position === 'front' ? 'front' :
          pref.position === 'middle_plane' ? 'middle' :
          pref.position === 'rear' ? 'rear' : 'any',
        restroomPreference:
          pref.position === 'near_restroom' ? 'near_restroom' :
          pref.position === 'away_from_restroom' ? 'away_restroom' : 'neutral',
        seatType: pref.type === 'any' ? 'any' : pref.type,
      };

      // Seat recommendations lives on the Next.js server, not the Express
      // backend — use a relative fetch instead of apiFetch.
      const res = await fetch('/api/seats/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerId,
          provider,
          preference: mappedPref,
          segmentIndex,
          excludeSeats: selectedSeatNumbers,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errBody.error || `Seat API failed: ${res.status}`);
      }

      const resp: SeatRecommendationResponse = await res.json();

      setSeatRecommendations(resp.seats);
      if (resp.fallbackUsed) {
        setSeatFallbackUsed(true);
        setSeatFallbackReason(resp.fallbackReason);
      }
    } catch (err) {
      console.error('Seat recommendation failed:', err);
      setSeatError('Seat map is temporarily unavailable. Your preference has been saved.');
    } finally {
      setSeatLoading(false);
    }
  }, [store.selectedFlight, store.selectedRoundTrip, store.seatPreference, selectedSeatNumbers]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleFlightSelect = async (index: number) => {
    const flight = flights[index];
    if (!flight) return;
    const roundTrip = resolveRoundTrip(flight.id);
    store.selectFlight(flight, roundTrip);

    // Update offer tracking — continue the existing timer from search page if active
    const sessionState = useOfferSessionStore.getState();
    const offerId = flight.providerOfferId || flight.id;
    const provider = flight.provider || 'faremind';
    if (sessionState.status === 'ACTIVE' || sessionState.status === 'WARNING') {
      sessionState.updateTrackedOffer(offerId, provider);
    } else {
      offerSession.startSession({ provider, providerOfferId: offerId });
    }

    // Fetch real fare options from the API
    setFareLoading(true);
    setFareError(null);
    setFareOptions([]);
    try {
      const origin = flight.segments[0]?.departure.airport ?? '';
      const destination = flight.segments[flight.segments.length - 1]?.arrival.airport ?? '';
      // Pass provider-sourced fare rules so the backend uses real provider data (not DB templates)
      let providerParams = '';
      if (flight.fareRules) {
        const fr = flight.fareRules;
        if (fr.changeable !== undefined) providerParams += `&provider_changeable=${fr.changeable}`;
        if (fr.changeFee !== undefined) providerParams += `&provider_change_fee=${fr.changeFee}`;
        if (fr.refundable !== undefined) providerParams += `&provider_refundable=${fr.refundable}`;
        if (fr.cancellationFee !== undefined) providerParams += `&provider_refund_fee=${fr.cancellationFee}`;
      }
      const payload = await apiFetch<FareSelectionPayload>(
        `/api/fares/options?offer_id=${encodeURIComponent(flight.providerOfferId)}&base_price=${flight.totalPrice}&traveler_count=1&currency=${flight.currency || 'USD'}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&stops=${flight.stops}&duration_minutes=${flight.totalDuration ?? 0}${providerParams}`
      );
      const allFares = payload.fareGroups.flatMap(g => g.fares);
      setFareOptions(allFares);
    } catch (err) {
      console.error('Failed to fetch fare options:', err);
      setFareError('Could not load fares — using estimated pricing.');
      const { buildFareDetails } = await import('@/store/useAiBookingStore');
      const fallbackFares: FareOption[] = (['basic', 'standard', 'flex'] as const).map(fc => {
        const d = buildFareDetails(flight, fc);
        return {
          id: `ai_${fc}_${flight.id}`,
          offerId: flight.providerOfferId,
          cabin: flight.cabinClass,
          name: d.name,
          basePrice: d.basePrice,
          totalPrice: d.totalPrice,
          currency: d.currency,
          baggage: {
            carryOn: true,
            carryOnPieces: d.carryOnPieces,
            carryOnWeightKg: null,
            checked: d.checkedBags,
            checkedWeightKg: d.checkedWeightKg,
            extraBagFeeUsd: 35,
          },
          policy: {
            refundable: d.refundable,
            refundFeeUsd: d.refundFee,
            changeable: d.changeable,
            changeFeeUsd: d.changeFee,
            seatSelection: d.seatSelection,
            seatSelectionFeeUsd: d.seatSelectionFee,
            upgradeable: false,
            loungeAccess: false,
            priorityBoarding: d.priorityBoarding,
            milesEarning: d.milesEarning,
          },
          aiScore: d.aiScore,
          aiBadges: fc === 'basic' ? ['cheapest'] : fc === 'flex' ? ['most_flexible'] : ['best_value'],
          aiExplanation: d.aiExplanation,
        };
      });
      setFareOptions(fallbackFares);
    } finally {
      setFareLoading(false);
    }
  };

  const handleFareSelect = (fare: FareOption) => {
    store.selectFareFromOption(fare);

    // Fetch live ancillaries (baggage) from provider API
    const offerId = fare.offerId || store.selectedFlight?.providerOfferId;
    const provider = (store.selectedFlight?.provider ?? 'duffel').toLowerCase();
    if (offerId) {
      setBaggageLoading(true);
      setBaggageUnavailable(false);
      setProviderBaggage([]);
      fetch(`/api/ancillaries?offer_id=${encodeURIComponent(offerId)}&provider=${provider}`)
        .then(r => r.json())
        .then((data: { baggage?: NormalizedAncillary[]; error?: string; info?: string }) => {
          const bags = (data.baggage ?? []).filter(a => !a.included && a.chargeable);
          setProviderBaggage(bags);
          if (bags.length === 0) setBaggageUnavailable(true);
        })
        .catch(() => {
          setBaggageUnavailable(true);
        })
        .finally(() => setBaggageLoading(false));
    } else {
      setBaggageUnavailable(true);
    }
    // Now goes to 'passenger_count' (set in store)
  };

  const handlePassengerCountSelect = (n: number) => {
    store.setPassengerCount(n);
    store.setStatus('price_protection');
  };

  const handleProtectionComplete = (selections: boolean[]) => {
    selections.forEach((selected, i) => {
      store.setPassengerProtection(i, selected);
    });
    store.setStatus('itinerary_preview');
  };

  const handleContinueFromPreview = () => {
    store.setCurrentPassengerIndex(0);
    store.setStatus('passenger_details');
  };

  const handlePassengerFieldUpdate = (field: keyof AiPassengerData, value: string) => {
    store.setPassengerField(field, value as never);
  };

  const handlePassengerComplete = () => {
    const nextIdx = store.currentPassengerIndex + 1;
    if (nextIdx < store.passengerCount) {
      // More passengers to collect
      store.setCurrentPassengerIndex(nextIdx);
      // Stay in passenger_details — the component will re-render for the next pax
      // Force re-render by toggling status
      store.setStatus('passenger_confirm'); // brief transition
      setTimeout(() => store.setStatus('passenger_details'), 50);
    } else {
      // All passengers collected → show confirmation table
      store.setStatus('passenger_confirm');
    }
  };

  const handlePassengerConfirm = () => {
    // Check if seat selection is available for this fare
    const seatPolicy = store.fareDetails?.seatSelection;
    if (seatPolicy === 'not_available') {
      // Skip seat preference entirely — go straight to meals
      store.setStatus('meal_preference');
      return;
    }
    setSeatPaxIndex(0);
    setSeatJourney('outbound');
    setSelectedSeatNumbers([]);
    setSavedGroupPref(null);
    store.setStatus('seat_preference');
  };

  const handlePassengerEdit = (index: number) => {
    store.setCurrentPassengerIndex(index);
    store.setStatus('passenger_details');
  };

  // ── Map AiSeatPreference → API area/type ──────────────────────────────────

  function mapPrefToArea(pref: AiSeatPreference): string {
    switch (pref.position) {
      case 'front': return 'front';
      case 'middle_plane': return 'middle';
      case 'rear': return 'rear';
      case 'near_restroom': return 'near_restroom';
      case 'away_from_restroom': return 'away_restroom';
      default: return 'any';
    }
  }

  // ── Fetch group seat blocks ─────────────────────────────────────────────────

  const fetchGroupSeatBlocks = async (pref: AiSeatPreference, segmentIndex: number) => {
    setGroupSeatLoading(true);
    setGroupSeatError(null);
    setGroupSeatBlocks([]);
    setGroupSeatFallbackLevel(0);
    setGroupSeatFallbackReason(undefined);

    try {
      const flight = store.selectedFlight;
      const roundTrip = store.selectedRoundTrip;
      if (!flight) throw new Error('No flight selected');

      // Use fare-level offer ID first (valid after fare selection), then fallback
      const selectedFare = store.selectedFareOption;
      const offerId = selectedFare?.offerId || roundTrip?.providerOfferId || flight.providerOfferId;
      const provider = flight.provider || 'duffel';

      console.log('[AI Seat Client] Fetching group blocks:', { offerId, provider, segmentIndex, passengerCount: store.passengerCount, area: mapPrefToArea(pref), type: pref.type });

      const res = await fetch('/api/seats/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerId,
          provider,
          segmentIndex,
          passengerCount: store.passengerCount,
          areaPreference: mapPrefToArea(pref),
          seatTypePreference: pref.type === 'any' ? 'any' : pref.type,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error('[AI Seat Client] HTTP error:', res.status, errBody);
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const resp = await res.json();
      console.log('[AI Seat Client] Full response:', JSON.stringify(resp));

      const groupResp = resp as GroupSeatResponse;

      setGroupSeatBlocks(groupResp.options ?? []);
      setGroupSeatFallbackLevel(groupResp.fallbackLevel ?? 0);
      setGroupSeatFallbackReason(groupResp.fallbackReason);

      if (groupResp.error) {
        console.warn('[AI Seat Client] Server returned error field:', groupResp.error);
        setGroupSeatError(groupResp.error);
      }
    } catch (err: any) {
      console.error('[AI Seat Client] Group seat fetch EXCEPTION:', err?.message || err);
      setGroupSeatError('Seat map is temporarily unavailable.');
    } finally {
      setGroupSeatLoading(false);
    }
  };

  // ── Handle seat preference complete ─────────────────────────────────────────

  const handleSeatComplete = async (pref: AiSeatPreference) => {
    store.setSeatPreference(pref);
    const isMultiPax = store.passengerCount > 1;

    if (isMultiPax) {
      // Group flow: fetch group blocks and show options
      setSavedGroupPref(pref);
      const segIdx = seatJourney === 'return' ? 1 : 0;
      store.setStatus('seat_group_options');
      await fetchGroupSeatBlocks(pref, segIdx);
    } else {
      // Single pax: existing individual flow
      const segIdx = seatJourney === 'return' ? 1 : 0;
      store.setStatus('seat_recommendations');
      await fetchSeatRecommendations(segIdx);
    }
  };

  // ── Handle group block selection ────────────────────────────────────────────

  const handleGroupBlockSelect = (block: GroupSeatBlock) => {
    // Assign seats from block to all passengers
    block.seats.forEach((seat, idx) => {
      if (idx < store.passengerCount) {
        store.setPassengerSeat(idx, seatJourney, {
          seatServiceId: seat.seatServiceId,
          seatServiceIds: seat.seatServiceIds ?? [],
          seatNumber: seat.seatNumber,
          segmentId: seat.segmentId,
          rowNumber: seat.rowNumber,
          column: seat.column,
          cabinZone: seat.cabinZone,
          seatType: seat.seatType,
          restroomZone: seat.restroomZone,
          price: seat.price,
          currency: seat.currency,
          reason: seat.reason,
        });
      }
    });

    const isRoundTrip = !!store.selectedRoundTrip;

    if (seatJourney === 'outbound' && isRoundTrip) {
      // Show return prompt
      store.setStatus('seat_return_prompt');
    } else {
      // Done → meals
      store.setStatus('meal_preference');
    }
  };

  const handleGroupSeatSkip = () => {
    // Skip all seat assignment for current journey
    for (let i = 0; i < store.passengerCount; i++) {
      store.setPassengerSeat(i, seatJourney, null);
    }
    const isRoundTrip = !!store.selectedRoundTrip;
    if (seatJourney === 'outbound' && isRoundTrip) {
      store.setStatus('seat_return_prompt');
    } else {
      store.setStatus('meal_preference');
    }
  };

  // ── Fallback to individual per-pax flow ─────────────────────────────────────

  const handleSwitchToIndividual = async () => {
    setSeatPaxIndex(0);
    setSelectedSeatNumbers([]);
    const segIdx = seatJourney === 'return' ? 1 : 0;
    store.setStatus('seat_recommendations');
    await fetchSeatRecommendations(segIdx);
  };

  // ── Return journey prompt handlers ──────────────────────────────────────────

  const handleReturnSamePreference = async () => {
    if (!savedGroupPref) return;
    setSeatJourney('return');
    store.setStatus('seat_group_options');
    await fetchGroupSeatBlocks(savedGroupPref, 1);
  };

  const handleReturnDifferentPreference = () => {
    setSeatJourney('return');
    store.setStatus('seat_preference');
  };

  const handleReturnSkipSeats = () => {
    for (let i = 0; i < store.passengerCount; i++) {
      store.setPassengerSeat(i, 'return', null);
    }
    store.setStatus('meal_preference');
  };

  // ── Individual seat handlers (single pax / fallback) ────────────────────────

  const handleSeatSelection = (seat: RecommendedSeat) => {
    const seatData = {
      seatServiceId: seat.seatServiceId,
      seatServiceIds: seat.seatServiceIds ?? [],
      seatNumber: seat.seatNumber,
      segmentId: seat.segmentId,
      rowNumber: seat.rowNumber,
      column: seat.column,
      cabinZone: seat.cabinZone,
      seatType: seat.seatType,
      restroomZone: seat.restroomZone,
      price: seat.price,
      currency: seat.currency,
      reason: seat.reason,
    };

    store.setPassengerSeat(seatPaxIndex, seatJourney, seatData);
    const newSelectedSeats = [...selectedSeatNumbers, seat.seatNumber];
    setSelectedSeatNumbers(newSelectedSeats);

    advanceSeatSelection(seatPaxIndex, seatJourney, newSelectedSeats);
  };

  const handleSeatSkip = () => {
    store.setPassengerSeat(seatPaxIndex, seatJourney, null);
    advanceSeatSelection(seatPaxIndex, seatJourney, selectedSeatNumbers);
  };

  const advanceSeatSelection = async (currentPax: number, currentJourney: 'outbound' | 'return', excludeSeats: string[]) => {
    const nextPax = currentPax + 1;
    const isRoundTrip = !!store.selectedRoundTrip;

    if (currentJourney === 'outbound') {
      if (nextPax < store.passengerCount) {
        setSeatPaxIndex(nextPax);
        setSelectedSeatNumbers(excludeSeats);
        await fetchSeatRecommendations(0);
      } else if (isRoundTrip) {
        setSeatPaxIndex(0);
        setSeatJourney('return');
        setSelectedSeatNumbers([]);
        await fetchSeatRecommendations(1);
      } else {
        store.setStatus('meal_preference');
      }
    } else {
      if (nextPax < store.passengerCount) {
        setSeatPaxIndex(nextPax);
        setSelectedSeatNumbers(excludeSeats);
        await fetchSeatRecommendations(1);
      } else {
        store.setStatus('meal_preference');
      }
    }
  };

  const handleMealComplete = (meals: { paxIndex: number; journey: 'outbound' | 'return'; code: string }[]) => {
    meals.forEach(m => {
      store.setPassengerMeal(m.paxIndex, m.journey, m.code);
    });
    store.setStatus('add_ons');
  };

  const handleAddOnsComplete = (addOns: { extraBags: number; travelInsurance: boolean; liveBagPrice?: number }) => {
    // Set live baggage price if available (from provider API)
    if (addOns.liveBagPrice !== undefined && addOns.liveBagPrice > 0) {
      store.setLiveBaggagePrice(addOns.liveBagPrice);
    }
    store.setExtraBags(addOns.extraBags);
    if (addOns.travelInsurance !== store.addOns.travelInsurance) {
      store.toggleInsurance();
    }
    store.setStatus('final_summary');
  };

  // ── Go back to previous step ─────────────────────────────────────────────────
  const canGoBack = store.status !== 'flight_selection' && store.status !== 'completed';

  const handleGoBack = () => {
    // Dynamic overrides
    if (store.status === 'meal_preference') {
      // If seats were skipped, go back to passenger confirm
      const seatPolicy = store.fareDetails?.seatSelection;
      store.setStatus(seatPolicy === 'not_available' ? 'passenger_confirm' : 'seat_preference');
      return;
    }
    if (store.status === 'passenger_details' && store.currentPassengerIndex > 0) {
      store.setCurrentPassengerIndex(store.currentPassengerIndex - 1);
      return;
    }
    const prev = PREVIOUS_STATUS[store.status];
    if (prev) store.setStatus(prev);
  };

  const handleContinueToReview = async () => {
    setIsNavigating(true);
    try {
      const { selectedFare } = store.hydrateCheckoutStore();

      try {
        const data = await apiFetch<{ sessionId: string }>('/api/booking-session/select-fare', {
          method: 'POST',
          body: JSON.stringify({
            fareId: selectedFare.fareId,
            offerId: selectedFare.offerId,
            cabin: selectedFare.cabin,
            name: selectedFare.name,
            basePrice: selectedFare.basePrice,
            totalPrice: selectedFare.totalPrice,
            priceProtection: selectedFare.priceProtection,
            currency: selectedFare.currency,
          }),
        });
        useCheckoutStore.getState().setSessionId(data.sessionId);
      } catch {
        useCheckoutStore.getState().setSessionId(`ai_session_${Date.now()}`);
      }

      const flight = store.selectedFlight!;
      // Resolve passenger breakdown from types array (AI flow tracks types individually)
      const paxTypes = store.passengerTypes ?? [];
      const adultCount = paxTypes.filter(t => t === 'adult').length || store.passengerCount;
      const childCount = paxTypes.filter(t => t === 'child').length;
      const infantCount = paxTypes.filter(t => t === 'infant').length;
      sessionStorage.setItem('fm_fare_context', JSON.stringify({
        offerId: flight.providerOfferId,
        basePrice: flight.totalPrice,
        providerTotalFare: (flight as any).providerTotalFare ?? flight.totalPrice,
        fareMindMarkupAmount: (flight as any).fareMindMarkupAmount ?? 0,
        travelers: store.passengerCount,
        adults: adultCount,
        children: childCount,
        infants: infantCount,
        currency: flight.currency || 'USD',
        origin: flight.segments[0]?.departure.airport ?? '',
        destination: flight.segments[flight.segments.length - 1]?.arrival.airport ?? '',
        stops: flight.stops,
        durationMinutes: flight.totalDuration,
        layoverMinutes: [],
        fareRules: flight.fareRules,
      }));

      store.setStatus('completed');
      router.push('/checkout/review');
    } catch (err) {
      console.error('Failed to navigate to review:', err);
      setIsNavigating(false);
    }
  };

  const handleRestart = () => {
    store.reset();
    offerSession.clearSession();
  };

  // ── Handle text input ──────────────────────────────────────────────────────
  const handleTextSubmit = () => {
    const val = inputValue.trim();
    if (!val) return;
    setInputValue('');

    const num = parseInt(val, 10);

    switch (store.status) {
      case 'flight_selection':
        if (num >= 1 && num <= Math.min(5, flights.length)) {
          handleFlightSelect(num - 1);
        }
        break;

      case 'fare_selection':
        if (num >= 1 && num <= fareOptions.length) {
          handleFareSelect(fareOptions[num - 1]);
        }
        break;

      case 'passenger_count':
        if (num >= 1 && num <= 9) {
          handlePassengerCountSelect(num);
        }
        break;

      case 'price_protection':
        if (val.toLowerCase() === 'yes' || val === '1') handleProtectionComplete(Array(store.passengerCount).fill(true));
        else if (val.toLowerCase() === 'no' || val === '3') handleProtectionComplete(Array(store.passengerCount).fill(false));
        break;

      case 'itinerary_preview':
      case 'continue_prompt':
        handleContinueFromPreview();
        break;

      default:
        break;
    }
  };

  // ── Should show text input? ─────────────────────────────────────────────────
  const showInput = !['passenger_count', 'passenger_details', 'passenger_confirm', 'add_ons', 'seat_preference', 'seat_recommendations', 'seat_recommendations_return', 'seat_group_options', 'seat_return_prompt', 'meal_preference', 'final_summary', 'completed'].includes(store.status);

  // ── Render route labels ────────────────────────────────────────────────────
  const getOutboundRoute = () => {
    const flight = store.selectedFlight;
    if (!flight) return '';
    return `${flight.segments[0]?.departure.airport ?? ''} → ${flight.segments[flight.segments.length - 1]?.arrival.airport ?? ''}`;
  };

  const getReturnRoute = () => {
    const rt = store.selectedRoundTrip;
    if (!rt) return 'Return flight';
    return `${rt.returnJourney.departureAirport} → ${rt.returnJourney.arrivalAirport}`;
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-gradient-to-r from-[#1ABC9C]/5 to-emerald-500/5 flex-none">
        <div className="flex items-center gap-1.5">
          {canGoBack && (
            <button
              onClick={handleGoBack}
              className="flex items-center justify-center w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all mr-0.5"
              title="Go back"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <Sparkles className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-[15px] font-bold bg-gradient-to-r from-[#1ABC9C] to-emerald-500 bg-clip-text text-transparent">
            Book a Flight
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Countdown timer — shows after flight selection */}
          {offerSession.status !== 'IDLE' && (() => {
            const fmt = (s: number) => {
              const m = Math.floor(s / 60);
              const sec = s % 60;
              return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
            };

            if (offerSession.status === 'EXPIRED') {
              return (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-400/30 text-red-500 text-[11px] font-bold">
                  <XCircle className="w-3 h-3" />
                  <span>Expired</span>
                </div>
              );
            }

            if (offerSession.status === 'WARNING') {
              return (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-600 text-[11px] font-bold animate-pulse">
                  <AlertTriangle className="w-3 h-3" />
                  <span className="tabular-nums">{fmt(offerSession.remainingSeconds)}</span>
                </div>
              );
            }

            return (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-400/30 text-amber-600 text-[11px] font-bold">
                <Clock className="w-3 h-3" />
                <span className="tabular-nums">{fmt(offerSession.remainingSeconds)}</span>
              </div>
            );
          })()}
          <button
            onClick={handleRestart}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 text-[12px] font-medium transition-all"
          >
            <RotateCcw className="w-3 h-3" />
            Restart
          </button>
          <button
            onClick={onExit}
            className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 text-[12px] font-medium transition-all"
          >
            Exit
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
        {/* ═══ Step: Flight Selection ═══ */}
        {store.status === 'flight_selection' && (
          <>
            <AiBubble>
              <p>I found {Math.min(5, flights.length)} great options. Tap to select:</p>
            </AiBubble>
            <AiFlightOptionTimeline
              flights={flights.slice(0, 5)}
              roundTripOptions={roundTripOptions}
              onSelect={handleFlightSelect}
            />
          </>
        )}

        {/* ═══ Step: Fare Selection ═══ */}
        {store.status === 'fare_selection' && store.selectedFlight && (
          <>
            <AiBubble>
              <p>Great pick! Now choose your fare class:</p>
            </AiBubble>
            <AiFareClassSelector
              fares={fareOptions}
              loading={fareLoading}
              error={fareError}
              onSelect={handleFareSelect}
            />
          </>
        )}

        {/* ═══ Step: Passenger Count — auto-skip from search params ═══ */}
        {store.status === 'passenger_count' && store.fareDetails && (
          <AiBubble>
            <p>
              ✅ <span className="font-bold text-[#1ABC9C]">{store.fareDetails.name}</span> selected at {fmt(store.fareDetails.totalPrice)} per passenger.
            </p>
          </AiBubble>
        )}

        {/* ═══ Step: Price Protection ═══ */}
        {store.status === 'price_protection' && (
          <>
            <AiBubble>
              <p>
                {store.passengerCount > 1 ? (
                  <>
                    ✅ <span className="font-bold text-white">{store.passengerCount} passengers</span> selected.
                    <br />
                    <span className="text-white/60 text-[14px]">
                      Fare total: {fmt(store.fareDetails!.totalPrice * store.passengerCount)}
                    </span>
                  </>
                ) : (
                  <>Good choice! One more option before we continue:</>
                )}
              </p>
            </AiBubble>
            <AiMultiPaxProtectionStep
              passengerCount={store.passengerCount}
              protectionFeePerPax={store.protectionFee}
              currency={store.fareDetails?.currency ?? 'USD'}
              onComplete={handleProtectionComplete}
            />
          </>
        )}

        {/* ═══ Step: Itinerary Preview ═══ */}
        {store.status === 'itinerary_preview' && store.selectedFlight && store.fareDetails && (
          <>
            <AiBubble>
              <p>Here&apos;s your selection so far:</p>
            </AiBubble>
            <div className="bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-slate-700">
                  {store.selectedFlight.segments[0]?.departure.airport ?? ''} → {store.selectedFlight.segments[store.selectedFlight.segments.length - 1]?.arrival.airport ?? ''}
                </span>
                <span className="text-[13px] font-bold text-[#1ABC9C]">{store.fareDetails.name}</span>
              </div>
              <div className="flex items-center justify-between text-[12px] text-slate-500">
                <span>{store.selectedFlight.airline.name}</span>
                <span className="text-[#F97316] font-bold">
                  {fmt(store.priceSummary.baseFare)}
                  {store.passengerCount > 1 && (
                    <span className="text-slate-400 font-normal ml-1">({store.passengerCount} pax)</span>
                  )}
                </span>
              </div>
              {store.priceProtection && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-full border border-emerald-200/50">
                  🛡️ Price protection active
                </span>
              )}
            </div>
            <button
              onClick={handleContinueFromPreview}
              className="w-full py-2.5 rounded-xl bg-[#1ABC9C] hover:bg-emerald-500 text-white text-[13px] font-bold transition-all shadow-md shadow-[#1ABC9C]/20 flex items-center justify-center gap-1"
            >
              Continue to passenger details →
            </button>
          </>
        )}

        {/* ═══ Step: Passenger Details ═══ */}
        {store.status === 'passenger_details' && (
          <>
            <AiBubble>
              {store.passengerCount > 1 ? (() => {
                const paxType = store.passengerTypes?.[store.currentPassengerIndex] ?? 'adult';
                const typeLabel = paxType === 'child' ? ' (Child)' : paxType === 'infant' ? ' (Infant)' : ' (Adult)';
                return (
                <p>
                  Let&apos;s collect details for <span className="font-bold text-white">Traveler {store.currentPassengerIndex + 1}{typeLabel}</span> of {store.passengerCount}.
                  {store.currentPassengerIndex === 0 && ' I\'ll start with the primary contact. 📋'}
                  {store.currentPassengerIndex > 0 && (
                    <>
                      <br />
                      <span className="text-white/60 text-[14px]">
                        Contact info from Traveler 1 will be used for the booking.
                      </span>
                    </>
                  )}
                </p>
                );
              })() : (
                <p>Now I need your passenger details. I&apos;ll ask one field at a time. 📋</p>
              )}

              {/* Traveler type roster */}
              {store.passengerCount > 1 && (
                <div className="mt-2.5 space-y-1">
                  {Array.from({ length: store.passengerCount }, (_, i) => {
                    const type = store.passengerTypes?.[i] ?? 'adult';
                    const label = type === 'child' ? 'Child' : type === 'infant' ? 'Infant' : 'Adult';
                    const emoji = type === 'child' ? '👦' : type === 'infant' ? '👶' : '🧑';
                    const isCurrent = i === store.currentPassengerIndex;
                    const isDone = i < store.currentPassengerIndex;
                    return (
                      <div
                        key={i}
                        className={`flex items-center gap-2 px-2 py-1 rounded-lg text-[12px] transition-all ${
                          isCurrent
                            ? 'bg-[#1ABC9C]/15 border border-[#1ABC9C]/30'
                            : isDone
                              ? 'bg-white/5 opacity-60'
                              : 'bg-white/5 opacity-40'
                        }`}
                      >
                        <span className="text-sm">{emoji}</span>
                        <span className={`font-bold ${isCurrent ? 'text-[#1ABC9C]' : 'text-white/70'}`}>
                          Traveler {i + 1}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          type === 'child' ? 'bg-amber-500/20 text-amber-400' :
                          type === 'infant' ? 'bg-pink-500/20 text-pink-400' :
                          'bg-blue-500/20 text-blue-400'
                        }`}>
                          {label}
                        </span>
                        {isDone && <span className="ml-auto text-[#1ABC9C] text-[11px] font-bold">✓ Done</span>}
                        {isCurrent && <span className="ml-auto text-[#1ABC9C] text-[11px] font-bold animate-pulse">→ Now</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Progress indicator */}
              {store.passengerCount > 1 && (
                <div className="flex gap-1 mt-1.5">
                  {Array.from({ length: store.passengerCount }, (_, i) => (
                    <div
                      key={i}
                      className={`h-1 rounded-full flex-1 ${
                        i < store.currentPassengerIndex ? 'bg-[#1ABC9C]' :
                        i === store.currentPassengerIndex ? 'bg-[#1ABC9C]/50' : 'bg-white/10'
                      }`}
                    />
                  ))}
                </div>
              )}
            </AiBubble>
            <AiPassengerDetailCollector
              key={`pax-${store.currentPassengerIndex}`}
              passenger={store.passengers[store.currentPassengerIndex] ?? store.passengers[0]}
              passengerIndex={store.currentPassengerIndex}
              passengerLabel={store.passengerCount > 1 ? `Traveler ${store.currentPassengerIndex + 1}` : undefined}
              passengerCount={store.passengerCount}
              passengerType={store.passengerTypes?.[store.currentPassengerIndex] ?? 'adult'}
              fieldOrder={store.currentPassengerIndex > 0 ? SECONDARY_PASSENGER_FIELDS : undefined}
              onFieldUpdate={handlePassengerFieldUpdate}
              onComplete={handlePassengerComplete}
            />
          </>
        )}

        {/* ═══ Step: Passenger Confirm ═══ */}
        {store.status === 'passenger_confirm' && (
          <>
            <AiBubble>
              <p>
                {store.passengerCount > 1
                  ? `All ${store.passengerCount} travelers collected! Please review:`
                  : 'Please review your details:'
                }
              </p>
            </AiBubble>
            <AiPassengerSummaryTable
              passengers={store.passengers}
              onConfirm={handlePassengerConfirm}
              onEdit={handlePassengerEdit}
            />
          </>
        )}

        {/* ═══ Step: Seat Preference ═══ */}
        {store.status === 'seat_preference' && (
          <>
            <AiBubble>
              {store.passengerCount > 1 ? (
                <>
                  <p>
                    <span className="text-[#1ABC9C] font-medium">
                      {seatJourney === 'outbound' ? getOutboundRoute() : getReturnRoute()}
                    </span>
                  </p>
                  <p className="mt-0.5">
                    Where would your group of{' '}
                    <span className="font-bold text-white">{store.passengerCount}</span>{' '}
                    prefer to sit? ✈️
                  </p>
                  <p className="text-white/50 text-[13px] mt-0.5">
                    I&apos;ll find consecutive seats for everyone together.
                  </p>
                </>
              ) : (
                <p>Where would you like to sit? ✈️</p>
              )}
            </AiBubble>
            <AiSeatPreferenceCollector onComplete={handleSeatComplete} />
          </>
        )}

        {/* ═══ Step: Group Seat Options (multi-pax) ═══ */}
        {store.status === 'seat_group_options' && (
          <>
            <AiGroupSeatBlockList
              blocks={groupSeatBlocks}
              loading={groupSeatLoading}
              error={groupSeatError}
              fallbackLevel={groupSeatFallbackLevel}
              fallbackReason={groupSeatFallbackReason}
              route={seatJourney === 'outbound' ? getOutboundRoute() : getReturnRoute()}
              passengerCount={store.passengerCount}
              onSelect={handleGroupBlockSelect}
              onSkip={handleGroupSeatSkip}
              onIndividual={handleSwitchToIndividual}
            />
          </>
        )}

        {/* ═══ Step: Return Seat Prompt ═══ */}
        {store.status === 'seat_return_prompt' && (
          <>
            <AiBubble>
              <p>
                ✅ Outbound seats selected for all{' '}
                <span className="font-bold text-white">{store.passengerCount}</span> travelers!
              </p>
              <p className="mt-1">
                Would you like to use the same group seat preference for your{' '}
                <span className="text-[#1ABC9C]">return flight</span>?
              </p>
            </AiBubble>
            <div className="space-y-1.5 px-0.5">
              <button
                onClick={handleReturnSamePreference}
                className="w-full text-left px-3 py-2.5 rounded-xl bg-white/95 border border-slate-200/80 hover:border-[#1ABC9C]/50 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black text-[#1ABC9C] bg-[#1ABC9C]/10 w-4 h-4 rounded-full flex items-center justify-center">1</span>
                  <span className="text-[13px] font-semibold text-slate-700">Yes, use same preference</span>
                </div>
              </button>
              <button
                onClick={handleReturnDifferentPreference}
                className="w-full text-left px-3 py-2.5 rounded-xl bg-white/95 border border-slate-200/80 hover:border-[#1ABC9C]/50 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black text-white/60 bg-white/10 w-4 h-4 rounded-full flex items-center justify-center">2</span>
                  <span className="text-[13px] font-semibold text-slate-700">No, choose different preference</span>
                </div>
              </button>
              <button
                onClick={handleReturnSkipSeats}
                className="w-full text-left px-3 py-2.5 rounded-xl bg-white/95 border border-slate-200/80 hover:border-slate-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black text-white/40 bg-white/5 w-4 h-4 rounded-full flex items-center justify-center">3</span>
                  <span className="text-[13px] font-medium text-slate-500">Skip return seat selection</span>
                </div>
              </button>
            </div>
          </>
        )}

        {/* ═══ Step: Seat Recommendations (single pax / individual fallback) ═══ */}
        {(store.status === 'seat_recommendations' || store.status === 'seat_recommendations_return') && (
          <>
            <AiSeatRecommendationList
              seats={seatRecommendations}
              loading={seatLoading}
              error={seatError}
              fallbackUsed={seatFallbackUsed}
              fallbackReason={seatFallbackReason}
              route={seatJourney === 'outbound' ? getOutboundRoute() : getReturnRoute()}
              passengerLabel={store.passengerCount > 1 ? `Traveler ${seatPaxIndex + 1}` : undefined}
              excludeSeats={selectedSeatNumbers}
              onSelect={handleSeatSelection}
              onSkip={handleSeatSkip}
            />
          </>
        )}

        {/* ═══ Step: Meal Preference ═══ */}
        {store.status === 'meal_preference' && (
          <>
            <AiBubble>
              {/* Show seat confirmation */}
              {store.passengerSeats.length > 0 && (
                <p className="mb-1">
                  ✅ <span className="font-bold text-[#1ABC9C]">{store.passengerSeats.filter(s => s.seat).length}</span> seat{store.passengerSeats.filter(s => s.seat).length !== 1 ? 's' : ''} selected!
                </p>
              )}
              <p>What meal would you like on board? 🍽️</p>
            </AiBubble>
            <AiMultiPaxMealStep
              passengerCount={store.passengerCount}
              isRoundTrip={!!store.selectedRoundTrip}
              onComplete={handleMealComplete}
            />
          </>
        )}

        {/* ═══ Step: Add-ons ═══ */}
        {store.status === 'add_ons' && store.fareDetails && (
          <>
            <AiBubble>
              <p>Almost done! Any extras? 🧳</p>
            </AiBubble>
            <AiMultiPaxAddOnsStep
              passengerCount={store.passengerCount}
              baseFarePrice={store.fareDetails.totalPrice}
              currency={store.fareDetails.currency}
              providerBaggage={providerBaggage}
              baggageLoading={baggageLoading}
              baggageUnavailable={baggageUnavailable}
              onComplete={handleAddOnsComplete}
            />
          </>
        )}

        {/* ═══ Step: Final Summary ═══ */}
        {store.status === 'final_summary' && store.selectedFlight && store.fareDetails && (
          <>
            <AiBubble>
              <p>Here&apos;s your complete booking summary! 🎉</p>
              <p className="text-white/50 text-[12px] mt-0.5">
                {store.passengerCount > 1
                  ? `Review details for all ${store.passengerCount} passengers and continue to checkout.`
                  : 'Review everything and continue to checkout when ready.'
                }
              </p>
            </AiBubble>
            <AiBookingSummaryCard
              flight={store.selectedFlight}
              roundTrip={store.selectedRoundTrip}
              fareDetails={store.fareDetails}
              passengers={store.passengers}
              passengerCount={store.passengerCount}
              seatPreference={store.seatPreference}
              passengerSeats={store.passengerSeats}
              passengerMeals={store.passengerMeals}
              selectedSeat={store.selectedSeat}
              selectedReturnSeat={store.selectedReturnSeat}
              mealLabel={store.mealPreference}
              extraBags={store.addOns.extraBags}
              travelInsurance={store.addOns.travelInsurance}
              priceProtection={store.priceProtection}
              protectionFee={store.protectionFee}
              priceSummary={store.priceSummary}
              onContinueToReview={handleContinueToReview}
              isNavigating={isNavigating}
            />
          </>
        )}

        {/* ═══ Step: Completed ═══ */}
        {store.status === 'completed' && (
          <AiBubble>
            <p>Redirecting you to checkout… ✈️</p>
          </AiBubble>
        )}
      </div>

      {/* Text input bar */}
      {showInput && (
        <div className="flex-none px-3 py-2 border-t border-slate-100 bg-white">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleTextSubmit(); } }}
              placeholder={isRecording ? 'Listening…' : 'Type a number to select…'}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-[13px] placeholder-slate-400 focus:outline-none focus:border-[#1ABC9C]/50 transition-colors min-w-0"
            />
            <button
              onClick={handleTextSubmit}
              disabled={!inputValue.trim()}
              className="flex-none px-3 py-2 rounded-xl bg-[#1ABC9C] hover:bg-emerald-500 text-white text-[12px] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Send
            </button>
            {/* Animated voice button */}
            {voiceSupported && (
              <button
                onClick={async () => {
                  if (isRecording) {
                    stopListening();
                    setIsRecording(false);
                    return;
                  }
                  setInputValue('');
                  setIsRecording(true);
                  try {
                    const result = await startListening((interim) => {
                      setInputValue(interim);
                    }, { singleShot: true });
                    setIsRecording(false);
                    if (result.transcript.trim()) {
                      setInputValue(result.transcript.trim());
                    }
                  } catch {
                    setIsRecording(false);
                  }
                }}
                title={isRecording ? 'Stop recording' : 'Voice input'}
                className={`flex-none w-9 h-9 rounded-full flex items-center justify-center transition-all relative ${
                  isRecording
                    ? 'text-red-500 ring-2 ring-red-400/40 bg-red-50'
                    : 'text-slate-400 hover:text-[#1ABC9C] cursor-pointer'
                }`}
              >
                {isRecording ? (
                  <Mic className="w-5 h-5 animate-pulse" />
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="relative z-10">
                    <rect x="3" y="9" width="2" height="6" rx="1" fill="currentColor">
                      <animate attributeName="height" values="6;10;6" dur="1.2s" repeatCount="indefinite" />
                      <animate attributeName="y" values="9;7;9" dur="1.2s" repeatCount="indefinite" />
                    </rect>
                    <rect x="7.5" y="7" width="2" height="10" rx="1" fill="currentColor">
                      <animate attributeName="height" values="10;4;10" dur="0.9s" repeatCount="indefinite" />
                      <animate attributeName="y" values="7;10;7" dur="0.9s" repeatCount="indefinite" />
                    </rect>
                    <rect x="12" y="5" width="2" height="14" rx="1" fill="currentColor">
                      <animate attributeName="height" values="14;6;14" dur="1.1s" repeatCount="indefinite" />
                      <animate attributeName="y" values="5;9;5" dur="1.1s" repeatCount="indefinite" />
                    </rect>
                    <rect x="16.5" y="8" width="2" height="8" rx="1" fill="currentColor">
                      <animate attributeName="height" values="8;14;8" dur="1.4s" repeatCount="indefinite" />
                      <animate attributeName="y" values="8;5;8" dur="1.4s" repeatCount="indefinite" />
                    </rect>
                    <rect x="21" y="10" width="2" height="4" rx="1" fill="currentColor">
                      <animate attributeName="height" values="4;10;4" dur="0.8s" repeatCount="indefinite" />
                      <animate attributeName="y" values="10;7;10" dur="0.8s" repeatCount="indefinite" />
                    </rect>
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
