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

import type { PtrPassenger } from '../lib/ptr-passengers';
import type { MystiflyRefundDetail } from '../lib/refund-details';
import * as crypto from 'crypto';
import { passengerTitleCased } from '../lib/passenger-title';

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

// Titles used on booking passenger tickets (Title-case, matching the servicing/
// PTR path in lib/ptr-passengers.ts):
//   Adult:  Mr / Mrs / Ms / Miss   (we derive Mr | Ms from gender)
//   Child:  Mstr (male) / Miss (female)
//   Infant: Mstr (male) / Miss (female)
export type MystiflyPassengerTitle = 'Mr' | 'Mrs' | 'Ms' | 'Miss' | 'Mstr';

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

// Paid extras — baggage and meals.
//
// The provider's doc gives exactly one property, the id:
//   "ExtraServices1_1": [ { "ExtraServiceId": 5 }, { "ExtraServiceId": 10 } ]
// Quantity and Key were ours; a second bag is a second id, not a quantity.
// They stay optional only so an older caller still compiles.
export interface MystiflyExtraService {
  ExtraServiceId: number;
  Quantity?: number;
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
  /** @deprecated The sibling that comes back empty on every revalidation. */
  ExtraServices?: MystiflyExtraService[];
  /** The tag services are offered under, and the one Book reads. */
  ExtraServices1_1?: MystiflyExtraService[];
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
    // Mystifly returns cheapest-fare-per-flight first and stops at the cap, so a
    // low cap truncates the airline's fare ladder away entirely before we ever
    // see it. Measured on DEL-BOM 23 Nov / 11 Dec: at 'TwoHundred' the response
    // held 200 flights and ZERO of them carried more than one fare family; at
    // 'Thousand' it held 696 flights of which 304 carried a real ladder, and two
    // families (INDIGO UPFRONT, ECO CLASSIC) did not appear at the lower cap at
    // all. The fare panel cannot show fares the search never requested.
    RequestOptions: params.maxResults || 'Thousand',
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

// Revalidation cache — shared by EVERY caller of revalidateFlight().
//
// Revalidate mints a fresh FareSourceCode with a short TTL, and the checkout
// hits it at several stages for the SAME FSC (seats seat-map, meal step,
// add-ons seat-map, payment-page load). Caching a successful, still-valid
// revalidation keyed by the input FSC lets those stages share ONE Mystifly call
// instead of one each. Because the cache lives in this function — the single
// point every path funnels through — even the direct seat-map calls dedupe.
//
// TTL is 3 min — comfortably shorter than the ~5 min private-fare TTL, so a
// cache hit is always still bookable; a caller more than ~3 min later
// re-revalidates automatically. Confirm passes skipCache to force a fresh FSC
// immediately before BookFlight.
const REVALIDATION_CACHE_TTL_MS = 3 * 60 * 1000;
const REVALIDATION_CACHE_MAX_ENTRIES = 1000;

interface RevalidationCacheEntry {
  data: any;
  expiresAt: number;
}

const revalidationCache = new Map<string, RevalidationCacheEntry>();

/** SHA-256 (first 16 chars) of an FSC — log traceability without leaking the code. */
function hashFsc(fsc: string): string {
  return crypto.createHash('sha256').update(fsc).digest('hex').slice(0, 16);
}

/**
 * Only cache a revalidation that actually succeeded and is still valid — never
 * cache a provider error or IsValid=false, or a later stage would reuse it.
 */
function isRevalidationCacheable(result: any): boolean {
  if (!result?.Data || typeof result.Data !== 'object') return false;
  const error = result?.Data?.Error || result?.Error;
  if (error?.ErrorCode && error.ErrorCode !== '0') return false;
  const isValidRaw = result?.Data?.IsValid ?? result?.IsValid;
  if (isValidRaw === false || isValidRaw === 'false' || isValidRaw === 'False') return false;
  return true;
}

export interface RevalidateOptions {
  /** Bypass the cache and force a fresh Mystifly call (confirm uses this before Book). */
  skipCache?: boolean;
  /** Diagnostic label for the [FSC-DIAG] counter (e.g. 'meal', 'seat-map', 'confirm'). */
  source?: string;
}

/**
 * Revalidate a fare before booking.
 * Confirms the price is still available and returns updated pricing.
 *
 * Cached (3-min TTL, keyed by FSC) so the checkout's seat-map / meal / payment
 * stages share one Mystifly call. Pass { skipCache: true } to force a fresh
 * call. Every invocation emits one [FSC-DIAG][REVAL] line for call counting.
 */
export async function revalidateFlight(
  fareSourceCode: string,
  options: RevalidateOptions = {},
): Promise<any> {
  const { skipCache = false, source = 'unknown' } = options;
  const fscHash = hashFsc(fareSourceCode);

  if (!skipCache) {
    const entry = revalidationCache.get(fareSourceCode);
    if (entry && Date.now() <= entry.expiresAt) {
      // [FSC-DIAG] TEMP diagnostic — remove after call counts confirmed
      console.log(`[FSC-DIAG][REVAL] source=${source} fsc=${fscHash} cacheHit=true mystiflyCalled=false skipCache=false`);
      return entry.data;
    }
    if (entry) revalidationCache.delete(fareSourceCode); // expired
  }

  // [FSC-DIAG] TEMP diagnostic — remove after call counts confirmed
  console.log(`[FSC-DIAG][REVAL] source=${source} fsc=${fscHash} cacheHit=false mystiflyCalled=true skipCache=${skipCache}`);
  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/v1/Revalidate/Flight',
    body: {
      FareSourceCode: fareSourceCode,
      Target: MYSTIFLY_TARGET,
    },
  });

  // Cache only successful, still-valid revalidations — never on skipCache.
  if (!skipCache && isRevalidationCacheable(result)) {
    if (revalidationCache.size >= REVALIDATION_CACHE_MAX_ENTRIES) {
      const now = Date.now();
      for (const [key, e] of revalidationCache) {
        if (now > e.expiresAt) revalidationCache.delete(key);
      }
    }
    revalidationCache.set(fareSourceCode, { data: result, expiresAt: Date.now() + REVALIDATION_CACHE_TTL_MS });
  }

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
      // Numeric dialling code and national destination code, digits only.
      // AreaCode defaulted to '1' on every booking regardless of country, so an
      // Indian number went out with a US area code; there is no sane default for
      // it, and empty is a valid value the contract allows.
      CountryCode: params.countryCode || '',
      AreaCode: params.areaCode ?? '',
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
 * TripDetails with version fallback. Mystifly exposes /api/TripDetails,
 * /api/v1.1/TripDetails, /api/v2/TripDetails and /api/v3/TripDetails — v3 has
 * been observed returning {"Data":"Error occured in Trip Details V3","Success":false}
 * for some bookings. Try the documented base first, then older versions, and
 * return the first response that is NOT an error (so callers get a real payload
 * — e.g. e-ticket numbers). Falls back to the last response if all error.
 */
