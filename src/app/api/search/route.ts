import { NextRequest, NextResponse } from 'next/server';
import { searchRoundTripFlights, searchFlights, getProviderStatus } from '@/lib/providers/orchestrator';
import { logSearch } from '@/lib/db-queries';
import { rankFlightOffers } from '@/lib/ai-scoring';
import { applyMarkupToOffers, applyMarkupToRoundTripOptions } from '@/lib/services/markup-service';
import type { AiUserPreferences, WeightPresetName, AiSortMode } from '@/lib/ai-scoring/types';
import type { RoundTripUserPrefs } from '@/lib/round-trip-types';
import { flexCacheKey, flexCacheGet } from '@/lib/flex-search-cache';
import { prisma } from '@/lib/db';
import { getTravelDnaForRecommendation } from '@/lib/services/travel-dna-service';
import type { TravelDnaRecommendationContext } from '@/lib/services/travel-dna-service';

export const maxDuration = 120; // Allow up to 2 minutes for search

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const origin = searchParams.get('origin')?.toUpperCase();
  const destination = searchParams.get('destination')?.toUpperCase();
  const date = searchParams.get('date');
  const returnDate = searchParams.get('returnDate') || undefined;
  const adults = parseInt(searchParams.get('adults') || '1');
  const children = parseInt(searchParams.get('children') || '0');
  const infants = parseInt(searchParams.get('infants') || '0');
  const cabin = searchParams.get('cabin') || 'economy';
  const trip = searchParams.get('trip') || 'one_way';

  if (!origin || !destination || !date) {
    return NextResponse.json({ error: 'Missing required parameters: origin, destination, date' }, { status: 400 });
  }
  if (origin.length !== 3 || destination.length !== 3) {
    return NextResponse.json({ error: 'origin and destination must be 3-letter IATA codes' }, { status: 400 });
  }
  if (origin === destination) {
    return NextResponse.json({ error: 'origin and destination must be different' }, { status: 400 });
  }

  try {
    // ── Travel DNA context (non-blocking) ─────────────────────────────────
    let travelDnaContext: TravelDnaRecommendationContext | null = null;
    try {
      const authHeader = request.headers.get('authorization');
      const token = authHeader?.replace('Bearer ', '') || request.cookies.get('faremind_session')?.value;
      if (token) {
        const session = await prisma.session.findUnique({
          where: { token },
          select: { userId: true, expiresAt: true },
        });
        if (session && new Date(session.expiresAt) > new Date()) {
          // Determine trip category from origin/destination (simplified heuristic)
          const tripCategory = (origin !== destination) ? 'INTERNATIONAL' : 'DOMESTIC';
          travelDnaContext = await getTravelDnaForRecommendation(session.userId, tripCategory as any);
        }
      }
    } catch {
      // Travel DNA is non-critical — never block search
    }

    // ── Round-trip path ──────────────────────────────────────────────────────
    if (trip === 'round_trip' && returnDate) {
      // Check if flex-price strip already fetched results for this exact tile.
      // If so, reuse that dataset so the cheapest card matches the tile price.
      const cachedOptions = flexCacheGet(flexCacheKey(origin!, destination!, date!, returnDate, adults, cabin));
      const rtResult = cachedOptions
        ? { options: cachedOptions, totalTimeMs: 0, searchId: 'cached', usedMockData: false, providers: [] }
        : await searchRoundTripFlights({
            origin: origin!, destination: destination!,
            date: date!, returnDate, adults, children, infants, cabin,
          });

      // ── Apply internal markup before AI ranking ──────────────────────────
      await applyMarkupToRoundTripOptions(rtResult.options);

      // ── Unified AI Ranking (ROUND_TRIP) ───────────────────────────────────
      const rtAiPrefs: AiUserPreferences = {
        sortMode: (searchParams.get('sort') as AiSortMode) || 'best_value',
        weightPreset: ((searchParams.get('sort') || 'best_ai_pick') as WeightPresetName),
        stops: (searchParams.get('stops') as AiUserPreferences['stops']) || undefined,
        departureWindow: (searchParams.get('departure_window') as AiUserPreferences['departureWindow']) || undefined,
      };

      const rtRankResult = rankFlightOffers(rtResult.options, 'ROUND_TRIP', rtAiPrefs, true, undefined, travelDnaContext);

      // Map ranked results to the format the frontend expects
      const ranked = rtRankResult.ranked.map((r) => ({
        ...r.option,
        score: r.aiScore,
        aiScoreRaw: r.aiScoreRaw,
        aiScoreDisplay: r.aiScore,
        aiReasons: r.aiReasons,
        rankingTags: r.rankingTags,
        scoreBreakdown: r.scoreBreakdown,
        badges: r.rankingTags
          .filter((t: string) => ['Cheapest', 'Fastest', 'Fewest Stops', 'Best Value', 'Recommended', 'AI Pick'].includes(t))
          .map((t: string) => t.toLowerCase().replace(/\s+/g, '_')),
      }));

      // Append filtered-out options
      const unscoredRT = rtRankResult.filteredOut.map((r) => ({
        ...r.option,
        score: 0,
        aiScoreRaw: 0,
        aiScoreDisplay: 0,
        aiReasons: [],
        rankingTags: [],
        scoreBreakdown: undefined,
        badges: [],
      }));

      const allRankedRT = [...ranked, ...unscoredRT];

      logSearch({
        origin: origin!, destination: destination!,
        departureDate: new Date(date!), returnDate: new Date(returnDate),
        adults, children, infants, cabinClass: cabin.toUpperCase() as any,
        tripType: 'ROUND_TRIP', resultsCount: allRankedRT.length,
        lowestPrice: allRankedRT[0]?.totalPrice, currency: allRankedRT[0]?.currency ?? 'USD',
        searchDurationMs: rtResult.totalTimeMs,
      }).catch((e) => console.warn('[RT Search] log failed:', e.message));
      const providerStatus = getProviderStatus();
      return NextResponse.json({
        roundTripOptions: allRankedRT,
        meta: {
          totalResults: allRankedRT.length, searchId: rtResult.searchId,
          totalTimeMs: rtResult.totalTimeMs, usedMockData: rtResult.usedMockData,
          providers: rtResult.providers.map((p) => ({
            provider: p.provider, count: rtResult.options.length,
            responseTimeMs: p.responseTimeMs, error: p.error || null, isMock: p.isMock,
          })),
          providerStatus: {
            duffel: providerStatus.duffel.configured ? 'connected' : 'not_configured',
            amadeus: providerStatus.amadeus.configured ? 'connected' : 'not_configured',
          },
          rankingMetadata: rtRankResult.metadata,
        },
      });
    }

    // ── One-way: proxy to backend for aggregated Duffel + Mystifly data ──────
    let backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    backendUrl = backendUrl.replace(/\/$/, '');
    const backendParams = new URLSearchParams({
      origin: origin!,
      destination: destination!,
      date: date!,
      adults: String(adults),
      cabin: cabin || 'economy',
    });
    if (returnDate) backendParams.set('returnDate', returnDate);
    if (children) backendParams.set('children', String(children));
    if (infants) backendParams.set('infants', String(infants));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000); // 90s timeout

    let backendFlights: any[] = [];
    let backendMeta: any = {};
    try {
      const res = await fetch(`${backendUrl}/api/search?${backendParams}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        backendFlights = data.flights || [];
        backendMeta = {
          searchId: data.searchId,
          totalTimeMs: data.totalTimeMs,
          providers: data.providers,
        };
      } else {
        console.warn(`[Search] Backend returned ${res.status}`);
      }
    } catch (err) {
      clearTimeout(timeout);
      console.warn('[Search] Backend call failed, falling back to local orchestrator:', (err as Error).message);
    }

    if (backendFlights.length === 0) {
      console.log('[Search] Using local orchestrator fallback for one-way search');
      try {
        const localResult = await searchFlights({
          origin: origin!, destination: destination!,
          date: date!, returnDate: returnDate || undefined, adults, children, infants, cabin,
        });
        backendFlights = localResult.flights || [];
        backendMeta = {
          searchId: localResult.searchId,
          totalTimeMs: localResult.totalTimeMs,
          providers: localResult.providers,
        };
      } catch (localErr) {
        console.warn('[Search] Local orchestrator fallback also failed:', (localErr as Error).message);
      }
    }

    // Log what cabin classes actually came back
    const cabinBreakdown: Record<string, number> = {};
    backendFlights.forEach((f: any) => {
      cabinBreakdown[f.cabinClass] = (cabinBreakdown[f.cabinClass] || 0) + 1;
    });
    console.log(`[Search] ${origin}→${destination} | ${backendFlights.length} flights | cabins:`, cabinBreakdown);

    // ── Apply internal markup before AI ranking ──────────────────────────
    await applyMarkupToOffers(backendFlights);

    // ── Unified AI Ranking (ONE_WAY) ───────────────────────────────────────
    const sortMode = searchParams.get('sort') as AiSortMode | null;
    const aiPrefs: AiUserPreferences = {
      sortMode: sortMode || 'best_value',
      weightPreset: (sortMode || 'best_ai_pick') as WeightPresetName,
      stops:           (searchParams.get('stops') as AiUserPreferences['stops']) || undefined,
      departureWindow: (searchParams.get('departure_window') as AiUserPreferences['departureWindow']) || undefined,
    };

    const rankResult = rankFlightOffers(backendFlights, 'ONE_WAY', aiPrefs, true, undefined, travelDnaContext);

    // Map ranked results to the format the frontend expects (AI-scored)
    const scoredFlights = rankResult.ranked.map((r) => ({
      ...r.option,
      valueScore:      r.aiScore,          // backward-compatible score field
      aiScoreRaw:      r.aiScoreRaw,
      aiScoreDisplay:  r.aiScore,
      aiReasons:       r.aiReasons,
      rankingTags:     r.rankingTags,
      scoreBreakdown:  r.scoreBreakdown,
      tags:            r.labels.map((l: string) =>
        l === '✨ AI Pick' ? 'best_value' : l === 'Best Price' ? 'cheapest' : l === 'Fastest' ? 'fastest' : l
      ),
    }));

    // Append quality-filtered flights at the end WITHOUT AI scores
    // These are flights that didn't pass the quality filter (e.g. duration > 2× fastest,
    // short layovers) but the user should still see them as scroll-able options.
    const unscoredFlights = rankResult.filteredOut.map((r) => ({
      ...r.option,
      valueScore:      0,
      aiScoreRaw:      0,
      aiScoreDisplay:  0,
      aiReasons:       [],
      rankingTags:     [],
      scoreBreakdown:  undefined,
      tags:            [],
    }));

    const rankedFlights = [...scoredFlights, ...unscoredFlights];

    const lowestPrice = rankedFlights.length > 0
      ? Math.min(...rankedFlights.map((f: any) => f.totalPrice))
      : undefined;

    logSearch({
      origin: origin!, destination: destination!,
      departureDate: new Date(date!),
      returnDate: returnDate ? new Date(returnDate) : undefined,
      adults, children, infants, cabinClass: cabin.toUpperCase() as any,
      tripType: 'ONE_WAY', resultsCount: rankedFlights.length,
      lowestPrice, currency: 'USD', searchDurationMs: backendMeta.totalTimeMs || 0,
    }).catch((err) => console.warn('[Search] Failed to log search:', err.message));

    // Build class counts for the filter panel
    const classCounts: Record<string, { count: number; minPrice: number }> = {};
    for (const f of rankedFlights) {
      const c = (f as any).cabinClass;
      if (!classCounts[c]) classCounts[c] = { count: 0, minPrice: Infinity };
      classCounts[c].count++;
      if ((f as any).totalPrice < classCounts[c].minPrice) classCounts[c].minPrice = (f as any).totalPrice;
    }

    const providerStatus = getProviderStatus();
    return NextResponse.json({
      flights: rankedFlights,
      meta: {
        totalResults: rankedFlights.length,
        searchId: backendMeta.searchId || 'unknown',
        totalTimeMs: backendMeta.totalTimeMs || 0,
        usedMockData: false,
        providers: backendMeta.providers?.map((p: any) => ({
          provider: p.provider, count: p.flights?.length ?? 0,
          responseTimeMs: p.responseTimeMs, error: p.error || null, isMock: p.isMock ?? false,
        })) || [],
        providerStatus: {
          duffel: providerStatus.duffel.configured ? 'connected' : 'not_configured',
          amadeus: providerStatus.amadeus.configured ? 'connected' : 'not_configured',
        },
        filters: { classes: classCounts },
        rankingMetadata: rankResult.metadata,
      },
    });
  } catch (error: any) {
    console.error('[Search] Critical error:', error);
    return NextResponse.json({ 
      error: 'Search failed. Please try again.',
      details: error.message || String(error)
    }, { status: 500 });
  }
}
