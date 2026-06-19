'use client';

import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import GlobalAIBot from '@/components/layout/GlobalAIBot';
import AgentSidebar from '@/components/agent/AgentSidebar';
import { cn } from '@/lib/utils';

/**
 * ClientShell — wraps page content with Navbar/Footer.
 *
 * Detection order:
 * 1. /agent/* routes → Agent layout handles its own sidebar (skip Navbar/Footer)
 * 2. /admin/* routes → Minimal Navbar (logo only, no nav links), no Footer
 * 3. Agent booking mode (sessionStorage.agentBookingContext present on /search, /checkout, etc.)
 *    → Show agent sidebar + agent mode banner, hide public Navbar/Footer
 * 4. Default → Full Navbar + Footer
 */
export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith('/admin');
  const isAgent = pathname.startsWith('/agent');
  const [isAgentBookingMode, setIsAgentBookingMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Check for agent booking context on non-agent pages
  useEffect(() => {
    if (isAgent || isAdmin) {
      setIsAgentBookingMode(false);
      return;
    }
    try {
      const ctx = sessionStorage.getItem('agentBookingContext');
      setIsAgentBookingMode(!!ctx);
    } catch {
      setIsAgentBookingMode(false);
    }
  }, [pathname, isAgent, isAdmin]);

  // Agent portal has its own sidebar layout — skip Navbar/Footer
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

  // Agent booking mode — show agent sidebar instead of public navbar
  if (isAgentBookingMode) {
    return (
      <>
        <AgentSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <main className={cn(
          'flex-1 transition-all duration-300 bg-slate-950 min-h-screen',
          sidebarCollapsed ? 'ml-[68px]' : 'ml-[240px]'
        )}>
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
