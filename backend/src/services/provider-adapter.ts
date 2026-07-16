/**
 * Provider Abstraction Layer — Post-Booking Management
 *
 * Normalizes provider-specific APIs (Duffel, future Amadeus/Sabre)
 * into a unified interface for all post-booking operations.
 *
 * Usage:
 *   const provider = getProvider('duffel');
 *   const quote = await provider.getCancellationQuote(orderId);
 */

import * as duffelClient from './duffel';
import type { DuffelOrder, DuffelCancellation } from './duffel';

// ═══════════════════════════════════════════════
// Unified Types (Provider-Agnostic)
// ═══════════════════════════════════════════════

export interface OrderDetails {
  orderId: string;
  bookingReference: string;
  status: string;
  totalAmount: number;
  currency: string;
  passengers: OrderPassenger[];
  slices: OrderSlice[];
  conditions: {
    refundable: boolean;
    changeable: boolean;
    refundPenalty?: number;
    changePenalty?: number;
    penaltyCurrency?: string;
  };
  createdAt: string;
  capabilities: {
    addBaggageAllowed: boolean;
  };
  raw: unknown;
}

export interface OrderPassenger {
  id: string;
  type: string;
  givenName?: string;
  familyName?: string;
}

export interface OrderSlice {
  id: string;
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  duration: string;
  segments: OrderSegment[];
}

export interface OrderSegment {
  id: string;
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  duration: string;
  flightNumber: string;
  airlineCode: string;
  airlineName: string;
  aircraft?: string;
  cabin?: string;
}

export interface CancelQuote {
  quoteId: string;
  orderId: string;
  refundAmount: number;
  refundCurrency: string;
  refundTo: string;
  penaltyAmount: number;
  expiresAt: string;
  raw: unknown;
}

export interface CancelResult {
  cancellationId: string;
  orderId: string;
  refundAmount: number;
  refundCurrency: string;
  confirmedAt: string;
  raw: unknown;
}

export interface SeatMapRow {
  row: number;
  seats: SeatMapSeat[];
}

export interface SeatMapSeat {
  designator: string;
  available: boolean;
  type: 'window' | 'middle' | 'aisle' | 'unknown';
  price: number;
  currency: string;
  cabinClass: string;
  isExitRow: boolean;
  hasExtraLegroom: boolean;
  serviceId?: string;
}

export interface SeatMapData {
  sliceId: string;
  segmentId: string;
  cabin: string;
  rows: SeatMapRow[];
}

export interface ChangeQuote {
  quoteId: string;
  orderId: string;
  fareChange: number;
  changePenalty: number;
  taxDifference: number;
  totalDelta: number;
  currency: string;
  newSlices: OrderSlice[];
  expiresAt: string;
  raw: unknown;
}

export interface ChangeResult {
  changeId: string;
  orderId: string;
  newBookingReference?: string;
  totalCharged: number;
  currency: string;
  confirmedAt: string;
  raw: unknown;
}

export interface PassengerUpdateResult {
  success: boolean;
  passengerId: string;
  updatedFields: Record<string, string>;
  raw: unknown;
}

// ═══════════════════════════════════════════════
// Provider Interface
// ═══════════════════════════════════════════════

export interface IBookingProvider {
  readonly name: string;

  /** Retrieve full order details */
  getOrder(orderId: string): Promise<OrderDetails>;

  /** Get cancellation refund quote (does NOT execute) */
  getCancellationQuote(orderId: string): Promise<CancelQuote>;

  /** Confirm and execute cancellation */
  confirmCancellation(quoteId: string): Promise<CancelResult>;

  /** Get seat map for a specific segment */
  getSeatMap(offerId: string, sliceId?: string): Promise<SeatMapData[]>;

  /** Update passenger information */
  updatePassenger(
    orderId: string,
    passengerId: string,
    updates: Record<string, string>
  ): Promise<PassengerUpdateResult>;

  // ── Capability checks ─────────────────────────

  /** Whether this provider supports automated post-booking seat selection */
  supportsSeatSelection(): boolean;

  /** Whether this provider supports automated order changes (flight/date) */
  supportsOrderChanges(): boolean;

  // ── Order changes (flight/date modifications) ──

