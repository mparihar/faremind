'use client';

import { create } from 'zustand';
import { apiFetch } from '@/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OfferSessionStatus = 'IDLE' | 'ACTIVE' | 'WARNING' | 'EXPIRED';

export interface OfferSessionSearchCriteria {
  origin?: string;
  destination?: string;
  departureDate?: string;
  returnDate?: string;
  adults?: number;
  children?: number;
  infants?: number;
  cabinClass?: string;
}

interface OfferSessionStore {
  // Session data
  offerSessionId: string | null;
  providerOfferId: string | null;
  provider: string | null;
  expiresAt: string | null;         // ISO timestamp
  remainingSeconds: number;
  status: OfferSessionStatus;
  searchCriteria: OfferSessionSearchCriteria | null;

  // UI flags
  warningShown: boolean;            // 3-minute warning modal shown
  criticalWarningShown: boolean;    // 1-minute toast shown

  // Internal
  _intervalId: ReturnType<typeof setInterval> | null;

  // Actions
  startSession: (params: {
    provider: string;
    providerOfferId: string;
    expiresAt?: string;
    searchCriteria?: OfferSessionSearchCriteria;
  }) => Promise<void>;
  tick: () => void;
  markExpired: () => void;
  markBooked: () => void;
  /** Update the tracked offer ID without restarting the timer countdown */
  updateTrackedOffer: (providerOfferId: string, provider?: string) => void;
  clearSession: () => void;
  setWarningShown: () => void;
  setCriticalWarningShown: () => void;

  // Persistence
  hydrateFromStorage: () => boolean;
  persistToStorage: () => void;
}

// ─── Session Storage Key ──────────────────────────────────────────────────────

const STORAGE_KEY = 'faremind_offer_session';

// ─── Store ────────────────────────────────────────────────────────────────────

