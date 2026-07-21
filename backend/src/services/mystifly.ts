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

// Meal preference SSR codes (IATA standard)
export type MystiflyMealPreference =
  | 'Any' | 'AVML' | 'BBML' | 'BLML' | 'CHML' | 'FPML' | 'GFML'
  | 'HFML' | 'KSML' | 'LFML' | 'LPML' | 'LSML' | 'MOML' | 'NLML'
  | 'ORML' | 'PRML' | 'RVML' | 'SFML' | 'VGML' | 'VJML' | 'VLML'
  | 'VOML' | 'VVML';

// Seat preference
export type MystiflySeatPreference = 'Any' | 'A' | 'W'; // Any, Aisle, Window

// SSR for booking
export interface MystiflySpecialServiceRequest {
  SeatPreference?: MystiflySeatPreference;
  MealPreference?: MystiflyMealPreference;
  RequestedSegments?: Array<{
    Origin?: string;
    Destination?: string;
    FlightNumber?: string;
    DepartureDateTime?: string;
    SSRCode?: string;
    FreeText?: string;
  }>;
}

// Extra services (baggage add-ons)
export interface MystiflyExtraService {
  ExtraServiceId: number;
  Quantity: number;
  Key?: string;
}

// Seat selection
export interface MystiflySeatSelectionRQ {
  SeatSelectionKey: string[];
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
  // ── SSR / Ancillary fields ──
  SpecialServiceRequest?: MystiflySpecialServiceRequest;
  ExtraServices?: MystiflyExtraService[];
  ExtraServices1_1?: MystiflyExtraService[];  // v1.1 format
  Seats?: MystiflySeatSelectionRQ;
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

// ── Ancillary Service Request ──

export interface MystiflyAncillaryServiceRQ {
  MFRef: string;
  isBaggage: boolean;
  isMeal: boolean;
  isSeatMap: boolean;
  isConfirmed?: boolean;
  isCancel?: boolean;
  SeatMapKey?: string;
  ServiceKey?: string;
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
  private staticIdFailed: boolean = false; // Track if static ID has expired

  // Mystifly session tokens typically last ~30 minutes.
  // We refresh proactively at 25 minutes.
  private readonly TOKEN_TTL_MS = 25 * 60 * 1000;

