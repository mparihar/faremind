// ═══════════════════════════════════════════════
// AI Booking Session Types
// Shared interface for the conversational AI booking flow.
// Compatible with useCheckoutStore data structures.
// Supports 1–9 passengers.
// ═══════════════════════════════════════════════

import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import type { SelectedSeatData } from '@/lib/ai-seat/ai-seat-types';

// ─── Flow status ──────────────────────────────────────────────────────────────

export type AiBookingStatus =
  | 'flight_selection'
  | 'fare_selection'
  | 'passenger_count'
  | 'price_protection'
  | 'itinerary_preview'
  | 'continue_prompt'
  | 'passenger_details'
  | 'passenger_confirm'
  | 'seat_preference'
  | 'seat_recommendations'
  | 'seat_recommendations_return'
  | 'seat_group_options'
  | 'seat_return_prompt'
  | 'meal_preference'
  | 'add_ons'
  | 'final_summary'
  | 'completed';

// ─── Fare class tier ──────────────────────────────────────────────────────────

export type AiFareClass = 'basic' | 'standard' | 'flex';

export interface AiFareDetails {
  fareClass: AiFareClass;
  name: string;                // e.g. "Economy Basic"
  basePrice: number;
  totalPrice: number;
  currency: string;

  // Baggage
  carryOnPieces: number;
  checkedBags: number;
  checkedWeightKg: number | null;

  // Policies
  refundable: boolean;
  refundFee: number | null;
  changeable: boolean;
  changeFee: number | null;
  seatSelection: 'free' | 'fee' | 'not_available';
  seatSelectionFee: number | null;
  priorityBoarding: boolean;
  milesEarning: 'full' | 'reduced' | 'none';

  // AI
  aiScore: number;             // 0–100
  aiExplanation: string;

  // Feature checklist for display
  includedFeatures: string[];
  excludedFeatures: string[];
}

// ─── Seat preference ──────────────────────────────────────────────────────────

export type AiSeatPosition =
  | 'front'
  | 'middle_plane'
  | 'rear'
  | 'near_restroom'
  | 'away_from_restroom'
  | 'any';

export type AiSeatType = 'window' | 'aisle' | 'middle' | 'any';

export interface AiSeatPreference {
  position: AiSeatPosition;
  type: AiSeatType;
}

// ─── Passenger data ───────────────────────────────────────────────────────────
// Reuses the same shape as the existing booking form

export interface AiPassengerData {
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: 'male' | 'female' | 'other';
  dateOfBirth: string;
  nationality: string;
  passportCountry: string;
  passportNumber: string;
  passportExpiry: string;
}

// ─── Per-passenger selections ─────────────────────────────────────────────────

export interface PassengerSeatSelection {
  passengerIndex: number;
  journeyType: 'outbound' | 'return';
  seat: SelectedSeatData | null;
}

export interface PassengerMealSelection {
  passengerIndex: number;
  journeyType: 'outbound' | 'return';
  mealCode: string;
}

export interface PassengerProtection {
  passengerIndex: number;
  selected: boolean;
}

// ─── Add-ons ──────────────────────────────────────────────────────────────────

export interface AiAddOns {
  extraBags: number;           // 0, 1, or 2
  travelInsurance: boolean;
  insuranceFee: number;
}

// ─── Price summary ────────────────────────────────────────────────────────────

export interface AiPriceSummary {
  passengerCount: number;
  baseFarePerPax: number;
  baseFare: number;            // baseFarePerPax × passengerCount
  serviceFee: number;
  taxes: number;
  protectionFee: number;       // sum of protected passengers
  baggageFee: number;
  insuranceFee: number;
  seatSelectionFee: number;    // sum of all pax outbound + return seats
  total: number;
  currency: string;
}

// ─── Complete session ─────────────────────────────────────────────────────────

export interface AiBookingSession {
  status: AiBookingStatus;

  // Flight
  selectedFlight: UnifiedFlight | null;
  selectedRoundTrip: RoundTripOption | null;

