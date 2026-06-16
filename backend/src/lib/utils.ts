/**
 * Backend utility functions (server-side only).
 * No client-side dependencies (clsx, etc.).
 */

export function formatPrice(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getAirlineLogo(code: string): string {
  return `https://images.kiwi.com/airlines/64/${code}.png`;
}

// IATA code → full airline name (covers major carriers seen in search results)
const AIRLINE_NAMES: Record<string, string> = {
  '6E': 'IndiGo', '9W': 'Jet Airways', AA: 'American Airlines', AC: 'Air Canada',
  AF: 'Air France', AI: 'Air India', AK: 'AirAsia', AM: 'Aeroméxico',
  AS: 'Alaska Airlines', AT: 'Royal Air Maroc', AY: 'Finnair', AZ: 'ITA Airways',
  BA: 'British Airways', BG: 'Biman Bangladesh', BR: 'EVA Air', BX: 'Air Busan',
  CA: 'Air China', CI: 'China Airlines', CM: 'Copa Airlines', CX: 'Cathay Pacific',
  CZ: 'China Southern', DL: 'Delta Air Lines', EI: 'Aer Lingus', EK: 'Emirates',
  ET: 'Ethiopian Airlines', EW: 'Eurowings', EY: 'Etihad Airways', FJ: 'Fiji Airways',
  FR: 'Ryanair', GA: 'Garuda Indonesia', GF: 'Gulf Air', HA: 'Hawaiian Airlines',
  HU: 'Hainan Airlines', IB: 'Iberia', IX: 'Air India Express', JL: 'Japan Airlines',
  KE: 'Korean Air', KL: 'KLM', KU: 'Kuwait Airways', LA: 'LATAM Airlines',
  LH: 'Lufthansa', LO: 'LOT Polish Airlines', LX: 'Swiss International Air Lines',
  MH: 'Malaysia Airlines', MS: 'EgyptAir', MU: 'China Eastern', NH: 'ANA',
  NK: 'Spirit Airlines', NZ: 'Air New Zealand', OK: 'Czech Airlines', OM: 'MIAT Mongolian',
  OS: 'Austrian Airlines', OZ: 'Asiana Airlines', PC: 'Pegasus Airlines',
  PG: 'Bangkok Airways', PK: 'PIA', PR: 'Philippine Airlines', PS: 'UIA',
  QF: 'Qantas', QR: 'Qatar Airways', RJ: 'Royal Jordanian', RO: 'TAROM',
  SA: 'South African Airways', SK: 'SAS', SN: 'Brussels Airlines', SQ: 'Singapore Airlines',
  SU: 'Aeroflot', SV: 'Saudia', TG: 'Thai Airways', TK: 'Turkish Airlines',
  TP: 'TAP Air Portugal', UA: 'United Airlines', UL: 'SriLankan Airlines',
  UK: 'Vistara', UX: 'Air Europa', VA: 'Virgin Australia', VN: 'Vietnam Airlines',
  VS: 'Virgin Atlantic', VY: 'Vueling', W6: 'Wizz Air', WN: 'Southwest Airlines',
  WS: 'WestJet', WY: 'Oman Air', ZZ: 'Duffel Airways',
  LW: 'Lufthansa CityLine', CL: 'Lufthansa CityLine', EN: 'Air Dolomiti',
  '4Y': 'Eurowings Discover', '4U': 'Germanwings', SG: 'SpiceJet',
  SWISS: 'SWISS', LF: 'Lufthansa', J2: 'Azerbaijan Airlines',
};

/** Resolve IATA code to full airline name. Falls back to the code itself. */
export function getAirlineName(code: string): string {
  return AIRLINE_NAMES[code] || code;
}

export function generateId(): string {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

/**
 * Calculate a value score for a single flight offer.
 *
 * Uses a combination of relative (within-set) and absolute scoring
 * to differentiate flights even when attributes are very similar.
 *
 * Note: This is an absolute scoring function (no access to the full result set).
 * For set-relative scoring, see mergeAndRankFlights in normalizer.ts
 * and rankRoundTripOptions in round-trip-score.ts.
 */
export function calculateValueScore(
  price: number,
  duration: number,
  stops: number,
  refundable: boolean
): number {
  // Price score: use a log-scale curve so $200 and $2000 flights
  // don't both end up near 100. Anchor: $300 = 80, $1500 = 30.
  const priceScore = Math.max(0, Math.min(100,
    120 - 25 * Math.log10(Math.max(price, 50))
  ));

  // Duration score: short-haul (<3h) = 90+, long-haul (18h) ≈ 25
  const durationScore = Math.max(0, Math.min(100,
    100 - (duration / 12)
  ));

  // Stops: 0 = 40, 1 = 20, 2+ = 5
  const stopScore = stops === 0 ? 40 : stops === 1 ? 20 : 5;

  // Refundable bonus
  const refundScore = refundable ? 10 : 0;

  return Math.round(
    priceScore * 0.45 +
    durationScore * 0.30 +
    stopScore * 0.15 +
    refundScore * 0.10
  );
}