export async function getTripDetailsResilient(mfRef: string): Promise<any> {
  const bases = ['/api/TripDetails/', '/api/v2/TripDetails/', '/api/v1.1/TripDetails/', '/api/v3/TripDetails/'];
  let last: any = null;
  for (const base of bases) {
    try {
      const res = await mystiflyRequest<any>({
        method: 'GET',
        path: `${base}${encodeURIComponent(mfRef)}`,
        retries: 1,
      });
      last = res;
      const failed =
        res?.Success === false ||
        (typeof res?.Data === 'string' && /error/i.test(res.Data)) ||
        !res?.Data;
      if (!failed && res?.Data && typeof res.Data === 'object') return res;
    } catch {
      /* try next version */
    }
  }
  return last;
}

/**
 * Resolve the Mystifly reference (MFRef) for a FareSourceCode.
 *
 * Used to recover a poll-able reference when BookFlight returns a pending /
 * unconfirmed state (e.g. ERBUK082 "Awaiting carrier response") without an
 * inline UniqueID. Returns null if no MFRef can be resolved.
 */
export interface MystiflyCouponSegment {
  origin: string;
  destination: string;
  flightNumber: string;
  travelDate: string | null;
  couponStatus: string;      // 'OPEN' | 'N/A' | 'USED' | …  (provider text)
  statusCode: number | null; // provider numeric Status
  /** Provider warning, e.g. "not in OPEN status; NOT valid for REFUND/VOID and REISSUE". */
  warning: string | null;
  fareBasisCode: string | null;
  rbdClass: string | null;
  baggage: string | null;
}

