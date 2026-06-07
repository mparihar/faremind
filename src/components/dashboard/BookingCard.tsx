'use client';

import { motion } from 'framer-motion';
import {
  TrendingDown,
  TrendingUp,
  Clock,
  Plane,
  MoreVertical,
  Bell,
  BellOff,
  Eye,
  ExternalLink,
  Minus,
} from 'lucide-react';
import { cn, formatPrice, formatTime, formatDate, formatDuration, getAirlineLogo } from '@/lib/utils';
import type { Booking } from '@/lib/types';

interface BookingCardProps {
  booking: Booking;
  index: number;
}

export default function BookingCard({ booking, index }: BookingCardProps) {
  const { flight, priceHistory } = booking;
  const firstSeg = flight.segments[0];
  const lastSeg = flight.segments[flight.segments.length - 1];

  // Price trend
  const currentPrice = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1].price : flight.totalPrice;
  const priceDiff = currentPrice - booking.totalPaid;
  const pricePercent = ((priceDiff) / booking.totalPaid * 100).toFixed(1);
  const priceDropped = priceDiff < 0;
  const priceRose = priceDiff > 0;

  // Status colors
  const statusColors: Record<string, string> = {
    confirmed: 'bg-success-500/15 text-success-400 border-success-500/20',
    pending: 'bg-warning-400/15 text-warning-400 border-warning-400/20',
    cancelled: 'bg-red-500/15 text-red-400 border-red-500/20',
    completed: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  };

  // Mini sparkline
  const sparklinePoints = priceHistory.map((p) => p.price);
  const minPrice = Math.min(...sparklinePoints, booking.totalPaid);
  const maxPrice = Math.max(...sparklinePoints, booking.totalPaid);
  const range = maxPrice - minPrice || 1;

  const sparklinePath = sparklinePoints
    .map((p, i) => {
      const x = (i / (sparklinePoints.length - 1)) * 100;
      const y = 30 - ((p - minPrice) / range) * 28;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="glass-card glass-card-hover overflow-hidden"
    >
      <div className="p-5">
        {/* Header: Status + PNR + Actions */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className={cn(
              'px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border',
              statusColors[booking.status]
            )}>
              {booking.status}
            </span>
            <span className="text-xs text-slate-500 font-mono">Airline PNR: {booking.pnr}</span>
          </div>
          <div className="flex items-center gap-2">
            {booking.priceTracking ? (
              <span className="flex items-center gap-1 text-[10px] font-medium text-brand-400">
                <Bell className="w-3 h-3" />
                Tracking
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-medium text-slate-600">
                <BellOff className="w-3 h-3" />
              </span>
            )}
            <button className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-all text-slate-500 hover:text-white">
              <MoreVertical className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Flight info */}
        <div className="flex items-center gap-4 mb-4">
          <div className="w-10 h-10 rounded-xl bg-white/[0.08] border border-white/[0.08] flex items-center justify-center overflow-hidden shrink-0">
            <img
              src={getAirlineLogo(flight.airline.code)}
              alt={flight.airline.name}
              className="w-6 h-6 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white">
                {firstSeg.departure.city}
              </p>
              <Plane className="w-3 h-3 text-brand-400 rotate-[0deg]" />
              <p className="text-sm font-semibold text-white">
                {lastSeg.arrival.city}
              </p>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-slate-500">{flight.airline.name} • {firstSeg.flightNumber}</p>
              <span className="text-xs text-slate-600">•</span>
              <p className="text-xs text-slate-500">{formatDate(firstSeg.departure.time)}</p>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="flex items-center gap-4 px-2 py-3 rounded-xl bg-white/[0.03] mb-4">
          <div className="text-center">
            <p className="text-sm font-bold text-white">{formatTime(firstSeg.departure.time)}</p>
            <p className="text-[10px] text-slate-500 font-medium">{firstSeg.departure.airport}</p>
          </div>

          <div className="flex-1 flex flex-col items-center gap-1">
            <p className="text-[10px] text-slate-500">{formatDuration(flight.totalDuration)}</p>
            <div className="w-full h-[1px] bg-gradient-to-r from-brand-500/30 via-brand-500 to-accent-400/30" />
            <p className="text-[10px] text-slate-500">
              {flight.stops === 0 ? 'Nonstop' : `${flight.stops} stop${flight.stops > 1 ? 's' : ''}`}
            </p>
          </div>

          <div className="text-center">
            <p className="text-sm font-bold text-white">{formatTime(lastSeg.arrival.time)}</p>
            <p className="text-[10px] text-slate-500 font-medium">{lastSeg.arrival.airport}</p>
          </div>
        </div>

        {/* Price tracking */}
        {booking.priceTracking && priceHistory.length > 0 && (
          <div className="flex items-center gap-4 pt-3 border-t border-white/[0.05]">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Paid</p>
              <p className="text-sm font-bold text-white">{formatPrice(booking.totalPaid)}</p>
            </div>

            {/* Sparkline */}
            <div className="flex-1">
              <svg viewBox="0 0 100 32" className="w-full h-8" preserveAspectRatio="none">
                <defs>
                  <linearGradient id={`grad-${booking.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={priceDropped ? '#22c55e' : '#ef4444'} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={priceDropped ? '#22c55e' : '#ef4444'} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* Fill area */}
                <path
                  d={`${sparklinePath} L 100 30 L 0 30 Z`}
                  fill={`url(#grad-${booking.id})`}
                />
                {/* Line */}
                <path
                  d={sparklinePath}
                  fill="none"
                  stroke={priceDropped ? '#22c55e' : priceRose ? '#ef4444' : '#94a3b8'}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <div className="text-right">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Now</p>
              <p className="text-sm font-bold text-white">{formatPrice(currentPrice)}</p>
              <div className={cn(
                'flex items-center gap-0.5 justify-end',
                priceDropped ? 'text-success-400' : priceRose ? 'text-red-400' : 'text-slate-500'
              )}>
                {priceDropped ? (
                  <TrendingDown className="w-3 h-3" />
                ) : priceRose ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <Minus className="w-3 h-3" />
                )}
                <span className="text-[10px] font-semibold">
                  {priceDropped ? '-' : priceRose ? '+' : ''}{formatPrice(Math.abs(priceDiff))} ({Math.abs(Number(pricePercent))}%)
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