export const useOfferSessionStore = create<OfferSessionStore>((set, get) => ({
  // Initial state
  offerSessionId: null,
  providerOfferId: null,
  provider: null,
  expiresAt: null,
  remainingSeconds: 0,
  status: 'IDLE',
  searchCriteria: null,
  warningShown: false,
  criticalWarningShown: false,
  _intervalId: null,

  /**
   * Start a new offer session. Calls backend to create DB record,
   * then starts a 1-second countdown interval.
   */
  startSession: async ({ provider, providerOfferId, expiresAt, searchCriteria }) => {
    const state = get();

    // Don't restart if same offer is already tracking
    if (state.providerOfferId === providerOfferId && state.status !== 'IDLE' && state.status !== 'EXPIRED') {
      return;
    }

    // Clear any existing interval
    if (state._intervalId) {
      clearInterval(state._intervalId);
    }

    try {
      const res = await apiFetch('/api/booking-session/offer-session/start', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          providerOfferId,
          offerExpiryTimestamp: expiresAt,
          searchCriteria,
        }),
      });

      const remaining = res.remainingSeconds ?? 0;
      const status: OfferSessionStatus =
        remaining <= 0 ? 'EXPIRED' :
        remaining <= 180 ? 'WARNING' : 'ACTIVE';

      set({
        offerSessionId: res.offerSessionId,
        providerOfferId,
        provider,
        expiresAt: res.expiresAt,
        remainingSeconds: remaining,
        status,
        searchCriteria: searchCriteria ?? null,
        warningShown: false,
        criticalWarningShown: false,
      });

      // Start countdown interval
      const intervalId = setInterval(() => {
        get().tick();
      }, 1000);

      set({ _intervalId: intervalId });

      // Persist to sessionStorage
      get().persistToStorage();

    } catch (err) {
      console.warn('[OfferSession] Failed to start session, using local-only timer:', err);

      // Fallback: local-only timer (no DB record)
      // Fetch admin-configured expiry from public config endpoint
      let fallbackMinutes = 20;
      try {
        const configRes = await fetch('/api/config/offer-expiry');
        if (configRes.ok) {
          const configData = await configRes.json();
          if (configData.minutes && configData.minutes >= 5 && configData.minutes <= 60) {
            fallbackMinutes = configData.minutes;
          }
        }
      } catch {
        // Use default 20 minutes if config fetch fails
      }

      // Check if provider's expiresAt is still usable (> 2 min remaining)
      const providerExpiryMs = expiresAt ? new Date(expiresAt).getTime() - Date.now() : 0;
      const providerExpiryUsable = expiresAt && providerExpiryMs > 2 * 60 * 1000; // Must have > 2 min

      const fallbackExpiry = providerExpiryUsable
        ? new Date(expiresAt!).toISOString()
        : new Date(Date.now() + fallbackMinutes * 60 * 1000).toISOString();
      const remaining = Math.max(0, Math.floor((new Date(fallbackExpiry).getTime() - Date.now()) / 1000));

      // Detailed audit logging for tracking "Fare Expired" triggers

      set({
        offerSessionId: null,
        providerOfferId,
        provider,
        expiresAt: fallbackExpiry,
        remainingSeconds: remaining,
        status: remaining <= 0 ? 'EXPIRED' : remaining <= 180 ? 'WARNING' : 'ACTIVE',
        searchCriteria: searchCriteria ?? null,
        warningShown: false,
        criticalWarningShown: false,
      });

      const intervalId = setInterval(() => {
        get().tick();
      }, 1000);
      set({ _intervalId: intervalId });
      get().persistToStorage();
    }
  },

  /**
   * Called every second to update the countdown.
   */
  tick: () => {
    const { expiresAt, status, _intervalId } = get();
    if (!expiresAt || status === 'EXPIRED' || status === 'IDLE') return;

    const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    let newStatus: OfferSessionStatus = 'ACTIVE';

    if (remaining <= 0) {
      newStatus = 'EXPIRED';
      // Stop the interval
      if (_intervalId) clearInterval(_intervalId);
      set({ remainingSeconds: 0, status: 'EXPIRED', _intervalId: null });

      // Notify backend
      const { offerSessionId } = get();
      if (offerSessionId) {
        apiFetch(`/api/booking-session/offer-session/${offerSessionId}/expire`, {
          method: 'POST',
        }).catch(() => {});
      }
      get().persistToStorage();
      return;
    }

    if (remaining <= 180) {
      newStatus = 'WARNING';
    }

    set({ remainingSeconds: remaining, status: newStatus });
  },

  markExpired: () => {
    const { _intervalId, offerSessionId } = get();
    if (_intervalId) clearInterval(_intervalId);
    set({ status: 'EXPIRED', remainingSeconds: 0, _intervalId: null });

    if (offerSessionId) {
      apiFetch(`/api/booking-session/offer-session/${offerSessionId}/expire`, {
        method: 'POST',
      }).catch(() => {});
    }
    get().persistToStorage();
  },

  markBooked: () => {
    const { _intervalId, offerSessionId } = get();
    if (_intervalId) clearInterval(_intervalId);
    set({ status: 'IDLE', _intervalId: null });

    if (offerSessionId) {
      apiFetch(`/api/booking-session/offer-session/${offerSessionId}/booked`, {
        method: 'POST',
      }).catch(() => {});
    }

    // Clear sessionStorage
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  },

  updateTrackedOffer: (providerOfferId, provider) => {
    const state = get();
    // Only update if there's an active session — don't start a new one
    if (state.status === 'IDLE' || state.status === 'EXPIRED') return;
    // Update the tracked offer ID without touching the timer/expiry
    set({
      providerOfferId,
      ...(provider ? { provider } : {}),
    });
    get().persistToStorage();
  },

  clearSession: () => {
    const { _intervalId } = get();
    if (_intervalId) clearInterval(_intervalId);
    set({
      offerSessionId: null,
      providerOfferId: null,
      provider: null,
      expiresAt: null,
      remainingSeconds: 0,
      status: 'IDLE',
      searchCriteria: null,
      warningShown: false,
      criticalWarningShown: false,
      _intervalId: null,
    });
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  },

  setWarningShown: () => set({ warningShown: true }),
  setCriticalWarningShown: () => set({ criticalWarningShown: true }),

  /**
   * Restore session from sessionStorage on page refresh.
   * Returns true if session was restored.
   */
  hydrateFromStorage: () => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return false;

      const data = JSON.parse(raw);
      if (!data.expiresAt) return false;

      const remaining = Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
      const status: OfferSessionStatus =
        remaining <= 0 ? 'EXPIRED' :
        remaining <= 180 ? 'WARNING' : 'ACTIVE';

      set({
        offerSessionId: data.offerSessionId ?? null,
        providerOfferId: data.providerOfferId ?? null,
        provider: data.provider ?? null,
        expiresAt: data.expiresAt,
        remainingSeconds: remaining,
        status,
        searchCriteria: data.searchCriteria ?? null,
        warningShown: data.warningShown ?? false,
        criticalWarningShown: data.criticalWarningShown ?? false,
      });

      if (status !== 'EXPIRED') {
        const intervalId = setInterval(() => {
          get().tick();
        }, 1000);
        set({ _intervalId: intervalId });
      }

      return true;
    } catch {
      return false;
    }
  },

  /**
   * Save session to sessionStorage for refresh survival.
   */
  persistToStorage: () => {
    try {
      const state = get();
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        offerSessionId: state.offerSessionId,
        providerOfferId: state.providerOfferId,
        provider: state.provider,
        expiresAt: state.expiresAt,
        searchCriteria: state.searchCriteria,
        warningShown: state.warningShown,
        criticalWarningShown: state.criticalWarningShown,
      }));
    } catch {}
  },
}));