export interface MystiflyCouponTicket {
  eTicketNumber: string;
  ticketIssueDate: string | null;
  segments: MystiflyCouponSegment[];
}

/**
 * Per-coupon (per-segment) status for a ticketed booking.
 *
 * GET /api/CouponStatus/{MFRef} → Data.CouponDetailsResult.CouponStatus.lstEticket[]
 * with an lstSegment[] per e-ticket. Each segment carries a CouponStatus plus a
 * Warning that states outright whether the coupon is eligible for REFUND/VOID/REISSUE,
 * so this is the cheapest pre-check before quoting any of them.
 */
export async function getCouponStatus(mfRef: string): Promise<{
  tickets: MystiflyCouponTicket[];
  raw: any;
}> {
  const res = await mystiflyRequest<any>({
    method: 'GET',
    path: `/api/CouponStatus/${encodeURIComponent(mfRef)}`,
    retries: 1,
  });

  const list = res?.Data?.CouponDetailsResult?.CouponStatus?.lstEticket;
  const tickets: MystiflyCouponTicket[] = (Array.isArray(list) ? list : []).map((t: any) => ({
    eTicketNumber: String(t?.ETicketNo ?? ''),
    ticketIssueDate: t?.TicketIssueDate || null,
    segments: (Array.isArray(t?.lstSegment) ? t.lstSegment : []).map((sg: any) => ({
      origin: String(sg?.Origin ?? ''),
      destination: String(sg?.Destination ?? ''),
      flightNumber: String(sg?.FlightNumber ?? ''),
      travelDate: sg?.TravelDate || null,
      couponStatus: String(sg?.CouponStatus ?? ''),
      statusCode: sg?.Status != null ? Number(sg.Status) : null,
      warning: sg?.Warning || null,
      fareBasisCode: sg?.FareBasisCode || null,
      rbdClass: sg?.RBDClass || null,
      baggage: sg?.Baggage || null,
    })),
  }));

  return { tickets, raw: res };
}

export interface MystiflyCreditNote {
  number: number | null;
  mfRef: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
}

/**
 * Credit notes raised by the provider — how a void/refund/reissue settles back to the
 * agency. POST /api/Search/CreditNote is a paged global feed (its only documented input
 * is Page), so a booking-scoped view is filtered here on the MFRef each transaction
 * carries.
 */
export async function searchCreditNotes(opts: { page?: number; mfRef?: string } = {}): Promise<{
  creditNotes: MystiflyCreditNote[];
  raw: any;
}> {
  const res = await mystiflyRequest<any>({
    method: 'POST',
    path: '/api/Search/CreditNote',
    body: { Page: opts.page ?? 1 } as unknown as Record<string, unknown>,
    retries: 1,
  });

  const txns = res?.Data?.Transactions;
  let creditNotes: MystiflyCreditNote[] = (Array.isArray(txns) ? txns : []).map((t: any) => ({
    number: t?.Number != null ? Number(t.Number) : null,
    mfRef: t?.MFRef ?? null,
    amount: t?.Amount != null ? Number(t.Amount) : null,
    currency: t?.Currency ?? null,
    status: t?.Status ?? null,
  }));

  if (opts.mfRef) {
    const want = opts.mfRef.toUpperCase();
    creditNotes = creditNotes.filter((c) => (c.mfRef || '').toUpperCase() === want);
  }

  return { creditNotes, raw: res };
}

/**
 * Outcome of resolving an MFRef from a FareSourceCode.
 *
 * The three cases are NOT interchangeable. This is the call that decides whether
 * an ERBUK082 booking gets refunded, so "the provider says no booking exists"
 * and "we could not find out" must never collapse into the same answer: the
 * first is safe to refund, the second may be a live PNR.
 */
export type MfRefLookup =
  | { outcome: 'found'; mfRef: string }
  | { outcome: 'not_found' }
  | { outcome: 'unknown'; reason: string };

