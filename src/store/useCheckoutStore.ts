'use client';

import { create } from 'zustand';
import type { SelectedFare, FareOption } from '@/lib/fare-types';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface PassengerInfo {
  id: string;
  type: 'adult' | 'child' | 'infant';
  firstName: string;
  middleName: string;
  lastName: string;
  gender: 'male' | 'female' | 'other';
  dateOfBirth: string;
  nationality: string;
  passportCountry: string;
  passportNumber: string;
  passportExpiry: string;
  isContact: boolean;
  email: string;
  phone: string;
}

export interface SeatSelection {
  passengerId: string;
  segmentKey: string;
  preference: 'window' | 'aisle' | 'middle' | 'no_preference';
  seatNumber: string | null;
  priceUsd: number;
  serviceId: string | null; // Duffel service ID for seat add-on
  /** All per-passenger Duffel service IDs for this seat.
   *  Indexed by offer passenger order. Used for multi-pax booking. */
  serviceIds: string[];
}

export interface MealSelection {
  passengerId: string;
  segmentKey: string;
  mealType: string;  // SSR code e.g. 'VGML', 'MOML', 'STANDARD', 'NONE'
  mealLabel: string; // Display label e.g. 'Vegetarian'
  priceUsd: number;  // 0 = included in fare
}

export type WheelchairCode = 'NONE' | 'WCHR' | 'WCHS' | 'WCHC' | 'WCOB';

export interface WheelchairSelection {
  passengerId: string;
  segmentKey: string;
  code: WheelchairCode;
  label: string;  // Display label e.g. 'Ramp Wheelchair'
}

export interface PerPassengerPrice {
  passengerId: string;
  type: 'adult' | 'child' | 'infant';
  baseFare: number;
  taxes: number;
  subtotal: number;
}

export interface PricingBreakdown {
  perPassenger: PerPassengerPrice[];
  seatFees: number;
  mealFees: number;
  baggageFees: number;
  protectionFee: number;
  insuranceFee: number;
  serviceFee: number;
  subtotal: number;
  total: number;
  currency: string;
}

export interface ConfirmedPnr {
  pnrCode: string;
  pnrType: string;
  journeyDirection: 'ALL' | 'OUTBOUND' | 'RETURN';
  isPrimary: boolean;
  airlineCode?: string | null;
  airlineName?: string | null;
  displayLabel: string;
}

