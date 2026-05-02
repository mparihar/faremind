'use client';

import { create } from 'zustand';
import type { FareSelectionPayload, FareOption, SelectedFare, PriceProtectionQuote } from '@/lib/fare-types';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';

interface FareStore {
  // Source flight (one-way or round-trip)
  sourceFlight: UnifiedFlight | null;
  sourceRoundTrip: RoundTripOption | null;

  // Fare data loaded from API
  payload: FareSelectionPayload | null;
  loading: boolean;
  error: string | null;

  // UI state
  selectedFareId: string | null;
  activeCabin: string | null;

  // Price Drop Protection
  priceProtection: boolean;
  protectionQuote: PriceProtectionQuote | null;

  // Finalized selection (written before navigating to booking)
  selectedFare: SelectedFare | null;

  // Actions
  setSourceFlight: (f: UnifiedFlight | null) => void;
  setSourceRoundTrip: (rt: RoundTripOption | null) => void;
  setPayload: (p: FareSelectionPayload | null) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  selectFare: (id: string) => void;
  setActiveCabin: (cabin: string) => void;
  togglePriceProtection: () => void;
  setProtectionQuote: (q: PriceProtectionQuote | null) => void;
  setSelectedFare: (f: SelectedFare | null) => void;
  reset: () => void;
}

export const useFareStore = create<FareStore>((set) => ({
  sourceFlight: null,
  sourceRoundTrip: null,
  payload: null,
  loading: false,
  error: null,
  selectedFareId: null,
  activeCabin: null,
  priceProtection: false,
  protectionQuote: null,
  selectedFare: null,

  setSourceFlight: (sourceFlight) => set({ sourceFlight }),
  setSourceRoundTrip: (sourceRoundTrip) => set({ sourceRoundTrip }),
  setPayload: (payload) => set({ payload }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  selectFare: (selectedFareId) => set({ selectedFareId }),
  setActiveCabin: (activeCabin) => set({ activeCabin }),
  togglePriceProtection: () => set((s) => ({ priceProtection: !s.priceProtection })),
  setProtectionQuote: (protectionQuote) => set({ protectionQuote }),
  setSelectedFare: (selectedFare) => set({ selectedFare }),
  reset: () => set({
    payload: null, loading: false, error: null,
    selectedFareId: null, activeCabin: null,
    priceProtection: false, protectionQuote: null, selectedFare: null,
  }),
}));

// Selector helpers
export function getSelectedFareOption(store: FareStore): FareOption | null {
  if (!store.payload || !store.selectedFareId) return null;
  for (const group of store.payload.fareGroups) {
    const found = group.fares.find(f => f.id === store.selectedFareId);
    if (found) return found;
  }
  return null;
}
