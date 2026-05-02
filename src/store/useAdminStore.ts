'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AdminRole = 'SUPER_ADMIN' | 'OPS_ADMIN' | 'SUPPORT' | 'FINANCE' | 'READ_ONLY';

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt?: string | null;
}

interface AdminState {
  user: AdminUser | null;
  isLoading: boolean;
  setUser: (user: AdminUser) => void;
  clearAuth: () => void;
  setLoading: (v: boolean) => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      user: null,
      isLoading: false,
      setUser: (user) => set({ user }),
      clearAuth: () => set({ user: null }),
      setLoading: (v) => set({ isLoading: v }),
    }),
    {
      name: 'faremind-admin',
      partialize: (s) => ({ user: s.user }),
    }
  )
);

// ── API helper ─────────────────────────────────────────────────────────────
// Auth is carried by HttpOnly cookie — no Authorization header needed.

export async function adminFetch(path: string, options?: RequestInit) {
  return fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
}
