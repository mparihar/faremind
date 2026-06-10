'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAdminStore, adminFetch } from '@/store/useAdminStore';
import AdminSidebar from '@/components/admin/AdminSidebar';
import { RefreshCw } from 'lucide-react';
import { useInactivityLogout } from '@/hooks/useInactivityLogout';
import SessionExpiryWarning from '@/components/session/SessionExpiryWarning';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const { user, setUser, clearAuth } = useAdminStore();
  const [checking, setChecking] = useState(true);
  const [showExpiryWarning, setShowExpiryWarning] = useState(false);

  const isLoginPage = pathname === '/admin/login';

  // ── Inactivity logout (15 min) → server-side revoke + redirect to admin login ──
  const handleInactivityLogout = useCallback(async () => {
    if (isLoginPage) return;
    // Revoke the admin session on server before clearing client state
    try {
      await fetch('/api/admin/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    clearAuth();
    router.push('/admin/login');
  }, [isLoginPage, clearAuth, router]);

  const handleExpiryWarning = useCallback(() => {
    if (!isLoginPage) setShowExpiryWarning(true);
  }, [isLoginPage]);

  const { resetTimer } = useInactivityLogout(15 * 60 * 1000, handleInactivityLogout, {
    warningMs: 60_000,
    onWarning: handleExpiryWarning,
  });

  // "Stay Signed In" → dismiss warning, reset timer, ping /me to extend server session
  const handleStaySignedIn = useCallback(() => {
    setShowExpiryWarning(false);
    resetTimer();
    // Touch the server session to extend lastActivityAt
    adminFetch('/api/admin/auth/me').catch(() => {});
  }, [resetTimer]);

  useEffect(() => {
    if (isLoginPage) { setChecking(false); return; }

    adminFetch('/api/admin/auth/me')
      .then(r => r.json())
      .then(d => {
        if (d.user) {
          setUser(d.user);
        } else {
          clearAuth();
          router.replace('/admin/login');
        }
      })
      .catch(() => {
        clearAuth();
        router.replace('/admin/login');
      })
      .finally(() => setChecking(false));
  }, [pathname]);

  if (isLoginPage) return <>{children}</>;

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-slate-950">
      <AdminSidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>

      {/* Session expiry warning toast */}
      <SessionExpiryWarning
        show={showExpiryWarning}
        secondsRemaining={60}
        onStaySignedIn={handleStaySignedIn}
        variant="admin"
      />
    </div>
  );
}
