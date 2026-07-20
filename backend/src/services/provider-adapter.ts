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
  /** Which cancellation path: VOID (within void window), REFUND (standard refund), or CANCEL (direct cancel, no refund) */
  method: 'VOID' | 'REFUND' | 'CANCEL' | 'UNKNOWN';
  /** Airline-imposed cancellation penalty */
  airlinePenalty: number;
  /** Supplier/aggregator fee */
  supplierFee: number;
  /** Original booking amount */
  originalAmount: number;
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

export interface CancelQuoteOptions {
  /** The booking's ticketing status — used to skip PTR for unticketed bookings */
  ticketingStatus?: string;
  /** The booking's total amount from DB — fallback when provider API doesn't return fare data */
  bookingAmount?: number;
}

export interface NormalizedProviderRefundStatus {
  status: 'PENDING' | 'PROCESSING' | 'SETTLED' | 'REJECTED' | 'FAILED' | 'UNKNOWN';
  providerRefundId?: string;
  settlementReference?: string;
  reimbursedAmount?: number;
  currency?: string;
  settledAt?: string;
  rawStatus?: string;
  rawResponse: unknown;
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
  getCancellationQuote(orderId: string, options?: CancelQuoteOptions): Promise<CancelQuote>;

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
    slicesToAdd: { origin: string; destination: string; departure_date: string; cabin_class?: string }[],
    bookingPassengers?: { firstName: string; lastName: string; type?: string; eTicket?: string }[]
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

  // ── Reimbursement monitoring ────────────────────

  /** Check provider refund/settlement status for reimbursement tracking */
  getProviderRefundStatus(
    refundRequestId: string,
    orderId: string,
  ): Promise<NormalizedProviderRefundStatus>;
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