/** Sentinels the provider returns in the MFRef field instead of an empty one. */
const NOT_A_REF = /^(no matching mfref found|not found|n\/?a|none|null)$/i;

export async function lookupMfRefFromFsc(fareSourceCode: string): Promise<MfRefLookup> {
  let result: any;
  try {
    result = await mystiflyRequest<any>({
      method: 'GET',
      path: `/api/RetrieveMFRefThroughFSC/${encodeURIComponent(fareSourceCode)}`,
      retries: 1,
    });
  } catch (err) {
    // A transport failure tells us nothing about whether a booking exists.
    return { outcome: 'unknown', reason: (err as Error).message };
  }

  // Real shape, confirmed live:
  //   { Data: { MFRefResult: { Success: false, MFRef: "No Matching MFRef found" } }, Success: true }
  // The previous parser read Data.MFRef — a path that does not exist — so it
  // returned null for every booking, and every ERBUK082 was refunded as if the
  // carrier had no record of it.
  const inner = result?.Data?.MFRefResult ?? result?.MFRefResult ?? null;
  const raw =
    inner?.MFRef ?? inner?.MfRef ??
    result?.Data?.MFRef ?? result?.Data?.MfRef ?? result?.Data?.UniqueID ??
    result?.MFRef ?? result?.MfRef ??
    (typeof result?.Data === 'string' ? result.Data : null) ??
    (typeof result === 'string' ? result : null);

  const ref = typeof raw === 'string' ? raw.trim() : '';

  if (inner && inner.Success === false) return { outcome: 'not_found' };
  if (!ref || NOT_A_REF.test(ref)) return { outcome: 'not_found' };
  return { outcome: 'found', mfRef: ref };
}

/** Back-compat wrapper: the reference, or null for both no-booking and unknown. */
export async function getMfRefFromFsc(fareSourceCode: string): Promise<string | null> {
  const r = await lookupMfRefFromFsc(fareSourceCode);
  return r.outcome === 'found' ? r.mfRef : null;
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
    const res = await mystiflyRequest<any>({
      method: 'POST',
      path: '/api/v1/SeatMap/Flight',
      body: rq as unknown as Record<string, unknown>,
    });
    return res;
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
    Target: MYSTIFLY_TARGET, // required by Mystifly on every request; PTR omitted it → "Please verify the request."
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
 * Broad Search PTR lookup for a booking (all categories). Used by the manual
 * "check status" console button; the automated reconciliation cron polls a
 * specific PTR via searchPtr(ptrType, mfRef, ptrId) instead.
 *
 * Documented contract: POST /api/Search/PostTicketingRequest with MFRef +
 * PTRCategory. (The old UniqueID/Target body is not part of this contract.)
 */
export async function searchPtrStatus(mfRef: string): Promise<any> {

  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: `/api/Search/PostTicketingRequest`,
    body: {
      MFRef: mfRef,
      PTRId: 0,
      Page: 1,
      PTRCategory: 'All',
    } as unknown as Record<string, unknown>,
    retries: 1,
  });

  return result;
}

/** PTR types MarkAsRead accepts (OnePointRestAPI.ValidationModels.MarkAsRead+PTRType). */
export type MarkAsReadPtrType =
  | 'None' | 'VoidQuote' | 'Void' | 'RefundQuote' | 'Refund'
  | 'ReIssueQuote' | 'ReIssue' | 'ScheduleChange' | 'FutureCredit';

/**
 * Mark a PTR notification as read.
 *
 * Contract is {MFRef, id, requestType} and all three are required — `id` is the
 * provider PTRId, not the MFRef. The previous body ({UniqueID, Target}) sent two
 * properties that do not exist on this endpoint and omitted every required one, so
 * every call returned HTTP 400 "Please enter valid id greater than 0. / The MFRef
 * field is required."
 */
