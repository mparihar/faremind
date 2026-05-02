/**
 * Duffel API Client – Production-Ready (NDC Layer)
 *
 * Handles all communication with the Duffel API:
 * - Flight search (offer requests with inline offers)
 * - Booking (order creation)
 * - Price monitoring (single offer re-fetch)
 * - Cancellation & modification
 *
 * Duffel API v2: https://duffel.com/docs/api
 *
 * Key implementation details:
 * - Uses `return_offers` as a query param (not body field)
 * - Offers come inline in the offer_request response when return_offers=true
 * - Retry with exponential backoff for transient failures
 * - Proper error categorization for rate limits vs auth vs data errors
 */

const DUFFEL_API_URL = process.env.DUFFEL_API_URL || 'https://api.duffel.com';
const DUFFEL_API_TOKEN = process.env.DUFFEL_API_TOKEN || '';

// ═══════════════════════════════════════════════
// Types – Duffel API Response Shapes
// ═══════════════════════════════════════════════

export interface DuffelOffer {
  id: string;
  live_mode: boolean;
  total_amount: string;
  total_currency: string;
  base_amount: string;
  base_currency: string;
  tax_amount: string | null;
  tax_currency: string | null;
  expires_at: string;
  created_at: string;
  owner: {
    iata_code: string;
    name: string;
    logo_symbol_url?: string;
    logo_lockup_url?: string;
  };
  slices: DuffelSlice[];
  passengers: DuffelPassenger[];
  conditions: DuffelConditions;
  available_services?: DuffelService[];
  payment_requirements: {
    requires_instant_payment: boolean;
    payment_required_by?: string;
    price_guarantee_expires_at?: string;
  };
}

export interface DuffelSlice {
  id: string;
  duration: string; // ISO 8601: PT5H30M
  origin: DuffelPlace;
  destination: DuffelPlace;
  segments: DuffelSegment[];
  fare_brand_name?: string;
}

export interface DuffelSegment {
  id: string;
  departing_at: string;
  arriving_at: string;
  duration: string;
  origin: DuffelPlace;
  destination: DuffelPlace;
  operating_carrier: { iata_code: string; name: string; logo_symbol_url?: string };
  marketing_carrier: { iata_code: string; name: string; logo_symbol_url?: string };
  marketing_carrier_flight_number: string;
  aircraft?: { iata_code: string; name: string };
  origin_terminal?: string;
  destination_terminal?: string;
  operating_carrier_flight_number?: string;
  passengers: {
    passenger_id: string;
    cabin_class: string;
    cabin_class_marketing_name?: string;
    baggages: { type: string; quantity: number }[];
  }[];
}

export interface DuffelPlace {
  iata_code: string;
  iata_country_code?: string;
  name: string;
  city_name?: string;
  city?: { iata_code: string; name: string };
  latitude?: number;
  longitude?: number;
  time_zone?: string;
}

export interface DuffelPassenger {
  id: string;
  type: string;
  age?: number;
  given_name?: string;
  family_name?: string;
  cabin_class?: string;
  baggages?: { type: string; quantity: number }[];
}

export interface DuffelConditions {
  refund_before_departure?: {
    allowed: boolean;
    penalty_amount?: string;
    penalty_currency?: string;
  };
  change_before_departure?: {
    allowed: boolean;
    penalty_amount?: string;
    penalty_currency?: string;
  };
}

export interface DuffelService {
  id: string;
  type: string;
  total_amount: string;
  total_currency: string;
  maximum_quantity: number;
}

export interface DuffelOrder {
  id: string;
  live_mode: boolean;
  booking_reference: string;
  total_amount: string;
  total_currency: string;
  base_amount: string;
  tax_amount: string | null;
  created_at: string;
  synced_at: string;
  passengers: DuffelPassenger[];
  slices: DuffelSlice[];
  owner: { iata_code: string; name: string };
  payment_status: { awaiting_payment: boolean; payment_required_by?: string };
  conditions: DuffelConditions;
}

export interface DuffelCancellation {
  id: string;
  order_id: string;
  live_mode: boolean;
  refund_amount: string;
  refund_currency: string;
  refund_to: string;
  expires_at: string;
  created_at: string;
  confirmed_at?: string;
}

// ─── Error types ───

export class DuffelApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errorType: string,
    public errors: { message: string; type: string; code?: string }[],
    public requestId?: string
  ) {
    super(message);
    this.name = 'DuffelApiError';
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }
  get isAuth(): boolean {
    return this.status === 401;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isValidation(): boolean {
    return this.status === 422;
  }
}

// ═══════════════════════════════════════════════
// HTTP Client with Retry
// ═══════════════════════════════════════════════

interface DuffelRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  queryParams?: Record<string, string>;
  retries?: number;
}

