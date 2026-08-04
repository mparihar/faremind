/**
 * Pre-revalidate Mystifly fare before payment
 *
 * Called when the payment page loads to surface an expired fare BEFORE the
 * user enters card details, and to refresh the FareSourceCode in the store.
 *
 * The backend /revalidate endpoint caches successful, still-valid revalidations
 * briefly (keyed by FSC). If the meal step already revalidated this FSC within
 * the cache window, this call is served from cache — no extra Mystifly hit. If
 * the cached revalidation has expired (older than the cache TTL), the backend
 * performs a fresh one automatically.
 *
 * Returns:
 *   { valid: true,  freshFareSourceCode, totalFare, currency, holdAllowed }
 *   { valid: false, error, errorCode }  → fare expired; UI shows the banner
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
  try {
    const { fareSourceCode } = await request.json();

    if (!fareSourceCode) {
      return NextResponse.json(
        { error: 'fareSourceCode is required' },
        { status: 400 }
      );
    }

    const revalRes = await fetch(`${BACKEND_URL}/api/mystifly/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fareSourceCode, source: 'payment-load' }),
    });
    const revalData = await revalRes.json();

    // Revalidation succeeded and the fare is still valid → return fresh FSC.
    if (revalRes.ok && revalData.success && revalData.isValid !== false) {
      const freshFsc = revalData.fareSourceCode || revalData.revalidatedFareSourceCode || fareSourceCode;
      return NextResponse.json({
        valid: true,
        freshFareSourceCode: freshFsc,
        totalFare: revalData.totalFare,
        currency: revalData.currency,
        holdAllowed: revalData.holdAllowed,
        cached: revalData.cached ?? false,
      });
    }

    // Fare is no longer available — let the frontend show the "expired" banner.
    return NextResponse.json({
      valid: false,
      error: revalData.error || 'Fare is no longer available',
      errorCode: revalData.errorCode || 'REVALIDATION_INVALID',
    }, { status: 200 });
  } catch (err) {
    console.error('[Pre-revalidate] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { valid: false, error: 'Pre-revalidation check failed' },
      { status: 200 }
    );
  }
}
