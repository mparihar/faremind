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
  const mfref = searchParams.get('mfref'); // Post-booking MFRef for ancillary services

  if (!offerId) {
    return NextResponse.json(
      { error: 'offer_id is required' },
      { status: 400 },
    );
  }

  // Check cache
  const cacheKey = `ancillaries:${provider}:${offerId}${mfref ? `:${mfref}` : ''}`;
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
      return await handleMystifly(offerId, cacheKey, mfref);
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

// Standard IATA meal codes available for Mystifly SSR
const MYSTIFLY_MEAL_CODES: Array<{ code: string; label: string; description: string }> = [
  { code: 'AVML', label: 'Asian Vegetarian', description: 'Asian vegetarian meal (no meat, fish, or eggs)' },
  { code: 'VGML', label: 'Vegetarian', description: 'Western vegetarian meal (no meat, fish, or eggs)' },
  { code: 'VLML', label: 'Lacto-Ovo Vegetarian', description: 'Vegetarian meal with dairy and eggs' },
  { code: 'VJML', label: 'Jain Vegetarian', description: 'Jain vegetarian meal (no root vegetables)' },
  { code: 'VOML', label: 'Oriental Vegetarian', description: 'Chinese/oriental style vegetarian' },
  { code: 'VVML', label: 'Vegan', description: 'Vegan meal (no animal products)' },
  { code: 'HNML', label: 'Hindu Non-Vegetarian', description: 'Hindu meal (no beef or pork)' },
  { code: 'MOML', label: 'Muslim/Halal', description: 'Halal meal prepared according to Islamic dietary law' },
  { code: 'KSML', label: 'Kosher', description: 'Kosher meal prepared according to Jewish dietary law' },
  { code: 'GFML', label: 'Gluten-Free', description: 'Gluten-free meal' },
  { code: 'LFML', label: 'Low Fat', description: 'Low fat/cholesterol meal' },
  { code: 'DBML', label: 'Diabetic', description: 'Diabetic meal (low sugar)' },
  { code: 'BBML', label: 'Baby Meal', description: 'Baby/infant meal' },
  { code: 'CHML', label: 'Child Meal', description: 'Child meal' },
  { code: 'SFML', label: 'Seafood', description: 'Seafood meal' },
  { code: 'FPML', label: 'Fruit Platter', description: 'Fresh fruit platter' },
  { code: 'BLML', label: 'Bland', description: 'Bland/soft diet meal' },
  { code: 'NLML', label: 'No Salt', description: 'Low sodium/no salt meal' },
  { code: 'LPML', label: 'Low Protein', description: 'Low protein meal' },
  { code: 'PRML', label: 'Low Purine', description: 'Low purine meal' },
  { code: 'RVML', label: 'Raw Vegetarian', description: 'Raw vegetarian meal' },
  { code: 'HFML', label: 'High Fiber', description: 'High fiber meal' },
  { code: 'LSML', label: 'Low Salt', description: 'Low salt meal' },
  { code: 'ORML', label: 'Oriental', description: 'Oriental meal' },
];

const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

