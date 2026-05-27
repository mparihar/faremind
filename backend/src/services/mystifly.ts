/**
 * Mystifly / MyFareBox API Client
 *
 * Handles all communication with the Mystifly OnePoint REST API:
 * - Session-based authentication (Bearer token with auto-refresh)
 * - Flight search (AirLowFareSearchRQ via v2.2)
 * - Revalidation (price/availability confirmation)
 * - Booking (order creation)
 * - Ticketing (OrderTicket — only after payment)
 * - Cancellation
 * - Fare rules
 * - Trip details
 * - Seat map
 *
 * Swagger source: https://restapidemo.myfarebox.com/api/docs/v1/swagger.json
 *
 * Key difference from Duffel:
 * - Uses FareSourceCode (opaque string) instead of offer IDs
 * - Session-based auth (POST /api/CreateSession → Bearer token)
 * - Target environment passed in every request body (Test/Production)
 */

// ═══════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════

const MYSTIFLY_API_URL = process.env.MYSTIFLY_API_URL || 'https://restapidemo.myfarebox.com';
const MYSTIFLY_USERNAME = process.env.MYSTIFLY_USERNAME || '';
const MYSTIFLY_PASSWORD = process.env.MYSTIFLY_PASSWORD || '';
const MYSTIFLY_ACCOUNT_NUMBER = process.env.MYSTIFLY_ACCOUNT_NUMBER || '';
const MYSTIFLY_SESSION_ID = process.env.MYSTIFLY_SESSION_ID || '';
const MYSTIFLY_TARGET = (process.env.MYSTIFLY_TARGET || 'Test') as MystiflyTarget;

// ═══════════════════════════════════════════════
// Types — Mystifly API Enums & Shapes
// ═══════════════════════════════════════════════

export type MystiflyTarget = 'Development' | 'Test' | 'Production';

export type MystiflyCabinType = 'Y' | 'S' | 'C' | 'J' | 'F' | 'P';

export type MystiflyPassengerType = 'ADT' | 'CHD' | 'INF';

export type MystiflyAirTripType = 'OneWay' | 'Return' | 'Circle' | 'OpenJaw' | 'Other';

export type MystiflyMaxStops = 'Direct' | 'OneStop' | 'All';

export type MystiflyPricingSource = 'Public' | 'Private' | 'All';

export type MystiflyRequestOptions = 'Fifty' | 'Hundred' | 'TwoHundred' | 'FiveHundred' | 'Thousand';

export type MystiflyGender = 'M' | 'F' | 'U';

export type MystiflyPassengerTitle = 'MR' | 'SIR' | 'LORD' | 'MRS' | 'LADY' | 'MISS' | 'MSTR' | 'INF' | 'MS';

// ── Search Request ──

export interface MystiflyOriginDestination {
  DepartureDateTime: string; // ISO 8601
  DepartureWindow?: string;
  ArrivalWindow?: string;
  OriginLocationCode: string;   // 3-letter IATA
  DestinationLocationCode: string;
}

export interface MystiflyPassengerTypeQuantity {
  Code: MystiflyPassengerType;
  Quantity: number;
}

export interface MystiflyTravelPreferences {
  MaxStopsQuantity?: MystiflyMaxStops;
  VendorPreferenceCodes?: string[];
  VendorExcludeCodes?: string[];
  CabinPreference?: MystiflyCabinType;
  AirTripType: MystiflyAirTripType;
}

export interface MystiflySearchRQ {
  OriginDestinationInformations: MystiflyOriginDestination[];
  TravelPreferences: MystiflyTravelPreferences;
  PricingSourceType: MystiflyPricingSource;
  IsRefundable: boolean;
  PassengerTypeQuantities: MystiflyPassengerTypeQuantity[];
  RequestOptions: MystiflyRequestOptions;
  NearByAirports: boolean;
  IsResidentFare: boolean;
  Target: MystiflyTarget;
  ConversationId?: string;
  IsInfantWithSeat?: boolean;
}

// ── Revalidate ──

export interface MystiflyRevalidateRQ {
  FareSourceCode: string;
  Target: MystiflyTarget;
  ConversationId?: string;
}

// ── Book ──

export interface MystiflyPassengerName {
  PassengerTitle: MystiflyPassengerTitle;
  PassengerFirstName: string;
  PassengerLastName: string;
}

export interface MystiflyPassport {
  PassportNumber: string;
  ExpiryDate: string;
  Country: string;
}

