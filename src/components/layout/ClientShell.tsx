'use client';

import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import GlobalAIBot from '@/components/layout/GlobalAIBot';
import AgentTopNavbar from '@/components/agent/AgentTopNavbar';

/**
 * ClientShell — wraps page content with Navbar/Footer.
 *
 * Detection order:
 * 1. /agent/* routes → Agent layout handles its own top navbar (skip Navbar/Footer)
 * 2. /admin/* routes → Minimal Navbar (logo only, no nav links), no Footer
 * 3. Agent booking mode (sessionStorage.agentBookingContext present on /search, /checkout, etc.)
 *    → Show agent top navbar + agent mode banner, hide public Navbar/Footer
 * 4. Default → Full Navbar + Footer
 */
export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith('/admin');
  const isAgent = pathname.startsWith('/agent');
  const [isAgentBookingMode, setIsAgentBookingMode] = useState(false);

  // Check for agent booking context on non-agent pages
  useEffect(() => {
    if (isAgent || isAdmin) {
      setIsAgentBookingMode(false);
      return;
    }
    try {
      const ctx = sessionStorage.getItem('agentBookingContext');
      if (!ctx) {
        setIsAgentBookingMode(false);
        return;
      }
      // Verify there's still an active agent session — if the agent logged out
      // or the session expired (inactivity timer), clear the stale booking context
      const session = localStorage.getItem('faremind_session');
      if (session) {
        const parsed = JSON.parse(session);
        if (parsed?.user?.role === 'FAREMIND_AGENT') {
          setIsAgentBookingMode(true);
          return;
        }
      }
      // No active agent session → stale context, clean it up
      sessionStorage.removeItem('agentBookingContext');
      setIsAgentBookingMode(false);
    } catch {
      setIsAgentBookingMode(false);
    }
  }, [pathname, isAgent, isAdmin]);

  // Agent portal has its own top navbar layout — skip Navbar/Footer
  if (isAgent) {
    return (
      <>
        <main className="flex-1">{children}</main>
        <GlobalAIBot />
      </>
    );
  }

  if (isAdmin) {
    return (
      <>
        <Navbar hideNav />
        <main className="flex-1 pt-16">{children}</main>
        <GlobalAIBot />
      </>
    );
  }

  // Agent booking mode — show agent top navbar instead of public navbar
  if (isAgentBookingMode) {
    return (
      <>
        <AgentTopNavbar />
        <main className="flex-1 pt-16 bg-slate-950 min-h-screen">
          {children}
        </main>
        <GlobalAIBot />
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="flex-1 pt-16">{children}</main>
      <Footer />
      <GlobalAIBot />
    </>
  );
}
