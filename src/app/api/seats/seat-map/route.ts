import { NextRequest, NextResponse } from 'next/server';
import { getSeatMaps } from '@/lib/providers/duffel';
import type {
  DuffelSeatMap,
  DuffelSeatMapCabin,
  DuffelSeatMapElement,
} from '@/lib/providers/duffel';
import type {
  SegmentSeatMap,
  SeatCabin,
  SeatRow,
  SeatSection,
  SeatElement,
  SeatElementType,
} from '@/lib/seat-map-types';

// ── In-memory cache (5-min TTL) ───────────────────────────────────────────────

interface CachedSeatData { seatMaps: SegmentSeatMap[]; seatSelectionSupported: boolean }
const cache = new Map<string, { data: CachedSeatData; expiresAt: number }>();

function getCached(key: string): CachedSeatData | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function setCached(key: string, data: CachedSeatData): void {
  cache.set(key, { data, expiresAt: Date.now() + 5 * 60 * 1000 });
}

// ── Transform Duffel → frontend model ────────────────────────────────────────

const SEAT_TYPES = new Set(['seat', 'empty', 'lavatory', 'galley', 'stairs', 'bassinet']);

function transformElement(el: DuffelSeatMapElement): SeatElement {
  // Treat restricted_seat_* types (e.g. restricted_seat_general) as real seats
  const isSeat = el.type === 'seat' || el.type.startsWith('restricted_seat');
  const services = el.available_services ?? [];
  const available = isSeat && services.length > 0;
  const svc = services[0];

  // Map seat-like types → 'seat', exit_row → 'empty', known types → themselves, unknown → 'empty'
  const type: SeatElementType = isSeat
    ? 'seat'
    : el.type === 'exit_row'
      ? 'empty'
      : SEAT_TYPES.has(el.type) ? (el.type as SeatElementType) : 'empty';

  // Collect ALL per-passenger service IDs (one per passenger on the offer)
  const serviceIds = services.map((s: any) => s.id as string).filter(Boolean);

  return {
    type,
    designator: el.designator ?? null,
    available,
    price: available && svc?.total_amount ? parseFloat(svc.total_amount) : 0,
    currency: available && svc?.total_currency ? svc.total_currency : 'USD',
    serviceId: available && svc?.id ? svc.id : null,
    serviceIds,
    disclosures: [
      ...(el.disclosures ?? []),
      // Propagate exit_row as a disclosure so the grid can style it
      ...(el.type === 'exit_row' ? ['exit_row'] : []),
    ],
  };
}

function transformCabin(cabin: DuffelSeatMapCabin): SeatCabin {
  const rows: SeatRow[] = cabin.rows.map((row) => {
    const sections: SeatSection[] = row.sections.map((section) => ({
      elements: section.elements.map(transformElement),
    }));

    const isExitRow = row.sections.some((s) =>
      s.elements.some((el) => el.disclosures?.includes('exit_row') || el.type === 'exit_row'),
    );

    // Row number = digits extracted from the first seat designator
    const firstDesignator = row.sections
      .flatMap((s) => s.elements)
      .find((el) => el.designator)?.designator;
    const rowNumber = firstDesignator?.match(/\d+/)?.[0] ?? '';

    return { rowNumber, sections, isExitRow };
  });

  return { cabinClass: cabin.cabin_class, rows, columnHeaders: deriveColumnHeaders(rows) };
}

function deriveColumnHeaders(rows: SeatRow[]): string[][] {
  const mostCompleteRow = rows.reduce<SeatRow | null>((best, row) => {
    const count = row.sections.reduce((n, s) => n + s.elements.filter(e => e.designator).length, 0);
    const bestCount = best
      ? best.sections.reduce((n, s) => n + s.elements.filter(e => e.designator).length, 0)
      : -1;
    return count > bestCount ? row : best;
  }, null);
  return mostCompleteRow
    ? mostCompleteRow.sections.map((s) =>
        s.elements.map((el) => el.designator?.replace(/\d+/g, '') ?? '').filter(Boolean),
      )
    : [];
}

// Merge multiple cabins that share the same cabin_class into a single cabin.
// Wide-body aircraft (A350, A380) often return Economy split into two blocks
// (front rows + rear rows). Users expect one continuous economy grid.
function mergeSameCabins(cabins: SeatCabin[]): SeatCabin[] {
  const ordered: string[] = [];
  const map = new Map<string, SeatCabin>();

  for (const cabin of cabins) {
    const existing = map.get(cabin.cabinClass);
    if (existing) {
      existing.rows = [...existing.rows, ...cabin.rows];
      existing.columnHeaders = deriveColumnHeaders(existing.rows);
    } else {
      ordered.push(cabin.cabinClass);
      map.set(cabin.cabinClass, { ...cabin, rows: [...cabin.rows] });
    }
  }

  return ordered.map((cc) => map.get(cc)!);
}

export function transformSeatMap(sm: DuffelSeatMap): SegmentSeatMap {
  return {
    seatMapId: sm.id,
    segmentId: sm.segment_id,
    sliceId: sm.slice_id,
    cabins: mergeSameCabins(sm.cabins.map(transformCabin)),
  };
}

// ── Check if the airline actually supports seat selection ─────────────────────
// Returns true when the seat map contains real seat elements (i.e. the airline
// provided seat layout data). This does NOT check whether any seats are
// currently available — a fully-booked flight still "supports" seat selection,
// the grid just shows all seats as occupied.

function checkSeatSelectionFromMaps(seatMaps: SegmentSeatMap[]): boolean {
  for (const sm of seatMaps) {
    for (const cabin of sm.cabins) {
      for (const row of cabin.rows) {
        for (const section of row.sections) {
          for (const el of section.elements) {
            if (el.type === 'seat' && el.designator) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const offerId = searchParams.get('offer_id');
  const orderId = searchParams.get('order_id');

  if (!offerId && !orderId) {
    return NextResponse.json({ error: 'offer_id or order_id required' }, { status: 400 });
  }

  const id = (offerId ?? orderId)!;
  const type = offerId ? 'offer' : 'order';
  const cacheKey = `seatmap:${type}:${id}`;

  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  try {
    const raw = await getSeatMaps(id, type);
    const seatMaps = raw.map(transformSeatMap);

    // Determine seat selection support from the actual seat map data.
    // If any seat has available_services, the airline supports seat selection.
    const seatSelectionSupported = seatMaps.length > 0 && checkSeatSelectionFromMaps(seatMaps);

    const result: CachedSeatData = { seatMaps, seatSelectionSupported };
    setCached(cacheKey, result);
    return NextResponse.json({ ...result, cached: false });
  } catch (error) {
    const errMsg = (error as Error).message;
    console.error(`[Seat Map] API error for ${type} ${id}: ${errMsg}`);
    // Return empty array — seats page shows preference-selector fallback
    return NextResponse.json(
      { seatMaps: [], seatSelectionSupported: false, error: `Seat map unavailable: ${errMsg}` },
      { status: 200 }, // 200 so the frontend can handle gracefully
    );
  }
}
