'use client';

import { usePathname } from 'next/navigation';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

/**
 * ClientShell — wraps page content with Navbar/Footer.
 * On /admin routes: shows Navbar (logo + black header only, no nav links) but hides Footer.
 * On customer routes: shows full Navbar + Footer.
 */
export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith('/admin');

  if (isAdmin) {
    return (
      <>
        <Navbar hideNav />
        <main className="flex-1 pt-16">{children}</main>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="flex-1 pt-16">{children}</main>
      <Footer />
    </>
  );
}
