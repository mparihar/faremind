import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import ClientShell from '@/components/layout/ClientShell';
import CacheBuster from '@/components/CacheBuster';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FAREMIND – AI-Powered Flight Booking & Price Intelligence',
  description:
    'Search, book, and save on flights with AI-powered price tracking. FAREMIND aggregates multiple flight sources and monitors prices to get you the best deals automatically.',
  keywords: 'flight booking, cheap flights, price tracking, AI travel, flight search, NDC, airline booking',
  openGraph: {
    title: 'FAREMIND – AI-Powered Flight Booking',
    description: 'Smart flight search with real-time price intelligence.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col font-[var(--font-inter)]" suppressHydrationWarning>
        <CacheBuster />
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}