export interface MystiflyAirTraveler {
  PassengerType: MystiflyPassengerType;
  Gender: MystiflyGender;
  PassengerName: MystiflyPassengerName;
  DateOfBirth?: string;
  Passport?: MystiflyPassport;
  FrequentFlyerNumber?: string;
  PassengerNationality?: string;
  NationalID?: string;
}

export interface MystiflyTravelerInfo {
  AirTravelers: MystiflyAirTraveler[];
  CountryCode?: string;
  AreaCode?: string;
  PhoneNumber: string;
  Email: string;
  PostCode?: string;
}

export interface MystiflyBookRQ {
  FareSourceCode: string;
  TravelerInfo: MystiflyTravelerInfo;
  Target: MystiflyTarget;
  ClientMarkup?: number;
  ClientReferenceNo?: string;
  ConversationId?: string;
  LccHoldBooking?: boolean;
}

// ── Order Ticket ──

export interface MystiflyOrderTicketRQ {
  UniqueID: string;
  FareSourceCode?: string;
  Target: MystiflyTarget;
  ConversationId?: string;
  ClientReferenceNo?: string;
}

// ── Cancel ──

export interface MystiflyCancelRQ {
  UniqueID: string;
  Target: MystiflyTarget;
  ConversationId?: string;
}

// ── Fare Rules ──

export interface MystiflyFareRulesRQ {
  FareSourceCode: string;
  UniqueID?: string;
  Target: MystiflyTarget;
  ConversationId?: string;
}

// ── Ticket Order Status ──

export interface MystiflyTicketOrderStatusRQ {
  UniqueID: string;
  Target: MystiflyTarget;
  ConversationId?: string;
}

// ── Seat Map ──

export interface MystiflySeatMapRQ {
  FareSourceCode: string;
  Target: MystiflyTarget;
  ConversationId?: string;
}

// ── Booking Notes ──

export interface MystiflyBookingNotesRQ {
  UniqueID: string;
  Notes: string[];
  Target: MystiflyTarget;
  ConversationId?: string;
}

// ═══════════════════════════════════════════════
// Error Class
// ═══════════════════════════════════════════════

export class MystiflyApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errorType: string,
    public rawResponse?: unknown
  ) {
    super(message);
    this.name = 'MystiflyApiError';
  }

  get isAuth(): boolean {
    return this.status === 401 || this.errorType === 'INVALID_SESSION';
  }
  get isRateLimit(): boolean {
    return this.status === 429;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isValidation(): boolean {
    return this.status === 400;
  }
}

// ═══════════════════════════════════════════════
// Session-Based Authentication
// ═══════════════════════════════════════════════

class MystiflyAuthService {
  private token: string | null = null;
  private tokenExpiry: number = 0;
  private refreshPromise: Promise<string> | null = null;

  // Mystifly session tokens typically last ~30 minutes.
  // We refresh proactively at 25 minutes.
  private readonly TOKEN_TTL_MS = 25 * 60 * 1000;

  async getToken(): Promise<string> {
    // Mode 1: Use static session ID from env (no CreateSession needed)
    if (MYSTIFLY_SESSION_ID) {
      return MYSTIFLY_SESSION_ID;
    }

    // Mode 2: Dynamic session via CreateSession
    // Return cached token if still valid
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    // Prevent concurrent refresh calls (thread-safe)
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.createSession();
    try {
      const token = await this.refreshPromise;
      return token;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Force-refresh the token (e.g. after a 401 response).
   * If using a static session ID, this is a no-op.
   */
  async forceRefresh(): Promise<string> {
    if (MYSTIFLY_SESSION_ID) {
      console.warn('[Mystifly] Static session ID in use — cannot refresh. Update MYSTIFLY_SESSION_ID env var if expired.');
      return MYSTIFLY_SESSION_ID;
    }
    this.token = null;
    this.tokenExpiry = 0;
    return this.getToken();
  }

  private async createSession(): Promise<string> {
    const url = `${MYSTIFLY_API_URL}/api/CreateSession`;

    console.log('[Mystifly] Creating new session...');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        UserName: MYSTIFLY_USERNAME,
        Password: MYSTIFLY_PASSWORD,
        AccountNumber: MYSTIFLY_ACCOUNT_NUMBER,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new MystiflyApiError(
        `Mystifly CreateSession failed (HTTP ${response.status}): ${errorBody}`,
        response.status,
        'AUTH_FAILED'
      );
    }

    const data = await response.json();

    // Mystifly returns session info — the token/session ID is in the response
    // Common patterns: data.Data.SessionId, data.SessionId, data.TokenId
    const sessionId =
      data?.Data?.SessionId ||
      data?.SessionId ||
      data?.TokenId ||
      data?.Data?.TokenId ||
      data?.data?.SessionId ||
      data?.data?.TokenId;

    if (!sessionId) {
      // Check if there's an error in the response
      const errMsg = data?.Data?.Error?.ErrorMessage || data?.Error?.ErrorMessage || data?.Message || 'Unknown session format';
      throw new MystiflyApiError(
        `Mystifly CreateSession returned no token: ${errMsg}`,
        response.status,
        'AUTH_NO_TOKEN',
        data
      );
    }

    this.token = sessionId;
    this.tokenExpiry = Date.now() + this.TOKEN_TTL_MS;

    // Mask the token in logs for security
    const masked = sessionId.substring(0, 8) + '***';
    console.log(`[Mystifly] ✅ Session created: ${masked} (expires in 25m)`);

    return sessionId;
  }
}

// Singleton auth service
const authService = new MystiflyAuthService();

// ═══════════════════════════════════════════════
// HTTP Client with Retry & Auto-Auth
// ═══════════════════════════════════════════════

interface MystiflyHttpRequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  retries?: number;
  skipAuth?: boolean; // For CreateSession itself
}

