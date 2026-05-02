'use client';

import { create } from 'zustand';
import { SearchQuery, UnifiedFlight, SearchFilters, SortOption } from '@/lib/types';

interface SearchStore {
  // State
  query: SearchQuery | null;
  results: UnifiedFlight[];
  loading: boolean;
  error: string | null;
  filters: SearchFilters;
  sortBy: SortOption;

  // Actions
  setQuery: (query: SearchQuery) => void;
  setResults: (results: UnifiedFlight[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setFilters: (filters: Partial<SearchFilters>) => void;
  setSortBy: (sort: SortOption) => void;
  clearResults: () => void;
  getFilteredResults: () => UnifiedFlight[];
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  query: null,
  results: [],
  loading: false,
  error: null,
  filters: {},
  sortBy: 'price',

  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
  setSortBy: (sortBy) => set({ sortBy }),
  clearResults: () => set({ results: [], error: null }),

  getFilteredResults: () => {
    const { results, filters, sortBy } = get();
    let filtered = [...results];

    // Apply filters
    if (filters.maxPrice) {
      filtered = filtered.filter((f) => f.totalPrice <= filters.maxPrice!);
    }
    if (filters.maxStops !== undefined) {
      filtered = filtered.filter((f) => f.stops <= filters.maxStops!);
    }
    if (filters.airlines && filters.airlines.length > 0) {
      filtered = filtered.filter((f) => filters.airlines!.includes(f.airline.code));
    }
    if (filters.providers && filters.providers.length > 0) {
      filtered = filtered.filter((f) => filters.providers!.includes(f.provider));
    }
    if (filters.refundableOnly) {
      filtered = filtered.filter((f) => f.fareRules.refundable);
    }
    if (filters.departureTimeRange) {
      const [minHour, maxHour] = filters.departureTimeRange;
      filtered = filtered.filter((f) => {
        const hour = new Date(f.segments[0].departure.time).getHours();
        return hour >= minHour && hour <= maxHour;
      });
    }

    // Apply sort
    switch (sortBy) {
      case 'price':
        filtered.sort((a, b) => a.totalPrice - b.totalPrice);
        break;
      case 'duration':
        filtered.sort((a, b) => a.totalDuration - b.totalDuration);
        break;
      case 'departure':
        filtered.sort((a, b) =>
          new Date(a.segments[0].departure.time).getTime() -
          new Date(b.segments[0].departure.time).getTime()
        );
        break;
      case 'value':
        filtered.sort((a, b) => b.valueScore - a.valueScore);
        break;
    }

    return filtered;
  },
}));
