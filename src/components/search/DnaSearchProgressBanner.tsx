'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

export type DnaSearchStatus = 'initializing' | 'matching' | 'ranking' | 'complete' | 'error';

interface DnaSearchProgressBannerProps {
  status: DnaSearchStatus;
  isVisible: boolean;
  message?: string;
  flightCount?: number;
}

const STAGE_CONFIG: Record<Exclude<DnaSearchStatus, 'complete' | 'error'>, {
  title: string;
  subtitle: string;
  progressTarget: number;
}> = {
  initializing: {
    title: 'Running DNA Search',
    subtitle: 'Preparing your FareMind DNA preferences…',
    progressTarget: 25,
  },
  matching: {
    title: 'Personalizing results with your DNA…',
    subtitle: 'Matching Flights to your travel preferences…',
    progressTarget: 60,
  },
  ranking: {
    title: 'Re-ranking your best matches…',
    subtitle: 'Combining FareMind AI score with your DNA match score…',
    progressTarget: 90,
  },
};

export default function DnaSearchProgressBanner({
  status,
  isVisible,
  message,
  flightCount,
}: DnaSearchProgressBannerProps) {
  const [progress, setProgress] = useState(0);

  // Smooth simulated progress that advances toward each stage's target
  useEffect(() => {
    if (!isVisible) {
      setProgress(0);
      return;
    }

    if (status === 'complete') {
      // Immediately jump to 100
      setProgress(100);
      return;
    }

    if (status === 'error') return;

    const target = STAGE_CONFIG[status]?.progressTarget ?? 0;
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= target) return prev;
        // Aggressive easing — reaches target quickly so bar stays close to stage
        const step = Math.max(1, (target - prev) * 0.22);
        return Math.min(target, prev + step);
      });
    }, 30);

    return () => clearInterval(interval);
  }, [status, isVisible]);

  const isError = status === 'error';
  const isComplete = status === 'complete';
  const stage = (!isError && !isComplete) ? STAGE_CONFIG[status] : null;

  const title = isError
    ? 'DNA Search Failed'
    : isComplete
      ? 'DNA Search Complete'
      : stage?.title ?? '';

  const subtitle = isError
    ? (message || 'We could not personalize results right now. Please try again.')
    : isComplete
      ? 'Showing flights tailored to your travel profile.'
      : (stage?.subtitle ?? '').replace('{count}', String(flightCount ?? 50));

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -12, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -12, height: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="w-full pt-3 pb-1"
        >
          <div
            className={`
              flex items-center gap-5 rounded-2xl border px-5 py-4 sm:px-6
              transition-colors duration-300
              ${isError
                ? 'bg-[#FEF2F2] border-[#FCA5A5] shadow-sm shadow-red-100/40'
                : 'bg-[#F0FDFA] border-[#5EEAD4] shadow-sm shadow-teal-100/40'
              }
            `}
            style={{ minHeight: 72 }}
          >
            {/* Spinner / Icon — left side */}
            <div className="shrink-0">
              {isComplete ? (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                >
                  <CheckCircle2 className="w-10 h-10 text-[#14B8A6]" />
                </motion.div>
              ) : isError ? (
                <XCircle className="w-10 h-10 text-[#B91C1C]" />
              ) : (
                /* Premium multi-ring DNA spinner */
                <div className="relative w-10 h-10" aria-label="DNA Search in progress">
                  {/* Outer ring — slow clockwise */}
                  <motion.svg
                    className="absolute inset-0 w-10 h-10"
                    viewBox="0 0 40 40"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
                  >
                    <circle cx="20" cy="20" r="18" fill="none" stroke="#14B8A6" strokeWidth="2.5" strokeOpacity="0.12" />
                    <circle
                      cx="20" cy="20" r="18" fill="none"
                      stroke="url(#dna-grad-outer)" strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeDasharray="70 113"
                    />
                    <defs>
                      <linearGradient id="dna-grad-outer" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#14B8A6" />
                        <stop offset="100%" stopColor="#06B6D4" />
                      </linearGradient>
                    </defs>
                  </motion.svg>

                  {/* Inner ring — counter-clockwise, faster */}
                  <motion.svg
                    className="absolute inset-[5px] w-[30px] h-[30px]"
                    viewBox="0 0 30 30"
                    animate={{ rotate: -360 }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                  >
                    <circle
                      cx="15" cy="15" r="12" fill="none"
                      stroke="#14B8A6" strokeWidth="2"
                      strokeOpacity="0.25"
                      strokeLinecap="round"
                      strokeDasharray="20 56"
                    />
                  </motion.svg>

                  {/* Orbiting dot */}
                  <motion.svg
                    className="absolute inset-0 w-10 h-10"
                    viewBox="0 0 40 40"
                    animate={{ rotate: -360 }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                  >
                    <circle cx="20" cy="3" r="2" fill="#14B8A6" opacity="0.7" />
                  </motion.svg>

                  {/* Center glow dot */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div
                      className="w-2 h-2 rounded-full bg-[#14B8A6]"
                      animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0.9, 0.5] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Text + progress */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold tracking-wide leading-tight ${
                isError ? 'text-[#B91C1C]' : 'text-[#115E59]'
              }`}>
                {title}
              </p>
              <p className={`text-xs mt-0.5 leading-tight ${
                isError ? 'text-[#7F1D1D]' : 'text-[#0F766E]'
              }`}>
                {subtitle}
              </p>

              {/* Progress bar — hidden on error */}
              {!isError && (
                <div className="mt-2.5 h-1 rounded-full overflow-hidden bg-[#CCFBF1]">
                  <motion.div
                    className="h-full rounded-full bg-[#14B8A6]"
                    initial={{ width: '0%' }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: progress === 100 ? 0.35 : 0.25, ease: 'easeOut' }}
                  />
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
