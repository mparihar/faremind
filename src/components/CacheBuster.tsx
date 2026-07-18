'use client';

import { useEffect } from 'react';

/**
 * Cache buster: clears stale sessionStorage/localStorage data when
 * the app version changes. This ensures old flight data (without
 * baseFare/taxAmount) doesn't persist across deployments.
 */
const CACHE_VERSION = '2026-07-18-tax-fix';

export default function CacheBuster() {
  useEffect(() => {
    try {
      const storedVersion = localStorage.getItem('fm_cache_version');
      if (storedVersion !== CACHE_VERSION) {
        // Clear all fm_ session keys
        const sessionKeys = [
          'fm_fare_context',
          'fm_source_flight',
          'fm_source_round_trip',
          'fm_selected_fare',
          'fm_checkout',
          'fm_offer_session',
        ];
        sessionKeys.forEach(k => {
          try { sessionStorage.removeItem(k); } catch {}
        });

        // Clear zustand persisted stores that may have stale flight data
        const localKeys = [
          'ai-booking-store',
          'offer-session-store',
          'fare-store',
        ];
        localKeys.forEach(k => {
          try { localStorage.removeItem(k); } catch {}
        });

        localStorage.setItem('fm_cache_version', CACHE_VERSION);
        console.log('[CacheBuster] Cleared stale caches for version', CACHE_VERSION);
      }
    } catch {
      // Storage unavailable
    }
  }, []);

  return null;
}
