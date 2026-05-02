import { NextRequest, NextResponse } from 'next/server';
import { resolveMeal, getDefaultMealCodes, getRecommendedCode } from '@/lib/meal-types';
import type { MealOptionDef } from '@/lib/meal-types';

// ── In-memory cache (10-min TTL) ──────────────────────────────────────────────

const cache = new Map<string, { meals: MealOptionDef[]; recommended: string; expiresAt: number }>();

function getCacheKey(airline: string, origin: string, destination: string, duration: string): string {
  return `meals:${airline}:${origin}:${destination}:${duration}`;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const airline     = searchParams.get('airline')  ?? '';
  const origin      = searchParams.get('origin')   ?? '';
  const destination = searchParams.get('destination') ?? '';
  const duration    = parseInt(searchParams.get('duration') ?? '0', 10);
  const hasChildren = searchParams.get('children') === 'true';

  const key = getCacheKey(airline, origin, destination, String(Math.round(duration / 30)));

  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json({ meals: cached.meals, recommended: cached.recommended, cached: true });
  }

  // Determine available SSR codes for this flight
  const codes = getDefaultMealCodes(duration, hasChildren);
  const meals = codes.map(code => resolveMeal(code, 0));

  const recommended = getRecommendedCode(origin, destination, airline);

  cache.set(key, { meals, recommended, expiresAt: Date.now() + 10 * 60 * 1000 });

  return NextResponse.json({ meals, recommended, cached: false });
}