async function mystiflyRequest<T>({
  method,
  path,
  body,
  retries = 2,
  skipAuth = false,
}: MystiflyHttpRequestOptions): Promise<T> {
  const url = `${MYSTIFLY_API_URL}${path}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      if (!skipAuth) {
        const token = await authService.getToken();
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle 401 — force-refresh token and retry once
      if (response.status === 401 && !skipAuth && attempt < retries) {
        console.warn(`[Mystifly] 401 Unauthorized, refreshing session (attempt ${attempt + 1})`);
        await authService.forceRefresh();
        continue;
      }

      // Handle rate limiting
      if (response.status === 429 && attempt < retries) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '3');
        console.warn(`[Mystifly] Rate limited, retrying in ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errMsg =
          errorBody?.Data?.Error?.ErrorMessage ||
          errorBody?.Error?.ErrorMessage ||
          errorBody?.Message ||
          `HTTP ${response.status}`;

        throw new MystiflyApiError(
          `Mystifly API error (${response.status}): ${errMsg}`,
          response.status,
          errorBody?.Data?.Error?.ErrorCode || 'UNKNOWN',
          errorBody
        );
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      lastError = error as Error;

      // Don't retry auth or validation errors
      if (error instanceof MystiflyApiError) {
        if (error.isAuth || error.isValidation || error.isNotFound) {
          throw error;
        }
      }

      // Retry on network errors / 5xx
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.warn(`[Mystifly] Request failed, retrying in ${Math.round(delay)}ms:`, (error as Error).message);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Mystifly request failed after retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════
// Cabin Class Mapping
// ═══════════════════════════════════════════════

const CABIN_MAP: Record<string, MystiflyCabinType> = {
  economy: 'Y',
  premium_economy: 'S',
  business: 'C',
  first: 'F',
};

const CABIN_REVERSE_MAP: Record<string, string> = {
  Y: 'economy',
  S: 'premium_economy',
  C: 'business',
  J: 'business',
  F: 'first',
  P: 'first',
};

export function toCabinType(cabin: string): MystiflyCabinType {
  return CABIN_MAP[cabin.toLowerCase()] || 'Y';
}

export function fromCabinType(cabinType: string): string {
  return CABIN_REVERSE_MAP[cabinType] || 'economy';
}

// ═══════════════════════════════════════════════
// Flight Search
// ═══════════════════════════════════════════════

export interface MystiflySearchParams {
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
  children?: number;
  infants?: number;
  cabinClass?: string;
  maxStops?: MystiflyMaxStops;
  maxResults?: MystiflyRequestOptions;
}

/**
 * Search for flights via Mystifly.
 *
 * Uses v2.2 endpoint for latest search capabilities.
 * Returns the raw Mystifly response — normalizer converts to UnifiedFlight.
 */
export async function searchFlights(params: MystiflySearchParams): Promise<any> {
  const originDestinations: MystiflyOriginDestination[] = [
    {
      DepartureDateTime: `${params.departureDate}T00:00:00`,
      OriginLocationCode: params.origin,
      DestinationLocationCode: params.destination,
    },
  ];

  if (params.returnDate) {
    originDestinations.push({
      DepartureDateTime: `${params.returnDate}T00:00:00`,
      OriginLocationCode: params.destination,
      DestinationLocationCode: params.origin,
    });
  }

  const passengerQuantities: MystiflyPassengerTypeQuantity[] = [];
  if (params.adults > 0) passengerQuantities.push({ Code: 'ADT', Quantity: params.adults });
  if ((params.children || 0) > 0) passengerQuantities.push({ Code: 'CHD', Quantity: params.children! });
  if ((params.infants || 0) > 0) passengerQuantities.push({ Code: 'INF', Quantity: params.infants! });

  const searchRQ: MystiflySearchRQ = {
    OriginDestinationInformations: originDestinations,
    TravelPreferences: {
      MaxStopsQuantity: params.maxStops || 'All',
      CabinPreference: toCabinType(params.cabinClass || 'economy'),
      AirTripType: params.returnDate ? 'Return' : 'OneWay',
    },
    PricingSourceType: 'All',
    IsRefundable: false,
    PassengerTypeQuantities: passengerQuantities,
    RequestOptions: params.maxResults || 'TwoHundred',
    NearByAirports: false,
    IsResidentFare: false,
    Target: MYSTIFLY_TARGET,
    IsInfantWithSeat: false,
  };

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/v2.2/Search/Flight',
    body: searchRQ as unknown as Record<string, unknown>,
    retries: 1, // Search can be slow
  });

  const itineraryCount = result?.Data?.PricedItineraries?.length || 0;
  console.log(`[Mystifly] Search ${params.origin}→${params.destination}: ${itineraryCount} itineraries returned`);

  return result;
}

