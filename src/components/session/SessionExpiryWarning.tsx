'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, RefreshCw } from 'lucide-react';

interface SessionExpiryWarningProps {
  /** Whether the warning is currently active */
  show: boolean;
  /** How many seconds until the session actually expires */
  secondsRemaining?: number;
  /** Called when user clicks "Stay Signed In" */
  onStaySignedIn: () => void;
  /** Label for the user type — "session" (user) or "admin session" */
  variant?: 'user' | 'admin';
}

/**
 * Floating toast that warns the user their session is about to expire.
 * Appears when `show` is true and auto-counts down.
 */
export default function SessionExpiryWarning({
  show,
  secondsRemaining = 60,
  onStaySignedIn,
  variant = 'user',
}: SessionExpiryWarningProps) {
  const [countdown, setCountdown] = useState(secondsRemaining);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset countdown when warning becomes visible
  useEffect(() => {
    if (show) {
      setCountdown(secondsRemaining);
      intervalRef.current = setInterval(() => {
        setCountdown(prev => Math.max(0, prev - 1));
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [show, secondsRemaining]);

  const label = variant === 'admin' ? 'admin session' : 'session';

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 60, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 60, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] w-[90vw] max-w-md"
        >
          <div className="relative bg-[#0f1525]/95 backdrop-blur-xl border border-amber-500/30 rounded-2xl shadow-2xl shadow-black/40 p-5 overflow-hidden">
            {/* Progress bar background */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/[0.06]">
              <motion.div
                className="h-full bg-gradient-to-r from-amber-500 to-red-500"
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: secondsRemaining, ease: 'linear' }}
              />
            </div>

            <div className="flex items-start gap-4">
              {/* Icon */}
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center flex-shrink-0">
                <Clock size={20} className="text-amber-400" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-bold mb-1">
                  Session Expiring Soon
                </p>
                <p className="text-slate-400 text-xs leading-relaxed">
                  Your {label} will expire in{' '}
                  <span className="text-amber-400 font-bold tabular-nums">
                    {countdown}s
                  </span>
                  {' '}due to inactivity. Click below to stay signed in.
                </p>
              </div>
            </div>

            {/* Action button */}
            <button
              onClick={onStaySignedIn}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1ABC9C] hover:bg-[#16a085] text-white text-sm font-bold transition-all shadow-lg shadow-[#1ABC9C]/20"
            >
              <RefreshCw size={14} />
              Stay Signed In
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