  /** Search for change options (alternative flights) */
  searchChangeOptions(
    orderId: string,
    slicesToRemove: { slice_id: string }[],
    slicesToAdd: { origin: string; destination: string; departure_date: string; cabin_class?: string }[]
  ): Promise<{
    requestId: string;
    offers: {
      id: string;
      changeTotalAmount: number;
      changeTotalCurrency: string;
      penaltyAmount: number;
      penaltyCurrency: string;
      newTotalAmount: number;
      newTotalCurrency: string;
      expiresAt: string;
      slices: { add: any[]; remove: any[] };
      conditions: any;
    }[];
    raw: unknown;
  }>;

  /** Confirm a specific change offer */
  confirmChangeOption(
    changeOfferId: string,
    paymentAmount?: number,
    paymentCurrency?: string
  ): Promise<{
    changeId: string;
    orderId: string;
    newTotalAmount: number;
    newTotalCurrency: string;
    confirmedAt: string;
    raw: unknown;
  }>;
}

// ═══════════════════════════════════════════════
// Duffel Adapter
// ═══════════════════════════════════════════════

function normalizeDuffelOrder(order: DuffelOrder): OrderDetails {
  return {
    orderId: order.id,
    bookingReference: order.booking_reference,
    status: order.payment_status?.awaiting_payment ? 'awaiting_payment' : 'confirmed',
    totalAmount: parseFloat(order.total_amount),
    currency: order.total_currency,
    passengers: (order.passengers || []).map((p) => ({
      id: p.id,
      type: p.type,
      givenName: p.given_name,
      familyName: p.family_name,
    })),
    slices: (order.slices || []).map((s) => ({
      id: s.id,
      origin: s.origin.iata_code,
      destination: s.destination.iata_code,
      departureAt: s.segments[0]?.departing_at || '',
      arrivalAt: s.segments[s.segments.length - 1]?.arriving_at || '',
      duration: s.duration,
      segments: s.segments.map((seg) => ({
        id: seg.id,
        origin: seg.origin.iata_code,
        destination: seg.destination.iata_code,
        departureAt: seg.departing_at,
        arrivalAt: seg.arriving_at,
        duration: seg.duration,
        flightNumber: `${seg.marketing_carrier.iata_code}${seg.marketing_carrier_flight_number}`,
        airlineCode: seg.marketing_carrier.iata_code,
        airlineName: seg.marketing_carrier.name,
        aircraft: seg.aircraft?.name,
        cabin: seg.passengers?.[0]?.cabin_class,
      })),
    })),
    conditions: {
      refundable: order.conditions?.refund_before_departure?.allowed ?? false,
      changeable: order.conditions?.change_before_departure?.allowed ?? false,
      refundPenalty: order.conditions?.refund_before_departure?.penalty_amount
        ? parseFloat(order.conditions.refund_before_departure.penalty_amount)
        : undefined,
      changePenalty: order.conditions?.change_before_departure?.penalty_amount
        ? parseFloat(order.conditions.change_before_departure.penalty_amount)
        : undefined,
      penaltyCurrency: order.conditions?.refund_before_departure?.penalty_currency || undefined,
    },
    capabilities: {
      // For Duffel, we check available_services to see if baggage is an option.
      // Often return_available_services=false during fetch, so we default to false unless explicitly seen
      addBaggageAllowed: (order as any).available_services?.some((s: any) => s.type === 'baggage') ?? false,
    },
    createdAt: order.created_at,
    raw: order,
  };
}

export class DuffelAdapter implements IBookingProvider {
  readonly name = 'duffel';

  async getOrder(orderId: string): Promise<OrderDetails> {
    const order = await duffelClient.getOrder(orderId);
    return normalizeDuffelOrder(order);
  }

  async getCancellationQuote(orderId: string): Promise<CancelQuote> {
    const cancellation = await duffelClient.createCancellationQuote(orderId);
    const refundAmount = parseFloat(cancellation.refund_amount || '0');
    // Duffel returns the net refund already accounting for penalties
    return {
      quoteId: cancellation.id,
      orderId: cancellation.order_id,
      refundAmount,
      refundCurrency: cancellation.refund_currency,
      refundTo: cancellation.refund_to,
      penaltyAmount: 0, // Duffel bakes penalty into refund_amount
      expiresAt: cancellation.expires_at,
      raw: cancellation,
    };
  }

  async confirmCancellation(quoteId: string): Promise<CancelResult> {
    const confirmed = await duffelClient.confirmCancellation(quoteId);
    return {
      cancellationId: confirmed.id,
      orderId: confirmed.order_id,
      refundAmount: parseFloat(confirmed.refund_amount || '0'),
      refundCurrency: confirmed.refund_currency,
      confirmedAt: confirmed.confirmed_at || new Date().toISOString(),
      raw: confirmed,
    };
  }

