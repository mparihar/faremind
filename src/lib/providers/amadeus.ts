/**
 * Amadeus API Client (GDS Layer)
 *
 * Handles communication with the Amadeus API for:
 * - Flight search (flight offers)
 * - Booking (flight orders)
 * - Price monitoring
 *
 * Docs: https://developers.amadeus.com
 *
 * Environment:
 * - AMADEUS_CLIENT_ID: API key
 * - AMADEUS_CLIENT_SECRET: API secret
 * - AMADEUS_API_URL: Base URL (test: https://test.api.amadeus.com)
 */

const AMADEUS_API_URL = process.env.AMADEUS_API_URL || 'https://test.api.amadeus.com';
const AMADEUS_CLIENT_ID = process.env.AMADEUS_CLIENT_ID || '';
const AMADEUS_CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET || '';

let accessToken: string | null = null;
let tokenExpiry: number = 0;

// ─── Auth ───

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const response = await fetch(`${AMADEUS_API_URL}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: AMADEUS_CLIENT_ID,
      client_secret: AMADEUS_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`Amadeus auth failed: ${response.status}`);
  }

  const data = await response.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

  return accessToken!;
}

async function amadeusRequest<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken();

  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${AMADEUS_API_URL}${path}`, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Amadeus API error: ${response.status} - ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return data as T;
}

// ─── Search ───

export interface AmadeusSearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  children?: number;
  infants?: number;
  travelClass?: string;
  maxResults?: number;
}

export async function searchFlights(params: AmadeusSearchParams) {
  const queryParams = new URLSearchParams({
    originLocationCode: params.origin,
    destinationLocationCode: params.destination,
    departureDate: params.departureDate,
    adults: params.adults.toString(),
    max: (params.maxResults || 50).toString(),
    currencyCode: 'USD',
  });

  if (params.returnDate) {
    queryParams.set('returnDate', params.returnDate);
  }
  if (params.children) {
    queryParams.set('children', params.children.toString());
  }
  if (params.infants) {
    queryParams.set('infants', params.infants.toString());
  }
  if (params.travelClass) {
    queryParams.set('travelClass', params.travelClass.toUpperCase());
  }

  const data = await amadeusRequest<{
    data: unknown[];
    dictionaries: Record<string, unknown>;
  }>('GET', `/v2/shopping/flight-offers?${queryParams.toString()}`);

  return data;
}

// ─── Price Confirmation ───

export async function confirmPrice(offers: unknown[]) {
  const data = await amadeusRequest<{
    data: { flightOffers: unknown[] };
  }>('POST', '/v1/shopping/flight-offers/pricing', {
    data: {
      type: 'flight-offers-pricing',
      flightOffers: offers,
    },
  });

  return data;
}

// ─── Booking ───

export interface AmadeusBookingParams {
  flightOffer: unknown;
  travelers: {
    id: string;
    dateOfBirth: string;
    name: { firstName: string; lastName: string };
    gender: string;
    contact: {
      emailAddress: string;
      phones: { number: string; countryCallingCode: string }[];
    };
    documents?: {
      documentType: string;
      number: string;
      expiryDate: string;
      issuanceCountry: string;
      nationality: string;
      holder: boolean;
    }[];
  }[];
}

export async function createBooking(params: AmadeusBookingParams) {
  const data = await amadeusRequest<{
    data: {
      type: string;
      id: string;
      associatedRecords: { reference: string; originSystemCode: string }[];
    };
  }>('POST', '/v1/booking/flight-orders', {
    data: {
      type: 'flight-order',
      flightOffers: [params.flightOffer],
      travelers: params.travelers,
      remarks: {
        general: [{ subType: 'GENERAL_MISCELLANEOUS', text: 'Booked via FareMind' }],
      },
    },
  });

  return data;
}

// ─── Get Booking ───

export async function getBooking(orderId: string) {
  const data = await amadeusRequest<{ data: unknown }>('GET', `/v1/booking/flight-orders/${orderId}`);
  return data;
}

// ─── Cancel Booking ───

export async function cancelBooking(orderId: string) {
  await amadeusRequest<void>('DELETE', `/v1/booking/flight-orders/${orderId}`);
  return { success: true };
}

export default {
  searchFlights,
  confirmPrice,
  createBooking,
  getBooking,
  cancelBooking,
};
