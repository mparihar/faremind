/**
 * Airport → IANA timezone.
 *
 * Providers send local airport times with no offset ("2026-09-23T23:30:00").
 * Subtracting two of them treats both as one clock, so a DEL→YYZ journey read
 * 15h09m when it is really 24h39m, and the same trip reversed read 34h03m when
 * it is really 24h33m — understated eastbound and overstated westbound by the
 * 9h30m gap between the two zones.
 *
 * Resolution order:
 *
 *   1. AIRPORT_ZONES — airports in countries that span several zones, or whose
 *      zone differs from the rest of their country (Phoenix has no DST).
 *   2. COUNTRY_ZONES — every country where one zone covers all our airports.
 *   3. null — we do not know, and the caller must fall back rather than guess.
 *      A wrong duration is worse than the old one, because it looks authoritative.
 */
import { AIRPORTS } from '@/data/airports';

/** Airports whose country spans more than one zone, or which are an exception. */
const AIRPORT_ZONES: Record<string, string> = {
  // ── United States ──
  // Eastern
  JFK: 'America/New_York', LGA: 'America/New_York', EWR: 'America/New_York',
  BOS: 'America/New_York', PHL: 'America/New_York', IAD: 'America/New_York',
  DCA: 'America/New_York', BWI: 'America/New_York', BDL: 'America/New_York',
  ALB: 'America/New_York', BUF: 'America/New_York', SYR: 'America/New_York',
  ROC: 'America/New_York', MHT: 'America/New_York', PWM: 'America/New_York',
  PVD: 'America/New_York', ATL: 'America/New_York', MIA: 'America/New_York',
  FLL: 'America/New_York', MCO: 'America/New_York', TPA: 'America/New_York',
  JAX: 'America/New_York', PBI: 'America/New_York', RSW: 'America/New_York',
  CLT: 'America/New_York', RDU: 'America/New_York', GSO: 'America/New_York',
  CHS: 'America/New_York', SAV: 'America/New_York', RIC: 'America/New_York',
  ORF: 'America/New_York', CMH: 'America/New_York', CLE: 'America/New_York',
  CVG: 'America/New_York', IND: 'America/Indiana/Indianapolis',
  SDF: 'America/New_York', DTW: 'America/Detroit', GRR: 'America/Detroit',
  // Central
  MSY: 'America/Chicago', BHM: 'America/Chicago', BNA: 'America/Chicago',
  MEM: 'America/Chicago', ORD: 'America/Chicago', MDW: 'America/Chicago',
  MSP: 'America/Chicago', STL: 'America/Chicago', MCI: 'America/Chicago',
  MKE: 'America/Chicago', OMA: 'America/Chicago', DFW: 'America/Chicago',
  DAL: 'America/Chicago', IAH: 'America/Chicago', HOU: 'America/Chicago',
  SAT: 'America/Chicago', AUS: 'America/Chicago', OKC: 'America/Chicago',
  TUL: 'America/Chicago', LIT: 'America/Chicago', JAN: 'America/Chicago',
  FAR: 'America/Chicago', LBB: 'America/Chicago',
  // Mountain — Phoenix and Tucson keep no DST, so they are their own zone.
  DEN: 'America/Denver', ABQ: 'America/Denver', BIL: 'America/Denver',
  SLC: 'America/Denver', ELP: 'America/Denver', BOI: 'America/Boise',
  PHX: 'America/Phoenix', TUS: 'America/Phoenix',
  // Pacific
  LAX: 'America/Los_Angeles', SFO: 'America/Los_Angeles', SJC: 'America/Los_Angeles',
  OAK: 'America/Los_Angeles', SAN: 'America/Los_Angeles', SNA: 'America/Los_Angeles',
  BUR: 'America/Los_Angeles', LGB: 'America/Los_Angeles', SMF: 'America/Los_Angeles',
  FAT: 'America/Los_Angeles', SEA: 'America/Los_Angeles', PDX: 'America/Los_Angeles',
  GEG: 'America/Los_Angeles', LAS: 'America/Los_Angeles', RNO: 'America/Los_Angeles',
  // Non-contiguous
  HNL: 'Pacific/Honolulu', OGG: 'Pacific/Honolulu', KOA: 'Pacific/Honolulu',
  ANC: 'America/Anchorage', FAI: 'America/Anchorage', GUM: 'Pacific/Guam',

  // ── Canada ──
  YYZ: 'America/Toronto', YOW: 'America/Toronto', YUL: 'America/Toronto',
  YHZ: 'America/Halifax', YWG: 'America/Winnipeg',
  YYC: 'America/Edmonton', YEG: 'America/Edmonton', YVR: 'America/Vancouver',

  // ── Mexico ──
  MEX: 'America/Mexico_City', GDL: 'America/Mexico_City', MTY: 'America/Monterrey',
  CUN: 'America/Cancun', SJD: 'America/Mazatlan', MZT: 'America/Mazatlan',
  PVR: 'America/Bahia_Banderas',

  // ── Brazil ──
  GRU: 'America/Sao_Paulo', GIG: 'America/Sao_Paulo', BSB: 'America/Sao_Paulo',

  // ── Australia ──
  SYD: 'Australia/Sydney', MEL: 'Australia/Melbourne', CBR: 'Australia/Sydney',
  BNE: 'Australia/Brisbane', OOL: 'Australia/Brisbane', CNS: 'Australia/Brisbane',
  PER: 'Australia/Perth', ADL: 'Australia/Adelaide',

  // ── Russia ──
  SVO: 'Europe/Moscow', DME: 'Europe/Moscow', LED: 'Europe/Moscow',

  // ── Indonesia ──
  CGK: 'Asia/Jakarta', SUB: 'Asia/Jakarta', DPS: 'Asia/Makassar',

  // ── Others in multi-zone countries ──
  ALA: 'Asia/Almaty', NQZ: 'Asia/Almaty',
  UIO: 'America/Guayaquil', GYE: 'America/Guayaquil',
};