// ═══════════════════════════════════════════════
// Revalidate (Price/Availability Check)
// ═══════════════════════════════════════════════

/**
 * Revalidate a fare before booking.
 * Confirms the price is still available and returns updated pricing.
 */
export async function revalidateFlight(fareSourceCode: string): Promise<any> {
  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/v1/Revalidate/Flight',
    body: {
      FareSourceCode: fareSourceCode,
      Target: MYSTIFLY_TARGET,
    },
  });

  console.log(`[Mystifly] Revalidation complete for FSC: ${fareSourceCode.substring(0, 20)}...`);
  return result;
}

// ═══════════════════════════════════════════════
// Booking (Order Creation)
// ═══════════════════════════════════════════════

export interface MystiflyBookParams {
  fareSourceCode: string;
  travelers: MystiflyAirTraveler[];
  phoneNumber: string;
  email: string;
  countryCode?: string;
  areaCode?: string;
  clientReferenceNo?: string;
  clientMarkup?: number;
  holdBooking?: boolean;
}

/**
 * Create a booking in Mystifly.
 * Returns the booking reference (MFRef / UniqueID).
 *
 * NOTE: This creates a PNR but does NOT issue tickets.
 * Call orderTicket() only AFTER Stripe payment succeeds.
 */
export async function bookFlight(params: MystiflyBookParams): Promise<any> {
  const bookRQ: MystiflyBookRQ = {
    FareSourceCode: params.fareSourceCode,
    TravelerInfo: {
      AirTravelers: params.travelers,
      CountryCode: params.countryCode || 'US',
      AreaCode: params.areaCode || '1',
      PhoneNumber: params.phoneNumber,
      Email: params.email,
    },
    Target: MYSTIFLY_TARGET,
    ClientMarkup: params.clientMarkup || 0,
    ClientReferenceNo: params.clientReferenceNo,
    LccHoldBooking: params.holdBooking || false,
  };

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/v1/Book/Flight',
    body: bookRQ as unknown as Record<string, unknown>,
    retries: 0, // Never retry booking operations
  });

  const uniqueId = result?.Data?.UniqueID || result?.UniqueID;
  if (uniqueId) {
    console.log(`[Mystifly] ✅ Booking created: ${uniqueId}`);
  } else {
    const errMsg = result?.Data?.Error?.ErrorMessage || 'Unknown booking error';
    console.error(`[Mystifly] ❌ Booking failed: ${errMsg}`);
  }

  return result;
}

// ═══════════════════════════════════════════════
// Ticketing (OrderTicket — ONLY AFTER PAYMENT)
// ═══════════════════════════════════════════════

/**
 * Issue ticket for a booked flight.
 *
 * ⚠️ CRITICAL: Only call this AFTER Stripe payment succeeds.
 * This triggers actual ticket issuance and charges the Mystifly account.
 */
