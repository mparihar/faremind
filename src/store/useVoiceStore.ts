'use client';

/**
 * Voice Store — Bridge between global header assistant and page-specific forms.
 *
 * The homepage registers its SearchForm ref here on mount.
 * The global Travel Assistant reads it to call fillFromVoice() + triggerSearch().
 */

import { create } from 'zustand';
import type { VoiceFormData } from '@/actions/voiceActionEngine';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SearchFormHandle {
  fillFromVoice: (data: VoiceFormData) => void;
  triggerSearch: () => void;
}

interface VoiceStore {
  /** Ref to the current page's SearchForm imperative handle */
  searchFormRef: SearchFormHandle | null;
  setSearchFormRef: (ref: SearchFormHandle | null) => void;
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useVoiceStore = create<VoiceStore>((set) => ({
  searchFormRef: null,
  setSearchFormRef: (ref) => set({ searchFormRef: ref }),
}));