  async getToken(): Promise<string> {
    // Mode 1: Use static session ID from env (unless it's already failed/expired)
    if (MYSTIFLY_SESSION_ID && !this.staticIdFailed) {
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
   * If using a static session ID, marks it as expired and falls back
   * to dynamic CreateSession using credentials.
   */
  async forceRefresh(): Promise<string> {
    if (MYSTIFLY_SESSION_ID && !this.staticIdFailed) {
      console.warn('[Mystifly] Static session ID expired — falling back to dynamic CreateSession');
      this.staticIdFailed = true;
    }
    this.token = null;
    this.tokenExpiry = 0;
    return this.getToken();
  }

  private async createSession(): Promise<string> {
    const url = `${MYSTIFLY_API_URL}/api/CreateSession`;


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

export interface MultiCityLeg {
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
}

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
  pricingSource?: MystiflyPricingSource;
  searchVersion?: string; // 'v1' | 'v2' | 'v2.2'
  /** Multi-city legs — when provided, origin/destination/departureDate/returnDate are ignored */
  legs?: MultiCityLeg[];
  /** Filter to refundable fares only. Default: false (return all fares) */
  isRefundable?: boolean;
  /** Include nearby airports in search. Default: false */
  nearByAirports?: boolean;
  /** Search for resident fares. Default: false */
  isResidentFare?: boolean;
  /** Whether infant has a seat. Default: false (lap infant) */
  isInfantWithSeat?: boolean;
}

/**
 * Determine the Mystifly AirTripType from the legs.
 *   - 1 leg: OneWay
 *   - 2 legs where leg2 is reverse of leg1: Return
 *   - N legs where last destination = first origin: Circle
 *   - Otherwise: OpenJaw
 */
function resolveAirTripType(legs: MultiCityLeg[]): MystiflyAirTripType {
  if (legs.length <= 1) return 'OneWay';
  if (legs.length === 2) {
    const isReturn = legs[1].origin === legs[0].destination && legs[1].destination === legs[0].origin;
    if (isReturn) return 'Return';
  }
  const isCircle = legs[legs.length - 1].destination === legs[0].origin;
  return isCircle ? 'Circle' : 'OpenJaw';
}

/**
 * Search for flights via Mystifly.
 *
 * Supports one-way, round-trip, and multi-city (Circle/OpenJaw).
 * Returns the raw Mystifly response — normalizer converts to UnifiedFlight.
 */
export async function searchFlights(params: MystiflySearchParams): Promise<any> {
  // Build legs array — either from explicit legs or from origin/destination/returnDate
  let legs: MultiCityLeg[];
  if (params.legs && params.legs.length > 0) {
    legs = params.legs;
  } else {
    legs = [{ origin: params.origin, destination: params.destination, departureDate: params.departureDate }];
    if (params.returnDate) {
      legs.push({ origin: params.destination, destination: params.origin, departureDate: params.returnDate });
    }
  }

  const originDestinations: MystiflyOriginDestination[] = legs.map(leg => ({
    DepartureDateTime: `${leg.departureDate}T00:00:00`,
    OriginLocationCode: leg.origin,
    DestinationLocationCode: leg.destination,
  }));

  const passengerQuantities: MystiflyPassengerTypeQuantity[] = [];
  if (params.adults > 0) passengerQuantities.push({ Code: 'ADT', Quantity: params.adults });
  if ((params.children || 0) > 0) passengerQuantities.push({ Code: 'CHD', Quantity: params.children! });
  if ((params.infants || 0) > 0) passengerQuantities.push({ Code: 'INF', Quantity: params.infants! });

  const airTripType = resolveAirTripType(legs);

  const searchRQ: MystiflySearchRQ = {
    OriginDestinationInformations: originDestinations,
    TravelPreferences: {
      MaxStopsQuantity: params.maxStops || 'All',
      CabinPreference: toCabinType(params.cabinClass || 'economy'),
      AirTripType: airTripType,
    },
    PricingSourceType: params.pricingSource || 'All',
    IsRefundable: params.isRefundable ?? false,
    PassengerTypeQuantities: passengerQuantities,
    RequestOptions: params.maxResults || 'TwoHundred',
    NearByAirports: params.nearByAirports ?? false,
    IsResidentFare: params.isResidentFare ?? false,
    Target: MYSTIFLY_TARGET,
    IsInfantWithSeat: params.isInfantWithSeat ?? false,
  };

  // Determine search API version (default v2.2)
  // Mixed versions (Search v2.2 → Revalidate v1 → Book v1) are the published
  // Mystifly workflow. ERBUK103 is caused by FSC lifecycle issues, not version mismatch.
  const version = params.searchVersion || 'v2.2';
  const searchPath = `/api/${version}/Search/Flight`;
  const routeDesc = legs.map(l => `${l.origin}→${l.destination}`).join(', ');

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: searchPath,
    body: searchRQ as unknown as Record<string, unknown>,
    retries: 1,
  });

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

/**
 * Resolve the Mystifly reference (MFRef) for a FareSourceCode.
 *
 * Used to recover a poll-able reference when BookFlight returns a pending /
 * unconfirmed state (e.g. ERBUK082 "Awaiting carrier response") without an
 * inline UniqueID. Returns null if no MFRef can be resolved.
 */
export async function getMfRefFromFsc(fareSourceCode: string): Promise<string | null> {
  try {
    const result = await mystiflyRequest<any>({
      method: 'GET',
      path: `/api/RetrieveMFRefThroughFSC/${encodeURIComponent(fareSourceCode)}`,
      retries: 1,
    });
    const mfRef =
      result?.Data?.MFRef || result?.Data?.MfRef || result?.Data?.UniqueID ||
      result?.MFRef || result?.MfRef ||
      (typeof result?.Data === 'string' ? result.Data : null) ||
      (typeof result === 'string' ? result : null);
    return mfRef && typeof mfRef === 'string' && mfRef.trim().length > 0 ? mfRef.trim() : null;
  } catch (err) {
    console.warn('[Mystifly] getMfRefFromFsc failed:', (err as Error).message);
    return null;
  }
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
// Ancillary Services (Baggage, Meal, Seat)
// ═══════════════════════════════════════════════

export interface AncillaryServiceOptions {
  baggage?: boolean;
  meal?: boolean;
  seatMap?: boolean;
  /** Confirm a selected service (post-booking). Requires serviceKey/seatMapKey. */
  isConfirmed?: boolean;
  /** Cancel a previously-added service (post-booking). */
  isCancel?: boolean;
  /** ServiceKey of a baggage/meal item to confirm or cancel. */
  serviceKey?: string;
  /** SeatMapKey of a seat to confirm or cancel. */
  seatMapKey?: string;
}

/**
 * Ancillary services (baggage, meals, seats) for a booking — post-booking only
 * (requires MFRef). Per Mystifly's ServiceListsRQ this endpoint LISTS available
 * services (isConfirmed/isCancel=false), CONFIRMS a selection (isConfirmed=true
 * + ServiceKey/SeatMapKey), or CANCELS one (isCancel=true). Prefer the
 * confirmAncillaryService/cancelAncillaryService wrappers for the mutations.
 */
export async function getAncillaryServices(
  mfRef: string,
  options: AncillaryServiceOptions = {}
): Promise<any> {
  const isMutation = options.isConfirmed === true || options.isCancel === true;
  const rq: MystiflyAncillaryServiceRQ = {
    MFRef: mfRef,
    isBaggage: options.baggage ?? true,
    isMeal: options.meal ?? true,
    isSeatMap: options.seatMap ?? false,
    isConfirmed: options.isConfirmed ?? false,
    isCancel: options.isCancel ?? false,
    ...(options.serviceKey ? { ServiceKey: options.serviceKey } : {}),
    ...(options.seatMapKey ? { SeatMapKey: options.seatMapKey } : {}),
  };

  try {
    return await mystiflyRequest<any>({
      method: 'POST',
      path: '/api/AncillaryServiceRequest',
      body: rq as unknown as Record<string, unknown>,
      // Never retry a confirm/cancel — it mutates the booking (billable).
      retries: isMutation ? 0 : 1,
    });
  } catch (error) {
    console.warn('[Mystifly] Ancillary services request failed:', (error as Error).message);
    return { error: (error as Error).message };
  }
}

/**
 * Confirm a selected ancillary (baggage/meal via ServiceKey, or seat via
 * SeatMapKey) on an existing booking. Post-booking, billable — no retry.
 */
export async function confirmAncillaryService(
  mfRef: string,
  keys: { serviceKey?: string; seatMapKey?: string; baggage?: boolean; meal?: boolean; seatMap?: boolean },
): Promise<any> {
  return getAncillaryServices(mfRef, { ...keys, isConfirmed: true });
}

/**
 * Cancel a previously-added ancillary on an existing booking. Post-booking — no retry.
 */
export async function cancelAncillaryService(
  mfRef: string,
  keys: { serviceKey?: string; seatMapKey?: string; baggage?: boolean; meal?: boolean; seatMap?: boolean },
): Promise<any> {
  return getAncillaryServices(mfRef, { ...keys, isCancel: true });
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
// Post-Ticketing Requests (PTR)
// ═══════════════════════════════════════════════

export type PtrType = 'VoidQuote' | 'Void' | 'RefundQuote' | 'Refund' | 'ReIssueQuote' | 'ReIssue';

export interface MystiflyPtrRQ {
  UniqueID: string;
  Target: MystiflyTarget;
  Remarks?: string;
  // For ReIssue/ReIssueQuote
  NewFareSourceCode?: string;
}

/**
 * Submit a Post-Ticketing Request to Mystifly.
 *
 * Supports: VoidQuote, Void, RefundQuote, Refund, ReIssueQuote, ReIssue.
 * Returns the raw Mystifly PTR response.
 */
export async function postTicketingRequest(
  uniqueId: string,
  ptrType: PtrType,
  remarks?: string,
  newFareSourceCode?: string,
): Promise<any> {
  const rq: Record<string, unknown> = {
    mFRef: uniqueId,
    ...(remarks ? { AdditionalNote: remarks } : {}),
    ...(newFareSourceCode ? { NewFareSourceCode: newFareSourceCode } : {}),
  };

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: `/api/PostTicketingRequest`,
    body: {
      ...rq,
      ptrType: ptrType,
    } as unknown as Record<string, unknown>,
    retries: 0,
  });

  return result;
}

/**
 * Search for Post-Ticketing Requests by UniqueID.
 */
export async function searchPtrStatus(uniqueId: string): Promise<any> {

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: `/api/Search/PostTicketingRequest`,
    body: {
      UniqueID: uniqueId,
      Target: MYSTIFLY_TARGET,
    } as unknown as Record<string, unknown>,
    retries: 1,
  });

