import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FareMind – AI-Powered Flight Booking & Price Intelligence',
  description:
    'Search, book, and save on flights with AI-powered price tracking. FareMind aggregates multiple flight sources and monitors prices to get you the best deals automatically.',
  keywords: 'flight booking, cheap flights, price tracking, AI travel, flight search, NDC, airline booking',
  openGraph: {
    title: 'FareMind – AI-Powered Flight Booking',
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
        <Navbar />
        <main className="flex-1 pt-16">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