export interface BookingConfirmation {
  pnr: string;
  masterBookingReference: string;
  bookingId: string;
  status: 'confirmed' | 'pending' | 'failed';
  confirmedAt: string;
  passengerNames: string[];
  totalCharged: number;
  currency: string;
  pnrStrategy?: string | null;
  isSplitTicket?: boolean;
  riskLabel?: string | null;
  riskExplanation?: string | null;
  pnrs?: ConfirmedPnr[];
  // Auto-registration: primary contact was registered as a platform user
  isNewPlatformUser?: boolean;
  platformUserId?: string;
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface CheckoutStore {
  // Source data (copied from fare/booking stores on init)
  selectedFare: SelectedFare | null;
  fareOption: FareOption | null;
  sourceFlight: UnifiedFlight | null;
  sourceRoundTrip: RoundTripOption | null;
  travelerCount: number;
  currency: string;

  // Step 1 — Passengers
  passengers: PassengerInfo[];

  // Step 2 — Seats
  seatSelections: SeatSelection[];

  // Step 2b — Wheelchair Assistance
  wheelchairSelections: WheelchairSelection[];

  // Step 3 — Meals
  mealSelections: MealSelection[];

  // Step 4 — Add-ons
  extraBags: number;
  priceProtection: boolean;
  travelInsurance: boolean;

  // Computed fees from fee engine (cached from /api/fees/compute)
  computedFees: { serviceFee: number; markupFee: number; protectionFee: number; protectionFeeTotal: number; insuranceFee: number; insuranceFeeTotal: number } | null;

  // Step 5 — Review
  acceptedTerms: boolean;

  // Pricing (computed server-side)
  pricing: PricingBreakdown | null;

  // Step 6 — Payment
  paymentIntentId: string | null;
  paymentStatus: 'idle' | 'processing' | 'succeeded' | 'failed';
  paymentError: string | null;

  // Step 7 — Confirmation
  confirmation: BookingConfirmation | null;

  // Session (created by /api/booking-session/select-fare on itinerary page)
  sessionId: string | null;

  // General error
  error: string | null;

  // ── Actions ──────────────────────────────────────────────────────────────

  setSessionId: (id: string) => void;

  initFromStores: (
    selectedFare: SelectedFare | null,
    fareOption: FareOption | null,
    sourceFlight: UnifiedFlight | null,
    sourceRoundTrip: RoundTripOption | null,
    travelerCount: number,
    passengerBreakdown?: { adults: number; children: number; infants: number },
  ) => void;

  setPassengers: (passengers: PassengerInfo[]) => void;
  updatePassenger: (id: string, updates: Partial<PassengerInfo>) => void;

  setSeatSelections: (selections: SeatSelection[]) => void;
  updateSeatSelection: (passengerId: string, segmentKey: string, updates: Partial<SeatSelection>) => void;

  updateWheelchairSelection: (passengerId: string, segmentKey: string, code: WheelchairCode, label: string) => void;

  setMealSelections: (selections: MealSelection[]) => void;
  updateMealSelection: (passengerId: string, segmentKey: string, mealType: string, mealLabel?: string, priceUsd?: number) => void;

  setExtraBags: (n: number) => void;
  toggleProtection: () => void;
  toggleInsurance: () => void;
  setComputedFees: (fees: CheckoutStore['computedFees']) => void;

  setAcceptedTerms: (v: boolean) => void;
  setPricing: (p: PricingBreakdown) => void;
  setPaymentIntent: (id: string) => void;
  setPaymentStatus: (s: CheckoutStore['paymentStatus']) => void;
  setPaymentError: (e: string | null) => void;
  setConfirmation: (c: BookingConfirmation) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

// ─── Default passenger factory ────────────────────────────────────────────────

export function makePassenger(index: number, type: 'adult' | 'child' | 'infant' = 'adult'): PassengerInfo {
  return {
    id: `pax_${index}`,
    type,
    firstName: '', middleName: '', lastName: '',
    gender: 'male',
    dateOfBirth: '',
    nationality: '',
    passportCountry: '',
    passportNumber: '',
    passportExpiry: '',
    isContact: index === 0,
    email: index === 0 ? '' : '',
    phone: index === 0 ? '' : '',
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

const INITIAL: Omit<CheckoutStore,
  'initFromStores' | 'setSessionId' | 'setPassengers' | 'updatePassenger' |
  'setSeatSelections' | 'updateSeatSelection' | 'updateWheelchairSelection' |
  'setMealSelections' | 'updateMealSelection' |
  'setExtraBags' | 'toggleProtection' | 'toggleInsurance' | 'setComputedFees' |
  'setAcceptedTerms' | 'setPricing' | 'setPaymentIntent' |
  'setPaymentStatus' | 'setPaymentError' | 'setConfirmation' |
  'setError' | 'reset'
> = {
  sessionId: null,
  selectedFare: null,
  fareOption: null,
  sourceFlight: null,
  sourceRoundTrip: null,
  travelerCount: 1,
  currency: 'USD',
  passengers: [makePassenger(0)],
  seatSelections: [],
  wheelchairSelections: [],
  mealSelections: [],
  extraBags: 0,
  priceProtection: false,
  travelInsurance: false,
  computedFees: null,
  acceptedTerms: false,
  pricing: null,
  paymentIntentId: null,
  paymentStatus: 'idle',
  paymentError: null,
  confirmation: null,
  error: null,
};

export const useCheckoutStore = create<CheckoutStore>((set) => ({
  ...INITIAL,

  setSessionId: (sessionId) => set({ sessionId }),

  initFromStores: (selectedFare, fareOption, sourceFlight, sourceRoundTrip, travelerCount, passengerBreakdown) => {
    // ── Resolve passenger breakdown ───────────────────────────────────────
    // If no explicit breakdown is provided, always try to recover it from
    // sessionStorage. This is the single defensive fallback so that every
    // call path (itinerary page, fare modal, AI booking store) produces
    // the correct passenger types — adults, children AND infants.
    let resolvedBreakdown = passengerBreakdown;
    if (!resolvedBreakdown && typeof window !== 'undefined') {
      try {
        const ctx = JSON.parse(sessionStorage.getItem('fm_fare_context') || '{}');
        if (typeof ctx.adults === 'number') {
          resolvedBreakdown = {
            adults: ctx.adults,
            children: ctx.children ?? 0,
            infants: ctx.infants ?? 0,
          };
        }
      } catch { /* sessionStorage unavailable */ }
    }

    // ── Build passengers array with correct types ─────────────────────────
    let passengers: PassengerInfo[];
    if (resolvedBreakdown) {
      const { adults, children: childCount, infants } = resolvedBreakdown;
      passengers = [];
      let idx = 0;
      for (let i = 0; i < Math.max(1, adults); i++) passengers.push(makePassenger(idx++, 'adult'));
      for (let i = 0; i < childCount; i++) passengers.push(makePassenger(idx++, 'child'));
      for (let i = 0; i < infants; i++) passengers.push(makePassenger(idx++, 'infant'));
    } else {
      const count = Math.max(1, travelerCount);
      passengers = Array.from({ length: count }, (_, i) => makePassenger(i));
    }
    set({
      selectedFare,
      fareOption,
      sourceFlight,
      sourceRoundTrip,
      travelerCount: passengers.length,
      currency: selectedFare?.currency ?? 'USD',
      priceProtection: selectedFare?.priceProtection ?? false,
      passengers,
    });
  },

  setPassengers:  (passengers)  => set({ passengers }),
  updatePassenger: (id, updates) => set((s) => ({
    passengers: s.passengers.map(p => p.id === id ? { ...p, ...updates } : p),
  })),

  setSeatSelections:  (seatSelections)  => set({ seatSelections }),
  updateSeatSelection: (passengerId, segmentKey, updates) => set((s) => {
    const existing = s.seatSelections.find(x => x.passengerId === passengerId && x.segmentKey === segmentKey);
    if (existing) {
      return { seatSelections: s.seatSelections.map(x =>
        x.passengerId === passengerId && x.segmentKey === segmentKey ? { ...x, ...updates } : x
      )};
    }
    return { seatSelections: [...s.seatSelections, {
      passengerId, segmentKey, preference: 'no_preference', seatNumber: null, priceUsd: 0, serviceId: null, serviceIds: [], ...updates
    }]};
  }),

  updateWheelchairSelection: (passengerId, segmentKey, code, label) => set((s) => {
    const filtered = s.wheelchairSelections.filter(x => !(x.passengerId === passengerId && x.segmentKey === segmentKey));
    if (code === 'NONE') return { wheelchairSelections: filtered };
    return { wheelchairSelections: [...filtered, { passengerId, segmentKey, code, label }] };
  }),

  setMealSelections:   (mealSelections) => set({ mealSelections }),
  updateMealSelection: (passengerId, segmentKey, mealType, mealLabel = '', priceUsd = 0) => set((s) => {
    const filtered = s.mealSelections.filter(x => !(x.passengerId === passengerId && x.segmentKey === segmentKey));
    return { mealSelections: [...filtered, { passengerId, segmentKey, mealType, mealLabel, priceUsd }] };
  }),

  setExtraBags:     (extraBags)     => set({ extraBags }),
  toggleProtection: ()              => set((s) => ({ priceProtection: !s.priceProtection })),
  toggleInsurance:  ()              => set((s) => ({ travelInsurance: !s.travelInsurance })),
  setComputedFees:  (computedFees)  => set({ computedFees }),

  setAcceptedTerms:  (acceptedTerms)  => set({ acceptedTerms }),
  setPricing:        (pricing)        => set({ pricing }),
  setPaymentIntent:  (paymentIntentId) => set({ paymentIntentId }),
  setPaymentStatus:  (paymentStatus)  => set({ paymentStatus }),
  setPaymentError:   (paymentError)   => set({ paymentError }),
  setConfirmation:   (confirmation)   => set({ confirmation }),
  setError:          (error)          => set({ error }),

  reset: () => set({ ...INITIAL }),
}));

// ─── Computed helpers ─────────────────────────────────────────────────────────

export function buildLocalPricing(store: CheckoutStore): PricingBreakdown {
  const { selectedFare, passengers, extraBags, priceProtection, travelInsurance, seatSelections, mealSelections, currency, computedFees } = store;
  const perPersonBase = selectedFare?.basePrice ?? 0;
  const taxRate = 0.156; // ~15.6% taxes estimate

  const perPassenger: PerPassengerPrice[] = passengers.map(p => {
    // Infants (lap) are typically free or same as adult on Duffel; children get 25% discount
    const base = p.type === 'child' ? Math.round(perPersonBase * 0.75) : perPersonBase;
    const taxes = Math.round(base * taxRate);
    return { passengerId: p.id, type: p.type, baseFare: base - taxes, taxes, subtotal: base };
  });

  const seatFees = seatSelections.reduce((s, x) => s + (x.priceUsd ?? 0), 0);
  const mealFees = mealSelections.reduce((s, x) => s + (x.priceUsd ?? 0), 0);
  const baggageFees = extraBags * 35;

  // Use admin-configured fees from the fee engine if available, otherwise fallback
  let serviceFee: number;
  let protectionFee: number;
  let insuranceFee: number;

  if (computedFees) {
    // DB-driven fees from /api/fees/compute
    serviceFee = computedFees.serviceFee;
    protectionFee = priceProtection ? computedFees.protectionFeeTotal : 0;
    insuranceFee = travelInsurance ? computedFees.insuranceFeeTotal : 0;
  } else {
    // Hardcoded fallback (backward compatibility)
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      console.warn('[buildLocalPricing] ⚠️ Using hardcoded fee fallback — computedFees is null. Call useFeeLoader() or /api/fees/compute.');
    }
    serviceFee = Math.round(perPersonBase * passengers.length * 0.015);
    const perPersonProtection = selectedFare?.protectionFee && selectedFare.protectionFee > 0
      ? selectedFare.protectionFee
      : Math.min(Math.max(Math.round((selectedFare?.basePrice ?? 0) * 0.06), 49), 399);
    protectionFee = priceProtection ? perPersonProtection * passengers.length : 0;
    insuranceFee = travelInsurance ? Math.round(perPersonBase * passengers.length * 0.04) : 0;
  }

  const subtotal = perPassenger.reduce((s, p) => s + p.subtotal, 0)
    + seatFees + mealFees + baggageFees + protectionFee + insuranceFee + serviceFee;

  return {
    perPassenger, seatFees, mealFees, baggageFees,
    protectionFee, insuranceFee, serviceFee,
    subtotal, total: subtotal,
    currency: currency ?? 'USD',
  };
}
