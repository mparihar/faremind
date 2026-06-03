// ═══════════════════════════════════════════════
// Seat Classifier & Recommendation Engine
//
// Pure functions — no API calls, no side effects.
// Works with the existing SegmentSeatMap type from
// seat-map-types.ts which is provider-agnostic
// (Duffel + Mystifly both normalize to it).
// ═══════════════════════════════════════════════

import type { SegmentSeatMap, SeatRow, SeatElement } from '@/lib/seat-map-types';
import type {
  CabinZone,
  SeatTypeClass,
  RestroomZone,
  SeatPreferenceInput,
  ClassifiedSeat,
  RecommendedSeat,
  GroupSeatBlock,
  AreaPreference,
} from './ai-seat-types';

// ─── Cabin zone classification ───────────────────────────────────────────────
// Uses position relative to total rows in the cabin, not hard-coded row numbers.
// first 30% = front, next 40% = middle, last 30% = rear

export function classifyCabinZone(rowIndex: number, totalRows: number): CabinZone {
  if (totalRows <= 0) return 'middle';
  const position = rowIndex / totalRows;
  if (position < 0.3) return 'front';
  if (position < 0.7) return 'middle';
  return 'rear';
}

// ─── Seat type classification ────────────────────────────────────────────────
// Uses Duffel disclosures when available, then falls back to position analysis.

export function classifySeatType(
  seatElement: SeatElement,
  seatIndexInSection: number,
  sectionSeatCount: number,
  isFirstSection: boolean,
  isLastSection: boolean,
): SeatTypeClass {
  // Prefer explicit disclosures from the provider
  const disc = seatElement.disclosures ?? [];
  if (disc.includes('window')) return 'window';
  if (disc.includes('aisle')) return 'aisle';
  if (disc.includes('middle')) return 'middle';

  // Position-based fallback
  if (sectionSeatCount <= 1) return 'unknown';

  // First seat of the first section = window, last seat of the last section = window
  if (isFirstSection && seatIndexInSection === 0) return 'window';
  if (isLastSection && seatIndexInSection === sectionSeatCount - 1) return 'window';

  // First/last seat of middle sections are aisle seats
  if (seatIndexInSection === 0 || seatIndexInSection === sectionSeatCount - 1) return 'aisle';

  // Everything in between = middle
  return 'middle';
}

// ─── Restroom / lavatory detection ───────────────────────────────────────────

export function detectRestroomRows(seatMap: SegmentSeatMap): number[] {
  const lavatoryRows: number[] = [];

  for (const cabin of seatMap.cabins) {
    for (const row of cabin.rows) {
      const hasLavatory = row.sections.some(section =>
        section.elements.some(el =>
          el.type === 'lavatory'
        )
      );
      if (hasLavatory) {
        const rowNum = parseInt(row.rowNumber, 10);
        if (!isNaN(rowNum)) lavatoryRows.push(rowNum);
      }
    }
  }

  if (lavatoryRows.length > 0) return lavatoryRows;

  // Fallback: estimate restroom positions from all row numbers
  const allRowNumbers: number[] = [];
  for (const cabin of seatMap.cabins) {
    for (const row of cabin.rows) {
      const n = parseInt(row.rowNumber, 10);
      if (!isNaN(n)) allRowNumbers.push(n);
    }
  }

  if (allRowNumbers.length === 0) return [];

  allRowNumbers.sort((a, b) => a - b);
  const estimated = [allRowNumbers[0], allRowNumbers[allRowNumbers.length - 1]];

  if (allRowNumbers.length > 25) {
    estimated.push(allRowNumbers[Math.floor(allRowNumbers.length / 2)]);
  }

  return estimated;
}

// ─── Restroom zone classification ────────────────────────────────────────────

export function classifyRestroomZone(rowNumber: number, restroomRows: number[]): RestroomZone {
  if (restroomRows.length === 0) return 'neutral';

  const distance = Math.min(
    ...restroomRows.map(rr => Math.abs(rowNumber - rr))
  );

  if (distance <= 2) return 'near_restroom';
  if (distance >= 5) return 'away_restroom';
  return 'neutral';
}

// ─── Flatten seat map → ClassifiedSeat[] ─────────────────────────────────────
// Iterates all cabins → rows → sections → elements, classifying each real seat.
// NOTE: In Duffel sandbox/test mode, seats often have no available_services,
// making them all appear as unavailable. We detect this and treat seats with
// designators as available at $0 to enable the full recommendation flow.

