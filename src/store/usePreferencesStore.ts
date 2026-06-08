'use client';

import { create } from 'zustand';

// ─── Preference Types ───

export type StopsPreference = 'nonstop' | '1stop' | '2stop' | 'any';
export type DepartureWindow = 'morning' | 'afternoon' | 'evening' | 'night';
export type SortPreference = 'any' | 'cheapest' | 'fastest';

export interface SmartPreferences {
  budgetMin: number;
  budgetMax: number;
  budgetActive: boolean;
  maxDuration: number | null; // minutes, null = any
  stops: StopsPreference;
  departureWindow: DepartureWindow | null; // null = any
  sort: SortPreference;
  personalized: boolean;    // legacy AI personalization toggle
  aiIntelligence: boolean;  // AI Intelligence scoring engine toggle
  dnaSearchActive: boolean; // 🧬 DNA Search active toggle
}

interface PreferencesStore extends SmartPreferences {
  // Actions
  setBudget: (min: number, max: number) => void;
  setBudgetActive: (active: boolean) => void;
  setMaxDuration: (minutes: number | null) => void;
  setStops: (stops: StopsPreference) => void;
  setDepartureWindow: (window: DepartureWindow | null) => void;
  setSort: (sort: SortPreference) => void;
  setPersonalized: (on: boolean) => void;
  setAiIntelligence: (on: boolean) => void;
  setDnaSearchActive: (on: boolean) => void;
  resetAll: () => void;
  toQueryParams: () => Record<string, string>;
}

const DEFAULT_STATE: SmartPreferences = {
  budgetMin: 0,
  budgetMax: 2000,
  budgetActive: false,
  maxDuration: null,
  stops: 'any',
  departureWindow: null,
  sort: 'any',
  personalized: false,
  aiIntelligence: true,
  dnaSearchActive: false,
};

export const usePreferencesStore = create<PreferencesStore>((set, get) => ({
  ...DEFAULT_STATE,

  setBudget: (budgetMin, budgetMax) => set({ budgetMin, budgetMax, budgetActive: true }),
  setBudgetActive: (budgetActive) => set({ budgetActive }),
  setMaxDuration: (maxDuration) => set({ maxDuration }),
  setStops: (stops) => set({ stops }),
  setDepartureWindow: (departureWindow) => set({ departureWindow }),
  setSort: (sort) => set({ sort }),
  setPersonalized: (personalized) => set({ personalized }),
  setAiIntelligence: (aiIntelligence) => set({ aiIntelligence }),
  setDnaSearchActive: (dnaSearchActive) => set({ dnaSearchActive }),
  resetAll: () => set(DEFAULT_STATE),

  toQueryParams: () => {
    const s = get();
    const params: Record<string, string> = {};

    if (s.budgetActive) {
      params.budget_min = s.budgetMin.toString();
      params.budget_max = s.budgetMax.toString();
    }
    if (s.maxDuration !== null) {
      params.max_duration = s.maxDuration.toString();
    }
    if (s.stops !== 'any') {
      params.stops = s.stops;
    }
    if (s.departureWindow) {
      params.departure_window = s.departureWindow;
    }
    params.sort = s.sort;
    params.personalized = s.personalized ? '1' : '0';

    return params;
  },
}));