export async function markPtrAsRead(
  mfRef: string,
  ptrId: number,
  requestType: MarkAsReadPtrType = 'None',
): Promise<any> {
  const result = await mystiflyRequest<any>({
    method: 'POST',
    path: `/api/MarkAsRead`,
    body: {
      MFRef: mfRef,
      id: ptrId,
      requestType,
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
  // Matches Mystifly ReissueQuoteRQ exactly (OND flow). Returns PTRId + PTRStatus=Completed;
  // the actual fare options come from getExchangeQuote (Search PTR).
  const requestBody = {
    AcceptQuote: 'None',
    AdditionalNote: null,
    AllowChildPassenger: false,
    IsScheduleChange: false,
    mFRef: mfRef,
    originDestinations: (Array.isArray(originDestinations) ? originDestinations : []).map(od => ({
      airlineCode: (od as any).airlineCode || '',
      cabinPreference: od.cabinPreference || 'Y',
      departureDateTime: od.departureDateTime,
      destinationLocationCode: od.destinationLocationCode,
      flightNumber: 0,
      originLocationCode: od.originLocationCode,
    })),
    passengers: (Array.isArray(passengers) ? passengers : []).map(p => ({
      eTicket: p.eTicket || '',
      firstName: p.firstName,
      lastName: p.lastName,
      passengerType: p.passengerType,
      // Defaulting to 'Mr' addressed every child and infant as an adult male.
      title: (p as any).title || passengerTitleCased((p as any).gender, p.passengerType),
    })),
    PaymentCardInfo: null,
    PreferenceOption: 0,
    PtrId: 0,
    ptrType: 'ReIssueQuote',
    RefundDetails: null,
    reissueQuoteRequestType: 'OND',
  };

  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/PostTicketingRequest',
    body: requestBody as unknown as Record<string, unknown>,
    retries: 0,
  });
}

/**
 * Get Exchange Quote — the reissue fare options (Search PTR).
 * Returns Data.RequestedPreferences[].QuotedFares[] (TotalFareDifference, Penalty, …).
 */
export async function getExchangeQuote(mfRef: string, ptrId: number): Promise<any> {
  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/Search/PostTicketingRequest',
    body: {
      MFRef: mfRef,
      Page: 1,
      PTRCategory: 'None',
      PTRId: ptrId,
      PTRStatus: 'None',
      ptrType: 'GetExchangeQuote',
      ShowProcessingMethod: 'False',
    } as unknown as Record<string, unknown>,
    retries: 1,
  });
}

/**
 * Search a PTR's status/resolution (Search PTR). Used to poll async executions
 * (Void/Refund/Reissue) for PTRStatus=Completed and the Resolution tag.
 */
export async function searchPtr(ptrType: 'Void' | 'Refund' | 'Reissue', mfRef: string, ptrId: number): Promise<any> {
  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/Search/PostTicketingRequest',
    body: {
      ptrType,
      MFRef: mfRef,
      PTRId: ptrId,
      ...(ptrType === 'Reissue' ? { PTRCategory: 'All' } : {}),
      Page: 1,
    } as unknown as Record<string, unknown>,
    retries: 1,
  });
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
      AcceptQuote: 'yes',
      AdditionalNote: 'Please reissue as per quoted fare',
      AllowChildPassenger: false,
      IsScheduleChange: false,
      mFRef: mfRef,
      originDestinations: null,
      passengers: null,
      PaymentCardInfo: null,
      PreferenceOption: preferenceOption,
      PtrId: ptrId,
      ptrType: 'ReIssueQuote',
      RefundDetails: null,
      reissueQuoteRequestType: 'None',
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
export async function voidQuote(mfRef: string, passengers: PtrPassenger[] = []): Promise<any> {
  // Mystifly requires the passengers array (firstName/lastName/title/eTicket/passengerType).
  // VoidQuote returns synchronously with PTRStatus=Completed + Data.VoidQuotes[].
  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/PostTicketingRequest',
    body: { ptrType: 'VoidQuote', mFRef: mfRef, passengers } as unknown as Record<string, unknown>,
    retries: 0,
  });
}

/**
 * Execute a Void (confirm void cancellation) via PTR.
 *
 * Flow: POST /api/PostTicketingRequest with ptrType=Void, AcceptQuote=yes
 * Requires the PtrId from the VoidQuote response.
 */