async function handleMystifly(offerId: string, cacheKey: string, mfref?: string | null) {
  // Mystifly sandbox returns Duffel-format offers (off_...).
  // Route those through the Duffel ancillary handler to get real extra baggage pricing.
  if (offerId.startsWith('off_')) {
    console.log(`[Ancillaries] Mystifly offer ${offerId} is a Duffel-format ID — routing to Duffel handler`);
    return handleDuffel(offerId, cacheKey);
  }

  const baggage: NormalizedAncillary[] = [];
  const meals: NormalizedAncillary[] = [];
  const premiumServices: NormalizedAncillary[] = [];

  // ── Pre-booking: SeatMap via FareSourceCode ───────────────────────────────
  // The SeatMap API works with FareSourceCode (pre-booking).
  // offerId IS the FareSourceCode for Mystifly flights.
  try {
    const seatRes = await fetch(`${BACKEND_URL}/api/mystifly/seat-map`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fareSourceCode: offerId }),
    });
    const seatData = await seatRes.json();

    if (seatRes.ok && seatData.success) {
      console.log(`[Ancillaries] Mystifly SeatMap fetched for FSC: ${offerId.slice(0, 20)}...`);
      // SeatMap data is returned as raw — frontend seat selector can use it
      // We normalize what we can into premium services
      const seatMapRaw = seatData.Data || seatData;
      if (seatMapRaw) {
        premiumServices.push({
          provider: 'MYSTIFLY',
          providerOfferId: offerId,
          providerServiceId: 'mystifly-seat-selection',
          ancillaryType: 'SEAT',
          passengerId: null,
          segmentId: null,
          journeyId: null,
          airportCode: null,
          label: 'Seat Selection',
          description: 'Select your preferred seat (aisle, window, or specific seat)',
          included: false,
          chargeable: false, // Seat preference SSR is typically free
          amount: 0,
          currency: 'USD',
          quantity: 1,
          maxQuantity: 1,
          rawProviderData: seatMapRaw,
        });
      }
    } else {
      console.warn(`[Ancillaries] Mystifly SeatMap not available: ${seatData.error || 'unknown'}`);
    }
  } catch (seatErr) {
    console.warn(`[Ancillaries] Mystifly SeatMap fetch failed: ${(seatErr as Error).message}`);
  }

  // ── Pre-booking: Meal preferences (IATA SSR codes) ────────────────────────
  // Meal selection uses standard IATA SSR codes passed in BookFlight request.
  // We provide the available codes so the UI can render a meal picker.
  for (const mealCode of MYSTIFLY_MEAL_CODES) {
    meals.push({
      provider: 'MYSTIFLY',
      providerOfferId: offerId,
      providerServiceId: `meal-${mealCode.code}`,
      ancillaryType: 'MEAL',
      passengerId: null,
      segmentId: null,
      journeyId: null,
      airportCode: null,
      label: `${mealCode.label} (${mealCode.code})`,
      description: mealCode.description,
      included: false,
      chargeable: false, // Meal SSR is typically free (preference, not purchase)
      amount: 0,
      currency: 'USD',
      quantity: 1,
      maxQuantity: 1,
      rawProviderData: { ssrCode: mealCode.code },
    });
  }

  // ── Post-booking: Extra baggage via AncillaryServiceRequest ─────────────
  // Only available after BookFlight (requires MFRef).
  if (mfref) {
    try {
      const ancRes = await fetch(`${BACKEND_URL}/api/mystifly/ancillary-services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uniqueId: mfref, baggage: true, meal: true, seatMap: false }),
      });
      const ancData = await ancRes.json();

      if (ancRes.ok && ancData.success) {
        // Normalize baggage services
        const baggageList = ancData.baggage || [];
        for (const bag of baggageList) {
          const serviceId = bag.ExtraServiceId ?? bag.ServiceId ?? bag.Id;
          const price = parseFloat(bag.Price ?? bag.Amount ?? '0');
          const currency = bag.Currency ?? bag.CurrencyCode ?? 'USD';
          const weight = bag.Weight ?? bag.BaggageWeight ?? '';
          const label = bag.Description ?? bag.Name ?? `Extra Baggage ${weight ? weight + 'kg' : ''}`;

          baggage.push({
            provider: 'MYSTIFLY',
            providerOfferId: offerId,
            providerServiceId: `baggage-${serviceId}`,
            ancillaryType: 'EXTRA_CHECKED_BAG',
            passengerId: null,
            segmentId: null,
            journeyId: null,
            airportCode: null,
            label: label.trim(),
            description: `Extra checked baggage${weight ? ` (${weight}kg)` : ''}`,
            included: false,
            chargeable: price > 0,
            amount: price,
            currency,
            quantity: 1,
            maxQuantity: bag.MaxQuantity ?? 3,
            rawProviderData: bag,
          });
        }

        console.log(`[Ancillaries] Mystifly post-booking: ${baggage.length} baggage from AncillaryServiceRequest`);
      } else {
        console.warn(`[Ancillaries] Mystifly AncillaryServiceRequest failed: ${ancData.error || 'unknown'}`);
      }
    } catch (ancErr) {
      console.warn(`[Ancillaries] Mystifly AncillaryServiceRequest fetch failed: ${(ancErr as Error).message}`);
    }
  }

  setCached(cacheKey, { baggage, meals, premiumServices });

  console.log(
    `[Ancillaries] Mystifly offer ${offerId.slice(0, 20)}...: ` +
    `${baggage.length} baggage, ${meals.length} meals, ${premiumServices.length} premium services` +
    (mfref ? ` (post-booking MFRef: ${mfref})` : ' (pre-booking)')
  );

  return NextResponse.json({
    baggage,
    meals,
    premiumServices,
    cached: false,
  });
}