export function flattenSeatMap(seatMap: SegmentSeatMap): ClassifiedSeat[] {
  const restroomRows = detectRestroomRows(seatMap);
  const seats: ClassifiedSeat[] = [];

  // First pass: collect all seats
  const rawSeats: {
    el: SeatElement;
    rowIndex: number;
    rowNumber: number;
    cabinZone: CabinZone;
    restroomZone: RestroomZone;
    seatIdx: number;
    seatElements: SeatElement[];
    isFirstSection: boolean;
    isLastSection: boolean;
  }[] = [];

  // Compute GLOBAL total rows across all cabins for zone classification.
  // This ensures row 28 on a 54-row aircraft is correctly classified as
  // 'middle' (28/54 = 0.52) rather than 'front' of its individual cabin.
  let globalTotalRows = 0;
  for (const cabin of seatMap.cabins) {
    globalTotalRows += cabin.rows.length;
  }

  let globalRowOffset = 0;
  for (const cabin of seatMap.cabins) {
    cabin.rows.forEach((row, rowIndexInCabin) => {
      const globalRowIndex = globalRowOffset + rowIndexInCabin;
      const rowNumber = parseInt(row.rowNumber, 10) || globalRowIndex + 1;
      const cabinZone = classifyCabinZone(globalRowIndex, globalTotalRows);
      const restroomZone = classifyRestroomZone(rowNumber, restroomRows);
      const sectionCount = row.sections.length;

      row.sections.forEach((section, sectionIdx) => {
        const seatElements = section.elements.filter(el => el.type === 'seat');
        const isFirstSection = sectionIdx === 0;
        const isLastSection = sectionIdx === sectionCount - 1;

        let seatIdx = 0;
        for (const el of section.elements) {
          if (el.type !== 'seat') continue;
          if (!el.designator) { seatIdx++; continue; }

          rawSeats.push({
            el,
            rowIndex: globalRowIndex,
            rowNumber,
            cabinZone,
            restroomZone,
            seatIdx,
            seatElements,
            isFirstSection,
            isLastSection,
          });
          seatIdx++;
        }
      });
    });
    globalRowOffset += cabin.rows.length;
  }

  // Detect test/sandbox mode: if ALL seats with designators are marked unavailable,
  // it's likely because the provider (Duffel sandbox) doesn't populate available_services.
  // In that case, treat all seats as available with $0 price.
  const totalWithDesignator = rawSeats.length;
  const totalAvailable = rawSeats.filter(s => s.el.available).length;
  const sandboxMode = totalWithDesignator > 0 && totalAvailable === 0;

  if (sandboxMode) {
    console.log(
      `[AI Seat] Sandbox mode detected: ${totalWithDesignator} seats, 0 available_services. ` +
      `Treating all as available at $0.`
    );
  }

  for (const raw of rawSeats) {
    const { el, rowNumber, cabinZone, restroomZone, seatIdx, seatElements, isFirstSection, isLastSection } = raw;
    const column = el.designator!.replace(/\d+/g, '');
    const seatType = classifySeatType(el, seatIdx, seatElements.length, isFirstSection, isLastSection);

    // Availability: must be explicitly available from the provider AND have a
    // valid serviceId (needed for Duffel/Mystifly to actually book the seat).
    // In sandbox mode, serviceId check is skipped since test data has no services.
    const isAvailable = sandboxMode
      ? true
      : (el.available && el.type === 'seat' && (el.serviceId != null && el.serviceId !== ''));
    const price = sandboxMode ? 0 : el.price;

    seats.push({
      seatId: `${seatMap.segmentId}_${el.designator}`,
      seatServiceId: el.serviceId,
      seatServiceIds: el.serviceIds ?? (el.serviceId ? [el.serviceId] : []),
      seatNumber: el.designator!,
      rowNumber,
      column,
      segmentId: seatMap.segmentId,

      available: isAvailable,
      occupied: !isAvailable,
      price,
      currency: el.currency,

      cabinZone,
      seatType,
      restroomZone,

      score: 0,
      reason: '',

      disclosures: el.disclosures ?? [],
    });
  }

  return seats;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

export function scoreSeat(seat: ClassifiedSeat, preference: SeatPreferenceInput): number {
  if (!seat.available) return -9999;

  let score = 100; // base score for available seats

  // Zone match (45 pts)
  if (preference.cabinZone !== 'any' && seat.cabinZone === preference.cabinZone) {
    score += 45;
  }

  // Seat type match (45 pts)
  if (preference.seatType !== 'any' && seat.seatType === preference.seatType) {
    score += 45;
  }

  // Restroom preference match (30 pts)
  if (preference.restroomPreference === 'near_restroom' && seat.restroomZone === 'near_restroom') {
    score += 30;
  }
  if (preference.restroomPreference === 'away_restroom' && seat.restroomZone === 'away_restroom') {
    score += 30;
  }

  // "Any" zone: mild preference for middle > front
  if (preference.cabinZone === 'any') {
    if (seat.cabinZone === 'middle') score += 10;
    if (seat.cabinZone === 'front') score += 8;
  }

  // "Any" type: mild preference for aisle > window
  if (preference.seatType === 'any') {
    if (seat.seatType === 'aisle') score += 8;
    if (seat.seatType === 'window') score += 7;
  }

  // Neutral restroom is slightly preferable to near
  if (seat.restroomZone === 'neutral') score += 3;

  // Lower price is better (up to -15 pts penalty for expensive seats)
  score -= Math.min(seat.price || 0, 100) * 0.15;

  return Math.round(score);
}

// ─── Reason builder ──────────────────────────────────────────────────────────

const ZONE_LABELS: Record<CabinZone, string> = { front: 'Front', middle: 'Middle', rear: 'Rear' };
const TYPE_LABELS: Record<SeatTypeClass, string> = { window: 'Window', aisle: 'Aisle', middle: 'Middle', unknown: '' };

export function buildSeatReason(seat: ClassifiedSeat): string {
  const parts: string[] = [];

  parts.push(`${ZONE_LABELS[seat.cabinZone]} cabin`);
  if (seat.seatType !== 'unknown') parts.push(`${TYPE_LABELS[seat.seatType]} seat`);

  if (seat.restroomZone === 'near_restroom') parts.push('Near restroom');
  else if (seat.restroomZone === 'away_restroom') parts.push('Away from restroom');

  if (seat.price === 0) parts.push('Included');
  else parts.push(`$${seat.price}`);

  return parts.join(' · ');
}

// ─── Progressive relaxation ─────────────────────────────────────────────────
// If exact match yields fewer than `limit` seats, relax criteria step by step:
//   1. Keep seat type, relax restroom preference
//   2. Keep cabin zone, relax seat type
//   3. Keep seat type, relax cabin zone
//   4. Any available best seats

function relaxPreference(pref: SeatPreferenceInput, level: number): SeatPreferenceInput {
  switch (level) {
    case 1: return { ...pref, restroomPreference: 'neutral' };
    case 2: return { ...pref, seatType: 'any' };
    case 3: return { ...pref, cabinZone: 'any' };
    case 4: return { cabinZone: 'any', seatType: 'any', restroomPreference: 'neutral' };
    default: return pref;
  }
}

// ─── Recommend seats ─────────────────────────────────────────────────────────

export interface RecommendResult {
  seats: RecommendedSeat[];
  totalAvailable: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

export function recommendSeats(
  classifiedSeats: ClassifiedSeat[],
  preference: SeatPreferenceInput,
  limit: number = 5,
): RecommendResult {
  const available = classifiedSeats.filter(s => s.available);
  const totalAvailable = available.length;

  if (totalAvailable === 0) {
    return { seats: [], totalAvailable: 0, fallbackUsed: false };
  }

  // Score with original preference
  let scored = available.map(seat => ({
    ...seat,
    score: scoreSeat(seat, preference),
    reason: buildSeatReason(seat),
  }));

  // Sort by score desc, then price asc
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.price || 0) - (b.price || 0);
  });

  // Check if top results are good matches (score >= 140 = at least 2 criteria matched)
  const goodMatches = scored.filter(s => s.score >= 140);

  let fallbackUsed = false;
  let fallbackReason: string | undefined;

  if (goodMatches.length < limit) {
    // Progressive relaxation
    for (let level = 1; level <= 4; level++) {
      const relaxed = relaxPreference(preference, level);
      scored = available.map(seat => ({
        ...seat,
        score: scoreSeat(seat, relaxed),
        reason: buildSeatReason(seat),
      }));
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.price || 0) - (b.price || 0);
      });

      if (scored.slice(0, limit).every(s => s.score >= 100)) {
        fallbackUsed = true;
        fallbackReason = level <= 2
          ? 'Relaxed restroom/seat type criteria for more options'
          : 'Showing closest available matches';
        break;
      }
    }
  }

  const top = scored.slice(0, limit).map((seat, idx) => ({
    ...seat,
    rank: idx + 1,
  }));

  return { seats: top, totalAvailable, fallbackUsed, fallbackReason };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group Consecutive Seat Block Finder (multi-pax)
