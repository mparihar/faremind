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
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
      {CHECKOUT_STEPS.map((step, i) => {
        const isDone = i < currentStep;
        const isActive = i === currentStep;
        const isClickable = isDone; // only completed steps are navigable

        const chip = (
          <div
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all flex-none',
              isActive && 'bg-[#1ABC9C] text-white',
              isDone && 'bg-emerald-100 text-emerald-700',
              !isActive && !isDone && 'bg-slate-100 text-slate-400',
              isClickable && 'cursor-pointer hover:bg-emerald-200 hover:shadow-sm active:scale-95',
            )}
          >
            {isDone ? (
              <Check className="w-3 h-3" strokeWidth={3} />
            ) : (
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold bg-white/20 flex-none">
                {i + 1}
              </span>
            )}
            <span className="hidden sm:inline whitespace-nowrap">{step.label}</span>
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
    <div className="sticky top-16 z-10 bg-[#1a1a2e]/95 backdrop-blur-xl border-b border-white/[0.06] shadow-lg flex flex-col">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-4 flex items-start justify-start gap-4 sm:gap-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-medium flex-none w-[140px] mt-1.5"
        >
          <ArrowLeft className="w-4 h-4 flex-none" />
          <span className="hidden sm:inline whitespace-nowrap">Book Your Flight</span>
        </button>
        
        <div className="flex flex-1 items-start justify-start gap-4 min-w-0 overflow-hidden">
          <div className="flex-shrink min-w-0 overflow-hidden flex items-center gap-4 mt-1">
            <StepChips currentStep={stepIndex} />
            <span className="text-slate-300 font-semibold text-xs whitespace-nowrap hidden lg:block pb-1">Step {stepIndex + 1} of {TOTAL_STEPS}</span>
          </div>
          <div className="flex-none flex flex-col items-start gap-2">
            <OfferExpiryTimer compact />
            <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold pr-1 -ml-10">
              <Lock className="w-3 h-3 flex-none" />
              <span className="whitespace-nowrap">Secure Checkout</span>
            </div>
          </div>
        </div>
      </div>

      <div className="h-0.5 bg-slate-800 w-full mt-auto">
        <div className="h-full bg-[#1ABC9C] transition-all duration-500" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );
}
