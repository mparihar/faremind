'use client';

import { create } from 'zustand';
import { apiUrl } from '@/lib/api-client';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
  isAdminViewer?: boolean;
  role?: string;
}

interface AuthStore {
  user: AuthUser | null;
  sessionToken: string | null;
  loading: boolean;
  error: string | null;

  verifyOtp: (email: string, otp: string) => Promise<boolean>;
  logout: () => void;
  logoutWithServerRevoke: () => Promise<void>;
  loadSession: () => void;
  setError: (error: string | null) => void;
  updateAvatar: (avatar: string | null) => void;
  updateUser: (updates: Partial<AuthUser>) => void;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  sessionToken: null,
  loading: false,
  error: null,

  verifyOtp: async (email, otp) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(apiUrl('/api/auth/verify-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        localStorage.setItem('faremind_session', JSON.stringify({
          user: data.user,
          token: data.sessionToken,
        }));
        set({ user: data.user, sessionToken: data.sessionToken, loading: false });

        // Fetch avatar in background after login
        try {
          const profileRes = await fetch(`/api/auth/profile?userId=${data.user.id}`);
          const profileData = await profileRes.json();
          if (profileRes.ok && profileData.user?.avatar) {
            const userWithAvatar = { ...data.user, avatar: profileData.user.avatar };
            localStorage.setItem('faremind_session', JSON.stringify({
              user: userWithAvatar,
              token: data.sessionToken,
            }));
            set({ user: userWithAvatar });
          }
        } catch {
          // Avatar fetch is non-critical
        }

        return true;
      } else {
        set({ error: data.detail || data.error || 'Verification failed', loading: false });
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
    // Clear all booking data to prevent stale session leaks
    try { 
      const { useManageBookingStore } = require('@/store/useManageBookingStore');
      useManageBookingStore.getState().reset();
    } catch {}
  },

  /**
   * Logout with server-side session revocation.
   * Used when the inactivity timer fires — ensures the DB session is cleaned up,
   * not just the client-side state.
   */
  logoutWithServerRevoke: async () => {
    const { sessionToken } = get();

    // Revoke on server (fire-and-forget; don't block UI)
    if (sessionToken) {
      try {
        await fetch(apiUrl('/api/auth/session'), {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionToken}`,
          },
        });
      } catch {
        // Server revocation is best-effort; client cleanup proceeds regardless
      }
    }

    // Clear client state (same as regular logout)
    get().logout();
  },

  loadSession: () => {
    try {
      const stored = localStorage.getItem('faremind_session');
      if (stored) {
        const { user, token } = JSON.parse(stored);
        // Immediately set user from cache for fast UI render
        set({ user, sessionToken: token });

        // Validate against backend in background — if expired, auto-logout
        if (token) {
          fetch(apiUrl('/api/auth/validate-session'), {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then(res => res.json())
            .then(data => {
              if (!data.valid) {
                // Session expired on server — clear everything
                localStorage.removeItem('faremind_session');
                set({ user: null, sessionToken: null });
              } else if (data.user) {
                // Sync latest user data (including role) from server
                const current = get().user;
                const merged = { ...current, ...data.user };
                set({ user: merged });
                localStorage.setItem('faremind_session', JSON.stringify({
                  user: merged,
                  token,
                }));
              }
            })
            .catch(() => {
              // Network error — keep cached session (offline tolerance)
            });
        }
      }
    } catch {
      // Invalid session data
    }
  },

  setError: (error) => set({ error }),

  updateAvatar: (avatar) => {
    const { user, sessionToken } = get();
    if (!user) return;
    const updatedUser = { ...user, avatar };
    set({ user: updatedUser });
    // Persist to localStorage
    localStorage.setItem('faremind_session', JSON.stringify({
      user: updatedUser,
      token: sessionToken,
    }));
  },

  updateUser: (updates) => {
    const { user, sessionToken } = get();
    if (!user) return;
    const updatedUser = { ...user, ...updates };
    set({ user: updatedUser });
    localStorage.setItem('faremind_session', JSON.stringify({
      user: updatedUser,
      token: sessionToken,
    }));
  },
}));