  // Fare
  fareDetails: AiFareDetails | null;

  // Passenger count (1–9)
  passengerCount: number;
  currentPassengerIndex: number;

  // Price protection (per-passenger)
  priceProtection: boolean;              // legacy compat: true if ANY pax protected
  protectionFee: number;                 // fee per pax
  passengerProtections: PassengerProtection[];

  // Passengers
  passengers: AiPassengerData[];
  passengerTypes: ('adult' | 'child' | 'infant')[];

  // Seat (per-passenger per-journey)
  seatPreference: AiSeatPreference;
  passengerSeats: PassengerSeatSelection[];

  // Legacy single-pax accessors (computed from passengerSeats[0])
  selectedSeat: SelectedSeatData | null;
  selectedReturnSeat: SelectedSeatData | null;

  // Meal (per-passenger per-journey)
  passengerMeals: PassengerMealSelection[];
  mealPreference: string;                // legacy: first pax outbound meal

  // Add-ons
  addOns: AiAddOns;

  // Computed price
  priceSummary: AiPriceSummary;
}

// ─── Passenger field collection order ─────────────────────────────────────────

export const PASSENGER_FIELD_ORDER: (keyof AiPassengerData)[] = [
  'firstName',
  'middleName',
  'lastName',
  'email',
  'phone',
  'gender',
  'dateOfBirth',
  'nationality',
  'passportCountry',
  'passportNumber',
  'passportExpiry',
];

// Fields collected for secondary passengers (skip email/phone — use primary contact)
export const SECONDARY_PASSENGER_FIELDS: (keyof AiPassengerData)[] = [
  'firstName',
  'middleName',
  'lastName',
  'gender',
  'dateOfBirth',
  'nationality',
  'passportCountry',
  'passportNumber',
  'passportExpiry',
];

export const PASSENGER_FIELD_LABELS: Record<keyof AiPassengerData, string> = {
  firstName: 'First Name',
  middleName: 'Middle Name (optional)',
  lastName: 'Last Name',
  email: 'Email Address',
  phone: 'Phone Number',
  gender: 'Gender (male / female / other)',
  dateOfBirth: 'Date of Birth (MM/DD/YYYY)',
  nationality: 'Nationality',
  passportCountry: 'Passport Country',
  passportNumber: 'Passport Number',
  passportExpiry: 'Passport Expiry Date (MM/DD/YYYY)',
};

// ─── Last-Resort Fallback Defaults ────────────────────────────────────────────
// These are ONLY used when the DB pricing config (/api/pricing-config) is
// unavailable. The primary path loads all values from DB FareTierTemplate,
// PlatformFeeRule, and SystemConfig tables.
// ──────────────────────────────────────────────────────────────────────────────

export const FARE_CLASS_NAMES: Record<AiFareClass, string> = {
  basic: 'Economy Basic',
  standard: 'Economy Standard',
  flex: 'Economy Flex',
};

export const FALLBACK_FARE_CLASS_MULTIPLIERS: Record<AiFareClass, number> = {
  basic: 0.9,
  standard: 1.0,
  flex: 1.25,
};

export const FALLBACK_EXTRA_BAG_PRICE = 35;     // USD per bag — use DB SystemConfig.extra_bag_fee_usd instead
export const FALLBACK_INSURANCE_RATE = 0.04;     // 4% of fare — use DB PlatformFeeRule instead
export const FALLBACK_SERVICE_FEE_RATE = 0.015;  // 1.5% of fare — use DB PlatformFeeRule instead
export const FALLBACK_TAX_RATE = 0.156;          // ~15.6% — use DB SystemConfig.tax_rate instead
export const MAX_PASSENGERS = 9;

export const COUNTRIES = [
  'Australia', 'Brazil', 'Canada', 'China', 'France', 'Germany',
  'India', 'Italy', 'Japan', 'Mexico', 'Netherlands', 'New Zealand',
  'Singapore', 'South Korea', 'Spain', 'Sweden', 'Switzerland',
  'UAE', 'United Kingdom', 'United States',
];
