import { NextRequest, NextResponse } from 'next/server';
import { getOffer } from '@/lib/providers/duffel';
import { resolveMeal } from '@/lib/meal-types';
import type { MealOptionDef } from '@/lib/meal-types';
import { mealServices, mealCodeFromDescription } from '@/lib/mystifly-extra-services';

// ── In-memory cache (5-min TTL) ───────────────────────────────────────────────

interface MealResult { meals: MealOptionDef[]; recommended: string; mealsSupported: boolean }
const cache = new Map<string, { data: MealResult; expiresAt: number }>();

function getCached(key: string): MealResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function setCached(key: string, data: MealResult): void {
  cache.set(key, { data, expiresAt: Date.now() + 5 * 60 * 1000 });
}

// ── Duffel meal service types ─────────────────────────────────────────────────
// Duffel's available_services can include type "meal" when the airline supports
// meal selection through their booking channel.

const MEAL_SERVICE_TYPES = new Set(['meal', 'meals', 'catering']);

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const offerId = searchParams.get('offer_id');
  const providerParam = searchParams.get('provider') ?? 'duffel';

  // Without an offer ID, we can't check the provider — return empty
  if (!offerId) {
    return NextResponse.json({
      meals: [],
      recommended: null,
      mealsSupported: false,
      error: 'No offer ID provided — meal availability cannot be determined.',
    });
  }

  // Route by offer-id shape, not the (unreliable) provider param — the checkout
  // defaults it to 'duffel' when the flight's provider is missing, which sent
  // Mystifly FareSourceCodes to Duffel (404). Duffel ids are prefixed off_/ord_.
  const isDuffelId = /^(off_|ord_)/i.test(offerId);
  const provider = isDuffelId ? 'duffel' : (providerParam === 'duffel' ? 'mystifly' : providerParam);

  const cacheKey = `meals:${provider}:${offerId}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  try {
    if (provider === 'duffel') {
      // Fetch offer with available_services to check for meal services
      const offer = await getOffer(offerId);
      const services = offer.available_services ?? [];

      // Filter for meal-type services
      const mealServices = services.filter(
        s => MEAL_SERVICE_TYPES.has(s.type?.toLowerCase() ?? ''),
      );

      if (mealServices.length === 0) {
        // Airline does not offer meal selection through this booking channel
        const result: MealResult = { meals: [], recommended: '', mealsSupported: false };
        setCached(cacheKey, result);
        return NextResponse.json({ ...result, cached: false });
      }

      // Airline provides meal services — build meal options from the services
      const meals: MealOptionDef[] = mealServices.map(s => {
        const code = s.metadata?.type?.toUpperCase() ?? s.type?.toUpperCase() ?? 'STANDARD';
        const price = parseFloat(s.total_amount ?? '0');
        return resolveMeal(code, price);
      });

      // Deduplicate by code
      const seen = new Set<string>();
      const uniqueMeals = meals.filter(m => {
        if (seen.has(m.code)) return false;
        seen.add(m.code);
        return true;
      });

      // Always add a "Skip Meal" option
      if (!uniqueMeals.some(m => m.code === 'NONE')) {
        uniqueMeals.push(resolveMeal('NONE', 0));
      }

      const recommended = uniqueMeals[0]?.code ?? 'STANDARD';
      const result: MealResult = { meals: uniqueMeals, recommended, mealsSupported: true };
      setCached(cacheKey, result);
      return NextResponse.json({ ...result, cached: false });
    }

    // ── Mystifly: Meals from Revalidation ExtraServices ──
    if (provider === 'mystifly') {
      const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
      const revalRes = await fetch(`${BACKEND_URL}/api/mystifly/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fareSourceCode: offerId, source: 'meal' }),
      });

      if (!revalRes.ok) {
        console.warn('[Meals] Mystifly revalidation failed for meal check');
        const result: MealResult = { meals: [], recommended: '', mealsSupported: false };
        setCached(cacheKey, result);
        return NextResponse.json({ ...result, cached: false });
      }

      const revalData = await revalRes.json();

      // ExtraServices1_1, not ExtraServices. The response carries both and the
      // second is empty on every revalidation seen — reading it meant no paid
      // meal was ever offered. The value is also an object with the list under
      // `.Services`, so the old `Array.isArray` check could not have matched
      // either. parseExtraServices handles both.
      const offered = mealServices(revalData);

      if (offered.length === 0) {
        // Mystifly supports meal SSR preferences at booking time even when
        // ExtraServices doesn't list them. Fall back to standard IATA SSR codes.
        const ssrCodes = ['STANDARD', 'VGML', 'AVML', 'NLML', 'MOML', 'KSML', 'HNML', 'DBML', 'GFML', 'LFML', 'FPML', 'SFML', 'LCML', 'CHML', 'NONE'];
        const ssrMeals: MealOptionDef[] = ssrCodes.map(code => resolveMeal(code, 0));
        const recommended = ssrMeals[0]?.code ?? 'STANDARD';
        const result: MealResult = { meals: ssrMeals, recommended, mealsSupported: true };
        setCached(cacheKey, result);
        return NextResponse.json({ ...result, cached: false });
      }

      // The provider gives a description and a price, not an IATA code — the doc's
      // own examples are "Child Menu 39.12 USD", "Gluten-free Menu 39.12 USD".
      // Match a code out of the wording where one is recognisable and keep the
      // provider's own text otherwise, so a menu we have no code for is still
      // offered rather than dropped.
      const meals: MealOptionDef[] = offered.map((s) => {
        const code = mealCodeFromDescription(s.description);
        const meal = resolveMeal(code, s.amount);
        return { ...meal, label: s.description || meal.label, serviceId: s.serviceId };
      });

      // Deduplicate by code
      const seen = new Set<string>();
      const uniqueMeals = meals.filter(m => {
        if (seen.has(m.code)) return false;
        seen.add(m.code);
        return true;
      });

      if (!uniqueMeals.some(m => m.code === 'NONE')) {
        uniqueMeals.push(resolveMeal('NONE', 0));
      }

      const recommended = uniqueMeals[0]?.code ?? 'STANDARD';
      const result: MealResult = { meals: uniqueMeals, recommended, mealsSupported: true };
      setCached(cacheKey, result);
      return NextResponse.json({ ...result, cached: false });
    }

    // Other providers: return empty for now
    const result: MealResult = { meals: [], recommended: '', mealsSupported: false };
    setCached(cacheKey, result);
    return NextResponse.json({ ...result, cached: false });
  } catch (error) {
    console.error('[Meals] Error checking meal services:', (error as Error).message);
    return NextResponse.json({
      meals: [],
      recommended: '',
      mealsSupported: false,
      error: 'Could not check meal availability.',
    });
  }
}
