'use client';

import { create } from 'zustand';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import type {
  AiBookingSession,
  AiBookingStatus,
  AiFareClass,
  AiFareDetails,
  AiPassengerData,
  AiSeatPreference,
  AiAddOns,
  AiPriceSummary,
  PassengerSeatSelection,
  PassengerMealSelection,
  PassengerProtection,
} from '@/lib/ai-booking-types';
import type { SelectedSeatData } from '@/lib/ai-seat/ai-seat-types';
import {
  FARE_CLASS_NAMES,
  FALLBACK_FARE_CLASS_MULTIPLIERS,

  FALLBACK_INSURANCE_RATE,
  FALLBACK_SERVICE_FEE_RATE,
} from '@/lib/ai-booking-types';
import { useCheckoutStore, makePassenger } from '@/store/useCheckoutStore';
import type { SelectedFare, FareOption } from '@/lib/fare-types';
import { fetchComputedFeesForContext, type ComputedFees } from '@/hooks/useFeeLoader';
import type { PricingConfig } from '@/hooks/usePricingConfig';

// ── SSR meal code → display label mapping ─────────────────────────────────────
const SSR_MEAL_LABELS: Record<string, string> = {
  STANDARD: 'Standard',
  VGML: 'Vegetarian',
  AVML: 'Asian Vegetarian',
  NLML: 'Vegan',
  MOML: 'Halal',
  KSML: 'Kosher',
  HNML: 'Hindu',
  DBML: 'Diabetic',
  GFML: 'Gluten-Free',
  NONE: 'No meal',
};

// ─── Empty passenger ──────────────────────────────────────────────────────────

const EMPTY_PASSENGER: AiPassengerData = {
  firstName: '',
  middleName: '',
  lastName: '',
  email: '',
  phone: '',
  gender: 'male',
  dateOfBirth: '',
  nationality: '',
  passportCountry: '',
  passportNumber: '',
  passportExpiry: '',
};

// ─── Default seat/add-on ──────────────────────────────────────────────────────