  async getSeatMap(offerId: string): Promise<SeatMapData[]> {
    const seatMaps = await duffelClient.getSeatMaps(offerId);
    return seatMaps.map((sm: any) => ({
      sliceId: sm.slice_id || sm.id,
      segmentId: sm.segment_id || '',
      cabin: sm.cabins?.[0]?.cabin_class || 'economy',
      rows: (sm.cabins || []).flatMap((cabin: any) =>
        (cabin.rows || []).map((row: any, rowIdx: number) => ({
          row: rowIdx + 1,
          seats: (row.sections || []).flatMap((section: any) =>
            (section.elements || []).filter((el: any) => el.type === 'seat').map((seat: any) => {
              const seatType = seat.designator?.endsWith('A') || seat.designator?.endsWith('F') || seat.designator?.endsWith('K')
                ? 'window'
                : seat.designator?.endsWith('C') || seat.designator?.endsWith('D') || seat.designator?.endsWith('G') || seat.designator?.endsWith('H')
                ? 'aisle'
                : 'middle';
              return {
                designator: seat.designator,
                available: seat.available_services?.length > 0,
                type: seatType as SeatMapSeat['type'],
                price: seat.available_services?.[0]?.total_amount ? parseFloat(seat.available_services[0].total_amount) : 0,
                currency: seat.available_services?.[0]?.total_currency || 'USD',
                cabinClass: cabin.cabin_class || 'economy',
                isExitRow: seat.disclosures?.includes('exit_row') ?? false,
                hasExtraLegroom: seat.disclosures?.includes('extra_legroom') ?? false,
                serviceId: seat.available_services?.[0]?.id,
              };
            })
          ),
        }))
      ),
    }));
  }

  async updatePassenger(
    orderId: string,
    passengerId: string,
    updates: Record<string, string>
  ): Promise<PassengerUpdateResult> {
    // Duffel allows updating passenger details via PATCH /air/orders/:id
    const result = await duffelClient.updateOrderPassenger(orderId, passengerId, updates);
    return {
      success: true,
      passengerId,
      updatedFields: updates,
      raw: result,
    };
  }

  // ── Capability checks ─────────────────────────

  supportsSeatSelection(): boolean {
    // Duffel does NOT support post-booking seat changes via API.
    // Seats can only be selected at order creation time.
    return false;
  }

  supportsOrderChanges(): boolean {
    // Duffel FULLY supports order changes (flight/date modifications)
    // via order_change_requests → order_change_offers → order_changes
    return true;
  }

  // ── Order changes ─────────────────────────────

  async searchChangeOptions(
    orderId: string,
    slicesToRemove: { slice_id: string }[],
    slicesToAdd: { origin: string; destination: string; departure_date: string; cabin_class?: string }[]
  ) {
    const result = await duffelClient.createOrderChangeRequest(orderId, {
      remove: slicesToRemove,
      add: slicesToAdd,
    });

    return {
      requestId: result.id,
      offers: (result.order_change_offers || []).map(offer => ({
        id: offer.id,
        changeTotalAmount: parseFloat(offer.change_total_amount || '0'),
        changeTotalCurrency: offer.change_total_currency,
        penaltyAmount: parseFloat(offer.penalty_total_amount || '0'),
        penaltyCurrency: offer.penalty_total_currency,
        newTotalAmount: parseFloat(offer.new_total_amount || '0'),
        newTotalCurrency: offer.new_total_currency,
        expiresAt: offer.expires_at,
        slices: offer.slices,
        conditions: offer.conditions,
      })),
      raw: result,
    };
  }

  async confirmChangeOption(
    changeOfferId: string,
    paymentAmount?: number,
    paymentCurrency?: string
  ) {
    // Step 1: Create the order change (selects the offer)
    const change = await duffelClient.createOrderChange(
      changeOfferId,
      paymentAmount,
      paymentCurrency
    );

    // Step 2: Confirm the change (executes it)
    const confirmed = await duffelClient.confirmOrderChange(change.id);

    return {
      changeId: confirmed.id,
      orderId: confirmed.order_id,
      newTotalAmount: parseFloat(confirmed.new_total_amount || '0'),
      newTotalCurrency: confirmed.new_total_currency,
      confirmedAt: confirmed.confirmed_at || new Date().toISOString(),
      raw: confirmed,
    };
  }
}

