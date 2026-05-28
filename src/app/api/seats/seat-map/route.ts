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

const cache = new Map<string, { data: SegmentSeatMap[]; expiresAt: number }>();

function getCached(key: string): SegmentSeatMap[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function setCached(key: string, data: SegmentSeatMap[]): void {
  cache.set(key, { data, expiresAt: Date.now() + 5 * 60 * 1000 });
}

// ── Transform Duffel → frontend model ────────────────────────────────────────

const SEAT_TYPES = new Set(['seat', 'empty', 'lavatory', 'galley', 'stairs', 'bassinet']);

function transformElement(el: DuffelSeatMapElement): SeatElement {
  const isSeat = el.type === 'seat';
  const services = el.available_services ?? [];
  const available = isSeat && services.length > 0;
  const svc = services[0];

  const rawType = el.type === 'exit_row' ? 'empty' : el.type;
  const type: SeatElementType = SEAT_TYPES.has(rawType) ? (rawType as SeatElementType) : 'empty';

  return {
    type,
    designator: el.designator ?? null,
    available,
    price: available && svc?.total_amount ? parseFloat(svc.total_amount) : 0,
    currency: available && svc?.total_currency ? svc.total_currency : 'USD',
    serviceId: available && svc?.id ? svc.id : null,
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

function transformSeatMap(sm: DuffelSeatMap): SegmentSeatMap {
  return {
    seatMapId: sm.id,
    segmentId: sm.segment_id,
    sliceId: sm.slice_id,
    cabins: mergeSameCabins(sm.cabins.map(transformCabin)),
  };
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
    return NextResponse.json({ seatMaps: cached, cached: true });
  }

  try {
    const raw = await getSeatMaps(id, type);
    const seatMaps = raw.map(transformSeatMap);
    setCached(cacheKey, seatMaps);
    return NextResponse.json({ seatMaps, cached: false });
  } catch (error) {
    const errMsg = (error as Error).message;
    console.error(`[Seat Map] API error for ${type} ${id}: ${errMsg}`);
    // Return empty array — seats page shows preference-selector fallback
    return NextResponse.json(
      { seatMaps: [], error: `Seat map unavailable: ${errMsg}` },
      { status: 200 }, // 200 so the frontend can handle gracefully
    );
  }
}