export async function executeVoid(
  mfRef: string,
  passengers: PtrPassenger[] = [],
): Promise<any> {
  // Direct Void (per Mystifly "Void Steps"): create a Void PTR with the passengers
  // array. Returns PTRStatus=InProcess + PTRId; fulfilment is async — poll searchPtr
  // until PTRStatus=Completed & Resolution=Voided.
  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/PostTicketingRequest',
    body: { ptrType: 'Void', mFRef: mfRef, passengers } as unknown as Record<string, unknown>,
    retries: 0, // Never retry void executions
  });
}

/**
 * Request a Refund Quote from Mystifly via PTR.
 *
 * Flow: POST /api/PostTicketingRequest with ptrType=RefundQuote
 * Returns: PTR record with PtrId, penalty breakdown, refundable amount.
 *
 * Used when void is not available (outside void window).
 */
export async function refundQuote(
  mfRef: string,
  passengers: PtrPassenger[] = [],
  refundDetails: MystiflyRefundDetail[] = [],
): Promise<any> {
  // NOT synchronous, despite what this comment used to claim. Every RefundQuote
  // raised on this account has come back PTRStatus=InProcess,
  // Resolution=QuoteRequested with an EMPTY RefundQuotes[] — 4 of 4, none ever
  // priced. A VoidQuote by contrast answers in the same response with populated
  // Data.VoidQuotes[] (see FMRRNII3), so the difference is the request type, not
  // our parsing. Callers must treat an empty array as "not priced yet", never as
  // zero; see isQuoteUnanswered in routes/mystifly-ptr.ts.
  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/PostTicketingRequest',
    // RefundDetails is required, not optional. Omitting it is answered with
    // "Refund quote request cannot be processed as the refund details are
    // missing from the request." — wording that names no field and reads like an
    // airline limitation. Proven on MF35565926: same request minus this array
    // fails, with it returns PTRId 22982. See lib/refund-details.
    body: {
      ptrType: 'RefundQuote',
      mFRef: mfRef,
      passengers,
      ...(refundDetails.length ? { RefundDetails: refundDetails } : {}),
    } as unknown as Record<string, unknown>,
    retries: 0,
  });
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
  passengers: PtrPassenger[] = [],
  note = 'Refund accepted',
): Promise<any> {
  // Accept Refund (per Mystifly): ptrType stays "RefundQuote" with AcceptQuote=yes and the
  // RefundQuote PtrId. Returns PTRType=Refund, PTRStatus=InProcess; poll searchPtr('Refund')
  // until PTRStatus=Completed & Resolution=Refunded.
  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/PostTicketingRequest',
    body: { ptrType: 'RefundQuote', mFRef: mfRef, PtrId: ptrId, AcceptQuote: 'yes', AdditionalNote: note, passengers } as unknown as Record<string, unknown>,
    retries: 0, // Never retry refund executions
  });
}

// ═══════════════════════════════════════════════
// Passenger Update / Name Correction
// ═══════════════════════════════════════════════

export interface MystiflyUpdatePassengerRQ {
  paxId: number;
  title?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  FFN?: string;
  DOB?: string;
  gender?: string;
  eTicket?: string;
  passengerType?: string;
  KTNNumber?: string;
  KTNCountry?: string;
  redressNumber?: string;
  redressCountry?: string;
}

/**
 * Update a passenger's mutable details (contact, DOB, gender, FFN, KTN, redress).
 * POST /api/UpdatePassenger. Note: Mystifly's UpdatePassenger does NOT accept
 * passport number/expiry/nationality — those stay FareMind-local. Post-booking,
 * billable-adjacent — no retry.
 */
export async function updatePassenger(mfRef: string, pax: MystiflyUpdatePassengerRQ): Promise<any> {
  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/UpdatePassenger',
    body: { MFRef: mfRef, ...pax } as unknown as Record<string, unknown>,
    retries: 0,
  });
}

export interface MystiflyNameCorrectionPassenger {
  PaxId: number;
  firstName: string;
  lastName: string;
  title?: string;
  eTicket?: string;
  email?: string;
  phoneNo?: string;
  passengerType?: string;
}

/**
 * Request a name correction for one or more passengers.
 * POST /api/NameCorrectionRequest. Post-booking, billable — no retry.
 */