const DEFAULT_SEAT: AiSeatPreference = { position: 'any', type: 'any' };
const DEFAULT_ADDONS: AiAddOns = { extraBags: 0, travelInsurance: false, insuranceFee: 0 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createEmptyPassengers(count: number): AiPassengerData[] {
  return Array.from({ length: count }, () => ({ ...EMPTY_PASSENGER }));
}

function createPassengerProtections(count: number): PassengerProtection[] {
  return Array.from({ length: count }, (_, i) => ({ passengerIndex: i, selected: false }));
}

/** Sum all seat prices across all passengers and journeys */
function totalSeatFees(seats: PassengerSeatSelection[]): number {
  return seats.reduce((sum, s) => sum + (s.seat?.price ?? 0), 0);
}

// ─── Compute price summary (multi-pax aware) ─────────────────────────────────

function computePriceSummary(
  fareDetails: AiFareDetails | null,
  passengerCount: number,
  protections: PassengerProtection[],
  protectionFeePerPax: number,
  addOns: AiAddOns,
  passengerSeats: PassengerSeatSelection[],
  computedFees?: ComputedFees | null,
  liveBaggagePrice?: number | null,
): AiPriceSummary {
  const empty: AiPriceSummary = {
    passengerCount: 1, baseFarePerPax: 0, baseFare: 0, serviceFee: 0, taxes: 0,
    protectionFee: 0, baggageFee: 0, insuranceFee: 0, seatSelectionFee: 0,
    total: 0, currency: 'USD',
  };
  if (!fareDetails) return empty;

  const paxCount = Math.max(1, passengerCount);

  // Always use actual provider base fare / tax breakdown (from Mystifly/Duffel API).
  // No estimated or cosmetic splits — only real provider data.
  const baseFarePerPax = fareDetails.providerBaseFare ?? fareDetails.totalPrice;
  const taxesPerPax = fareDetails.providerTaxAmount ?? 0;
  const baseFare = baseFarePerPax * paxCount;
  const taxes = taxesPerPax * paxCount;

  // Use DB-driven service fee if available, otherwise last-resort fallback
  // Service fee is based on the full fare (totalPrice), not just base
  const fullFare = fareDetails.totalPrice * paxCount;
  const serviceFee = computedFees
    ? computedFees.serviceFee
    : Math.round(fullFare * FALLBACK_SERVICE_FEE_RATE);

  const protectedCount = protections.filter(p => p.selected).length;
  // Use DB-driven protection fee if available
  const effectiveProtectionPerPax = computedFees
    ? computedFees.protectionFee
    : protectionFeePerPax;
  const protectionFee = protectedCount * effectiveProtectionPerPax;

  const bagPricePerUnit = liveBaggagePrice ?? 0; // live price only — no fallback
  // extraBags is the total bag count (not per-passenger)
  const baggageFee = addOns.extraBags * bagPricePerUnit;

  // Use DB-driven insurance fee if available, otherwise last-resort fallback
  const insuranceFee = addOns.travelInsurance
    ? (computedFees
        ? computedFees.insuranceFeeTotal
        : Math.round(fareDetails.totalPrice * FALLBACK_INSURANCE_RATE) * paxCount)
    : 0;

  const seatSelectionFee = totalSeatFees(passengerSeats);

  return {
    passengerCount: paxCount,
    baseFarePerPax,
    baseFare,
    serviceFee,
    taxes,
    protectionFee,
    baggageFee,
    insuranceFee,
    seatSelectionFee,
    // total = base + taxes (= provider fare) + service fee + add-ons
    total: baseFare + taxes + serviceFee + protectionFee + baggageFee + insuranceFee + seatSelectionFee,
    currency: fareDetails.currency,
  };
}

// ─── Build fare details from flight (fallback when API unavailable) ───────────
// Uses DB pricing config when available, falls back to hardcoded defaults.

export function buildFareDetails(
  flight: UnifiedFlight,
  fareClass: AiFareClass,
  pricingConfig?: PricingConfig | null,
): AiFareDetails {
  // Use DB fare tier multiplier if available, else fallback
  const dbTier = pricingConfig?.fareTiers?.find(t =>
    t.name.toLowerCase().includes(fareClass === 'basic' ? 'basic' : fareClass === 'flex' ? 'flex' : 'standard')
  );
  const multiplier = dbTier?.priceMultiplier ?? FALLBACK_FARE_CLASS_MULTIPLIERS[fareClass];
  const totalPrice = Math.round(flight.totalPrice * multiplier);
  // Use actual provider base/tax split scaled for the fare tier — no estimated tax rates
  const basePrice = flight.baseFare ? Math.round(flight.baseFare * multiplier) : totalPrice;

  const isBasic = fareClass === 'basic';
  const isFlex = fareClass === 'flex';

  const actualChecked = flight.baggage.checked;
  const actualRefundable = flight.fareRules.refundable;
  const actualChangeable = flight.fareRules.changeable;
  const actualCancelFee = flight.fareRules.cancellationFee ?? null;
  const actualChangeFee = flight.fareRules.changeFee ?? null;

  const checkedBags = isBasic
    ? Math.max(0, actualChecked - 1)
    : isFlex
    ? Math.max(actualChecked, 2)
    : actualChecked;

  const refundable = isBasic ? false : isFlex ? true : actualRefundable;
  const refundFee = isBasic ? null : isFlex ? 0 : actualCancelFee;
  const changeable = isBasic ? false : true;
  const changeFee = isBasic ? null : isFlex ? 0 : actualChangeFee;

  // Use DB fare tier seat selection policy if available
  const seatSelection = dbTier
    ? (dbTier.seatSelection as 'free' | 'fee' | 'not_available')
    : (isBasic ? 'not_available' as const : isFlex ? 'free' as const : 'fee' as const);
  const seatSelectionFee = dbTier?.seatSelectionFeeUsd ?? (seatSelection === 'fee' ? 15 : null);
  const priorityBoarding = dbTier?.priorityBoarding ?? isFlex;
  const milesEarning = isBasic ? 'reduced' as const : 'full' as const;

  const includedFeatures: string[] = [];
  const excludedFeatures: string[] = [];

  includedFeatures.push(`${flight.baggage.carryOn || 1}× carry-on bag`);
  if (milesEarning === 'full') includedFeatures.push('Full miles earned');
  else includedFeatures.push('50% miles earned');
  if (checkedBags > 0) includedFeatures.push(`${checkedBags}× checked bag${checkedBags > 1 ? 's' : ''}`);
  else excludedFeatures.push('No checked bags');
  if (refundable === null || refundable === undefined) includedFeatures.push('Refund: Contact airline');
  else if (!refundable) excludedFeatures.push('Non-refundable');
  else if (refundFee === 0) includedFeatures.push('Refundable (Included)');
  else if (refundFee !== null) includedFeatures.push(`Refundable (fee: $${refundFee})`);
  else includedFeatures.push('Refundable');
  if (changeable === null || changeable === undefined) includedFeatures.push('Changes: Contact airline');
  else if (!changeable) excludedFeatures.push('Non-changeable');
  else if (changeFee === 0) includedFeatures.push('Changeable (Included)');
  else if (changeFee !== null) includedFeatures.push(`Changeable (fee: $${changeFee})`);
  else includedFeatures.push('Changes allowed (fee applies)');
  if (priorityBoarding) includedFeatures.push('Priority boarding');
  else excludedFeatures.push('No priority boarding');

  const aiScore = Math.min(100, Math.max(0,
    Math.round(flight.valueScore * (isFlex ? 1.1 : isBasic ? 0.85 : 1.0))
  ));

  const aiExplanation = isFlex
    ? 'Maximum flexibility with free changes and full refund'
    : isBasic
    ? 'Lowest cost option — ideal for simple trips'
    : 'Balanced value with checked bag and flexibility';

  return {
    fareClass,
    name: FARE_CLASS_NAMES[fareClass],
    basePrice,
    totalPrice,
    // Scale provider base fare / tax proportionally for the fare tier
    providerBaseFare: flight.baseFare ? Math.round(flight.baseFare * multiplier) : undefined,
    providerTaxAmount: flight.taxAmount ? Math.round(flight.taxAmount * multiplier) : undefined,
    currency: flight.currency || 'USD',
    carryOnPieces: flight.baggage.carryOn || 1,
    checkedBags,
    checkedWeightKg: flight.baggage.checkedWeight ?? 23,
    refundable,
    refundFee,
    changeable,
    changeFee,
    seatSelection,
    seatSelectionFee,
    priorityBoarding,
    milesEarning,
    aiScore,
    aiExplanation,
    includedFeatures,
    excludedFeatures,
  };
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface AiBookingStore extends AiBookingSession {
  // Actions
  setStatus: (status: AiBookingStatus) => void;
  selectFlight: (flight: UnifiedFlight, roundTrip?: RoundTripOption | null) => void;
  selectFare: (fareClass: AiFareClass) => void;
  selectFareFromOption: (fare: FareOption) => void;

  // Passenger count
  setPassengerCount: (n: number) => void;
  setCurrentPassengerIndex: (i: number) => void;
  setPassengerTypes: (types: ('adult' | 'child' | 'infant')[]) => void;

  // Protection
  toggleProtection: () => void;
  setPassengerProtection: (paxIndex: number, selected: boolean) => void;
  setAllProtections: (selected: boolean) => void;

  // Passenger data
  setPassengerField: <K extends keyof AiPassengerData>(field: K, value: AiPassengerData[K]) => void;
  setPassenger: (passenger: AiPassengerData) => void;
  setPassengerAt: (index: number, data: Partial<AiPassengerData>) => void;
  setPassengerComplete: (index: number, data: AiPassengerData) => void;

  // Seat
  setSeatPreference: (pref: AiSeatPreference) => void;
  setSelectedSeat: (seat: SelectedSeatData | null) => void;
  setSelectedReturnSeat: (seat: SelectedSeatData | null) => void;
  setPassengerSeat: (paxIndex: number, journey: 'outbound' | 'return', seat: SelectedSeatData | null) => void;

  // Meal
  setMealPreference: (code: string) => void;
  setPassengerMeal: (paxIndex: number, journey: 'outbound' | 'return', code: string) => void;
  setAllMeals: (code: string) => void;

  // Add-ons
  setExtraBags: (n: number) => void;
  toggleInsurance: () => void;
  setLiveBaggagePrice: (price: number) => void;

  // Misc
  reset: () => void;
  selectedFareOption: FareOption | null;
  hydrateCheckoutStore: () => { selectedFare: SelectedFare; fareOption: FareOption | null };
  recomputePrice: () => void;

  // DB-driven commercial fees
  computedFees: ComputedFees | null;
  fetchComputedFees: () => Promise<void>;

  // Live provider baggage price (per bag)
  liveBaggagePrice: number | null;
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_PRICE: AiPriceSummary = {
  passengerCount: 1, baseFarePerPax: 0, baseFare: 0, serviceFee: 0, taxes: 0,
  protectionFee: 0, baggageFee: 0, insuranceFee: 0, seatSelectionFee: 0,
  total: 0, currency: 'USD',
};

const INITIAL: Omit<AiBookingStore,
  'setStatus' | 'selectFlight' | 'selectFare' | 'selectFareFromOption' |
  'setPassengerCount' | 'setCurrentPassengerIndex' | 'setPassengerTypes' |
  'toggleProtection' | 'setPassengerProtection' | 'setAllProtections' |
  'setPassengerField' | 'setPassenger' | 'setPassengerAt' | 'setPassengerComplete' |
  'setSeatPreference' | 'setSelectedSeat' | 'setSelectedReturnSeat' | 'setPassengerSeat' |
  'setMealPreference' | 'setPassengerMeal' | 'setAllMeals' |
  'setExtraBags' | 'toggleInsurance' | 'setLiveBaggagePrice' |
  'reset' | 'hydrateCheckoutStore' | 'recomputePrice' | 'fetchComputedFees'
> = {
  status: 'flight_selection',
  selectedFlight: null,
  selectedRoundTrip: null,
  fareDetails: null,
  selectedFareOption: null,

  passengerCount: 1,
  currentPassengerIndex: 0,

  priceProtection: false,
  protectionFee: 0,
  passengerProtections: [{ passengerIndex: 0, selected: false }],

  passengers: [{ ...EMPTY_PASSENGER }],
  passengerTypes: ['adult'],

  seatPreference: { ...DEFAULT_SEAT },
  passengerSeats: [],
  selectedSeat: null,
  selectedReturnSeat: null,

  passengerMeals: [],
  mealPreference: 'STANDARD',

  addOns: { ...DEFAULT_ADDONS },
  priceSummary: { ...INITIAL_PRICE },
  computedFees: null,
  liveBaggagePrice: null,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAiBookingStore = create<AiBookingStore>((set, get) => ({
  ...INITIAL,

  setStatus: (status) => set({ status }),

  selectFlight: (flight, roundTrip) => {
    // Start with hardcoded fallback, then fetch DB values
    const protectionFee = Math.round(flight.totalPrice * 0.06);
    set({
      selectedFlight: flight,
      selectedRoundTrip: roundTrip ?? null,
      protectionFee,
      status: 'fare_selection',
    });

    // Async: fetch DB-driven fees
    const paxCount = get().passengerCount;
    fetchComputedFeesForContext({
      fareTotal: flight.totalPrice * paxCount,
      passengerCount: paxCount,
      cabin: flight.cabinClass || 'economy',
      currency: flight.currency || 'USD',
    }).then(fees => {
      if (fees) {
        const s = get();
        set({
          computedFees: fees,
          protectionFee: fees.protectionFee,
          priceSummary: computePriceSummary(s.fareDetails, s.passengerCount, s.passengerProtections, fees.protectionFee, s.addOns, s.passengerSeats, fees, s.liveBaggagePrice),
        });
      }
    });
  },

  selectFare: (fareClass) => {
    const { selectedFlight, passengerCount, passengerProtections, protectionFee, addOns, passengerSeats } = get();
    if (!selectedFlight) return;

    const fareDetails = buildFareDetails(selectedFlight, fareClass);
    const priceSummary = computePriceSummary(fareDetails, passengerCount, passengerProtections, protectionFee, addOns, passengerSeats, get().computedFees, get().liveBaggagePrice);

    set({
      fareDetails,
      selectedFareOption: null,
      priceSummary,
      status: 'passenger_count',
    });
  },

  selectFareFromOption: (fare: FareOption) => {
    const { passengerCount, passengerProtections, protectionFee, addOns, passengerSeats, selectedFlight } = get();

    // Scale provider base fare / tax proportionally for this fare tier
    // e.g. if provider had baseFare=100, tax=20 (total=120) and this fare tier is 150,
    // scale to baseFare=125, tax=25 (total=150)
    const flight = selectedFlight;
    let providerBaseFare: number | undefined;
    let providerTaxAmount: number | undefined;
    if (flight?.baseFare && flight.taxAmount && flight.totalPrice > 0) {
      const ratio = fare.totalPrice / flight.totalPrice;
      providerBaseFare = Math.round(flight.baseFare * ratio);
      providerTaxAmount = Math.round(flight.taxAmount * ratio);
      // Ensure they sum to totalPrice (fix rounding)
      const diff = fare.totalPrice - (providerBaseFare + providerTaxAmount);
      if (diff !== 0) providerTaxAmount += diff;
    }

    const fareDetails: AiFareDetails = {
      fareClass: 'standard',
      name: fare.name,
      basePrice: fare.basePrice,
      totalPrice: fare.totalPrice,
      providerBaseFare,
      providerTaxAmount,
      currency: fare.currency,
      carryOnPieces: fare.baggage.carryOnPieces,
      checkedBags: fare.baggage.checked,
      checkedWeightKg: fare.baggage.checkedWeightKg,
      refundable: fare.policy.refundable,
      refundFee: fare.policy.refundFeeUsd,
      changeable: fare.policy.changeable,
      changeFee: fare.policy.changeFeeUsd,
      seatSelection: fare.policy.seatSelection,
      seatSelectionFee: fare.policy.seatSelectionFeeUsd,
      priorityBoarding: fare.policy.priorityBoarding,
      milesEarning: fare.policy.milesEarning,
      aiScore: fare.aiScore,
      aiExplanation: fare.aiExplanation,
      includedFeatures: [],
      excludedFeatures: [],
    };

    const priceSummary = computePriceSummary(fareDetails, passengerCount, passengerProtections, protectionFee, addOns, passengerSeats, get().computedFees, get().liveBaggagePrice);

    set({
      fareDetails,
      selectedFareOption: fare,
      priceSummary,
      status: 'passenger_count',
    });

    // Re-fetch DB fees for the new fare total
    const totalFare = fare.totalPrice * passengerCount;
    fetchComputedFeesForContext({
      fareTotal: totalFare,
      passengerCount,
      cabin: fare.cabin ?? 'economy',
      fareClass: fare.name,
      currency: fare.currency || 'USD',
    }).then(fees => {
      if (fees) {
        const s = get();
        set({
          computedFees: fees,
          protectionFee: fees.protectionFee,
          priceSummary: computePriceSummary(s.fareDetails, s.passengerCount, s.passengerProtections, fees.protectionFee, s.addOns, s.passengerSeats, fees, s.liveBaggagePrice),
        });
      }
    });
  },

  // ── Passenger count ─────────────────────────────────────────────────────────

  setPassengerCount: (n) => {
    const count = Math.max(1, Math.min(9, n));
    const { fareDetails, protectionFee, addOns, passengerSeats, passengerProtections } = get();

    // Grow or shrink passengers array
    const passengers = createEmptyPassengers(count);
    // Keep existing data for passengers that already exist
    const existing = get().passengers;
    existing.forEach((p, i) => { if (i < count) passengers[i] = { ...p }; });

    // Grow/shrink protections
    const protections = createPassengerProtections(count);
    passengerProtections.forEach((p, i) => { if (i < count) protections[i] = { ...p }; });

    const priceSummary = computePriceSummary(fareDetails, count, protections, protectionFee, addOns, passengerSeats, get().computedFees, get().liveBaggagePrice);

    set({
      passengerCount: count,
      passengers,
      passengerTypes: Array.from({ length: count }, (_, i) => get().passengerTypes?.[i] ?? 'adult'),
      passengerProtections: protections,
      priceSummary,
    });

    // Re-fetch DB fees with updated passenger count & total fare
    if (fareDetails) {
      const totalFare = fareDetails.totalPrice * count;
      fetchComputedFeesForContext({
        fareTotal: totalFare,
        passengerCount: count,
        cabin: fareDetails.fareClass || 'economy',
        currency: fareDetails.currency || 'USD',
      }).then(fees => {
        if (fees) {
          const s = get();
          set({
            computedFees: fees,
            protectionFee: fees.protectionFee,
            priceSummary: computePriceSummary(s.fareDetails, s.passengerCount, s.passengerProtections, fees.protectionFee, s.addOns, s.passengerSeats, fees, s.liveBaggagePrice),
          });
        }
      });
    }
  },

  setCurrentPassengerIndex: (i) => set({ currentPassengerIndex: i }),

  setPassengerTypes: (types) => set({ passengerTypes: types }),

  // ── Protection ──────────────────────────────────────────────────────────────

  toggleProtection: () => {
    const { priceProtection, fareDetails, passengerCount, protectionFee, addOns, passengerProtections, passengerSeats } = get();
    const next = !priceProtection;
    // Toggle all passengers
    const protections = passengerProtections.map(p => ({ ...p, selected: next }));
    const priceSummary = computePriceSummary(fareDetails, passengerCount, protections, protectionFee, addOns, passengerSeats, get().computedFees, get().liveBaggagePrice);
    set({ priceProtection: next, passengerProtections: protections, priceSummary });
  },

  setPassengerProtection: (paxIndex, selected) => {
    const { fareDetails, passengerCount, protectionFee, addOns, passengerSeats } = get();
    const protections = [...get().passengerProtections];
    if (paxIndex < protections.length) {
      protections[paxIndex] = { ...protections[paxIndex], selected };
    }
    const anyProtected = protections.some(p => p.selected);
    const priceSummary = computePriceSummary(fareDetails, passengerCount, protections, protectionFee, addOns, passengerSeats, get().computedFees, get().liveBaggagePrice);
    set({ passengerProtections: protections, priceProtection: anyProtected, priceSummary });
  },

  setAllProtections: (selected) => {
    const { fareDetails, passengerCount, protectionFee, addOns, passengerSeats } = get();
    const protections = get().passengerProtections.map(p => ({ ...p, selected }));
    const priceSummary = computePriceSummary(fareDetails, passengerCount, protections, protectionFee, addOns, passengerSeats, get().computedFees, get().liveBaggagePrice);
    set({ passengerProtections: protections, priceProtection: selected, priceSummary });
  },

  // ── Passenger data ──────────────────────────────────────────────────────────

  setPassengerField: (field, value) => {
    // Legacy: updates passenger at currentPassengerIndex
    const { currentPassengerIndex, passengers } = get();
    const updated = [...passengers];
    if (currentPassengerIndex < updated.length) {
      updated[currentPassengerIndex] = { ...updated[currentPassengerIndex], [field]: value };
    }
    set({ passengers: updated });
  },

  setPassenger: (passenger) => {
    // Legacy: sets passenger at currentPassengerIndex
    const { currentPassengerIndex, passengers } = get();
    const updated = [...passengers];
    if (currentPassengerIndex < updated.length) {
      updated[currentPassengerIndex] = passenger;
    }
    set({ passengers: updated });
  },

  setPassengerAt: (index, data) => {
    const passengers = [...get().passengers];
    if (index < passengers.length) {
      passengers[index] = { ...passengers[index], ...data };
    }
    set({ passengers });
  },

  setPassengerComplete: (index, data) => {
    const passengers = [...get().passengers];
    if (index < passengers.length) {
      passengers[index] = data;
    }
    set({ passengers });
  },

  // ── Seat ────────────────────────────────────────────────────────────────────

  setSeatPreference: (pref) => set({ seatPreference: pref }),

  setSelectedSeat: (seat) => {
    // Legacy single-pax: sets pax 0 outbound seat
    const s = get();
    const seats = [...s.passengerSeats];
    const idx = seats.findIndex(ss => ss.passengerIndex === 0 && ss.journeyType === 'outbound');
    if (idx >= 0) seats[idx] = { ...seats[idx], seat };
    else seats.push({ passengerIndex: 0, journeyType: 'outbound', seat });
    const priceSummary = computePriceSummary(s.fareDetails, s.passengerCount, s.passengerProtections, s.protectionFee, s.addOns, seats, s.computedFees, s.liveBaggagePrice);
    set({ passengerSeats: seats, selectedSeat: seat, priceSummary });
  },

  setSelectedReturnSeat: (seat) => {
    const s = get();
    const seats = [...s.passengerSeats];
    const idx = seats.findIndex(ss => ss.passengerIndex === 0 && ss.journeyType === 'return');
    if (idx >= 0) seats[idx] = { ...seats[idx], seat };
    else seats.push({ passengerIndex: 0, journeyType: 'return', seat });
    const priceSummary = computePriceSummary(s.fareDetails, s.passengerCount, s.passengerProtections, s.protectionFee, s.addOns, seats, s.computedFees, s.liveBaggagePrice);
    set({ passengerSeats: seats, selectedReturnSeat: seat, priceSummary });
  },

  setPassengerSeat: (paxIndex, journey, seat) => {
    const s = get();
    const seats = [...s.passengerSeats];
    const idx = seats.findIndex(ss => ss.passengerIndex === paxIndex && ss.journeyType === journey);
    if (idx >= 0) seats[idx] = { ...seats[idx], seat };
    else seats.push({ passengerIndex: paxIndex, journeyType: journey, seat });

    // Keep legacy accessors in sync
    const selectedSeat = seats.find(ss => ss.passengerIndex === 0 && ss.journeyType === 'outbound')?.seat ?? null;
    const selectedReturnSeat = seats.find(ss => ss.passengerIndex === 0 && ss.journeyType === 'return')?.seat ?? null;

    const priceSummary = computePriceSummary(s.fareDetails, s.passengerCount, s.passengerProtections, s.protectionFee, s.addOns, seats, s.computedFees, s.liveBaggagePrice);
    set({ passengerSeats: seats, selectedSeat, selectedReturnSeat, priceSummary });
  },

  // ── Meal ────────────────────────────────────────────────────────────────────

  setMealPreference: (code) => {
    // Legacy single-pax: sets pax 0 outbound meal
    const meals = [...get().passengerMeals];
    const idx = meals.findIndex(m => m.passengerIndex === 0 && m.journeyType === 'outbound');
    if (idx >= 0) meals[idx] = { ...meals[idx], mealCode: code };
    else meals.push({ passengerIndex: 0, journeyType: 'outbound', mealCode: code });
    set({ passengerMeals: meals, mealPreference: code });
  },

  setPassengerMeal: (paxIndex, journey, code) => {
    const meals = [...get().passengerMeals];
    const idx = meals.findIndex(m => m.passengerIndex === paxIndex && m.journeyType === journey);
    if (idx >= 0) meals[idx] = { ...meals[idx], mealCode: code };
    else meals.push({ passengerIndex: paxIndex, journeyType: journey, mealCode: code });
    // Update legacy
    const mealPreference = meals.find(m => m.passengerIndex === 0 && m.journeyType === 'outbound')?.mealCode ?? 'STANDARD';
    set({ passengerMeals: meals, mealPreference });
  },

  setAllMeals: (code) => {
    const { passengerCount, selectedRoundTrip } = get();
    const meals: PassengerMealSelection[] = [];
    for (let i = 0; i < passengerCount; i++) {
      meals.push({ passengerIndex: i, journeyType: 'outbound', mealCode: code });
      if (selectedRoundTrip) {
        meals.push({ passengerIndex: i, journeyType: 'return', mealCode: code });
      }
    }
    set({ passengerMeals: meals, mealPreference: code });
  },

  // ── Add-ons ─────────────────────────────────────────────────────────────────

  setExtraBags: (n) => {
    const s = get();
    const next = { ...s.addOns, extraBags: n };
    const priceSummary = computePriceSummary(s.fareDetails, s.passengerCount, s.passengerProtections, s.protectionFee, next, s.passengerSeats, s.computedFees, s.liveBaggagePrice);
    set({ addOns: next, priceSummary });
  },

  toggleInsurance: () => {
    const s = get();
    const travelInsurance = !s.addOns.travelInsurance;
    // Use DB-driven insurance fee if available
    const insuranceFee = travelInsurance && s.fareDetails
      ? (s.computedFees
          ? Math.round(s.computedFees.insuranceFeeTotal / Math.max(1, s.passengerCount))
          : Math.round(s.fareDetails.totalPrice * FALLBACK_INSURANCE_RATE))
      : 0;
    const next = { ...s.addOns, travelInsurance, insuranceFee };
    const priceSummary = computePriceSummary(s.fareDetails, s.passengerCount, s.passengerProtections, s.protectionFee, next, s.passengerSeats, s.computedFees, s.liveBaggagePrice);
    set({ addOns: next, priceSummary });
  },

  setLiveBaggagePrice: (price) => {
    const s = get();
    const priceSummary = computePriceSummary(s.fareDetails, s.passengerCount, s.passengerProtections, s.protectionFee, s.addOns, s.passengerSeats, s.computedFees, price);
    set({ liveBaggagePrice: price, priceSummary });
  },

  // ── Recompute ───────────────────────────────────────────────────────────────

  recomputePrice: () => {
    const s = get();
    const priceSummary = computePriceSummary(s.fareDetails, s.passengerCount, s.passengerProtections, s.protectionFee, s.addOns, s.passengerSeats, s.computedFees, s.liveBaggagePrice);
    set({ priceSummary });
  },

  // ── Fetch DB-driven fees ─────────────────────────────────────────────────────

  fetchComputedFees: async () => {
    const s = get();
    if (!s.fareDetails) return;
    const fees = await fetchComputedFeesForContext({
      fareTotal: s.fareDetails.totalPrice * s.passengerCount,
      passengerCount: s.passengerCount,
      cabin: s.fareDetails.fareClass || 'economy',
      currency: s.fareDetails.currency || 'USD',
    });
    if (fees) {
      const current = get();
      set({
        computedFees: fees,
        protectionFee: fees.protectionFee,
        priceSummary: computePriceSummary(current.fareDetails, current.passengerCount, current.passengerProtections, fees.protectionFee, current.addOns, current.passengerSeats, fees, current.liveBaggagePrice),
      });
    }
  },

  // ── Reset ───────────────────────────────────────────────────────────────────

  reset: () => set({
    ...INITIAL,
    passengers: [{ ...EMPTY_PASSENGER }],
    passengerProtections: [{ passengerIndex: 0, selected: false }],
    seatPreference: { ...DEFAULT_SEAT },
    passengerSeats: [],
    passengerMeals: [],
    selectedSeat: null,
    selectedReturnSeat: null,
    addOns: { ...DEFAULT_ADDONS },
    priceSummary: { ...INITIAL_PRICE },
  }),

  // ── Bridge to checkout store ───────────────────────────────────────────────
  hydrateCheckoutStore: () => {
    const s = get();
    const { selectedFlight, selectedRoundTrip, fareDetails, passengers, passengerCount, seatPreference, passengerMeals, addOns, priceProtection, priceSummary, passengerSeats } = s;
    if (!selectedFlight || !fareDetails) {
      throw new Error('Cannot hydrate checkout store: missing flight or fare data');
    }

    // Build SelectedFare
    const apiFare = s.selectedFareOption;
    const selectedFare: SelectedFare = {
      fareId: apiFare?.id ?? `ai_${fareDetails.fareClass}_${selectedFlight.id}`,
      offerId: apiFare?.offerId ?? selectedFlight.providerOfferId,
      cabin: apiFare?.cabin ?? selectedFlight.cabinClass,
      name: fareDetails.name,
      basePrice: fareDetails.basePrice,
      totalPrice: fareDetails.totalPrice,
      priceProtection,
      protectionFee: priceProtection ? s.protectionFee : 0,
      grandTotal: priceSummary.total,
      currency: fareDetails.currency,
      policy: apiFare?.policy ?? {
        refundable: fareDetails.refundable,
        refundFeeUsd: fareDetails.refundFee,
        changeable: fareDetails.changeable,
        changeFeeUsd: fareDetails.changeFee,
        seatSelection: fareDetails.seatSelection,
        seatSelectionFeeUsd: fareDetails.seatSelectionFee,
        upgradeable: false,
        loungeAccess: false,
        priorityBoarding: fareDetails.priorityBoarding,
        milesEarning: fareDetails.milesEarning,
      },
    };

    const fareOption: FareOption = apiFare ?? {
      id: selectedFare.fareId,
      offerId: selectedFlight.providerOfferId,
      cabin: selectedFlight.cabinClass,
      name: fareDetails.name,
      basePrice: fareDetails.basePrice,
      totalPrice: fareDetails.totalPrice,
      currency: fareDetails.currency,
      baggage: {
        carryOn: true,
        carryOnPieces: fareDetails.carryOnPieces,
        carryOnWeightKg: null,
        checked: fareDetails.checkedBags,
        checkedWeightKg: fareDetails.checkedWeightKg,
        extraBagFeeUsd: s.liveBaggagePrice ?? null, // live price only — no fallback
      },
      policy: {
        refundable: fareDetails.refundable,
        refundFeeUsd: fareDetails.refundFee,
        changeable: fareDetails.changeable,
        changeFeeUsd: fareDetails.changeFee,
        seatSelection: fareDetails.seatSelection,
        seatSelectionFeeUsd: fareDetails.seatSelectionFee,
        upgradeable: false,
        loungeAccess: false,
        priorityBoarding: fareDetails.priorityBoarding,
        milesEarning: fareDetails.milesEarning,
      },
      aiScore: fareDetails.aiScore,
      aiBadges: ['ai_pick'],
      aiExplanation: fareDetails.aiExplanation,
    };

    // ── Hydrate useCheckoutStore ──
    const checkout = useCheckoutStore.getState();

    // Init with flight/fare/count + breakdown
    const paxTypes = s.passengerTypes ?? [];
    const breakdownFromTypes = paxTypes.length > 0
      ? {
          adults: paxTypes.filter(t => t === 'adult').length || passengerCount,
          children: paxTypes.filter(t => t === 'child').length,
          infants: paxTypes.filter(t => t === 'infant').length,
        }
      : undefined;
    checkout.initFromStores(
      selectedFare,
      fareOption,
      selectedRoundTrip ? null : selectedFlight,
      selectedRoundTrip,
      passengerCount,
      breakdownFromTypes,
    );

    // Set all passengers
    const paxInfos = passengers.map((p, i) => {
      const paxType = paxTypes[i] ?? 'adult';
      const pax = makePassenger(i, paxType);
      pax.firstName = p.firstName;
      pax.middleName = p.middleName || '';
      pax.lastName = p.lastName;
      pax.email = i === 0 ? p.email : passengers[0].email;
      pax.phone = i === 0 ? p.phone : passengers[0].phone;
      pax.gender = p.gender;
      pax.dateOfBirth = p.dateOfBirth;
      pax.nationality = p.nationality;
      pax.passportCountry = p.passportCountry;
      pax.passportNumber = p.passportNumber;
      pax.passportExpiry = p.passportExpiry;
      pax.isContact = i === 0;
      return pax;
    });
    checkout.setPassengers(paxInfos);

    // Map seat preference
    const seatPrefMap: Record<string, 'window' | 'aisle' | 'middle' | 'no_preference'> = {
      window: 'window',
      aisle: 'aisle',
      middle: 'middle',
      any: 'no_preference',
    };
    const mappedPref = seatPrefMap[seatPreference.type] ?? 'no_preference';

    // Set per-passenger seats and meals
    paxInfos.forEach((pax, paxIdx) => {
      if (selectedRoundTrip) {
        const outSegs = selectedRoundTrip.outboundJourney.segments;
        const retSegs = selectedRoundTrip.returnJourney.segments;

        // Outbound segments
        outSegs.forEach((_, i) => {
          const seatSel = passengerSeats.find(ss => ss.passengerIndex === paxIdx && ss.journeyType === 'outbound');
          checkout.updateSeatSelection(pax.id, `out_${i}`, {
            preference: mappedPref,
            seatNumber: seatSel?.seat?.seatNumber ?? null,
            priceUsd: seatSel?.seat?.price ?? 0,
            serviceId: seatSel?.seat?.seatServiceId ?? null,
            serviceIds: seatSel?.seat?.seatServiceIds ?? [],
          });
        });

        // Return segments
        retSegs.forEach((_, i) => {
          const seatSel = passengerSeats.find(ss => ss.passengerIndex === paxIdx && ss.journeyType === 'return');
          checkout.updateSeatSelection(pax.id, `ret_${i}`, {
            preference: mappedPref,
            seatNumber: seatSel?.seat?.seatNumber ?? null,
            priceUsd: seatSel?.seat?.price ?? 0,
            serviceId: seatSel?.seat?.seatServiceId ?? null,
            serviceIds: seatSel?.seat?.seatServiceIds ?? [],
          });
        });

        // Meals — keys must match review page's mealSegs: 'out' / 'ret'
        const outMeal = passengerMeals.find(m => m.passengerIndex === paxIdx && m.journeyType === 'outbound')?.mealCode ?? 'STANDARD';
        const retMeal = passengerMeals.find(m => m.passengerIndex === paxIdx && m.journeyType === 'return')?.mealCode ?? 'STANDARD';
        checkout.updateMealSelection(pax.id, 'out', outMeal, SSR_MEAL_LABELS[outMeal] ?? outMeal);
        checkout.updateMealSelection(pax.id, 'ret', retMeal, SSR_MEAL_LABELS[retMeal] ?? retMeal);
      } else if (selectedFlight.segments.length > 0) {
        selectedFlight.segments.forEach((_, i) => {
          const seatSel = passengerSeats.find(ss => ss.passengerIndex === paxIdx && ss.journeyType === 'outbound');
          checkout.updateSeatSelection(pax.id, `seg_${i}`, {
            preference: mappedPref,
            seatNumber: seatSel?.seat?.seatNumber ?? null,
            priceUsd: seatSel?.seat?.price ?? 0,
            serviceId: seatSel?.seat?.seatServiceId ?? null,
            serviceIds: seatSel?.seat?.seatServiceIds ?? [],
          });
        });
        const outMeal = passengerMeals.find(m => m.passengerIndex === paxIdx && m.journeyType === 'outbound')?.mealCode ?? 'STANDARD';
        checkout.updateMealSelection(pax.id, `seg_0`, outMeal, SSR_MEAL_LABELS[outMeal] ?? outMeal);
      }
    });

    // Set add-ons
    checkout.setExtraBags(addOns.extraBags);
    if (priceProtection && !checkout.priceProtection) checkout.toggleProtection();
    if (!priceProtection && checkout.priceProtection) checkout.toggleProtection();
    if (addOns.travelInsurance && !checkout.travelInsurance) checkout.toggleInsurance();
    if (!addOns.travelInsurance && checkout.travelInsurance) checkout.toggleInsurance();

    return { selectedFare, fareOption };
  },
}));