  return result;
}

/**
 * Mark a PTR notification as read.
 */
export async function markPtrAsRead(uniqueId: string): Promise<any> {

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: `/api/MarkAsRead`,
    body: {
      UniqueID: uniqueId,
      Target: MYSTIFLY_TARGET,
    } as unknown as Record<string, unknown>,
    retries: 0,
  });

  return result;
}

// ═══════════════════════════════════════════════
// ReIssue — Flight Change
// ═══════════════════════════════════════════════

export interface MystiflyReissueOriginDestination {
  originLocationCode: string;
  destinationLocationCode: string;
  departureDateTime: string;      // ISO-8601
  cabinPreference?: string;       // Y, C, F, etc.
  airlineCode?: string;
  flightNumber?: number;
}

export interface MystiflyReissuePassenger {
  firstName: string;
  lastName: string;
  passengerType: string;          // ADT, CHD, INF
  title?: string;
  eTicket?: string;
}

/**
 * Request a ReIssue Quote (flight change pricing) from Mystifly.
 *
 * Flow: POST /api/PostTicketingRequest with ptrType=ReIssueQuote
 * Returns: PTR record with PtrId, penalty, fare difference, options.
 */
export async function reissueQuote(
  mfRef: string,
  originDestinations: MystiflyReissueOriginDestination[],
  passengers: MystiflyReissuePassenger[],
): Promise<any> {
  const requestBody = {
    ptrType: 'ReIssueQuote',
    mFRef: mfRef,
    reissueQuoteRequestType: 'OND',
    originDestinations: originDestinations.map(od => ({
      originLocationCode: od.originLocationCode,
      destinationLocationCode: od.destinationLocationCode,
      departureDateTime: od.departureDateTime,
      cabinPreference: od.cabinPreference,
    })),
    passengers: passengers.map(p => ({
      firstName: p.firstName,
      lastName: p.lastName,
      passengerType: p.passengerType,
      ...(p.eTicket ? { eTicket: p.eTicket } : {}),
    })),
  };

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/PostTicketingRequest',
    body: requestBody as unknown as Record<string, unknown>,
    retries: 0,
  });

  return result;
}

