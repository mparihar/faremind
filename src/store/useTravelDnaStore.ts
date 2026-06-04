'use client';

import { create } from 'zustand';
import type { TravelDnaResponse } from '@/lib/services/travel-dna-service';

interface TravelDnaStore {
  profile: TravelDnaResponse | null;
  loading: boolean;
  error: string | null;
  fetched: boolean;
  feedbackPending: Set<string>;
  fetchProfile: (sessionToken?: string | null) => Promise<void>;
  submitFeedback: (preferenceId: string, action: 'accurate' | 'not_me', sessionToken?: string | null) => Promise<boolean>;
  clear: () => void;
}

export const useTravelDnaStore = create<TravelDnaStore>((set, get) => ({
  profile: null,
  loading: false,
  error: null,
  fetched: false,
  feedbackPending: new Set(),

  fetchProfile: async (sessionToken?: string | null) => {
    // Avoid duplicate fetches
    if (get().loading) return;

    set({ loading: true, error: null });
    try {
      const headers: Record<string, string> = {};
      if (sessionToken) {
        headers['Authorization'] = `Bearer ${sessionToken}`;
      }

      const res = await fetch('/api/travel-dna/me', { headers });

      if (res.status === 401) {
        set({
          profile: null,
          loading: false,
          fetched: true,
          error: null,
        });
        return;
      }

      if (!res.ok) {
        throw new Error('Failed to fetch FAREMIND DNA');
      }

      const data = await res.json();
      set({ profile: data, loading: false, fetched: true });
    } catch (err: any) {
      set({
        error: err.message ?? 'Failed to fetch FAREMIND DNA',
        loading: false,
        fetched: true,
      });
    }
  },

  submitFeedback: async (preferenceId: string, action: 'accurate' | 'not_me', sessionToken?: string | null) => {
    const pending = new Set(get().feedbackPending);
    pending.add(preferenceId);
    set({ feedbackPending: pending });

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionToken) {
        headers['Authorization'] = `Bearer ${sessionToken}`;
      }

      const res = await fetch('/api/travel-dna/feedback', {
        method: 'POST',
        headers,
        body: JSON.stringify({ preferenceId, action }),
      });

      if (!res.ok) return false;

      // Update local state optimistically
      const profile = get().profile;
      if (profile) {
        const updatedProfiles = { ...profile.profiles };
        for (const key of ['domestic', 'international'] as const) {
          const p = updatedProfiles[key];
          if (!p) continue;
          const updatedPrefs = { ...p.preferences };
          for (const [cat, items] of Object.entries(updatedPrefs)) {
            updatedPrefs[cat] = items.map(item => {
              if (item.id === preferenceId) {
                return {
                  ...item,
                  userValidated: action === 'accurate',
                  rejectedByUser: action === 'not_me',
                };
              }
              return item;
            });
            // Remove rejected items from display
            if (action === 'not_me') {
              updatedPrefs[cat] = updatedPrefs[cat].filter(item => item.id !== preferenceId);
            }
          }
          updatedProfiles[key] = { ...p, preferences: updatedPrefs };
        }
        set({ profile: { ...profile, profiles: updatedProfiles } });
      }

      return true;
    } catch {
      return false;
    } finally {
      const p = new Set(get().feedbackPending);
      p.delete(preferenceId);
      set({ feedbackPending: p });
    }
  },

  clear: () => set({ profile: null, loading: false, error: null, fetched: false, feedbackPending: new Set() }),
}));