export async function nameCorrection(mfRef: string, passengers: MystiflyNameCorrectionPassenger[]): Promise<any> {
  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/NameCorrectionRequest',
    body: { MFRef: mfRef, passengers } as unknown as Record<string, unknown>,
    retries: 0,
  });
}

// ═══════════════════════════════════════════════
// Schedule Change (airline-initiated / IROPS)
// ═══════════════════════════════════════════════

export type MystiflyScheduleActionType =
  | 'None' | 'Accept' | 'ChooseAlternative' | 'Refund' | 'ReIssue'
  | 'ASCRefund' | 'ASCReissue' | 'ASCReissueQuote' | 'Reject' | 'Retain';

export type MystiflyScheduleRejectOption =
  | 'None' | 'ASCReissueSearch' | 'ASCReissue' | 'QuoteforRefund' | 'ApplyforRefund';

export interface MystiflyScheduleFlightOption {
  FlightNumber?: number;
  AirlineCode?: string;
  TravelDate?: string;
  DepartureTime?: string;
  CityPair?: string;
}

/**
 * Poll the provider queue — the detection source for airline-initiated schedule
 * changes (and other ops messages). POST /api/Search/GetQueue → paginated
 * { Data: [...items], Page, TotalPages }. Empty → { Data: [], "No Records Found" }.
 */
export async function searchQueue(page: number = 1): Promise<any> {
  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/Search/GetQueue',
    body: { Page: page } as unknown as Record<string, unknown>,
    retries: 1,
  });
}

/**
 * Get the schedule-change policy/details for a booking.
 * POST /api/GetPolicyInfoForScheduleChange { ActionType, MFRef }. Used to detect
 * whether a booking has a pending airline schedule change and what options apply.
 */
export async function getScheduleChangePolicy(mfRef: string, actionType: MystiflyScheduleActionType = 'None'): Promise<any> {
  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/GetPolicyInfoForScheduleChange',
    body: { ActionType: actionType, MFRef: mfRef } as unknown as Record<string, unknown>,
    retries: 1,
  });
}

/**
 * Act on a schedule change (Accept / Refund / ReIssue / Reject / Retain / …).
 * POST /api/ScheduleChange. Billable action — no retry.
 */
export async function applyScheduleChange(
  mfRef: string,
  actionType: MystiflyScheduleActionType,
  opts: {
    rejectOption?: MystiflyScheduleRejectOption;
    flightOptions?: MystiflyScheduleFlightOption[];
    comments?: string;
    allowRevalidation?: boolean;
    allowReissue?: boolean;
    isOverridden?: boolean;
  } = {},
): Promise<any> {
  return mystiflyRequest<any>({
    method: 'POST',
    path: '/api/ScheduleChange',
    body: {
      ActionType: actionType,
      MFRef: mfRef,
      RejectOption: opts.rejectOption || 'None',
      FlightOptions: opts.flightOptions || [],
      Comments: opts.comments || null,
      AllowRevalidation: opts.allowRevalidation ?? false,
      AllowReissue: opts.allowReissue ?? false,
      IsOverridden: opts.isOverridden ?? false,
    } as unknown as Record<string, unknown>,
    retries: 0,
  });
}

/**
 * Accept a specific schedule-changed flight by id.
 * GET /api/ScheduleChangeAccept/{MFRef}/{FlightId}. Billable action — no retry.
 */
export async function acceptScheduleChangeByFlight(mfRef: string, flightId: string | number): Promise<any> {
  return mystiflyRequest<any>({
    method: 'GET',
    path: `/api/ScheduleChangeAccept/${encodeURIComponent(mfRef)}/${encodeURIComponent(String(flightId))}`,
    retries: 0,
  });
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
  getCouponStatus,
  searchCreditNotes,
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
  // Passenger update / name correction
  updatePassenger,
  nameCorrection,
  // Schedule change (IROPS)
  searchQueue,
  getScheduleChangePolicy,
  applyScheduleChange,
  acceptScheduleChangeByFlight,
  // Helpers
  toCabinType,
  fromCabinType,
  // Constants
  CABIN_MAP,
  CABIN_REVERSE_MAP,
};