// ═══════════════════════════════════════════════
// Mystifly Adapter
// ═══════════════════════════════════════════════

import * as mystiflyClient from './mystifly';

export class MystiflyAdapter implements IBookingProvider {
  readonly name = 'mystifly';

  async getOrder(mfRef: string): Promise<OrderDetails> {
    const tripDetails = await mystiflyClient.getTripDetails(mfRef);
    const data = tripDetails?.Data || tripDetails;

    // Normalize Mystifly trip details to OrderDetails
    const segments: OrderSegment[] = [];
    const slices: OrderSlice[] = [];

    const flightSegments = data?.FlightSegments || data?.flightSegments || [];
    for (const seg of flightSegments) {
      segments.push({
        id: String(seg.SegmentId || seg.segmentId || ''),
        origin: seg.DepartureAirport || seg.departureAirport || '',
        destination: seg.ArrivalAirport || seg.arrivalAirport || '',
        departureAt: seg.DepartureDateTime || seg.departureDateTime || '',
        arrivalAt: seg.ArrivalDateTime || seg.arrivalDateTime || '',
        duration: '',
        flightNumber: `${seg.AirlineCode || ''} ${seg.FlightNumber || ''}`.trim(),
        airlineCode: seg.AirlineCode || seg.airlineCode || '',
        airlineName: seg.AirlineCode || '',
        aircraft: seg.Equipment || undefined,
        cabin: seg.CabinClass || seg.cabinClass || undefined,
      });
    }

    if (segments.length > 0) {
      slices.push({
        id: 'slice_0',
        origin: segments[0].origin,
        destination: segments[segments.length - 1].destination,
        departureAt: segments[0].departureAt,
        arrivalAt: segments[segments.length - 1].arrivalAt,
        duration: '',
        segments,
      });
    }

    const totalAmount = parseFloat(data?.TotalFare || data?.totalFare || '0');

    return {
      orderId: mfRef,
      bookingReference: data?.AirlinePNR || data?.airlinePNR || mfRef,
      status: data?.BookingStatus || data?.bookingStatus || 'confirmed',
      totalAmount,
      currency: data?.Currency || data?.currency || 'USD',
      passengers: (data?.Passengers || data?.passengers || []).map((p: any) => ({
        id: String(p.PaxId || p.paxId || ''),
        type: p.PassengerType || p.passengerType || 'ADT',
        givenName: p.FirstName || p.firstName || undefined,
        familyName: p.LastName || p.lastName || undefined,
      })),
      slices,
      conditions: {
        refundable: data?.IsRefundable ?? false,
        changeable: true,
      },
      capabilities: {
        addBaggageAllowed: false, // Mystifly Post-booking baggage addition not currently supported in adapter
      },
      createdAt: data?.BookingDate || data?.bookingDate || new Date().toISOString(),
      raw: tripDetails,
    };
  }

  async getCancellationQuote(mfRef: string): Promise<CancelQuote> {
    // Mystifly doesn't have a separate cancel-quote API.
    // We return a synthetic quote; the actual cancellation happens in confirmCancellation.
    const order = await this.getOrder(mfRef);
    const isRefundable = order.conditions?.refundable ?? false;
    const refundAmount = isRefundable ? order.totalAmount : 0;
    const penaltyAmount = isRefundable ? 0 : order.totalAmount;

    return {
      quoteId: `mystifly_cancel_quote_${mfRef}`,
      orderId: mfRef,
      refundAmount, // Estimated — actual refund depends on fare rules
      refundCurrency: order.currency,
      refundTo: 'original_payment',
      penaltyAmount,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min synthetic expiry
      raw: { note: 'Mystifly does not provide cancellation quotes. This is an estimated refund.' },
    };
  }

  async confirmCancellation(quoteId: string): Promise<CancelResult> {
    // The quoteId is our synthetic ID: "mystifly_cancel_quote_MF35335226"
    // Extract the actual MFRef (UniqueID) that Mystifly's Cancel API expects.
    const mfRef = quoteId.replace(/^mystifly_cancel_quote_/, '');
    if (!mfRef || mfRef === quoteId) {
      throw new Error(`[MystiflyAdapter] Could not extract MFRef from quoteId: ${quoteId}`);
    }

    const result = await mystiflyClient.cancelBooking(mfRef);
    const success = result?.Data?.Success || result?.Success;

    if (!success) {
      const errorMsg = result?.Data?.Errors?.[0]?.Message || result?.Message || 'Unknown error';
      const errorCode = result?.Data?.Errors?.[0]?.Code || '';
      throw new Error(`Mystifly cancellation failed: ${errorCode} ${errorMsg}`);
    }

    return {
      cancellationId: `mystifly_cancel_${mfRef}_${Date.now()}`,
      orderId: mfRef,
      refundAmount: 0, // Mystifly returns refund info asynchronously
      refundCurrency: 'USD',
      confirmedAt: success ? new Date().toISOString() : '',
      raw: result,
    };
  }

