export type ProfileId =
  | 'family_friendly'
  | 'avoid_stressful_layovers'
  | 'cheapest_nonstop_bags'
  | 'elderly_parents'
  | 'comfortable_overnight'
  | 'better_baggage'
  | 'reliable_airline'
  | 'short_connections'
  | 'no_overnight_layovers';

export interface PreferenceProfile {
  id: ProfileId;
  label: string;
  keywords: string[];
  weights: Record<string, number>;
  gpt_guidance: string;
}

export const PROFILES: Record<ProfileId, PreferenceProfile> = {
  family_friendly: {
    id: 'family_friendly',
    label: 'Family Friendly',
    keywords: ['family', 'kid', 'kids', 'children', 'child', 'toddler', 'baby', 'babies', 'young'],
    weights: {
      prefer_fewer_stops: 0.95,
      avoid_tight_connections: 1.0,
      prefer_longer_layover_buffer: 0.85,
      avoid_airport_change: 1.0,
      prefer_daytime_arrival: 0.70,
      prefer_baggage_included: 0.90,
      avoid_overnight_layovers: 0.95,
      prefer_reliable_airline: 0.75,
      penalize_red_eye: 0.65,
    },
    gpt_guidance: 'ALWAYS recommend flights — rank by family suitability, never say "no suitable flights". Prefer nonstop or fewest stops, no airport changes, included checked baggage, and daytime departures/arrivals. Penalize red-eyes and overnight layovers but DO NOT exclude them — explain trade-offs warmly. Family comfort outweighs lowest price. Present at least 3-5 best options.',
  },
  avoid_stressful_layovers: {
    id: 'avoid_stressful_layovers',
    label: 'Avoid Stressful Layovers',
    keywords: ['stress', 'stressful', 'layover', 'connection', 'connect', 'transfer', 'tight', 'rush', 'sprint', 'avoid layover'],
    weights: {
      avoid_short_connections: 1.0,
      avoid_airport_change: 1.0,
      prefer_single_stop: 0.80,
      prefer_terminal_consistency: 0.95,
      prefer_longer_layover_buffer: 0.90,
      penalize_multiple_connections: 1.0,
      avoid_overnight_connections: 0.95,
    },
    gpt_guidance: 'Prioritize flights with generous layover windows (90+ min), no airport changes mid-route. Penalize tight connections under 60 minutes and multiple stops. Same-terminal connections strongly preferred.',
  },
  cheapest_nonstop_bags: {
    id: 'cheapest_nonstop_bags',
    label: 'Cheapest Nonstop + Bags',
    keywords: ['cheap', 'cheapest', 'budget', 'nonstop', 'direct', 'bag', 'bags', 'baggage', 'luggage', 'affordable', 'lowest price'],
    weights: {
      prefer_nonstop: 1.0,
      prefer_lowest_price: 1.0,
      prefer_baggage_included: 0.95,
      prefer_short_duration: 0.80,
      penalize_extra_baggage_fee: 1.0,
      avoid_basic_fare_without_bags: 1.0,
    },
    gpt_guidance: 'Prioritize nonstop or fewest-stop flights with the lowest all-in price that include at least carry-on baggage. Penalize flights with no bags or expensive add-ons. Sort by price within nonstop tier.',
  },
  elderly_parents: {
    id: 'elderly_parents',
    label: 'Elderly Parents',
    keywords: ['elderly', 'parents', 'parent', 'mom', 'dad', 'grandparent', 'senior', 'grandma', 'grandpa', 'mobility', 'wheelchair', 'easy flight'],
    weights: {
      prefer_nonstop: 1.0,
      avoid_airport_change: 1.0,
      avoid_short_connections: 1.0,
      prefer_longer_layover_buffer: 0.85,
      prefer_daytime_arrival: 0.90,
      avoid_red_eye: 1.0,
      prefer_reliable_airline: 0.90,
      minimize_total_walking: 1.0,
      prefer_wheelchair_friendly_airports: 0.75,
    },
    gpt_guidance: 'Strongly prioritize nonstop. If connections unavoidable, prefer generous layovers (2+ hours), no airport changes, major hub airports with good accessibility. Avoid red-eye departures. Full-service reliable airlines strongly preferred.',
  },
  comfortable_overnight: {
    id: 'comfortable_overnight',
    label: 'Comfortable Overnight',
    keywords: ['overnight', 'night flight', 'sleep', 'comfortable', 'comfort', 'rest', 'evening departure', 'morning arrival', 'red eye', 'redeye'],
    weights: {
      prefer_evening_departure: 0.80,
      prefer_morning_arrival: 1.0,
      avoid_midnight_layovers: 1.0,
      prefer_longer_rest_window: 0.90,
      prefer_reliable_airline: 0.80,
      avoid_overnight_airport_wait: 1.0,
    },
    gpt_guidance: 'Prioritize flights with evening departures (after 7pm) and morning arrivals. Avoid flights with midnight airport layovers. Longer uninterrupted flight segments preferred for rest. Reliable airlines preferred.',
  },
  better_baggage: {
    id: 'better_baggage',
    label: 'Better Baggage',
    keywords: ['baggage', 'bag', 'bags', 'luggage', 'checked', 'carry on', 'carry-on', 'allowance', 'generous', 'more bags', 'extra bag'],
    weights: {
      prefer_checked_bags: 1.0,
      prefer_carry_on: 0.85,
      avoid_extra_baggage_fee: 1.0,
      prefer_full_service_airline: 0.75,
    },
    gpt_guidance: 'Rank by baggage generosity: checked bag included > carry-on only > no bags. Penalize basic economy without bags. Full-service airlines generally better baggage policies.',
  },
  reliable_airline: {
    id: 'reliable_airline',
    label: 'Reliable Airline',
    keywords: ['reliable', 'reliability', 'on-time', 'ontime', 'cancel', 'cancellation', 'delay', 'punctual', 'trustworthy', 'dependable', 'reputable'],
    weights: {
      prefer_high_reliability_score: 1.0,
      prefer_low_cancellation_rate: 0.95,
      prefer_low_delay_rate: 0.90,
      prefer_major_airline: 0.75,
    },
    gpt_guidance: 'Prioritize major full-service carriers known for reliability: Lufthansa, Singapore Airlines, Emirates, Qatar Airways, ANA, JAL, Swiss, Austrian, Delta, United, American, British Airways. Prefer fewer connections to reduce disruption risk.',
  },
  short_connections: {
    id: 'short_connections',
    label: 'Short Connections',
    keywords: ['short', 'quick', 'fast', 'fastest', 'minimal', 'shortest', 'less time', 'total time', 'duration', 'quickest'],
    weights: {
      prefer_short_total_duration: 1.0,
      prefer_minimal_layover: 0.95,
      prefer_fewer_stops: 0.90,
      avoid_long_wait_airports: 1.0,
    },
    gpt_guidance: 'Minimize total journey time including all layovers. Prioritize nonstop or fewest stops. Among connecting flights prefer shorter layovers (45-90 min) at well-connected hub airports. Rank strictly by total door-to-door time.',
  },
  no_overnight_layovers: {
    id: 'no_overnight_layovers',
    label: 'No Overnight Layovers',
    keywords: ['no overnight', 'overnight layover', 'night layover', 'sleep airport', 'midnight layover', 'daytime only', 'no night layover'],
    weights: {
      avoid_overnight_layovers: 1.0,
      prefer_same_day_connections: 0.95,
      prefer_daytime_transfer: 0.85,
      avoid_red_eye: 0.80,
    },
    gpt_guidance: 'Exclude or heavily penalize any flight with an overnight layover (connection spanning midnight). Prefer same-day connections completed before midnight local time. Daytime connections strongly preferred.',
  },
};

const ALL_PROFILES = Object.values(PROFILES);

export function matchProfile(query: string): PreferenceProfile | null {
  if (!query?.trim()) return null;
  const q = query.toLowerCase();
  let best: PreferenceProfile | null = null;
  let bestScore = 0;
  for (const profile of ALL_PROFILES) {
    const score = profile.keywords.reduce((acc, kw) => acc + (q.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = profile; }
  }
  return bestScore > 0 ? best : null;
}
