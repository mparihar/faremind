/**
 * Ancillary API Route
 *
 * GET /api/ancillaries?offer_id=XXX&provider=duffel
 *
 * Fetches provider ancillary services (baggage, meals, premium services) for a given offer.
 * Returns normalized ancillaries with real provider prices.
 * No markup, no mock prices.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOffer } from '@/lib/providers/duffel';
import {
  normalizeDuffelAllBaggage,
  normalizeDuffelPremiumServices,
  type NormalizedAncillary,
} from '@/lib/providers/providerAncillaryNormalizer';

// ── In-memory cache (5-min TTL) ───────────────────────────────────────────────

interface CachedAncillaries {
  baggage: NormalizedAncillary[];
  meals: NormalizedAncillary[];
  premiumServices: NormalizedAncillary[];
  expiresAt: number;
}

const cache = new Map<string, CachedAncillaries>();

function getCached(key: string): CachedAncillaries | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry;
}

function setCached(key: string, data: Omit<CachedAncillaries, 'expiresAt'>): void {
  cache.set(key, { ...data, expiresAt: Date.now() + 5 * 60 * 1000 });
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const offerId = searchParams.get('offer_id');
  const provider = (searchParams.get('provider') ?? 'duffel').toLowerCase();

  if (!offerId) {
    return NextResponse.json(
      { error: 'offer_id is required' },
      { status: 400 },
    );
  }

  // Check cache
  const cacheKey = `ancillaries:${provider}:${offerId}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json({
      baggage: cached.baggage,
      meals: cached.meals,
      premiumServices: cached.premiumServices,
      cached: true,
    });
  }

  try {
    if (provider === 'duffel') {
      return await handleDuffel(offerId, cacheKey);
    }

    if (provider === 'mystifly') {
      return await handleMystifly(offerId, cacheKey);
    }

    return NextResponse.json(
      { error: `Unsupported provider: ${provider}` },
      { status: 400 },
    );
  } catch (error) {
    const errMsg = (error as Error).message;
    console.error(`[Ancillaries] API error for ${provider} offer ${offerId}: ${errMsg}`);

    // Graceful fallback — don't block the checkout flow
    return NextResponse.json({
      baggage: [],
      meals: [],
      premiumServices: [],
      error: 'Add-ons are temporarily unavailable. You can continue booking or manage add-ons with the airline after ticketing.',
    });
  }
}

// ── Duffel Handler ────────────────────────────────────────────────────────────

async function handleDuffel(offerId: string, cacheKey: string) {
  // Fetch the full offer which includes available_services
  const offer = await getOffer(offerId);

  // Normalize baggage ancillaries
  const baggage = normalizeDuffelAllBaggage(offer);

  // Normalize premium services (lounge, priority boarding)
  const premiumServices = normalizeDuffelPremiumServices(offer);

  // Duffel does not return meal services on most fares.
  // Meals are handled via SSR codes (free) in /api/meals route.
  const meals: NormalizedAncillary[] = [];

  setCached(cacheKey, { baggage, meals, premiumServices });

  console.log(
    `[Ancillaries] Duffel offer ${offerId}: ${baggage.length} baggage, ` +
    `${premiumServices.length} premium service(s)`,
  );

  return NextResponse.json({
    baggage,
    meals,
    premiumServices,
    cached: false,
  });
}

// ── Mystifly Handler ──────────────────────────────────────────────────────────

async function handleMystifly(offerId: string, cacheKey: string) {
  // Mystifly sandbox returns Duffel-format offers (off_...).
  // Route those through the Duffel ancillary handler to get real extra baggage pricing.
  if (offerId.startsWith('off_')) {
    console.log(`[Ancillaries] Mystifly offer ${offerId} is a Duffel-format ID — routing to Duffel handler`);
    return handleDuffel(offerId, cacheKey);
  }

  // Real Mystifly offers — ancillary API not yet integrated.
  // Return empty arrays — UI shows "unavailable" message.
  const baggage: NormalizedAncillary[] = [];
  const meals: NormalizedAncillary[] = [];
  const premiumServices: NormalizedAncillary[] = [];

  setCached(cacheKey, { baggage, meals, premiumServices });

  console.log(`[Ancillaries] Mystifly offer ${offerId}: ancillaries not supported yet`);

  return NextResponse.json({
    baggage,
    meals,
    premiumServices,
    cached: false,
    info: 'Ancillary pricing from this provider is not yet available. Check airline baggage policy.',
  });
}
