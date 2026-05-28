// ═══════════════════════════════════════════════
// POST /api/seats/recommendations
//
// AI seat recommendation endpoint for the FareMind
// AI Bot ONLY. Does not affect the existing manual
// seat selection flow.
//
// Supports both Duffel and Mystifly providers.
// ═══════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import type { SegmentSeatMap } from '@/lib/seat-map-types';
import type {
  SeatRecommendationRequest,
  SeatRecommendationResponse,
  SeatPreferenceInput,
  GroupSeatRequest,
  GroupSeatResponse,
} from '@/lib/ai-seat/ai-seat-types';
import { flattenSeatMap, recommendSeats, findConsecutiveGroupSeatBlocks } from '@/lib/ai-seat/seat-classifier';

// ── In-memory cache (3-min TTL) ───────────────────────────────────────────────
const cache = new Map<string, { data: SegmentSeatMap[]; expiresAt: number }>();

function getCached(key: string): SegmentSeatMap[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function setCached(key: string, data: SegmentSeatMap[]): void {
  cache.set(key, { data, expiresAt: Date.now() + 3 * 60 * 1000 });
}

// ── Fetch seat maps via the existing internal API route ──────────────────────
// Reuses /api/seats/seat-map which already handles Duffel transformation.
// For Mystifly, we call the backend adapter directly.

async function fetchSeatMaps(offerId: string, provider: string): Promise<SegmentSeatMap[]> {
  const cacheKey = `ai_seat:${provider}:${offerId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (provider === 'mystifly') {
    // Mystifly: call backend directly
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';
    const res = await fetch(`${backendUrl}/api/seats/mystifly-seat-map`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fareSourceCode: offerId }),
    });

    if (!res.ok) {
      console.warn(`[AI Seat] Mystifly seat map fetch failed: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const seatMaps: SegmentSeatMap[] = data.seatMaps ?? [];
    setCached(cacheKey, seatMaps);
    return seatMaps;
  }

  // Duffel (or default): call existing internal seat map route
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'http://localhost:3000';

  const seatMapUrl = `${baseUrl}/api/seats/seat-map?offer_id=${encodeURIComponent(offerId)}`;
  console.log(`[AI Seat] Fetching seat map from: ${seatMapUrl}`);

  const res = await fetch(seatMapUrl, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    console.warn(`[AI Seat] Duffel seat map fetch failed: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const seatMaps: SegmentSeatMap[] = data.seatMaps ?? [];
  console.log(`[AI Seat] Seat map result: ${seatMaps.length} segment(s), error=${data.error ?? 'none'}, cached=${data.cached ?? false}`);
  if (seatMaps.length === 0) {
    if (data.error) {
      console.warn(`[AI Seat] Seat map API returned 200 but with error: ${data.error}`);
    }
    // Do NOT cache empty results — allow retry on next request
    return [];
  }
  setCached(cacheKey, seatMaps);
  return seatMaps;
}

// ── Detect request type ──────────────────────────────────────────────────────

function isGroupRequest(body: Record<string, unknown>): body is GroupSeatRequest & Record<string, unknown> {
  return typeof body.passengerCount === 'number' && typeof body.areaPreference === 'string';
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ── Group seat request ───────────────────────────────────────────────────
    if (isGroupRequest(body)) {
      const { offerId, provider: prov, segmentIndex, passengerCount, areaPreference, seatTypePreference } = body as GroupSeatRequest;
      const provider = prov || 'duffel';
      const segIdx = segmentIndex ?? 0;

      if (!offerId || !passengerCount) {
        return NextResponse.json({ error: 'offerId and passengerCount are required' }, { status: 400 });
      }

      const seatMaps = await fetchSeatMaps(offerId, provider);
      if (!seatMaps.length) {
        const resp: GroupSeatResponse = {
          options: [], totalAvailable: 0, fallbackLevel: 5,
          error: 'Seat map is temporarily unavailable.',
        };
        return NextResponse.json(resp);
      }

      const targetMap = seatMaps[Math.min(segIdx, seatMaps.length - 1)];
      const classifiedSeats = flattenSeatMap(targetMap);

      console.log(
        `[AI Seat] Group request: ${passengerCount} pax, area=${areaPreference}, type=${seatTypePreference}, ` +
        `segment=${segIdx}, ${classifiedSeats.filter(s => s.available).length} available seats`
      );

      // Zone & availability breakdown for debugging
      const avail = classifiedSeats.filter(s => s.available);
      const unavail = classifiedSeats.filter(s => !s.available);
      const zoneBreakdown = {
        front: avail.filter(s => s.cabinZone === 'front').length,
        middle: avail.filter(s => s.cabinZone === 'middle').length,
        rear: avail.filter(s => s.cabinZone === 'rear').length,
      };
      const frontRows = avail.filter(s => s.cabinZone === 'front').map(s => s.rowNumber);
      const frontRange = frontRows.length > 0 ? `rows ${Math.min(...frontRows)}-${Math.max(...frontRows)}` : 'none';
      console.log(
        `[AI Seat] Zone breakdown: front=${zoneBreakdown.front} (${frontRange}), middle=${zoneBreakdown.middle}, rear=${zoneBreakdown.rear} | ` +
        `blocked/reserved: ${unavail.length}`
      );

      const result = findConsecutiveGroupSeatBlocks({
        classifiedSeats,
        passengerCount,
        areaPreference,
        seatTypePreference,
      });

      console.log(
        `[AI Seat] Group result: ${result.blocks.length} blocks found, fallbackLevel=${result.fallbackLevel}` +
        (result.fallbackReason ? ` — ${result.fallbackReason}` : '')
      );

      const resp: GroupSeatResponse = {
        options: result.blocks,
        totalAvailable: result.totalAvailable,
        fallbackLevel: result.fallbackLevel,
        fallbackReason: result.fallbackReason,
      };
      return NextResponse.json(resp);
    }

    // ── Individual seat request (existing flow) ──────────────────────────────
    const reqBody = body as SeatRecommendationRequest;

    if (!reqBody.offerId || !reqBody.preference) {
      return NextResponse.json(
        { error: 'offerId and preference are required' },
        { status: 400 },
      );
    }

    const provider = reqBody.provider || 'duffel';
    const preference: SeatPreferenceInput = reqBody.preference;
    const segmentIndex = reqBody.segmentIndex ?? 0;
    const excludeSeats: string[] = reqBody.excludeSeats ?? [];

    // 1. Fetch seat maps
    const seatMaps = await fetchSeatMaps(reqBody.offerId, provider);

    console.log(
      `[AI Seat] Fetched seat maps for ${provider}/${reqBody.offerId.substring(0, 20)}... → ` +
      `${seatMaps.length} segment(s), segmentIndex=${segmentIndex}, ` +
      `${seatMaps.reduce((n, sm) => n + sm.cabins.reduce((c, cab) => c + cab.rows.length, 0), 0)} total rows`
    );

    if (!seatMaps.length) {
      console.warn(`[AI Seat] No seat maps returned for ${reqBody.offerId}`);
      const response: SeatRecommendationResponse = {
        recommendedSeats: [],
        seats: [],
        totalAvailable: 0,
        fallbackUsed: false,
        error: 'Seat map is temporarily unavailable. Your seat preference has been saved, but exact seat selection can be completed later or during airline check-in.',
      };
      return NextResponse.json(response);
    }

    // 2. Pick the correct segment (outbound=0, return=1), fall back to last available
    const targetSeatMap = seatMaps[Math.min(segmentIndex, seatMaps.length - 1)];
    const classifiedSeats = flattenSeatMap(targetSeatMap);

    console.log(
      `[AI Seat] Classified: ${classifiedSeats.length} total seats, ` +
      `${classifiedSeats.filter(s => s.available).length} available, ` +
      `${classifiedSeats.filter(s => !s.available).length} unavailable`
    );

    // 3. Filter out excluded seats (pool depletion for multi-passenger)
    const filteredSeats = excludeSeats.length
      ? classifiedSeats.filter(s => !excludeSeats.includes(s.seatNumber))
      : classifiedSeats;

    // 4. Normal recommendation (top 5)
    const result = recommendSeats(filteredSeats, preference, 5);

    const response: SeatRecommendationResponse = {
      recommendedSeats: result.seats,
      seats: result.seats,
      totalAvailable: result.totalAvailable,
      fallbackUsed: result.fallbackUsed,
      fallbackReason: result.fallbackReason,
    };

    console.log(
      `[AI Seat] ${provider} | ${reqBody.offerId.substring(0, 16)}... | ` +
      `${result.totalAvailable} available | returning ${result.seats.length} seats | ` +
      `top: ${result.seats[0]?.seatNumber ?? 'none'} (score ${result.seats[0]?.score ?? 0}) | ` +
      `fallback: ${result.fallbackUsed}`
    );

    return NextResponse.json(response);
  } catch (error) {
    console.error('[AI Seat] Recommendation error:', (error as Error).message);
    const response: SeatRecommendationResponse = {
      recommendedSeats: [],
      seats: [],
      totalAvailable: 0,
      fallbackUsed: false,
      error: 'Failed to fetch seat recommendations. Please try again.',
    };
    return NextResponse.json(response, { status: 500 });
  }
}
