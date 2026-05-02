'use client';

import { create } from 'zustand';
import { apiUrl } from '@/lib/api-client';

interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthStore {
  user: AuthUser | null;
  sessionToken: string | null;
  loading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<boolean>;
  signup: (firstName: string, lastName: string, email: string, password: string) => Promise<boolean>;
  logout: () => void;
  loadSession: () => void;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  sessionToken: null,
  loading: false,
  error: null,

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (data.success) {
        localStorage.setItem('faremind_session', JSON.stringify({
          user: data.user,
          token: data.sessionToken,
        }));
        set({ user: data.user, sessionToken: data.sessionToken, loading: false });
        return true;
      } else {
        set({ error: data.error || 'Login failed', loading: false });
        return false;
      }
    } catch {
      set({ error: 'Network error', loading: false });
      return false;
    }
  },

  signup: async (firstName, lastName, email, password) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(apiUrl('/api/auth/signup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, password }),
      });
      const data = await res.json();

      if (data.success) {
        localStorage.setItem('faremind_session', JSON.stringify({
          user: data.user,
          token: data.sessionToken,
        }));
        set({ user: data.user, sessionToken: data.sessionToken, loading: false });
        return true;
      } else {
        set({ error: data.error || 'Signup failed', loading: false });
        return false;
      }
    } catch {
      set({ error: 'Network error', loading: false });
      return false;
    }
  },

  logout: () => {
    localStorage.removeItem('faremind_session');
    set({ user: null, sessionToken: null });
  },

  loadSession: () => {
    try {
      const stored = localStorage.getItem('faremind_session');
      if (stored) {
        const { user, token } = JSON.parse(stored);
        set({ user, sessionToken: token });
      }
    } catch {
      // Invalid session data
    }
  },

  setError: (error) => set({ error }),
}));