//
// Finds N adjacent available seats for a group, respecting area and seat-type
// preferences, with progressive fallback.
// ═══════════════════════════════════════════════════════════════════════════════

const ZONE_LABEL_MAP: Record<CabinZone, string> = { front: 'Front cabin', middle: 'Middle cabin', rear: 'Rear cabin' };
const TYPE_LABEL_MAP: Record<SeatTypeClass, string> = { window: 'Window', aisle: 'Aisle', middle: 'Middle', unknown: 'Seat' };
const RESTROOM_LABEL_MAP: Record<string, string> = {
  near_restroom: 'Near restroom',
  away_restroom: 'Away from restroom',
  neutral: '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function filterByArea(seats: ClassifiedSeat[], area: AreaPreference): ClassifiedSeat[] {
  switch (area) {
    case 'front': return seats.filter(s => s.cabinZone === 'front');
    case 'middle': return seats.filter(s => s.cabinZone === 'middle');
    case 'rear': return seats.filter(s => s.cabinZone === 'rear');
    case 'near_restroom': return seats.filter(s => s.restroomZone === 'near_restroom');
    case 'away_restroom': return seats.filter(s => s.restroomZone === 'away_restroom');
    case 'any': return seats;
    default: return seats;
  }
}

function isConsecutiveColumns(seats: ClassifiedSeat[]): boolean {
  for (let i = 1; i < seats.length; i++) {
    if (seats[i].column.charCodeAt(0) - seats[i - 1].column.charCodeAt(0) !== 1) return false;
  }
  return true;
}

