// ═══════════════════════════════════════════════════════════════════════════════
// 🧬 DNA Search Analytics
// Lightweight event tracking for DNA Search interactions.
// ═══════════════════════════════════════════════════════════════════════════════

type DnaAnalyticsEvent =
  | 'dna_search_started'
  | 'dna_search_completed'
  | 'dna_search_result_viewed'
  | 'dna_match_selected'
  | 'dna_booking_started'
  | 'dna_booking_completed';

interface DnaAnalyticsPayload {
  event: DnaAnalyticsEvent;
  userId?: string;
  searchSessionId?: string;
  cardId?: string;
  aiScore?: number;
  dnaScore?: number;
  finalDnaScore?: number;
  matchLabel?: string;
  source?: 'flight_page' | 'chatbot';
  totalResults?: number;
  cached?: boolean;
  timestamp: number;
}

const analyticsQueue: DnaAnalyticsPayload[] = [];

export function trackDnaEvent(
  event: DnaAnalyticsEvent,
  data: Omit<DnaAnalyticsPayload, 'event' | 'timestamp'> = {},
): void {
  const payload: DnaAnalyticsPayload = {
    event,
    ...data,
    timestamp: Date.now(),
  };

  // Console log for development observability

  // Queue for potential batch send (future: send to analytics backend)
  analyticsQueue.push(payload);

  // Keep queue size manageable
  if (analyticsQueue.length > 100) {
    analyticsQueue.splice(0, analyticsQueue.length - 50);
  }
}

export function getAnalyticsQueue(): readonly DnaAnalyticsPayload[] {
  return analyticsQueue;
}