  async getSeatMap(fareSourceCode: string): Promise<SeatMapData[]> {
    const result = await mystiflyClient.getSeatMap(fareSourceCode);
    if (!result) return [];

    // Mystifly seat map response normalization
    const seatMaps: SeatMapData[] = [];
    const data = result?.Data || result;
    const cabins = data?.SeatMapResponses || data?.seatMapResponses || [];

    for (const cabin of cabins) {
      const rows: SeatMapRow[] = [];
      const seatRows = cabin?.Rows || cabin?.rows || [];

      for (const row of seatRows) {
        const seats: SeatMapSeat[] = [];
        const seatList = row?.Seats || row?.seats || [];

        for (const seat of seatList) {
          seats.push({
            designator: seat.SeatNumber || seat.seatNumber || '',
            available: seat.IsAvailable ?? seat.isAvailable ?? true,
            type: 'unknown',
            price: parseFloat(seat.Price || seat.price || '0'),
            currency: seat.Currency || seat.currency || 'USD',
            cabinClass: cabin.CabinClass || cabin.cabinClass || 'economy',
            isExitRow: seat.IsExitRow ?? seat.isExitRow ?? false,
            hasExtraLegroom: seat.HasExtraLegroom ?? seat.hasExtraLegroom ?? false,
            serviceId: seat.SeatSelectionKey || seat.seatSelectionKey || undefined,
          });
        }

        rows.push({ row: row.RowNumber || row.rowNumber || 0, seats });
      }

      seatMaps.push({
        sliceId: cabin.SegmentId || cabin.segmentId || '',
        segmentId: cabin.SegmentId || cabin.segmentId || '',
        cabin: cabin.CabinClass || cabin.cabinClass || 'economy',
        rows,
      });
    }

    return seatMaps;
  }

  async updatePassenger(
    mfRef: string,
    _passengerId: string,
    updates: Record<string, string>
  ): Promise<PassengerUpdateResult> {
    // Mystifly uses the NameCorrection API for passenger updates
    // This is a simplified implementation — full impl would map fields properly
    return {
      success: false,
      passengerId: _passengerId,
      updatedFields: updates,
      raw: { note: 'Mystifly passenger updates require NameCorrectionRequest API — not yet fully implemented' },
    };
  }

  // ── Capability checks ─────────────────────────

  supportsSeatSelection(): boolean {
    return true; // Mystifly supports seat maps via SeatMap API
  }

  supportsOrderChanges(): boolean {
    return false; // Mystifly post-ticketing changes use PTR flow (complex, phase 2)
  }

  // ── Order changes (not supported yet) ─────────

  async searchChangeOptions(
    _orderId: string,
    _slicesToRemove: { slice_id: string }[],
    _slicesToAdd: { origin: string; destination: string; departure_date: string; cabin_class?: string }[]
  ): Promise<{ requestId: string; offers: any[]; raw: unknown }> {
    throw new Error('Mystifly order changes are not yet supported. Use PostTicketingRequest flow.');
  }

  async confirmChangeOption(
    _changeOfferId: string,
    _paymentAmount?: number,
    _paymentCurrency?: string
  ): Promise<{ changeId: string; orderId: string; newTotalAmount: number; newTotalCurrency: string; confirmedAt: string; raw: unknown }> {
    throw new Error('Mystifly order changes are not yet supported. Use PostTicketingRequest flow.');
  }
}

// ═══════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════

const providers: Record<string, IBookingProvider> = {
  duffel: new DuffelAdapter(),
  mystifly: new MystiflyAdapter(),
};

/**
 * Get a provider adapter by name.
 * Falls back to Duffel if the provider is unknown.
 */
export function getProvider(providerName: string = 'duffel'): IBookingProvider {
  const key = providerName.toLowerCase();
  return providers[key] || providers.duffel;
}