/**
 * Confirm a ReIssue (execute the flight change) with Mystifly.
 *
 * Flow: POST /api/PostTicketingRequest with ptrType=ReIssue, AcceptQuote=yes
 * Requires the PtrId from the ReIssueQuote response.
 */
export async function confirmReissue(
  mfRef: string,
  ptrId: number,
  preferenceOption: number = 1,
): Promise<any> {

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/PostTicketingRequest',
    body: {
      ptrType: 'ReIssue',
      mFRef: mfRef,
      PtrId: ptrId,
      AcceptQuote: 'yes',
      PreferenceOption: preferenceOption,
    } as unknown as Record<string, unknown>,
    retries: 0,
  });

  return result;
}

// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// Void / Refund — Cancellation PTR Flow
// ═══════════════════════════════════════════════

/**
 * Request a Void Quote from Mystifly via PTR.
 *
 * Flow: POST /api/PostTicketingRequest with ptrType=VoidQuote
 * Returns: PTR record with PtrId, void eligibility, penalty info.
 *
 * Void is only available within the airline's void window
 * (typically 24h after ticketing, before midnight).
 */
export async function voidQuote(mfRef: string): Promise<any> {

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/PostTicketingRequest',
    body: {
      ptrType: 'VoidQuote',
      mFRef: mfRef,
    } as unknown as Record<string, unknown>,
    retries: 0,
  });

  return result;
}

/**
 * Execute a Void (confirm void cancellation) via PTR.
 *
 * Flow: POST /api/PostTicketingRequest with ptrType=Void, AcceptQuote=yes
 * Requires the PtrId from the VoidQuote response.
 */
export async function executeVoid(
  mfRef: string,
  ptrId: number,
): Promise<any> {

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/PostTicketingRequest',
    body: {
      ptrType: 'Void',
      mFRef: mfRef,
      PtrId: ptrId,
      AcceptQuote: 'yes',
    } as unknown as Record<string, unknown>,
    retries: 0, // Never retry void executions
  });

  return result;
}

/**
 * Request a Refund Quote from Mystifly via PTR.
 *
 * Flow: POST /api/PostTicketingRequest with ptrType=RefundQuote
 * Returns: PTR record with PtrId, penalty breakdown, refundable amount.
 *
 * Used when void is not available (outside void window).
 */
export async function refundQuote(mfRef: string): Promise<any> {

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/PostTicketingRequest',
    body: {
      ptrType: 'RefundQuote',
      mFRef: mfRef,
    } as unknown as Record<string, unknown>,
    retries: 0,
  });

  return result;
}

/**
 * Execute a Refund (confirm refund cancellation) via PTR.
 *
 * Flow: POST /api/PostTicketingRequest with ptrType=Refund, AcceptQuote=yes
 * Requires the PtrId from the RefundQuote response.
 */
export async function executeRefund(
  mfRef: string,
  ptrId: number,
): Promise<any> {

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/PostTicketingRequest',
    body: {
      ptrType: 'Refund',
      mFRef: mfRef,
      PtrId: ptrId,
      AcceptQuote: 'yes',
    } as unknown as Record<string, unknown>,
    retries: 0, // Never retry refund executions
  });

  return result;
}

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
  getAncillaryServices,
  addBookingNotes,
  getStructuredFareRule,
  // PTR
  postTicketingRequest,
  searchPtrStatus,
  markPtrAsRead,
  // ReIssue (Flight Change)
  reissueQuote,
  confirmReissue,
  // Void/Refund (Cancellation PTR)
  voidQuote,
  executeVoid,
  refundQuote,
  executeRefund,
  // Helpers
  toCabinType,
  fromCabinType,
  // Constants
  CABIN_MAP,
  CABIN_REVERSE_MAP,
};

