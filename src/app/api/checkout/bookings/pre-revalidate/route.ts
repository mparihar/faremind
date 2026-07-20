/**
 * Pre-revalidate Mystifly fare before payment
 *
 * Called when the payment page loads to refresh the FSC (FareSourceCode).
 * Private fares have ~5 min TTL, so by the time the user reaches payment
 * the original FSC may have expired.
 *
 * Returns the fresh FSC so the frontend can update the checkout store
 * before the user clicks Pay.
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fareSourceCode } = body;

    if (!fareSourceCode) {
      return NextResponse.json(
        { error: 'fareSourceCode is required' },
        { status: 400 }
      );
    }

    // Call Mystifly revalidate via the backend
    const revalRes = await fetch(`${BACKEND_URL}/api/mystifly/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fareSourceCode }),
    });
    const revalData = await revalRes.json();

    if (!revalRes.ok || !revalData.success) {
      return NextResponse.json({
        valid: false,
        error: revalData.error || 'Revalidation failed',
        errorCode: revalData.errorCode || 'REVALIDATION_FAILED',
      }, { status: 200 }); // 200 so frontend can handle gracefully
    }

    // Check IsValid
    if (revalData.isValid === false) {
      return NextResponse.json({
        valid: false,
        error: 'Fare is no longer valid',
        errorCode: 'REVALIDATION_INVALID',
      }, { status: 200 });
    }

    // Return the fresh FSC
    const freshFsc = revalData.fareSourceCode || revalData.revalidatedFareSourceCode || fareSourceCode;

    return NextResponse.json({
      valid: true,
      freshFareSourceCode: freshFsc,
      totalFare: revalData.totalFare,
      currency: revalData.currency,
      holdAllowed: revalData.holdAllowed,
    });
  } catch (err) {
    console.error('[Pre-revalidate] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { valid: false, error: 'Pre-revalidation check failed' },
      { status: 200 }
    );
  }
}
