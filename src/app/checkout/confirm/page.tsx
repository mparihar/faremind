// FILE: src/app/checkout/confirm/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  Check,
  Copy,
  Share2,
  Download,
  LayoutDashboard,
  Search,
  ShieldCheck,
  Plane,
  User,
  CreditCard,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCheckoutStore } from '@/store/useCheckoutStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);

// ─── PNR copy button ──────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-all"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5" />
          Copied!
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          Copy
        </>
      )}
    </button>
  );
}

// ─── Download toast ───────────────────────────────────────────────────────────

function DownloadToast({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ duration: 0.25 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl bg-[#0F172A] border border-white/10 shadow-2xl text-white text-sm font-medium"
        >
          <CheckCircle2 className="w-4 h-4 text-[#1ABC9C]" />
          Itinerary downloaded successfully!
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ConfirmPage() {
  const router = useRouter();
  const store = useCheckoutStore();
  const [showDownloadToast, setShowDownloadToast] = useState(false);

  const {
    confirmation,
    selectedFare,
    sourceFlight,
    sourceRoundTrip,
    passengers,
    priceProtection,
  } = store;

  // Redirect if no confirmation (e.g. navigated directly)
  useEffect(() => {
    if (!confirmation) {
      const timer = setTimeout(() => {
        router.push('/');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [confirmation, router]);

  if (!confirmation) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-8 h-8 border-2 border-[#1ABC9C] border-t-transparent rounded-full"
        />
      </div>
    );
  }

  // ── Derived display values ─────────────────────────────────────────────────
  const routeLabel = (() => {
    if (sourceRoundTrip) {
      return `${sourceRoundTrip.outboundJourney.departureAirport} ⇄ ${sourceRoundTrip.outboundJourney.arrivalAirport}`;
    }
    if (sourceFlight?.segments.length) {
      const first = sourceFlight.segments[0];
      const last = sourceFlight.segments[sourceFlight.segments.length - 1];
      return `${first.departure.airport} → ${last.arrival.airport}`;
    }
    return selectedFare ? `${selectedFare.cabin.replace(/_/g, ' ')} flight` : 'Your Flight';
  })();

  const airlineName = (() => {
    if (sourceRoundTrip) return sourceRoundTrip.airlines[0] ?? '';
    return sourceFlight?.airline.name ?? '';
  })();

  const handleDownload = () => {
    setShowDownloadToast(true);
    setTimeout(() => setShowDownloadToast(false), 3000);
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: 'My FareMind Booking',
        text: `Booking reference: ${confirmation.pnr} · ${routeLabel}`,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(
        `FareMind Booking · PNR: ${confirmation.pnr} · ${routeLabel}`
      );
    }
  };

  // ── Animation variants ─────────────────────────────────────────────────────
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.12 },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-12 px-4">
      <DownloadToast visible={showDownloadToast} />

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="max-w-2xl mx-auto space-y-6"
      >
        {/* ── Success hero ── */}
        <motion.div variants={itemVariants} className="text-center">
          {/* Animated checkmark circle */}
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ duration: 0.6, ease: [0.175, 0.885, 0.32, 1.275], delay: 0.1 }}
            className="w-24 h-24 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-emerald-500/30"
          >
            <Check className="w-12 h-12 text-white" strokeWidth={3} />
          </motion.div>

          <h1 className="text-3xl sm:text-4xl font-black text-slate-900 mb-3">
            Booking Confirmed! ✈️
          </h1>
          <p className="text-slate-500 text-base max-w-md mx-auto">
            Your flight has been booked. Check your email for the full itinerary.
          </p>
        </motion.div>

        {/* ── PNR box ── */}
        <motion.div variants={itemVariants}>
          <div className="rounded-2xl bg-[#0F172A] border border-white/10 p-6 text-center shadow-xl shadow-slate-900/20">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
              Booking Reference
            </p>
            <p className="text-4xl font-black text-white tracking-[0.15em] font-mono mb-4">
              {confirmation.pnr}
            </p>
            <div className="flex items-center justify-center gap-3">
              <CopyButton text={confirmation.pnr} />
              <button
                onClick={handleShare}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-all"
              >
                <Share2 className="w-3.5 h-3.5" />
                Share
              </button>
            </div>
          </div>
        </motion.div>

        {/* ── Itinerary summary ── */}
        <motion.div variants={itemVariants}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <Plane className="w-4 h-4 text-[#1ABC9C]" />
              <h2 className="text-base font-bold text-slate-900">Itinerary Summary</h2>
            </div>

            <div className="space-y-3">
              {/* Route */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Route</span>
                <span className="font-semibold text-slate-900">{routeLabel}</span>
              </div>

              {airlineName && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Airline</span>
                  <span className="font-medium text-slate-900">{airlineName}</span>
                </div>
              )}

              {selectedFare && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Fare</span>
                  <span className="font-medium text-slate-900">
                    {selectedFare.name}
                    <span className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 capitalize">
                      {selectedFare.cabin.replace(/_/g, ' ')}
                    </span>
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Status</span>
                <span className="inline-flex items-center gap-1.5 text-emerald-600 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Confirmed
                </span>
              </div>

              {/* Passengers */}
              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center gap-2 mb-2">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Passengers
                  </p>
                </div>
                <div className="space-y-1.5">
                  {confirmation.passengerNames.map((name, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{name}</span>
                      <span className="text-xs text-slate-400 capitalize">
                        {passengers[i]?.type ?? 'Adult'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Payment summary ── */}
        <motion.div variants={itemVariants}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <CreditCard className="w-4 h-4 text-slate-400" />
              <h2 className="text-base font-bold text-slate-900">Payment Summary</h2>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Total charged</span>
                <span className="text-xl font-black text-[#F97316]">
                  {fmt(confirmation.totalCharged)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Payment method</span>
                <span className="font-medium text-slate-900 flex items-center gap-2">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                    CARD
                  </span>
                  Card •••• 4242
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Confirmed at</span>
                <span className="font-medium text-slate-900 text-xs">
                  {new Date(confirmation.confirmedAt).toLocaleString('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Price Drop Protection banner ── */}
        {priceProtection && (
          <motion.div variants={itemVariants}>
            <div className="flex items-start gap-4 p-5 rounded-2xl bg-gradient-to-r from-[#1ABC9C]/10 to-emerald-500/5 border border-[#1ABC9C]/25">
              <div className="w-10 h-10 rounded-xl bg-[#1ABC9C] flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900 mb-1">
                  Price monitoring is now active
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  We&apos;ll notify you if the price drops after booking and refund 80% of the
                  difference as FareMind credit. Check your dashboard to view price history.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Action buttons ── */}
        <motion.div variants={itemVariants}>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/dashboard"
              className={cn(
                'flex items-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-bold text-white',
                'bg-[#1ABC9C] hover:bg-emerald-500 shadow-lg shadow-[#1ABC9C]/25 transition-all w-full sm:w-auto justify-center'
              )}
            >
              <LayoutDashboard className="w-4 h-4" />
              View Dashboard
            </Link>

            <button
              onClick={handleDownload}
              className={cn(
                'flex items-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-bold',
                'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm transition-all w-full sm:w-auto justify-center'
              )}
            >
              <Download className="w-4 h-4" />
              Download Itinerary
            </button>

            <Link
              href="/"
              className={cn(
                'flex items-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold',
                'bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all w-full sm:w-auto justify-center'
              )}
            >
              <Search className="w-4 h-4" />
              Search More Flights
            </Link>
          </div>
        </motion.div>

        {/* ── Footer note ── */}
        <motion.div variants={itemVariants}>
          <p className="text-center text-xs text-slate-400 pb-8">
            A confirmation email has been sent to{' '}
            <span className="font-medium text-slate-600">
              {passengers[0]?.email || 'your email address'}
            </span>
            . Booking ID: <span className="font-mono">{confirmation.bookingId}</span>
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
