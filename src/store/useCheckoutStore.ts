'use client';

import { create } from 'zustand';
import type { SelectedFare, FareOption } from '@/lib/fare-types';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import type { NormalizedAncillary } from '@/lib/providers/providerAncillaryNormalizer';
import { isBundleEnabled } from '@/lib/bundle-flags';

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
  fareTotal: number;
  totalBaseFare: number;   // sum of perPassenger baseFare
  totalTaxes: number;      // sum of perPassenger taxes
  taxBreakdown?: Array<{ code: string; amount: number; label?: string }>;
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
  // Mystifly: FareSourceCodes of the other fare options for the same itinerary.
  // Sent to the confirm endpoint so it can recover from ERBUK082 by re-revalidating
  // an alternate FSC (price-guarded server-side).
  alternateFareSourceCodes: string[];
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
  selectedAncillaries: NormalizedAncillary[];

  // Computed fees from fee engine (cached from /api/fees/compute)
  computedFees: { serviceFee: number; protectionFee: number; protectionFeeTotal: number; insuranceFee: number; insuranceFeeTotal: number } | null;

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
  setAlternateFareSourceCodes: (fscs: string[]) => void;

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
  setSelectedAncillaries: (ancillaries: NormalizedAncillary[]) => void;
  addAncillary: (ancillary: NormalizedAncillary) => void;
  removeAncillary: (serviceId: string) => void;

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
  'initFromStores' | 'setSessionId' | 'setAlternateFareSourceCodes' | 'setPassengers' | 'updatePassenger' |
  'setSeatSelections' | 'updateSeatSelection' | 'updateWheelchairSelection' |
  'setMealSelections' | 'updateMealSelection' |
  'setExtraBags' | 'toggleProtection' | 'toggleInsurance' | 'setComputedFees' |
  'setSelectedAncillaries' | 'addAncillary' | 'removeAncillary' |
  'setAcceptedTerms' | 'setPricing' | 'setPaymentIntent' |
  'setPaymentStatus' | 'setPaymentError' | 'setConfirmation' |
  'setError' | 'reset'
