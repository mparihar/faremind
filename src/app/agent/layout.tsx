// FILE: src/app/agent/layout.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';
import { useInactivityLogout } from '@/hooks/useInactivityLogout';
import SessionExpiryWarning from '@/components/session/SessionExpiryWarning';
import AgentSidebar from '@/components/agent/AgentSidebar';

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loadSession, logoutWithServerRevoke } = useAuthStore();
  const [checking, setChecking] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [showExpiryWarning, setShowExpiryWarning] = useState(false);

  const isLoginPage = pathname === '/agent/login';

  // Inactivity logout (15 min)
  const handleInactivityLogout = useCallback(async () => {
    if (isLoginPage) return;
    await logoutWithServerRevoke();
    router.push('/agent/login');
  }, [isLoginPage, logoutWithServerRevoke, router]);

  const handleExpiryWarning = useCallback(() => {
    if (!isLoginPage) setShowExpiryWarning(true);
  }, [isLoginPage]);

  const { resetTimer } = useInactivityLogout(15 * 60 * 1000, handleInactivityLogout, {
    warningMs: 60_000,
    onWarning: handleExpiryWarning,
  });

  const handleStaySignedIn = useCallback(() => {
    setShowExpiryWarning(false);
    resetTimer();
  }, [resetTimer]);

  // Load session on mount / route change
  useEffect(() => {
    if (isLoginPage) { setChecking(false); return; }
    loadSession();
  }, [pathname]);

  // Auth guard — runs after loadSession updates user
  const [sessionLoaded, setSessionLoaded] = useState(false);
  useEffect(() => {
    if (isLoginPage) return;
    // loadSession is synchronous (reads localStorage), so after it runs
    // the zustand store triggers a re-render with user populated.
    // On first mount user is null; mark sessionLoaded after first pathname effect.
    const t = setTimeout(() => setSessionLoaded(true), 50);
    return () => clearTimeout(t);
  }, [pathname, isLoginPage]);

  useEffect(() => {
    if (isLoginPage || !sessionLoaded) return;
    if (!user) {
      // Double-check localStorage directly as a safety net
      const stored = localStorage.getItem('faremind_session');
      if (!stored) {
        router.replace('/agent/login');
      } else {
        try {
          const { user: u } = JSON.parse(stored);
          if (u?.role !== 'FAREMIND_AGENT') {
            router.replace('/agent/login');
          } else {
            // Session exists in localStorage but store hasn't picked it up yet — reload
            loadSession();
          }
        } catch {
          router.replace('/agent/login');
        }
      }
      setChecking(false);
      return;
    }

    if (user.role !== 'FAREMIND_AGENT') {
      router.replace('/agent/login');
      return;
    }
    setChecking(false);
  }, [user, sessionLoaded, isLoginPage, router]);

  if (isLoginPage) return <>{children}</>;

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  if (!user || user.role !== 'FAREMIND_AGENT') return null;

  return (
    <div className="flex min-h-screen bg-slate-950">
      <AgentSidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />

      {/* Main content */}
      <main className={cn(
        'flex-1 overflow-auto transition-all duration-300',
        collapsed ? 'ml-[68px]' : 'ml-[240px]'
      )}>
        {children}
      </main>

      <SessionExpiryWarning
        show={showExpiryWarning}
        secondsRemaining={60}
        onStaySignedIn={handleStaySignedIn}
        variant="admin"
      />
    </div>
  );
}
