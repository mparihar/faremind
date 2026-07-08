import { NextRequest, NextResponse } from 'next/server';
import { getOffer } from '@/lib/providers/duffel';
import { resolveMeal } from '@/lib/meal-types';
import type { MealOptionDef } from '@/lib/meal-types';

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
  const provider = searchParams.get('provider') ?? 'duffel';

  // Without an offer ID, we can't check the provider — return empty
  if (!offerId) {
    return NextResponse.json({
      meals: [],
      recommended: null,
      mealsSupported: false,
      error: 'No offer ID provided — meal availability cannot be determined.',
    });
  }

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

    // Non-Duffel providers: return empty for now
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
