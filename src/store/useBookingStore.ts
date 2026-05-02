'use client';

import { create } from 'zustand';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';

export type FareTier = 'basic' | 'standard' | 'flex';
export type SeatPref = 'window' | 'aisle' | 'middle' | 'no_preference';
export type MealPref = 'standard' | 'vegetarian' | 'vegan' | 'halal' | 'kosher' | 'none';

export interface PassengerData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other';
  passportNumber: string;
  passportExpiry: string;
  nationality: string;
}

export interface BookingResult {
  pnr: string;
  id: string;
  priceTracking: boolean;
}

interface BookingStore {
  flight: UnifiedFlight | null;
  roundTrip: RoundTripOption | null;
  step: number;
  fare: FareTier;
  seatPrefs: Record<string, SeatPref>;
  mealPrefs: Record<string, MealPref>;
  extraBags: number;
  priceDropProtection: boolean;
  passenger: PassengerData;
  bookingResult: BookingResult | null;
  bookingError: string | null;
  processing: boolean;

  setFlight: (f: UnifiedFlight | null) => void;
  setRoundTrip: (rt: RoundTripOption | null) => void;
  setStep: (s: number) => void;
  setFare: (f: FareTier) => void;
  setSeatPref: (key: string, pref: SeatPref) => void;
  setMealPref: (key: string, pref: MealPref) => void;
  setExtraBags: (n: number) => void;
  togglePriceDropProtection: () => void;
  updatePassenger: (p: Partial<PassengerData>) => void;
  setBookingResult: (r: BookingResult | null) => void;
  setBookingError: (e: string | null) => void;
  setProcessing: (v: boolean) => void;
  reset: () => void;
}

const EMPTY_PASSENGER: PassengerData = {
  firstName: '', lastName: '', email: '', phone: '',
  dateOfBirth: '', gender: 'male', passportNumber: '',
  passportExpiry: '', nationality: '',
};

export const useBookingStore = create<BookingStore>((set) => ({
  flight: null,
  roundTrip: null,
  step: 0,
  fare: 'standard',
  seatPrefs: {},
  mealPrefs: {},
  extraBags: 0,
  priceDropProtection: false,
  passenger: { ...EMPTY_PASSENGER },
  bookingResult: null,
  bookingError: null,
  processing: false,

  setFlight: (flight) => set({ flight }),
  setRoundTrip: (roundTrip) => set({ roundTrip }),
  setStep: (step) => set({ step }),
  setFare: (fare) => set({ fare }),
  setSeatPref: (key, pref) => set((s) => ({ seatPrefs: { ...s.seatPrefs, [key]: pref } })),
  setMealPref: (key, pref) => set((s) => ({ mealPrefs: { ...s.mealPrefs, [key]: pref } })),
  setExtraBags: (extraBags) => set({ extraBags }),
  togglePriceDropProtection: () => set((s) => ({ priceDropProtection: !s.priceDropProtection })),
  updatePassenger: (p) => set((s) => ({ passenger: { ...s.passenger, ...p } })),
  setBookingResult: (bookingResult) => set({ bookingResult }),
  setBookingError: (bookingError) => set({ bookingError }),
  setProcessing: (processing) => set({ processing }),
  reset: () => set({
    step: 0, fare: 'standard', seatPrefs: {}, mealPrefs: {}, extraBags: 0,
    priceDropProtection: false, passenger: { ...EMPTY_PASSENGER },
    bookingResult: null, bookingError: null, processing: false,
  }),
}));
