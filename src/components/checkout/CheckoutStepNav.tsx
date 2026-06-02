'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Lock, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OfferExpiryTimer } from './OfferExpiryTimer';

// ── Step definition ───────────────────────────────────────────────────────────

export const CHECKOUT_STEPS = [
  { label: 'Itinerary',  path: '/checkout/itinerary'  },
  { label: 'Passengers', path: '/checkout/passengers'  },
  { label: 'Seats',      path: '/checkout/seats'       },
  { label: 'Meals',      path: '/checkout/meals'       },
  { label: 'Add-ons',    path: '/checkout/addons'      },
  { label: 'Review',     path: '/checkout/review'      },
  { label: 'Payment',    path: '/checkout/payment'     },
] as const;

export const STEP_LABELS = CHECKOUT_STEPS.map(s => s.label);
export const TOTAL_STEPS = CHECKOUT_STEPS.length;

// ── Clickable step chips ──────────────────────────────────────────────────────

export function StepChips({ currentStep }: { currentStep: number }) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide w-full">
      {CHECKOUT_STEPS.map((step, i) => {
        const isDone = i < currentStep;
        const isActive = i === currentStep;
        const isClickable = isDone; // only completed steps are navigable

        const chip = (
          <div
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all',
              isActive && 'bg-[#1ABC9C] text-white',
              isDone && 'bg-emerald-100 text-emerald-700',
              !isActive && !isDone && 'bg-slate-100 text-slate-400',
              isClickable && 'cursor-pointer hover:bg-emerald-200 hover:shadow-sm active:scale-95',
            )}
          >
            {isDone ? (
              <Check className="w-3 h-3" strokeWidth={3} />
            ) : (
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold bg-white/20">
                {i + 1}
              </span>
            )}
            <span className="hidden sm:inline">{step.label}</span>
          </div>
        );

        return (
          <div key={step.label} className="flex items-center gap-1.5 flex-none">
            {isClickable ? (
              <button
                type="button"
                onClick={() => router.push(step.path)}
                title={`Go back to ${step.label}`}
              >
                {chip}
              </button>
            ) : (
              chip
            )}
            {i < CHECKOUT_STEPS.length - 1 && (
              <div className={cn('w-4 h-px flex-none', i < currentStep ? 'bg-emerald-300' : 'bg-slate-200')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Full checkout header (used by all checkout pages) ─────────────────────────

export function CheckoutHeader({ stepIndex }: { stepIndex: number }) {
  const router = useRouter();
  const progressPct = Math.round(((stepIndex + 1) / TOTAL_STEPS) * 100);

  return (
    <div className="sticky top-16 z-10 bg-[#1a1a2e]/95 backdrop-blur-xl border-b border-white/[0.06] shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-[90px] flex items-center justify-between gap-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-medium flex-none"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Book Your Flight</span>
        </button>
        <div className="flex-1 overflow-hidden">
          <StepChips currentStep={stepIndex} />
        </div>
        <OfferExpiryTimer compact />
        <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold flex-none">
          <Lock className="w-3 h-3" />
          <span className="hidden sm:inline">Secure Checkout</span>
          <span className="text-slate-600 mx-1">·</span>
          <span className="text-slate-300">Step {stepIndex + 1} of {TOTAL_STEPS}</span>
        </div>
      </div>
      <div className="h-0.5 bg-slate-800">
        <div className="h-full bg-[#1ABC9C] transition-all duration-500" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );
}
