// ── Seat map types shared between API route and frontend ──────────────────────

export type SeatElementType =
  | 'seat'
  | 'empty'
  | 'lavatory'
  | 'galley'
  | 'stairs'
  | 'bassinet';

export interface SeatElement {
  type: SeatElementType;
  designator: string | null;   // e.g. "12A" — null for non-seat elements
  available: boolean;
  price: number;               // 0 = free, >0 = paid
  currency: string;
  serviceId: string | null;    // Duffel service ID (first passenger), needed when placing order
  /** All per-passenger Duffel service IDs for this seat.
   *  Index matches the offer's passenger order. For 2-pax offers:
   *  serviceIds[0] = passenger 0's service, serviceIds[1] = passenger 1's service.
   *  Falls back to [serviceId] when only one service is available. */
  serviceIds: string[];
  disclosures: string[];       // e.g. ["window", "extra_legroom", "exit_row"]
}

export interface SeatSection {
  elements: SeatElement[];
}

export interface SeatRow {
  rowNumber: string;           // "10", "11", etc.
  sections: SeatSection[];     // column groups separated by aisles
  isExitRow: boolean;
}

export interface SeatCabin {
  cabinClass: string;
  rows: SeatRow[];
  columnHeaders: string[][];   // per-section column letters: [['A','B','C'], ['D','E','F']]
}

export interface SegmentSeatMap {
  seatMapId: string;
  segmentId: string;
  sliceId: string;
  cabins: SeatCabin[];
}

// ── Frontend assignment model ─────────────────────────────────────────────────

export interface SeatAssignment {
  designator: string;
  passengerIndex: number;
  price: number;
  currency: string;
  serviceId: string | null;
}
