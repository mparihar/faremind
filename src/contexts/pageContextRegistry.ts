/**
 * Page Context Registry
 *
 * Maps page routes to context names and their supported voice actions.
 * Phase 1: Only HOME_SEARCH with SEARCH_FLIGHTS.
 * Future phases will add more contexts and actions.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type PageContext =
  | 'HOME_SEARCH'
  | 'FLIGHT_RESULTS'
  | 'FARE_SELECTION'
  | 'PASSENGER_DETAILS'
  | 'SEAT_SELECTION'
  | 'MANAGE_BOOKING'
  | 'UNKNOWN';

export type VoiceAction =
  | 'SEARCH_FLIGHTS'
  | 'FILL_PASSENGER_DETAILS'
  | 'FILL_PRIMARY_CONTACT';
// Future actions:
// | 'SELECT_FLIGHT_BY_SCORE'
// | 'SELECT_FLIGHT_BY_PRICE'
// | 'SELECT_FARE'
// | 'SELECT_SEAT'

// ─── Action registry ────────────────────────────────────────────────────────

export const PAGE_ACTIONS: Record<PageContext, VoiceAction[]> = {
  HOME_SEARCH: ['SEARCH_FLIGHTS'],
  FLIGHT_RESULTS: [],     // Future
  FARE_SELECTION: [],     // Future
  PASSENGER_DETAILS: ['FILL_PASSENGER_DETAILS', 'FILL_PRIMARY_CONTACT'],
  SEAT_SELECTION: [],     // Future
  MANAGE_BOOKING: [],     // Future
  UNKNOWN: [],
};

// ─── Route → Context mapping ────────────────────────────────────────────────

/**
 * Determine the page context from the current pathname.
 */
export function getPageContext(pathname: string): PageContext {
  if (pathname === '/') return 'HOME_SEARCH';
  if (pathname === '/search') return 'FLIGHT_RESULTS';
  if (pathname === '/fare-selection') return 'FARE_SELECTION';
  if (pathname === '/checkout/passengers') return 'PASSENGER_DETAILS';
  if (pathname.startsWith('/manage-booking')) return 'MANAGE_BOOKING';
  return 'UNKNOWN';
}

/**
 * Check if a given voice action is supported on the specified page context.
 */
export function isActionSupported(context: PageContext, action: string): boolean {
  return (PAGE_ACTIONS[context] ?? []).includes(action as VoiceAction);
}

/**
 * Get a user-friendly description of what the assistant can do on this page.
 */
export function getContextHelpText(context: PageContext): string {
  switch (context) {
    case 'HOME_SEARCH':
      return 'I can search flights for you. Try saying a destination, dates, and number of travelers.';
    case 'PASSENGER_DETAILS':
      return 'I can fill passenger details by voice. Say a traveler number and their info.';
    case 'FLIGHT_RESULTS':
      return 'Flight results actions coming soon. Use the search page to find flights by voice.';
    default:
      return 'Voice commands for this page are coming soon. Navigate to the home page to search flights by voice.';
  }
}