/** Countries where a single zone covers every airport we carry. */
const COUNTRY_ZONES: Record<string, string> = {
  India: 'Asia/Kolkata',
  'United Kingdom': 'Europe/London', Ireland: 'Europe/Dublin',
  France: 'Europe/Paris', Spain: 'Europe/Madrid', Portugal: 'Europe/Lisbon',
  Germany: 'Europe/Berlin', Netherlands: 'Europe/Amsterdam', Belgium: 'Europe/Brussels',
  Switzerland: 'Europe/Zurich', Austria: 'Europe/Vienna', Italy: 'Europe/Rome',
  Denmark: 'Europe/Copenhagen', Sweden: 'Europe/Stockholm', Norway: 'Europe/Oslo',
  Finland: 'Europe/Helsinki', Poland: 'Europe/Warsaw', 'Czech Republic': 'Europe/Prague',
  Czechia: 'Europe/Prague', Hungary: 'Europe/Budapest', Greece: 'Europe/Athens',
  Turkey: 'Europe/Istanbul', Romania: 'Europe/Bucharest', Bulgaria: 'Europe/Sofia',
  Croatia: 'Europe/Zagreb', Serbia: 'Europe/Belgrade', Ukraine: 'Europe/Kyiv',
  Iceland: 'Atlantic/Reykjavik', Luxembourg: 'Europe/Luxembourg', Malta: 'Europe/Malta',
  Cyprus: 'Asia/Nicosia', Estonia: 'Europe/Tallinn', Latvia: 'Europe/Riga',
  Lithuania: 'Europe/Vilnius', Slovakia: 'Europe/Bratislava', Slovenia: 'Europe/Ljubljana',
  Albania: 'Europe/Tirane', 'Bosnia and Herzegovina': 'Europe/Sarajevo',

  'United Arab Emirates': 'Asia/Dubai', 'Saudi Arabia': 'Asia/Riyadh',
  Qatar: 'Asia/Qatar', Kuwait: 'Asia/Kuwait', Bahrain: 'Asia/Bahrain',
  Oman: 'Asia/Muscat', Jordan: 'Asia/Amman', Lebanon: 'Asia/Beirut',
  Israel: 'Asia/Jerusalem', Iran: 'Asia/Tehran', Iraq: 'Asia/Baghdad',

  Japan: 'Asia/Tokyo', 'South Korea': 'Asia/Seoul', China: 'Asia/Shanghai',
  'Hong Kong': 'Asia/Hong_Kong', Taiwan: 'Asia/Taipei', Macau: 'Asia/Macau',
  Singapore: 'Asia/Singapore', Malaysia: 'Asia/Kuala_Lumpur', Thailand: 'Asia/Bangkok',
  Vietnam: 'Asia/Ho_Chi_Minh', Philippines: 'Asia/Manila', Cambodia: 'Asia/Phnom_Penh',
  Laos: 'Asia/Vientiane', Myanmar: 'Asia/Yangon', Brunei: 'Asia/Brunei',
  Pakistan: 'Asia/Karachi', Bangladesh: 'Asia/Dhaka', 'Sri Lanka': 'Asia/Colombo',
  Nepal: 'Asia/Kathmandu', Maldives: 'Indian/Maldives', Bhutan: 'Asia/Thimphu',
  Afghanistan: 'Asia/Kabul', Uzbekistan: 'Asia/Tashkent', Azerbaijan: 'Asia/Baku',
  Georgia: 'Asia/Tbilisi', Armenia: 'Asia/Yerevan', Mongolia: 'Asia/Ulaanbaatar',

  Egypt: 'Africa/Cairo', Morocco: 'Africa/Casablanca', Tunisia: 'Africa/Tunis',
  Algeria: 'Africa/Algiers', 'South Africa': 'Africa/Johannesburg',
  Kenya: 'Africa/Nairobi', Ethiopia: 'Africa/Addis_Ababa', Nigeria: 'Africa/Lagos',
  Ghana: 'Africa/Accra', Tanzania: 'Africa/Dar_es_Salaam', Uganda: 'Africa/Kampala',
  Senegal: 'Africa/Dakar', 'Ivory Coast': 'Africa/Abidjan', Mauritius: 'Indian/Mauritius',
  Seychelles: 'Indian/Mahe', Rwanda: 'Africa/Kigali', Zimbabwe: 'Africa/Harare',
  Zambia: 'Africa/Lusaka', Angola: 'Africa/Luanda', Mozambique: 'Africa/Maputo',

  'New Zealand': 'Pacific/Auckland', Fiji: 'Pacific/Fiji',
  Argentina: 'America/Argentina/Buenos_Aires', Chile: 'America/Santiago',
  Peru: 'America/Lima', Colombia: 'America/Bogota', Venezuela: 'America/Caracas',
  Uruguay: 'America/Montevideo', Paraguay: 'America/Asuncion', Bolivia: 'America/La_Paz',
  Panama: 'America/Panama', 'Costa Rica': 'America/Costa_Rica',
  Guatemala: 'America/Guatemala', 'El Salvador': 'America/El_Salvador',
  Honduras: 'America/Tegucigalpa', Nicaragua: 'America/Managua',
  Cuba: 'America/Havana', Jamaica: 'America/Jamaica',
  'Dominican Republic': 'America/Santo_Domingo', 'Puerto Rico': 'America/Puerto_Rico',
  Bahamas: 'America/Nassau', Barbados: 'America/Barbados',
  'Trinidad and Tobago': 'America/Port_of_Spain', Aruba: 'America/Aruba',
  Curacao: 'America/Curacao', Bermuda: 'Atlantic/Bermuda',
  Kyrgyzstan: 'Asia/Bishkek', Madagascar: 'Indian/Antananarivo',
  'French Polynesia': 'Pacific/Tahiti',
};

