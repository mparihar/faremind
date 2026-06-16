import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// ─── Time Formatting ───

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateFull(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ─── Price Formatting ───

export function formatPrice(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPriceDecimal(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ─── Airport & Airline ───

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

export function getAirlineLogo(code: string): string {
  // Using a CDN for airline logos
  return `https://images.kiwi.com/airlines/64/${code}.png`;
}

export function getStopsLabel(stops: number): string {
  if (stops === 0) return 'Nonstop';
  if (stops === 1) return '1 stop';
  return `${stops} stops`;
}

// ─── Misc ───

export function generateId(): string {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

export function calculateValueScore(
  price: number,
  duration: number,
  stops: number,
  refundable: boolean
): number {
  // Lower is better for all inputs
  const priceScore = Math.max(0, 100 - (price / 20)); // normalize to 0-100
  const durationScore = Math.max(0, 100 - (duration / 10)); // penalize long flights
  const stopScore = (2 - Math.min(stops, 2)) * 20; // 0 stops = 40, 1 = 20, 2+ = 0
  const refundScore = refundable ? 10 : 0;

  return Math.round(
    priceScore * 0.45 +
    durationScore * 0.30 +
    stopScore * 0.15 +
    refundScore * 0.10
  );
}

// ─── Date helpers ───

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function getDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getTomorrow(): string {
  return getDateString(addDays(new Date(), 1));
}

export function getNextWeek(): string {
  return getDateString(addDays(new Date(), 7));
}