async function duffelRequest<T>({
  method,
  path,
  body,
  queryParams,
  retries = 2,
}: DuffelRequestOptions): Promise<T> {
  let url = `${DUFFEL_API_URL}${path}`;
  if (queryParams) {
    const qs = new URLSearchParams(queryParams).toString();
    url += `?${qs}`;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${DUFFEL_API_TOKEN}`,
        'Duffel-Version': 'v2',
        'Accept': 'application/json',
      };

      if (body) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify({ data: body }) : undefined,
      });

      // Handle rate limiting with retry
      if (response.status === 429 && attempt < retries) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '2');
        console.warn(`[Duffel] Rate limited, retrying in ${retryAfter}s (attempt ${attempt + 1}/${retries})`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ errors: [] }));
        const errors = errorBody.errors || [];
        const requestId = response.headers.get('x-request-id') || undefined;
        const msg = errors.map((e: any) => e.message).join('; ') || `HTTP ${response.status}`;

        throw new DuffelApiError(
          `Duffel API error (${response.status}): ${msg}`,
          response.status,
          errors[0]?.type || 'unknown',
          errors,
          requestId
        );
      }

      // 204 No Content (e.g. for confirmed cancellations)
      if (response.status === 204) {
        return {} as T;
      }

      const data = await response.json();
      return data.data as T;
    } catch (error) {
      lastError = error as Error;

      // Don't retry auth errors, validation errors, or not-found
      if (error instanceof DuffelApiError) {
        if (error.isAuth || error.isValidation || error.isNotFound) {
          throw error;
        }
      }

      // Retry on network errors / 5xx
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.warn(`[Duffel] Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${retries}):`, (error as Error).message);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Duffel request failed after retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════
// Search (Offer Requests)
// ═══════════════════════════════════════════════

export interface DuffelSearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  children?: number;
  infants?: number;
  cabinClass?: string;
  maxConnections?: number;
}

/**
 * Search for flights via Duffel.
 *
 * Uses return_offers=true (query param) to get offers inline in the
 * offer request response — single API call, no pagination needed
 * for typical result sizes.
 */
export async function searchFlights(params: DuffelSearchParams): Promise<DuffelOffer[]> {
  const slices = [
    {
      origin: params.origin,
      destination: params.destination,
      departure_date: params.departureDate,
    },
  ];

  if (params.returnDate) {
    slices.push({
      origin: params.destination,
      destination: params.origin,
      departure_date: params.returnDate,
    });
  }

  const passengers: { type: string }[] = [
    ...Array(params.adults).fill({ type: 'adult' }),
    ...Array(params.children || 0).fill({ type: 'child' }),
    ...Array(params.infants || 0).fill({ type: 'infant_without_seat' }),
  ];

  // Duffel: return_offers is a QUERY PARAM, not a body field
  // When true, offers come inline in the response under `offers`
  const offerRequest = await duffelRequest<{
    id: string;
    offers: DuffelOffer[];
    slices: DuffelSlice[];
    passengers: DuffelPassenger[];
    created_at: string;
    live_mode: boolean;
  }>({
    method: 'POST',
    path: '/air/offer_requests',
    queryParams: { return_offers: 'true' },
    body: {
      slices,
      passengers,
      cabin_class: params.cabinClass || 'economy',
      max_connections: params.maxConnections ?? 2,
    } as Record<string, unknown>,
    retries: 1, // Offer requests can be slow, don't over-retry
  });

  const offers = offerRequest.offers || [];
  console.log(`[Duffel] Search ${params.origin}→${params.destination}: ${offers.length} offers returned`);

  return offers;
}

/**
 * List offers for an existing offer request (paginated).
 * Use this when you want to page through a large result set.
 */
export async function listOffers(
  offerRequestId: string,
  options?: { limit?: number; sort?: 'total_amount' | '-total_amount' }
): Promise<DuffelOffer[]> {
  const queryParams: Record<string, string> = {
    offer_request_id: offerRequestId,
    limit: (options?.limit || 50).toString(),
  };
  if (options?.sort) {
    queryParams.sort = options.sort;
  }

  return duffelRequest<DuffelOffer[]>({
    method: 'GET',
    path: '/air/offers',
    queryParams,
  });
}

/**
 * Get a single offer by ID.
 * Useful for verifying an offer is still valid before booking.
 */
export async function getOffer(offerId: string): Promise<DuffelOffer> {
  return duffelRequest<DuffelOffer>({
    method: 'GET',
    path: `/air/offers/${offerId}`,
  });
}

// ═══════════════════════════════════════════════
// Booking (Order Creation)
// ═══════════════════════════════════════════════

export interface DuffelBookingParams {
  offerId: string;
  passengers: {
    id: string;
    given_name: string;
    family_name: string;
    born_on: string; // YYYY-MM-DD
    gender: string; // m or f
    email: string;
    phone_number: string; // E.164 format
    title: string; // mr, ms, mrs, miss, dr
    type: string; // adult, child, infant_without_seat
  }[];
  paymentAmount: number;
  paymentCurrency: string;
  metadata?: Record<string, string>;
}

/**
 * Create a booking (order) in Duffel.
 *
 * This is a two-step process in some configurations:
 * 1. Create the order
 * 2. Payment is handled by Duffel balance (for test mode)
 */
export async function createBooking(params: DuffelBookingParams): Promise<DuffelOrder> {
  // Verify the offer is still valid first
  let offer: DuffelOffer;
  try {
    offer = await getOffer(params.offerId);
    const expiresAt = new Date(offer.expires_at);
    if (expiresAt < new Date()) {
      throw new Error(`Offer ${params.offerId} has expired at ${offer.expires_at}`);
    }
  } catch (error) {
    if (error instanceof DuffelApiError && error.isNotFound) {
      throw new Error(`Offer ${params.offerId} not found — it may have expired`);
    }
    throw error;
  }

  const order = await duffelRequest<DuffelOrder>({
    method: 'POST',
    path: '/air/orders',
    body: {
      selected_offers: [params.offerId],
      passengers: params.passengers,
      type: 'instant',
      payments: [
        {
          type: 'balance',
          amount: params.paymentAmount.toFixed(2),
          currency: params.paymentCurrency,
        },
      ],
      metadata: params.metadata || { booked_via: 'faremind' },
    } as Record<string, unknown>,
    retries: 0, // Never retry a payment
  });

  console.log(`[Duffel] ✅ Order created: ${order.id} (PNR: ${order.booking_reference})`);
  return order;
}

// ═══════════════════════════════════════════════
// Order Management
// ═══════════════════════════════════════════════

/**
 * Get an existing order by ID.
 */
export async function getOrder(orderId: string): Promise<DuffelOrder> {
  return duffelRequest<DuffelOrder>({
    method: 'GET',
    path: `/air/orders/${orderId}`,
  });
}

/**
 * Update order metadata (e.g. internal tracking info).
 */
export async function updateOrder(
  orderId: string,
  metadata: Record<string, string>
): Promise<DuffelOrder> {
  return duffelRequest<DuffelOrder>({
    method: 'PATCH',
    path: `/air/orders/${orderId}`,
    body: { metadata } as Record<string, unknown>,
  });
}

// ═══════════════════════════════════════════════
// Cancellation
// ═══════════════════════════════════════════════

/**
 * Cancel an order. Two-step:
 * 1. Create cancellation (gets quote with refund amount)
 * 2. Confirm cancellation
 */
export async function cancelBooking(orderId: string): Promise<{
  cancellation: DuffelCancellation;
  refundAmount: number;
  refundCurrency: string;
}> {
  // Step 1: Create cancellation (gets refund quote)
  const cancellation = await duffelRequest<DuffelCancellation>({
    method: 'POST',
    path: '/air/order_cancellations',
    body: { order_id: orderId } as Record<string, unknown>,
  });

  console.log(`[Duffel] Cancellation quote: ${cancellation.refund_amount} ${cancellation.refund_currency} (expires: ${cancellation.expires_at})`);

  // Step 2: Confirm cancellation
  const confirmed = await duffelRequest<DuffelCancellation>({
    method: 'POST',
    path: `/air/order_cancellations/${cancellation.id}/actions/confirm`,
    retries: 0, // Don't retry cancellation confirmation
  });

  console.log(`[Duffel] ✅ Cancellation confirmed: ${confirmed.id}`);

  return {
    cancellation: confirmed,
    refundAmount: parseFloat(confirmed.refund_amount || cancellation.refund_amount),
    refundCurrency: confirmed.refund_currency || cancellation.refund_currency,
  };
}

// ═══════════════════════════════════════════════
// Price Check (for monitoring)
// ═══════════════════════════════════════════════

/**
 * Re-run a search to get current prices for a route.
 * Used by the price monitoring cron.
 */
export async function checkPrice(params: DuffelSearchParams): Promise<{
  lowestPrice: number;
  currency: string;
  offerCount: number;
  offers: DuffelOffer[];
}> {
  const offers = await searchFlights({
    ...params,
    maxConnections: 1, // Keep it fast for monitoring
  });

  if (offers.length === 0) {
    throw new Error('No offers found for price check');
  }

  const prices = offers.map((o) => parseFloat(o.total_amount));
  const lowestPrice = Math.min(...prices);
  const currency = offers[0].total_currency;

  return {
    lowestPrice,
    currency,
    offerCount: offers.length,
    offers,
  };
}

// ═══════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════

export default {
  searchFlights,
  listOffers,
  getOffer,
  createBooking,
  getOrder,
  updateOrder,
  cancelBooking,
  checkPrice,
};