/**
 * The IANA zone for an airport, or null when we do not know it.
 *
 * `country` comes from our airport table when the code is one we carry. A code
 * we have never seen — providers return plenty — resolves to null, and the
 * caller keeps whatever it did before rather than showing a confident wrong
 * number.
 */
let countryByCode: Map<string, string> | null = null;

/** Built once from the airport table so callers need only pass the IATA code. */
function countryFor(code: string): string | undefined {
  if (!countryByCode) {
    countryByCode = new Map();
    for (const a of AIRPORTS as Array<{ code?: string; country?: string }>) {
      if (a?.code && a?.country) countryByCode.set(a.code.toUpperCase(), a.country);
    }
  }
  return countryByCode.get(code);
}

export function airportTimeZone(code?: string | null, country?: string | null): string | null {
  const iata = String(code ?? '').trim().toUpperCase();
  if (iata && AIRPORT_ZONES[iata]) return AIRPORT_ZONES[iata];
  const c = String(country ?? '').trim() || (iata ? countryFor(iata) : undefined);
  if (c && COUNTRY_ZONES[c]) return COUNTRY_ZONES[c];
  return null;
}

/** Every zone this module can return — used by the test to validate them all. */
export function allKnownZones(): string[] {
  return [...new Set([...Object.values(AIRPORT_ZONES), ...Object.values(COUNTRY_ZONES)])];
}

/** Airport codes with an explicit zone, for coverage reporting. */
export function mappedAirportCodes(): string[] {
  return Object.keys(AIRPORT_ZONES);
}