export async function orderTicket(
  uniqueId: string,
  fareSourceCode?: string,
  clientReferenceNo?: string
): Promise<any> {
  const rq: MystiflyOrderTicketRQ = {
    UniqueID: uniqueId,
    FareSourceCode: fareSourceCode,
    Target: MYSTIFLY_TARGET,
    ClientReferenceNo: clientReferenceNo,
  };

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/v1/OrderTicket',
    body: rq as unknown as Record<string, unknown>,
    retries: 0, // Never retry ticketing
  });

  console.log(`[Mystifly] OrderTicket for ${uniqueId}: ${result?.Data?.Success ? '✅ Success' : '❌ Failed'}`);
  return result;
}

// ═══════════════════════════════════════════════
// Cancellation
// ═══════════════════════════════════════════════

/**
 * Cancel a booking by its UniqueID (MFRef).
 */
export async function cancelBooking(uniqueId: string): Promise<any> {
  const rq: MystiflyCancelRQ = {
    UniqueID: uniqueId,
    Target: MYSTIFLY_TARGET,
  };

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/v1/Booking/Cancel',
    body: rq as unknown as Record<string, unknown>,
    retries: 0, // Never retry cancellations
  });

  console.log(`[Mystifly] Cancel ${uniqueId}: ${result?.Data?.Success ? '✅ Cancelled' : '❌ Failed'}`);
  return result;
}

// ═══════════════════════════════════════════════
// Fare Rules
// ═══════════════════════════════════════════════

/**
 * Get fare rules for a specific fare.
 */
export async function getFareRules(
  fareSourceCode: string,
  uniqueId?: string
): Promise<any> {
  const rq: MystiflyFareRulesRQ = {
    FareSourceCode: fareSourceCode,
    UniqueID: uniqueId,
    Target: MYSTIFLY_TARGET,
  };

  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/v1/FlightFareRules',
    body: rq as unknown as Record<string, unknown>,
  });
}

// ═══════════════════════════════════════════════
// Ticket Order Status
// ═══════════════════════════════════════════════

/**
 * Check the ticketing status for a booking.
 */
export async function getTicketOrderStatus(uniqueId: string): Promise<any> {
  const rq: MystiflyTicketOrderStatusRQ = {
    UniqueID: uniqueId,
    Target: MYSTIFLY_TARGET,
  };

  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/v1/AirTicketOrderStatus',
    body: rq as unknown as Record<string, unknown>,
  });
}

// ═══════════════════════════════════════════════
// Trip Details
// ═══════════════════════════════════════════════

/**
 * Get full trip/booking details by MFRef.
 */
export async function getTripDetails(mfRef: string): Promise<any> {
  return mystiflyRequest<any>({
    method: 'GET',
    path: `/api/v3/TripDetails/${encodeURIComponent(mfRef)}`,
  });
}

// ═══════════════════════════════════════════════
// Seat Map
// ═══════════════════════════════════════════════

/**
 * Get seat map for a fare.
 */
export async function getSeatMap(fareSourceCode: string): Promise<any> {
  const rq: MystiflySeatMapRQ = {
    FareSourceCode: fareSourceCode,
    Target: MYSTIFLY_TARGET,
  };

  try {
    return await mystiflyRequest<any>({
      method: 'POST',
      path: '/api/v1/SeatMap/Flight',
      body: rq as unknown as Record<string, unknown>,
    });
  } catch (error) {
    console.warn('[Mystifly] Seat map fetch failed:', (error as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════
// Booking Notes
// ═══════════════════════════════════════════════

/**
 * Add remarks/notes to a booking.
 */
export async function addBookingNotes(uniqueId: string, notes: string[]): Promise<any> {
  const rq: MystiflyBookingNotesRQ = {
    UniqueID: uniqueId,
    Notes: notes,
    Target: MYSTIFLY_TARGET,
  };

  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/v2/BookingNotes',
    body: rq as unknown as Record<string, unknown>,
  });
}

// ═══════════════════════════════════════════════
// Structured Fare Rule
// ═══════════════════════════════════════════════

/**
 * Get structured fare rules by SFR key.
 */
export async function getStructuredFareRule(sfrKey: string): Promise<any> {
  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/v1/StructuredFareRule',
    body: {
      SFRKey: sfrKey,
      Target: MYSTIFLY_TARGET,
    },
  });
}

// ═══════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════

export default {
  searchFlights,
  revalidateFlight,
  bookFlight,
  orderTicket,
  cancelBooking,
  getFareRules,
  getTicketOrderStatus,
  getTripDetails,
  getSeatMap,
  addBookingNotes,
  getStructuredFareRule,
  // Helpers
  toCabinType,
  fromCabinType,
  // Constants
  CABIN_MAP,
  CABIN_REVERSE_MAP,
};
