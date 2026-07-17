/**
 * Voice Command Parser Service
 *
 * API client for the Fastify voice command endpoint.
 * Sends a transcript + page context to the backend and receives
 * a structured action command.
 *
 * Phase 1: Flight search (HOME_SEARCH)
 * Phase 2: Passenger details (PASSENGER_DETAILS)
 */

import { apiFetch } from '@/lib/api-client';
import type { PageContext } from '@/contexts/pageContextRegistry';

// ─── Phase 1 Types — Flight Search ─────────────────────────────────────────

export interface VoiceSearchParams {
  origin: string | null;
  destination: string | null;
  departureDate: string | null;
  returnDate: string | null;
  tripType: 'ROUND_TRIP' | 'ONE_WAY';
  adults: number;
  children: number;
  infants: number;
  cabinClass: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
}

export interface VoiceCommandResult {
  action: string;
  params: VoiceSearchParams;
}

// ─── Phase 2 Types — Passenger Details ──────────────────────────────────────

export interface PassengerContext {
  totalTravelers: number;
  travelers: Array<{
    travelerIndex: number;
    passengerType: 'ADULT' | 'CHILD' | 'INFANT';
  }>;
}

export interface VoicePassengerParams {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  passportCountry?: string | null;
  passportNumber?: string | null;
  passportExpiry?: string | null;
  email?: string | null;
  phoneCountryCode?: string | null;
  phoneNumber?: string | null;
}

export interface VoicePassengerResult {
  action: 'FILL_PASSENGER_DETAILS' | 'FILL_PRIMARY_CONTACT' | 'CLARIFY';
  target?: 'TRAVELER' | 'PRIMARY_CONTACT';
  travelerIndex?: number;
  params: VoicePassengerParams;
  missingFields?: string[];
  message?: string; // for CLARIFY action
}

// ─── Phase 1 API call ───────────────────────────────────────────────────────

/**
 * Send a voice transcript to the Fastify backend for GPT-4o Mini parsing.
 *
 * @param transcript - The speech-to-text string from the browser
 * @param pageContext - Current page context (e.g. 'HOME_SEARCH')
 * @returns Structured voice command with action + params
 */
export async function parseVoiceCommand(
  transcript: string,
  pageContext: PageContext = 'HOME_SEARCH',
): Promise<VoiceCommandResult> {

  const result = await apiFetch<VoiceCommandResult>('/api/voice/parse-command', {
    method: 'POST',
    body: JSON.stringify({ transcript, pageContext }),
  });

  return result;
}

// ─── Phase 2 API call — Passenger Details ───────────────────────────────────

/**
 * Send a voice transcript for passenger detail parsing.
 *
 * @param transcript - The speech-to-text string
 * @param passengerContext - Info about available travelers on the page
 * @returns Structured passenger fill command
 */
export async function parsePassengerVoiceCommand(
  transcript: string,
  passengerContext: PassengerContext,
): Promise<VoicePassengerResult> {

  const result = await apiFetch<VoicePassengerResult>('/api/voice/parse-command', {
    method: 'POST',
    body: JSON.stringify({
      pageContext: 'PASSENGER_DETAILS',
      transcript,
      passengerContext,
    }),
  });

  return result;
}
