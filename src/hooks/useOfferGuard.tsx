'use client';

/**
 * Checkout Offer Guard — Shared hook for all checkout pages.
 *
 * Provides:
 * - `isExpired` — true when the offer has expired
 * - `OfferGuardUI` — renders the expiry modals and banner (call in JSX)
 *
 * Usage in any checkout page:
 *   const { isExpired, OfferGuardUI } = useOfferGuard();
 *   // disable CTA: disabled={isExpired || ...}
 *   // render: {OfferGuardUI}
 */

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useOfferSessionStore } from '@/store/useOfferSessionStore';
import { OfferExpiryTimer } from '@/components/checkout/OfferExpiryTimer';
import { OfferExpiryModals } from '@/components/checkout/OfferExpiryModals';

export function useOfferGuard() {
  const router = useRouter();
  const status = useOfferSessionStore((s) => s.status);
  const isExpired = status === 'EXPIRED';

  const handleRefresh = useCallback(() => {
    router.push('/');
  }, [router]);

  /**
   * Render this in each checkout page's JSX to get the timer banner + modals.
   * Place it right after <CheckoutHeader />.
   */
  function OfferGuardUI() {
    return (
      <>
        <OfferExpiryModals />
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <OfferExpiryTimer onRefreshResults={handleRefresh} />
        </div>
      </>
    );
  }

  return { isExpired, OfferGuardUI };
}