> = {
  sessionId: null,
  selectedFare: null,
  fareOption: null,
  sourceFlight: null,
  sourceRoundTrip: null,
  alternateFareSourceCodes: [],
  travelerCount: 1,
  currency: 'USD',
  passengers: [makePassenger(0)],
  seatSelections: [],
  wheelchairSelections: [],
  mealSelections: [],
  extraBags: 0,
  priceProtection: false,
  travelInsurance: false,
  selectedAncillaries: [],
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

  setAlternateFareSourceCodes: (alternateFareSourceCodes) => set({ alternateFareSourceCodes }),

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
  toggleProtection: ()              => { if (!isBundleEnabled()) return; set((s) => ({ priceProtection: !s.priceProtection })); },
  toggleInsurance:  ()              => { if (!isBundleEnabled()) return; set((s) => ({ travelInsurance: !s.travelInsurance })); },
  setComputedFees:  (computedFees)  => set({ computedFees }),
  setSelectedAncillaries: (selectedAncillaries) => set({ selectedAncillaries }),
  addAncillary: (ancillary) => set((s) => ({
    selectedAncillaries: [
      ...s.selectedAncillaries.filter(a => a.providerServiceId !== ancillary.providerServiceId),
      ancillary,
    ],
  })),
  removeAncillary: (serviceId) => set((s) => ({
    selectedAncillaries: s.selectedAncillaries.filter(a => a.providerServiceId !== serviceId),
  })),

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

/** Optional pricing config from /api/pricing-config (DB-driven values) */
export interface PricingConfigParam {
  serviceFee?: { model: string; fixedAmount: number | null; percentageValue: number | null } | null;
  taxRate?: number | null;
  extraBagFeeUsd?: number | null;
}

export function buildLocalPricing(store: CheckoutStore, pricingConfig?: PricingConfigParam): PricingBreakdown {
  const { selectedFare, passengers, extraBags, priceProtection, travelInsurance, seatSelections, mealSelections, currency, computedFees, sourceFlight } = store;
  // Use sourceRoundTrip as fallback for tax data when sourceFlight is null (round-trip flow)
  const sourceRT = (store as any).sourceRoundTrip;
  const taxSource = sourceFlight ?? sourceRT; // whichever has baseFare/taxAmount

  // Use the exact all-passenger total from the fare-options API to avoid rounding loss.
  // selectedFare.totalPrice is the all-passenger total; basePrice is per-person (display only).
  const allPaxFareTotal = selectedFare?.totalPrice ?? 0;
  const perPersonBase = selectedFare?.basePrice ?? 0;

  // Always use actual provider base/tax split (from Mystifly BaseFare/Taxes or Duffel base_amount/tax_amount).
  // No estimated or cosmetic splits — only real provider data.

  // Build per-passenger breakdown for display.
  // Distribute allPaxFareTotal exactly across passengers so line items sum to the
  // total — avoids the ±$1 rounding drift when perPersonBase × count ≠ allPaxFareTotal.
  const paxCount = passengers.length || 1;
  const perPaxFloor = Math.floor(allPaxFareTotal / paxCount);
  const remainder = allPaxFareTotal - perPaxFloor * paxCount; // 0 ≤ remainder < paxCount

  const perPassenger: PerPassengerPrice[] = passengers.map((p, idx) => {
    const base = perPaxFloor + (idx < remainder ? 1 : 0);
    // Scale provider tax proportionally for this fare tier
    const ratio = (taxSource?.totalPrice && taxSource.totalPrice > 0) ? (base / taxSource.totalPrice) : 0;
    const taxes = taxSource?.taxAmount != null ? Math.round(taxSource.taxAmount * ratio) : 0;
    const baseFare = base - taxes;
    return { passengerId: p.id, type: p.type, baseFare, taxes, subtotal: base };
  });

  const seatFees = seatSelections.reduce((s, x) => s + (x.priceUsd ?? 0), 0);
  const mealFees = mealSelections.reduce((s, x) => s + (x.priceUsd ?? 0), 0);

  // Baggage fees: sum of selected provider ancillary amounts (no markup)
  const selectedBags = (store.selectedAncillaries ?? []).filter(
    a => a.ancillaryType === 'CHECKED_BAG' || a.ancillaryType === 'EXTRA_CHECKED_BAG',
  );
  const baggageFees = selectedBags.reduce((s, a) => s + a.amount * a.quantity, 0);

  // Service fee: computed from the exact all-passenger total (no rounding drift)
  const fareTotal = allPaxFareTotal;
  let serviceFee: number;
  const sfCfg = pricingConfig?.serviceFee;
  if (sfCfg) {
    switch (sfCfg.model) {
      case 'FIXED_PER_BOOKING':
        serviceFee = Math.round(sfCfg.fixedAmount ?? 0);
        break;
      case 'FIXED_PER_TRAVELER':
        serviceFee = Math.round((sfCfg.fixedAmount ?? 0) * passengers.length);
        break;
      case 'PERCENTAGE_OF_FARE':
      case 'PERCENTAGE_OF_BOOKING_TOTAL':
        serviceFee = Math.round(fareTotal * ((sfCfg.percentageValue ?? 0) / 100));
        break;
      case 'HYBRID':
        serviceFee = Math.round(
          (sfCfg.fixedAmount ?? 0) * passengers.length +
          fareTotal * ((sfCfg.percentageValue ?? 0) / 100),
        );
        break;
      default:
        serviceFee = 0;
    }
  } else if (computedFees) {
    serviceFee = computedFees.serviceFee;
  } else {
    serviceFee = Math.round(fareTotal * 0.015); // last-resort fallback
  }

  let protectionFee: number;
  let insuranceFee: number;

  // FAREMIND_BUNDLE gate: when disabled, protection & insurance are always zero
  if (!isBundleEnabled()) {
    protectionFee = 0;
    insuranceFee = 0;
  } else if (computedFees) {
    // DB-driven fees for protection and insurance
    protectionFee = priceProtection ? computedFees.protectionFeeTotal : 0;
    insuranceFee = travelInsurance ? computedFees.insuranceFeeTotal : 0;
  } else {
    // Hardcoded fallback (backward compatibility)
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      console.warn('[buildLocalPricing] ⚠️ Using hardcoded fee fallback — computedFees is null. Call useFeeLoader() or /api/fees/compute.');
    }
    const perPersonProtection = selectedFare?.protectionFee && selectedFare.protectionFee > 0
      ? selectedFare.protectionFee
      : Math.min(Math.max(Math.round((selectedFare?.basePrice ?? 0) * 0.06), 49), 399);
    protectionFee = priceProtection ? perPersonProtection * passengers.length : 0;
    insuranceFee = travelInsurance ? Math.round(perPersonBase * passengers.length * 0.04) : 0;
  }

  const subtotal = allPaxFareTotal
    + seatFees + mealFees + baggageFees + protectionFee + insuranceFee + serviceFee;

  const totalBaseFare = perPassenger.reduce((s, p) => s + p.baseFare, 0);
  const totalTaxes = perPassenger.reduce((s, p) => s + p.taxes, 0);

  return {
    perPassenger, fareTotal: allPaxFareTotal,
    totalBaseFare, totalTaxes,
    taxBreakdown: taxSource?.taxBreakdown,
    seatFees, mealFees, baggageFees,
    protectionFee, insuranceFee, serviceFee,
    subtotal, total: subtotal,
    currency: currency ?? 'USD',
  };
}
