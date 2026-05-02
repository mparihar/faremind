// Public surface of the AI Intelligence Scoring Engine.
// Import from here — never from individual sub-modules.

export { aiRank, aiRankOneWay, aiRankRoundTrip } from './engine';
export type {
  AiUserPreferences,
  AiScoredOption,
  AiFilteredOut,
  AiRankResult,
  AiScoreBreakdown,
  AiSortMode,
  AiTag,
  AiLabel,
} from './types';
