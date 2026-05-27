import { NextRequest, NextResponse } from 'next/server';
import { getOffer, DuffelApiError } from '@/lib/providers/duffel';

export async function POST(request: NextRequest) {
  let body: { offer_id?: string; expected_price?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { offer_id, expected_price } = body;
  if (!offer_id) {
    return NextResponse.json({ error: 'offer_id is required' }, { status: 400 });
  }

  try {
    const offer = await getOffer(offer_id);

    const now = new Date();
    const expiresAt = new Date(offer.expires_at);
    if (expiresAt <= now) {
      return NextResponse.json({ status: 'unavailable', reason: 'expired' });
    }

    const currentPrice = parseFloat(offer.total_amount);
    const currency = offer.total_currency;

    if (expected_price !== undefined) {
      const diff = Math.abs(currentPrice - expected_price);
      // Treat differences > $1 as a real price change (rounding noise below that)
      if (diff > 1) {
        return NextResponse.json({
          status: 'price_changed',
          current_price: currentPrice,
          previous_price: expected_price,
          currency,
        });
      }
    }

    return NextResponse.json({ status: 'valid', current_price: currentPrice, currency });
  } catch (err) {
    if (err instanceof DuffelApiError) {
      if (err.isNotFound) {
        return NextResponse.json({ status: 'unavailable', reason: 'not_found' });
      }
      if (err.isAuth) {
        console.error('[validate-offer] Duffel auth error');
        return NextResponse.json({ status: 'error', message: 'Provider auth error' }, { status: 502 });
      }
    }
    console.error('[validate-offer] Error:', err);
    return NextResponse.json({ status: 'error', message: 'Validation failed' }, { status: 502 });
  }
}