/** Find all consecutive runs of available seats within a single row. */
function findConsecutiveRuns(rowSeats: ClassifiedSeat[], minLen: number): ClassifiedSeat[][] {
  // Sort by column
  const sorted = [...rowSeats].sort((a, b) => a.column.localeCompare(b.column));
  const runs: ClassifiedSeat[][] = [];
  let current: ClassifiedSeat[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].column.charCodeAt(0) - sorted[i - 1].column.charCodeAt(0) === 1) {
      current.push(sorted[i]);
    } else {
      if (current.length >= minLen) runs.push(current);
      current = [sorted[i]];
    }
  }
  if (current.length >= minLen) runs.push(current);
  return runs;
}

/** Find the best starting index within a run for the seat type preference.
 *  STRICT: if the preferred type exists as a starting position in the run,
 *  we ONLY consider starting positions that match.
 *  This ensures "Aisle" preference always starts from an aisle seat.
 */
function bestStartInRun(
  run: ClassifiedSeat[],
  count: number,
  typePref: SeatTypeClass | 'any',
): number {
  if (typePref === 'any') return 0;

  // First: find all valid starting positions where the block starts with the preferred type
  const strictStarts: number[] = [];
  for (let i = 0; i <= run.length - count; i++) {
    if (run[i].seatType === typePref) {
      strictStarts.push(i);
    }
  }

  // If we found any strict match, use the earliest one (lowest row position)
  if (strictStarts.length > 0) {
    return strictStarts[0];
  }

  // Fallback: no block starts with the preferred type — find the block
  // that contains the most seats of the preferred type
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i <= run.length - count; i++) {
    let score = 0;
    for (let j = i; j < i + count; j++) {
      if (run[j].seatType === typePref) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Build a GroupSeatBlock from a list of classified seats. */
function makeBlock(
  seats: ClassifiedSeat[],
  area: AreaPreference,
  typePref: SeatTypeClass | 'any',
): GroupSeatBlock {
  const rows = [...new Set(seats.map(s => s.rowNumber))].sort((a, b) => a - b);
  const sameRow = rows.length === 1;
  const totalPrice = seats.reduce((s, seat) => s + (seat.price || 0), 0);
  const currency = seats[0]?.currency || 'USD';
  const cabinZone = seats[0]?.cabinZone || 'middle';
  const restroom = seats[0]?.restroomZone || 'neutral';
  const startsType = seats[0]?.seatType || 'unknown';

  const seatNums = seats.map(s => s.seatNumber).join(', ');
  const firstRow = rows[0];
  const lastCol = seats[seats.length - 1]?.column || '';
  const firstCol = seats[0]?.column || '';
  const blockId = `row-${firstRow}-${firstCol}-${lastCol}`;

  // Score
  let matchScore = 100;
  // Area match
  if (area !== 'any') {
    const areaMatch = area === 'near_restroom'
      ? seats[0]?.restroomZone === 'near_restroom'
      : area === 'away_restroom'
        ? seats[0]?.restroomZone === 'away_restroom'
        : seats[0]?.cabinZone === area;
    if (areaMatch) matchScore += 40;
  }
  // Type start match
  if (typePref !== 'any' && startsType === typePref) matchScore += 30;
  else if (typePref !== 'any' && seats.some(s => s.seatType === typePref)) matchScore += 15;
  // Same row bonus
  if (sameRow) matchScore += 20;
  // Lower row in section = earlier = better (small bonus, max 10)
  matchScore += Math.max(0, 10 - Math.floor(firstRow / 5));
  // Price penalty
  matchScore -= Math.min(totalPrice * 0.05, 15);
  matchScore = Math.round(matchScore);

  // Reason
  const parts: string[] = [];
  parts.push(ZONE_LABEL_MAP[cabinZone]);
  parts.push(`Starts at ${TYPE_LABEL_MAP[startsType]}`);
  if (sameRow) parts.push('Same row');
  else parts.push(`Rows ${rows.join(', ')}`);

  return {
    blockId,
    seats,
    rowNumbers: rows,
    totalPrice,
    currency,
    cabinZoneSummary: ZONE_LABEL_MAP[cabinZone],
    restroomZoneSummary: RESTROOM_LABEL_MAP[restroom] || '',
    startsWithSeatType: TYPE_LABEL_MAP[startsType],
    sameRow,
    matchScore,
    reason: parts.join(' · '),
  };
}

// ─── Same-row block finder ──────────────────────────────────────────────────

function findSameRowBlocks(
  available: ClassifiedSeat[],
  count: number,
  area: AreaPreference,
  typePref: SeatTypeClass | 'any',
): GroupSeatBlock[] {
  // Group by row, sorted by row number ascending (earliest rows first)
  const byRow = new Map<number, ClassifiedSeat[]>();
  for (const seat of available) {
    if (!byRow.has(seat.rowNumber)) byRow.set(seat.rowNumber, []);
    byRow.get(seat.rowNumber)!.push(seat);
  }
  const sortedRows = [...byRow.keys()].sort((a, b) => a - b);

  const blocks: GroupSeatBlock[] = [];

  for (const rowNum of sortedRows) {
    const rowSeats = byRow.get(rowNum)!;
    if (rowSeats.length < count) continue;

    const runs = findConsecutiveRuns(rowSeats, count);
    for (const run of runs) {
      const startIdx = bestStartInRun(run, count, typePref);
      const group = run.slice(startIdx, startIdx + count);
      if (group.length !== count) continue;

      // When a specific seat type is requested, only include blocks
      // where the first seat actually matches that type.
      // This ensures "Front + Aisle" only returns blocks starting at an aisle seat.
      if (typePref !== 'any' && group[0].seatType !== typePref) continue;

      blocks.push(makeBlock(group, area, typePref));
    }
  }

  return blocks;
}

// ─── Split-row block finder (fallback 4) ─────────────────────────────────────

function findSplitRowBlocks(
  available: ClassifiedSeat[],
  count: number,
  area: AreaPreference,
  typePref: SeatTypeClass | 'any',
): GroupSeatBlock[] {
  // Group by row
  const byRow = new Map<number, ClassifiedSeat[]>();
  for (const seat of available) {
    if (!byRow.has(seat.rowNumber)) byRow.set(seat.rowNumber, []);
    byRow.get(seat.rowNumber)!.push(seat);
  }
  const sortedRows = [...byRow.keys()].sort((a, b) => a - b);

  const blocks: GroupSeatBlock[] = [];

  // Try adjacent row pairs
  for (let i = 0; i < sortedRows.length - 1; i++) {
    const row1 = sortedRows[i];
    const row2 = sortedRows[i + 1];
    // Only consider truly adjacent rows (distance 1-2)
    if (row2 - row1 > 2) continue;

    const seats1 = byRow.get(row1)!.sort((a, b) => a.column.localeCompare(b.column));
    const seats2 = byRow.get(row2)!.sort((a, b) => a.column.localeCompare(b.column));

    // Try splitting: take some from row1, rest from row2
    for (let splitAt = 1; splitAt < count; splitAt++) {
      const need1 = splitAt;
      const need2 = count - splitAt;

      // Find consecutive runs in each row
      const runs1 = findConsecutiveRuns(seats1, need1);
      const runs2 = findConsecutiveRuns(seats2, need2);

      if (runs1.length > 0 && runs2.length > 0) {
        const group1 = runs1[0].slice(0, need1);
        const group2 = runs2[0].slice(0, need2);
        const combined = [...group1, ...group2];
        if (combined.length === count) {
          const block = makeBlock(combined, area, typePref);
          block.matchScore -= 20; // penalty for split row
          blocks.push(block);
        }
      }
    }
  }

  return blocks;
}

// ─── Main entry: findConsecutiveGroupSeatBlocks ──────────────────────────────

export interface GroupSeatFinderInput {
  classifiedSeats: ClassifiedSeat[];
  passengerCount: number;
  areaPreference: AreaPreference;
  seatTypePreference: SeatTypeClass | 'any';
  maxOptions?: number;
}

export interface GroupSeatFinderResult {
  blocks: GroupSeatBlock[];
  totalAvailable: number;
  fallbackLevel: number;
  fallbackReason?: string;
}

export function findConsecutiveGroupSeatBlocks({
  classifiedSeats,
  passengerCount,
  areaPreference,
  seatTypePreference,
  maxOptions = 5,
}: GroupSeatFinderInput): GroupSeatFinderResult {
  const allAvailable = classifiedSeats.filter(s => s.available);
  const totalAvailable = allAvailable.length;

  if (totalAvailable < passengerCount) {
    return { blocks: [], totalAvailable, fallbackLevel: 5, fallbackReason: 'Not enough seats available' };
  }

  // ── Fallback 0: Exact — section + seat type ──────────────────────────────
  const filtered0 = filterByArea(allAvailable, areaPreference);
  const blocks0 = findSameRowBlocks(filtered0, passengerCount, areaPreference, seatTypePreference);
  if (blocks0.length > 0) {
    blocks0.sort((a, b) => b.matchScore - a.matchScore);
    return { blocks: blocks0.slice(0, maxOptions), totalAvailable, fallbackLevel: 0 };
  }

  // ── Fallback 1: Keep section, relax seat type ────────────────────────────
  const blocks1 = findSameRowBlocks(filtered0, passengerCount, areaPreference, 'any');
  if (blocks1.length > 0) {
    blocks1.sort((a, b) => b.matchScore - a.matchScore);
    return {
      blocks: blocks1.slice(0, maxOptions),
      totalAvailable,
      fallbackLevel: 1,
      fallbackReason: 'Relaxed seat type — showing best available in your preferred section',
    };
  }

  // ── Fallback 2: Keep seat type, relax section ───────────────────────────
  const blocks2 = findSameRowBlocks(allAvailable, passengerCount, 'any', seatTypePreference);
  if (blocks2.length > 0) {
    blocks2.sort((a, b) => b.matchScore - a.matchScore);
    return {
      blocks: blocks2.slice(0, maxOptions),
      totalAvailable,
      fallbackLevel: 2,
      fallbackReason: 'Preferred section unavailable — showing other sections',
    };
  }

  // ── Fallback 3: Any same-row consecutive block ──────────────────────────
  const blocks3 = findSameRowBlocks(allAvailable, passengerCount, 'any', 'any');
  if (blocks3.length > 0) {
    blocks3.sort((a, b) => b.matchScore - a.matchScore);
    return {
      blocks: blocks3.slice(0, maxOptions),
      totalAvailable,
      fallbackLevel: 3,
      fallbackReason: 'Showing closest available same-row group options',
    };
  }

  // ── Fallback 4: Split across adjacent rows ──────────────────────────────
  const blocks4 = findSplitRowBlocks(allAvailable, passengerCount, 'any', 'any');
  if (blocks4.length > 0) {
    blocks4.sort((a, b) => b.matchScore - a.matchScore);
    return {
      blocks: blocks4.slice(0, maxOptions),
      totalAvailable,
      fallbackLevel: 4,
      fallbackReason: 'No same-row block available — seats split across nearby rows',
    };
  }

  // ── Fallback 5: Cannot group — switch to individual selection ───────────
  return {
    blocks: [],
    totalAvailable,
    fallbackLevel: 5,
    fallbackReason: 'Could not find enough consecutive seats for your full group',
  };
}