  async getCancellationQuote(orderId: string, _options?: CancelQuoteOptions): Promise<CancelQuote> {
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
      method: 'REFUND', // Duffel uses a unified refund flow (no separate void)
      airlinePenalty: 0,
      supplierFee: 0,
      originalAmount: 0, // Not available from Duffel quote — calculated in route
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
    slicesToAdd: { origin: string; destination: string; departure_date: string; cabin_class?: string }[],
    _bookingPassengers?: { firstName: string; lastName: string; type?: string; eTicket?: string }[]
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

  // ── Reimbursement monitoring ─────────────────────────────────────────

  async getProviderRefundStatus(
    refundRequestId: string,
    orderId: string,
  ): Promise<NormalizedProviderRefundStatus> {
    // Duffel: check order cancellation/refund status
    // For now, Duffel handles settlement internally — treat all completed cancellations as settled
    try {
      const order = await duffelClient.getOrder(orderId);
      const rawStatus = (order as any)?.payment_status?.refund_status || 'unknown';

      let status: NormalizedProviderRefundStatus['status'] = 'UNKNOWN';
      if (rawStatus === 'refunded' || rawStatus === 'settled') status = 'SETTLED';
      else if (rawStatus === 'pending') status = 'PENDING';
      else if (rawStatus === 'processing') status = 'PROCESSING';
      else if (rawStatus === 'failed') status = 'FAILED';
      else if (rawStatus === 'rejected') status = 'REJECTED';

      return {
        status,
        rawStatus,
        providerRefundId: orderId,
        rawResponse: order,
      };
    } catch (err) {
      return {
        status: 'UNKNOWN',
        rawStatus: 'error',
        rawResponse: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }
}

// ═══════════════════════════════════════════════
// Mystifly Adapter
// ═══════════════════════════════════════════════

import * as mystiflyClient from './mystifly';
import type { MystiflyReissueOriginDestination, MystiflyReissuePassenger } from './mystifly';
import { MystiflyCancellationError } from '../providers/mystifly/mystifly.errors';

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

  async getCancellationQuote(mfRef: string, options?: CancelQuoteOptions): Promise<CancelQuote> {
    // ── Step 1: Get order details for original amount ──
    const order = await this.getOrder(mfRef);
    const originalAmount = order.totalAmount || options?.bookingAmount || 0;
    const currency = order.currency;

    // ── Step 1b: If booking was never ticketed, skip PTR entirely ──
    // VoidQuote/RefundQuote are Post-TICKETING Requests — they only work
    // on ticketed bookings. Unticketed bookings use direct cancel.
    // Since no ticket was ever issued, customer gets a FULL refund — no
    // airline penalty applies (the airline was never paid).
    const ticketingStatus = options?.ticketingStatus;
    if (ticketingStatus && ticketingStatus === 'NOT_STARTED') {
      console.info(`[MystiflyAdapter] Booking ${mfRef} not ticketed (${ticketingStatus}), full refund — no ticket issued`);
      return {
        quoteId: `mystifly_void_unticketed_${mfRef}`,
        orderId: mfRef,
        refundAmount: originalAmount,
        refundCurrency: currency,
        refundTo: 'original_payment',
        penaltyAmount: 0,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        method: 'VOID',
        airlinePenalty: 0,
        supplierFee: 0,
        originalAmount,
        raw: { directCancel: true, reason: 'unticketed_booking', fullRefund: true },
      };
    }

    // ── Step 2: Try VoidQuote first (within void window) ──
    try {
      const voidResult = await mystiflyClient.voidQuote(mfRef);
      const voidData = voidResult?.Data || voidResult;
      const voidSuccess = voidData?.Success ?? voidResult?.Success;
      const ptrId = voidData?.PtrId || voidData?.ptrId || voidResult?.PtrId;
      const voidErrors = voidData?.Errors || voidResult?.Errors || [];

      // Check for business-level "not eligible" vs technical failure
      const isNotEligible = !voidSuccess && voidErrors.some((e: any) =>
        (e.Code || e.code || '').toString().match(/void.*not.*eligible|void.*window|not.*voidable/i) ||
        (e.Message || e.message || '').match(/void.*not.*eligible|void.*window|not.*voidable|cannot.*void/i)
      );

      if (voidSuccess && ptrId) {
        // Void IS eligible — extract fee info
        const voidPenalty = parseFloat(voidData?.Penalty || voidData?.penalty || '0');
        const supplierFee = parseFloat(voidData?.SupplierFee || voidData?.supplierFee || '0');
        const totalDeductions = voidPenalty + supplierFee;
        const refundAmount = Math.max(0, originalAmount - totalDeductions);

        return {
          quoteId: `mystifly_void_${mfRef}_${ptrId}`,
          orderId: mfRef,
          refundAmount,
          refundCurrency: currency,
          refundTo: 'original_payment',
          penaltyAmount: totalDeductions,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min — void window can expire
          method: 'VOID',
          airlinePenalty: voidPenalty,
          supplierFee,
          originalAmount,
          raw: voidResult,
        };
      }

      // If not eligible for void, fall through to refund
      if (!isNotEligible && !voidSuccess) {
        // Technical failure — log but still try refund
        console.warn(`[MystiflyAdapter] VoidQuote returned non-eligible response, trying RefundQuote`, voidErrors);
      }
    } catch (voidErr) {
      // VoidQuote API call failed — classify and log, then fall through to RefundQuote
      const classified = MystiflyCancellationError.from(voidErr, 'VoidQuote');
      console.warn(`[MystiflyAdapter] VoidQuote API error for ${mfRef} (${classified.errorType}), falling back to RefundQuote:`, classified.message);

      // If it's a PNR-level problem (not found, already cancelled), don't bother trying refund
      if (classified.errorType === 'INVALID_PNR' || classified.errorType === 'ALREADY_CANCELLED') {
        throw classified;
      }
    }

    // ── Step 3: VoidQuote not eligible or failed → try RefundQuote ──
    let refundResult;
    try {
      refundResult = await mystiflyClient.refundQuote(mfRef);
    } catch (refundErr) {
      // RefundQuote API crashed (e.g. Mystifly 500 bug on certain bookings)
      // Fall back to direct cancel path
      const classified = MystiflyCancellationError.from(refundErr, 'RefundQuote');
      console.warn(`[MystiflyAdapter] RefundQuote API crashed for ${mfRef} (${classified.errorType}), falling back to direct cancel:`, classified.message);

      if (classified.errorType === 'TRANSIENT' || classified.errorType === 'UNKNOWN') {
        return {
          quoteId: `mystifly_cancel_norefund_${mfRef}`,
          orderId: mfRef,
          refundAmount: 0,
          refundCurrency: currency,
          refundTo: 'original_payment',
          penaltyAmount: originalAmount,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          method: 'CANCEL',
          airlinePenalty: originalAmount,
          supplierFee: 0,
          originalAmount,
          raw: { directCancel: true, reason: 'refund_quote_failed', error: classified.message },
        };
      }
      throw classified;
    }

    const refundData = refundResult?.Data || refundResult;
    const refundSuccess = refundData?.Success ?? refundResult?.Success;
    const refundPtrId = refundData?.PtrId || refundData?.ptrId || refundResult?.PtrId;
    const refundErrors = refundData?.Errors || refundResult?.Errors || [];
    const refundMsg = refundResult?.Message || refundData?.Message || '';

    // Check for Mystifly 500 passed through in the JSON body (HTTP 200 but internal error in Message)
    const is500InBody = /\(500\)|Internal Server Error/i.test(refundMsg);

    if (is500InBody || (!refundSuccess && !refundPtrId)) {
      // If it's a Mystifly internal 500 error, fall back to direct cancel
      if (is500InBody) {
        console.warn(`[MystiflyAdapter] RefundQuote returned 500-in-body for ${mfRef}, falling back to direct cancel`);
        return {
          quoteId: `mystifly_cancel_norefund_${mfRef}`,
          orderId: mfRef,
          refundAmount: 0,
          refundCurrency: currency,
          refundTo: 'original_payment',
          penaltyAmount: originalAmount,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          method: 'CANCEL',
          airlinePenalty: originalAmount,
          supplierFee: 0,
          originalAmount,
          raw: { directCancel: true, reason: 'refund_quote_500', originalMessage: refundMsg },
        };
      }

      const errMsg = refundMsg || refundErrors?.[0]?.Message || refundErrors?.[0]?.message || 'Cancellation not available';
      const errCode = refundErrors?.[0]?.Code || refundErrors?.[0]?.code || undefined;
      throw new MystiflyCancellationError(`Mystifly cancellation not available: ${errMsg}`, {
        providerErrorCode: errCode,
        rawResponse: refundResult,
      });
    }

    // Extract refund breakdown from PTR response
    const airlinePenalty = parseFloat(refundData?.Penalty || refundData?.penalty || refundData?.CancellationCharge || '0');
    const supplierFee = parseFloat(refundData?.SupplierFee || refundData?.supplierFee || '0');
    const providerRefundAmount = parseFloat(refundData?.RefundAmount || refundData?.refundAmount || '0');
    const totalDeductions = airlinePenalty + supplierFee;
    // Use provider-returned refund amount if available, otherwise calculate
    const refundAmount = providerRefundAmount > 0 ? providerRefundAmount : Math.max(0, originalAmount - totalDeductions);

    return {
      quoteId: `mystifly_refund_${mfRef}_${refundPtrId}`,
      orderId: mfRef,
      refundAmount,
      refundCurrency: currency,
      refundTo: 'original_payment',
      penaltyAmount: totalDeductions,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
      method: 'REFUND',
      airlinePenalty,
      supplierFee,
      originalAmount,
      raw: refundResult,
    };
  }

  async confirmCancellation(quoteId: string): Promise<CancelResult> {
    // quoteId format: "mystifly_void_{mfRef}_{ptrId}" or "mystifly_refund_{mfRef}_{ptrId}"
    const voidMatch = quoteId.match(/^mystifly_void_(.+)_(\d+)$/);
    const refundMatch = quoteId.match(/^mystifly_refund_(.+)_(\d+)$/);

    if (voidMatch) {
      // ── Execute Void ──
      const [, mfRef, ptrIdStr] = voidMatch;
      const ptrId = parseInt(ptrIdStr, 10);

      const result = await mystiflyClient.executeVoid(mfRef, ptrId);
      const data = result?.Data || result;
      const success = data?.Success ?? result?.Success;

      if (!success) {
        const errorMsg = data?.Errors?.[0]?.Message || result?.Message || 'Void execution failed';
        const errorCode = data?.Errors?.[0]?.Code || '';
        throw new MystiflyCancellationError(`Mystifly void failed: ${errorCode} ${errorMsg}`, {
          providerErrorCode: errorCode,
          rawResponse: result,
        });
      }

      return {
        cancellationId: `mystifly_void_confirmed_${mfRef}_${ptrId}`,
        orderId: mfRef,
        refundAmount: parseFloat(data?.RefundAmount || '0'),
        refundCurrency: data?.Currency || 'USD',
        confirmedAt: new Date().toISOString(),
        raw: result,
      };
    }

    if (refundMatch) {
      // ── Execute Refund ──
      const [, mfRef, ptrIdStr] = refundMatch;
      const ptrId = parseInt(ptrIdStr, 10);

      const result = await mystiflyClient.executeRefund(mfRef, ptrId);
      const data = result?.Data || result;
      const success = data?.Success ?? result?.Success;

      if (!success) {
        const errorMsg = data?.Errors?.[0]?.Message || result?.Message || 'Refund execution failed';
        const errorCode = data?.Errors?.[0]?.Code || '';
        throw new MystiflyCancellationError(`Mystifly refund failed: ${errorCode} ${errorMsg}`, {
          providerErrorCode: errorCode,
          rawResponse: result,
        });
      }

      return {
        cancellationId: `mystifly_refund_confirmed_${mfRef}_${ptrId}`,
        orderId: mfRef,
        refundAmount: parseFloat(data?.RefundAmount || data?.refundAmount || '0'),
        refundCurrency: data?.Currency || data?.currency || 'USD',
        confirmedAt: new Date().toISOString(),
        raw: result,
      };
    }

    // ── Cancel Anyway (non-refundable): try Void PTR → fallback to direct cancel ──
    // quoteId format: "mystifly_cancel_norefund_{mfRef}"
    const noRefundMatch = quoteId.match(/^mystifly_cancel_norefund_(.+)$/);
    if (noRefundMatch) {
      const [, mfRef] = noRefundMatch;

      // Step 1: Try Void PTR
      try {
        const voidQuoteResult = await mystiflyClient.voidQuote(mfRef);
        const voidData = voidQuoteResult?.Data || voidQuoteResult;
        const voidSuccess = voidData?.Success ?? voidQuoteResult?.Success;
        const voidPtrId = voidData?.PtrId || voidData?.ptrId || voidQuoteResult?.PtrId;

        if (voidSuccess && voidPtrId) {
          const execResult = await mystiflyClient.executeVoid(mfRef, voidPtrId);
          const execData = execResult?.Data || execResult;
          const execSuccess = execData?.Success ?? execResult?.Success;

          if (execSuccess) {
            return {
              cancellationId: `mystifly_void_norefund_${mfRef}_${voidPtrId}`,
              orderId: mfRef,
              refundAmount: 0,
              refundCurrency: 'USD',
              confirmedAt: new Date().toISOString(),
              raw: execResult,
            };
          }
        }
      } catch (voidErr) {
      }

      // Step 2: Fallback — direct /api/v1/Booking/Cancel
      const result = await mystiflyClient.cancelBooking(mfRef);
      const success = result?.Data?.Success || result?.Success;
      if (!success) {
        const errorMsg = result?.Data?.Errors?.[0]?.Message || result?.Message || 'Cancellation failed';
        const errorCode = result?.Data?.Errors?.[0]?.Code || '';
        throw new MystiflyCancellationError(`Mystifly cancellation failed: ${errorMsg}`, {
          providerErrorCode: errorCode,
          rawResponse: result,
        });
      }

      return {
        cancellationId: `mystifly_direct_cancel_${mfRef}_${Date.now()}`,
        orderId: mfRef,
        refundAmount: 0,
        refundCurrency: 'USD',
        confirmedAt: new Date().toISOString(),
        raw: result,
      };
    }

    // Legacy fallback: old-style quoteId (mystifly_cancel_quote_XXX)
    const legacyMfRef = quoteId.replace(/^mystifly_cancel_quote_/, '');
    if (legacyMfRef && legacyMfRef !== quoteId) {
      console.warn(`[MystiflyAdapter] Legacy quoteId format detected: ${quoteId}. Using cancelBooking fallback.`);
      const result = await mystiflyClient.cancelBooking(legacyMfRef);
      const success = result?.Data?.Success || result?.Success;
      if (!success) {
        const errorMsg = result?.Data?.Errors?.[0]?.Message || result?.Message || 'Unknown error';
        const errorCode = result?.Data?.Errors?.[0]?.Code || '';
        throw new MystiflyCancellationError(`Mystifly cancellation failed: ${errorMsg}`, {
          providerErrorCode: errorCode,
          rawResponse: result,
        });
      }
      return {
        cancellationId: `mystifly_cancel_${legacyMfRef}_${Date.now()}`,
        orderId: legacyMfRef,
        refundAmount: 0,
        refundCurrency: 'USD',
        confirmedAt: new Date().toISOString(),
        raw: result,
      };
    }

    // ── Unticketed VOID: no PTR exists, use direct cancelBooking ──
    const untickMatch = quoteId.match(/^mystifly_void_unticketed_(.+)$/);
    if (untickMatch) {
      const [, mfRef] = untickMatch;
      console.info(`[MystiflyAdapter] Confirming unticketed VOID for ${mfRef} — direct cancelBooking`);

      const result = await mystiflyClient.cancelBooking(mfRef);
      const data = result?.Data || result;
      const success = data?.Success ?? result?.Success;

      if (!success) {
        const errorMsg = data?.Errors?.[0]?.Message || result?.Message || 'Cancellation failed';
        const errorCode = data?.Errors?.[0]?.Code || '';
        throw new MystiflyCancellationError(`Mystifly unticketed cancel failed: ${errorCode} ${errorMsg}`, {
          providerErrorCode: errorCode,
          rawResponse: result,
        });
      }

      // For unticketed bookings, Mystifly won't return a refund amount —
      // the orchestrator uses the DB booking amount instead
      return {
        cancellationId: `mystifly_void_unticketed_confirmed_${mfRef}`,
        orderId: mfRef,
        refundAmount: 0, // orchestrator will use originalAmount from DB
        refundCurrency: data?.Currency || 'USD',
        confirmedAt: new Date().toISOString(),
        raw: result,
      };
    }

    throw new Error(`[MystiflyAdapter] Invalid quoteId format: ${quoteId}`);
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
    return true; // Mystifly supports flight changes via PTR ReIssue flow
  }

  // ── Order changes (not supported yet) ─────────

  async searchChangeOptions(
    mfRef: string,
    _slicesToRemove: { slice_id: string }[],
    slicesToAdd: { origin: string; destination: string; departure_date: string; cabin_class?: string }[],
    bookingPassengers?: { firstName: string; lastName: string; type?: string; eTicket?: string }[]
  ): Promise<{ requestId: string; offers: any[]; raw: unknown }> {
    // Step 1: Get current booking details (original fare) for the ReIssueQuote
    const order = await this.getOrder(mfRef);
    const originalTicketValue = order.totalAmount;
    const orderCurrency = order.currency || 'USD';

    // Build origin-destination list from requested changes
    const originDestinations: MystiflyReissueOriginDestination[] = slicesToAdd.map(s => ({
      originLocationCode: s.origin,
      destinationLocationCode: s.destination,
      departureDateTime: `${s.departure_date}T00:00:00`,
      cabinPreference: mystiflyClient.toCabinType(s.cabin_class || 'economy'),
    }));

    // Build passenger list: prefer DB passengers (always available), fall back to order
    const rawPax = (bookingPassengers && bookingPassengers.length > 0)
      ? bookingPassengers
      : order.passengers.map(p => ({ firstName: p.givenName || '', lastName: p.familyName || '', type: p.type || 'ADT', eTicket: '' }));

    if (rawPax.length === 0) {
      throw new Error('Mystifly ReIssueQuote failed: No passenger data available for this booking');
    }

    const passengers: MystiflyReissuePassenger[] = rawPax.map(p => ({
      firstName: p.firstName,
      lastName: p.lastName,
      passengerType: p.type || 'ADT',
      eTicket: p.eTicket || '',
    }));

    // Step 2: Call Mystifly ReIssueQuote
    const result = await mystiflyClient.reissueQuote(mfRef, originDestinations, passengers);

    // Step 3: Parse response
    const success = result?.Data?.Success ?? result?.Success;
    const data = result?.Data || result;

    if (!success && !data?.PtrId) {
      const errMsg = data?.Errors?.[0]?.Message || data?.Message || result?.Message || 'ReIssue quote not available';
      throw new Error(`Mystifly ReIssueQuote failed: ${errMsg}`);
    }

    const ptrId = data?.PtrId || data?.ptrId || 0;
    const options = data?.Options || data?.options || data?.ReissueOptions || [];

    // Helper: extract itinerary info from an option or top-level PTR data
    const extractItinerary = (opt: any) => {
      const segs = opt?.Segments || opt?.segments || opt?.FlightSegments || [];
      const firstSeg = Array.isArray(segs) && segs.length > 0 ? segs[0] : null;
      return {
        origin: firstSeg?.Origin || firstSeg?.origin || firstSeg?.DepartureAirport || slicesToAdd[0]?.origin || '',
        destination: firstSeg?.Destination || firstSeg?.destination || firstSeg?.ArrivalAirport || slicesToAdd[0]?.destination || '',
        departureDateTime: firstSeg?.DepartureDateTime || firstSeg?.departureDateTime || firstSeg?.DepartureTime || `${slicesToAdd[0]?.departure_date}T00:00:00`,
        arrivalDateTime: firstSeg?.ArrivalDateTime || firstSeg?.arrivalDateTime || firstSeg?.ArrivalTime || undefined,
        airline: firstSeg?.AirlineName || firstSeg?.airlineName || firstSeg?.Carrier || '',
        airlineCode: firstSeg?.AirlineCode || firstSeg?.airlineCode || firstSeg?.MarketingCarrier || '',
        flightNumber: firstSeg?.FlightNumber || firstSeg?.flightNumber || '',
        cabin: firstSeg?.CabinClass || firstSeg?.cabinClass || slicesToAdd[0]?.cabin_class || 'economy',
        duration: firstSeg?.Duration || firstSeg?.duration || '',
      };
    };

    // Helper: extract fee breakdown from an option
    const extractFees = (opt: any) => {
      const fareDiff = parseFloat(opt.FareDifference || opt.fareDifference || '0');
      const taxDiff = parseFloat(opt.TaxDifference || opt.taxDifference || opt.TaxAmount || '0');
      const penalty = parseFloat(opt.Penalty || opt.penalty || opt.ChangeFee || opt.ReissuePenalty || '0');
      const supplierFee = parseFloat(opt.SupplierFee || opt.supplierFee || '0');
      const totalAmount = parseFloat(opt.TotalAmount || opt.totalAmount || '0');
      // If provider gives a total, use it; otherwise sum components
      const totalDelta = totalAmount > 0 ? totalAmount : fareDiff + taxDiff + penalty + supplierFee;
      const newTicketValue = parseFloat(opt.NewFareAmount || opt.newFareAmount || '0') || (originalTicketValue + fareDiff + taxDiff);

      return { fareDiff, taxDiff, penalty, supplierFee, totalDelta, newTicketValue };
    };

    // Step 4: Normalize options into enhanced offer format
    const offers = Array.isArray(options) && options.length > 0
      ? options.map((opt: any, idx: number) => {
          const fees = extractFees(opt);
          const itinerary = extractItinerary(opt);

          return {
            id: `mystifly_reissue_${mfRef}_${ptrId}_${idx + 1}`,
            changeTotalAmount: fees.totalDelta,
            changeTotalCurrency: opt.Currency || opt.currency || orderCurrency,
            penaltyAmount: fees.penalty,
            penaltyCurrency: opt.Currency || opt.currency || orderCurrency,
            newTotalAmount: originalTicketValue + fees.totalDelta,
            newTotalCurrency: orderCurrency,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            // Enhanced fee breakdown
            fareDifference: fees.fareDiff,
            taxDifference: fees.taxDiff,
            airlineChangeFee: fees.penalty,
            supplierFee: fees.supplierFee,
            originalTicketValue,
            newTicketValue: fees.newTicketValue,
            // Enhanced itinerary
            newItinerary: itinerary,
            slices: {
              add: slicesToAdd.map(s => ({
                origin: s.origin,
                destination: s.destination,
                departure_date: s.departure_date,
              })),
              remove: [],
            },
            conditions: {
              fareDifference: fees.fareDiff,
              taxDifference: fees.taxDiff,
              penalty: fees.penalty,
              refundable: opt.IsRefundable ?? false,
            },
            // Mystifly-specific metadata needed for confirm
            _mystifly: { ptrId, preferenceOption: idx + 1 },
          };
        })
      : [{
          // If Mystifly returns a single quote (no Options array),
          // build a single offer from top-level PTR data
          id: `mystifly_reissue_${mfRef}_${ptrId}_1`,
          ...(() => {
            const fees = extractFees(data);
            const itinerary = extractItinerary(data);
            return {
              changeTotalAmount: fees.totalDelta,
              changeTotalCurrency: data?.Currency || orderCurrency,
              penaltyAmount: fees.penalty,
              penaltyCurrency: data?.Currency || orderCurrency,
              newTotalAmount: originalTicketValue + fees.totalDelta,
              newTotalCurrency: orderCurrency,
              expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              fareDifference: fees.fareDiff,
              taxDifference: fees.taxDiff,
              airlineChangeFee: fees.penalty,
              supplierFee: fees.supplierFee,
              originalTicketValue,
              newTicketValue: fees.newTicketValue,
              newItinerary: itinerary,
              slices: {
                add: slicesToAdd.map(s => ({
                  origin: s.origin,
                  destination: s.destination,
                  departure_date: s.departure_date,
                })),
                remove: [],
              },
              conditions: {
                fareDifference: fees.fareDiff,
                taxDifference: fees.taxDiff,
                penalty: fees.penalty,
              },
              _mystifly: { ptrId, preferenceOption: 1 },
            };
          })(),
        }];

    return {
      requestId: `mystifly_ptr_${ptrId}`,
      offers,
      raw: result,
    };
  }

  async confirmChangeOption(
    changeOfferId: string,
    _paymentAmount?: number,
    _paymentCurrency?: string
  ): Promise<{ changeId: string; orderId: string; newTotalAmount: number; newTotalCurrency: string; confirmedAt: string; raw: unknown }> {
    // Parse the change offer ID: "mystifly_reissue_MF35335226_12345_1"
    const parts = changeOfferId.split('_');
    // Format: mystifly_reissue_{mfRef}_{ptrId}_{preferenceOption}
    const mfRef = parts[2] || '';
    const ptrId = parseInt(parts[3] || '0', 10);
    const preferenceOption = parseInt(parts[4] || '1', 10);

    if (!mfRef || !ptrId) {
      throw new Error(`[MystiflyAdapter] Invalid changeOfferId format: ${changeOfferId}`);
    }

    const result = await mystiflyClient.confirmReissue(mfRef, ptrId, preferenceOption);
    const success = result?.Data?.Success ?? result?.Success;
    const data = result?.Data || result;

    if (!success) {
      const errMsg = data?.Errors?.[0]?.Message || data?.Message || result?.Message || 'ReIssue failed';
      throw new Error(`Mystifly ReIssue confirm failed: ${errMsg}`);
    }

    return {
      changeId: `mystifly_reissue_confirmed_${mfRef}_${ptrId}`,
      orderId: mfRef,
      newTotalAmount: parseFloat(data?.NewTotalAmount || data?.TotalAmount || '0'),
      newTotalCurrency: data?.Currency || 'USD',
      confirmedAt: new Date().toISOString(),
      raw: result,
    };
  }

  // ── Reimbursement monitoring ─────────────────────────────────────────

  async getProviderRefundStatus(
    refundRequestId: string,
    orderId: string,
  ): Promise<NormalizedProviderRefundStatus> {
    // Mystifly: use searchPtrStatus to check void/refund PTR settlement
    // refundRequestId is our quoteId format: mystifly_void_{mfRef}_{ptrId} or mystifly_refund_{mfRef}_{ptrId}
    const mfRef = orderId || refundRequestId.replace(/^mystifly_(void|refund)_/, '').replace(/_\d+$/, '');

    try {
      const ptrResult = await mystiflyClient.searchPtrStatus(mfRef);
      const data = ptrResult?.Data || ptrResult;
      const ptrRecords = data?.PostTicketingRequests || data?.Records || [];

      // Find the relevant PTR record (void or refund)
      const relevantPtr = Array.isArray(ptrRecords)
        ? ptrRecords.find((r: any) =>
            r.PtrType === 'Void' || r.PtrType === 'Refund' ||
            r.ptrType === 'void' || r.ptrType === 'refund'
          )
        : null;

      if (!relevantPtr) {
        return {
          status: 'UNKNOWN',
          rawStatus: 'no_ptr_found',
          rawResponse: ptrResult,
        };
      }

      // Map Mystifly PTR statuses to normalized statuses
      const ptrStatus = (relevantPtr.Status || relevantPtr.status || '').toLowerCase();
      let normalizedStatus: NormalizedProviderRefundStatus['status'] = 'UNKNOWN';

      if (['settled', 'completed', 'processed', 'approved', 'refunded', 'voided'].includes(ptrStatus)) {
        normalizedStatus = 'SETTLED';
      } else if (['processing', 'in_progress', 'inprogress'].includes(ptrStatus)) {
        normalizedStatus = 'PROCESSING';
      } else if (['pending', 'submitted', 'open', 'new'].includes(ptrStatus)) {
        normalizedStatus = 'PENDING';
      } else if (['rejected', 'denied', 'declined'].includes(ptrStatus)) {
        normalizedStatus = 'REJECTED';
      } else if (['failed', 'error', 'cancelled'].includes(ptrStatus)) {
        normalizedStatus = 'FAILED';
      }

      return {
        status: normalizedStatus,
        rawStatus: ptrStatus,
        providerRefundId: relevantPtr.PtrId?.toString() || relevantPtr.UniqueId || null,
        settlementReference: relevantPtr.SettlementReference || relevantPtr.TransactionId || null,
        reimbursedAmount: relevantPtr.RefundAmount != null
          ? parseFloat(String(relevantPtr.RefundAmount))
          : relevantPtr.Amount != null
            ? parseFloat(String(relevantPtr.Amount))
            : undefined,
        currency: relevantPtr.Currency || 'USD',
        settledAt: relevantPtr.SettledAt || relevantPtr.ProcessedAt || relevantPtr.CompletedAt || null,
        rawResponse: ptrResult,
      };
    } catch (err) {
      return {
        status: 'UNKNOWN',
        rawStatus: 'error',
        rawResponse: { error: err instanceof Error ? err.message : String(err) },
      };
    }
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
