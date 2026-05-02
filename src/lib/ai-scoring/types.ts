// ─── AI Scoring Engine — Types ────────────────────────────────────────────────

export type AiSortMode = 'best_value' | 'cheapest' | 'fastest' | 'fewest_stops';
export type AiTag    = 'Smart Value' | 'Fast & Reasonable' | 'Avoid';
export type AiLabel  = '✨ AI Pick' | 'Best Price' | 'Fastest';

export interface AiUserPreferences {
  budget?:         number | null;
  maxDuration?:    number | null; // minutes
  stops?:          'nonstop' | '1stop' | 'any';
  departureWindow?: 'morning' | 'afternoon' | 'evening' | 'night' | null;
  sortMode?:       AiSortMode;
}

// Stats computed over surviving candidates — passed to scorer for min/max normalization
export interface ScoringStats {
  minPrice:    number;
  maxPrice:    number;
  minDuration: number;
  maxDuration: number;
  avgDuration: number;
}

// Normalised shape used internally — same for one-way and round-trip
export interface NormalizedOption {
  id:               string;
  price:            number;
  currency:         string;
  durationMinutes:  number;
  stops:            number;
  airlineCount:     number;
  departureHour:    number;   // 0-23
  layoverMinutes:   number[];
}

export interface AiScoreBreakdown {
  priceScore:    number; // 0-1
  durationScore: number; // 0-1
  stopsScore:    number; // 0-1
  finalScore:    number; // 0-100
}

export interface AiScoredOption<T> {
  option:          T;
  aiScore:         number;        // 0-100
  labels:          AiLabel[];
  tag?:            AiTag;
  layoverPenalty:  number;        // 0-1
  filtered:        false;
  scoreBreakdown?: AiScoreBreakdown; // debug only
}

export interface AiFilteredOut<T> {
  option:   T;
  reason:   string;
  filtered: true;
}

export interface AiRankResult<T> {
  ranked:      AiScoredOption<T>[];
  filteredOut: AiFilteredOut<T>[];
}
