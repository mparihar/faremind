/**
 * MIRROR of src/lib/airport-timezones.ts — keep the two byte-identical below this header.
 *
 * Dockerfile.backend copies only backend/, prisma/ and the root package files,
 * so the backend cannot import across into src/ at runtime: doing so crashed the
 * container on startup and took production search down with a 502.
 *
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

/**
 * Every airport we carry, resolved to its zone.
 *
 * Generated from the airport table crossed with the country map below, then
 * embedded so this file has NO imports. That matters: Dockerfile.backend copies
 * only `backend/`, `prisma/` and the root package files — never `src/` — so a
 * backend importing across into src/ crashes the container on startup. This is
 * mirrored into backend/src/services instead, and a file with no dependencies
 * is one that can be mirrored safely.
 */
const AIRPORT_ZONE_BY_CODE: Record<string, string> = {
  JFK:'America/New_York', LGA:'America/New_York', EWR:'America/New_York', BOS:'America/New_York',
  PHL:'America/New_York', IAD:'America/New_York', DCA:'America/New_York', BWI:'America/New_York',
  BDL:'America/New_York', ALB:'America/New_York', BUF:'America/New_York', SYR:'America/New_York',
  ROC:'America/New_York', MHT:'America/New_York', PWM:'America/New_York', PVD:'America/New_York',
  ATL:'America/New_York', MIA:'America/New_York', FLL:'America/New_York', MCO:'America/New_York',
  TPA:'America/New_York', JAX:'America/New_York', PBI:'America/New_York', RSW:'America/New_York',
  CLT:'America/New_York', RDU:'America/New_York', GSO:'America/New_York', CHS:'America/New_York',
  MSY:'America/Chicago', BHM:'America/Chicago', BNA:'America/Chicago', MEM:'America/Chicago',
  SDF:'America/New_York', RIC:'America/New_York', ORF:'America/New_York', SAV:'America/New_York',
  ORD:'America/Chicago', MDW:'America/Chicago', DTW:'America/Detroit', MSP:'America/Chicago',
  STL:'America/Chicago', MCI:'America/Chicago', CMH:'America/New_York', CLE:'America/New_York',
  CVG:'America/New_York', IND:'America/Indiana/Indianapolis', MKE:'America/Chicago', GRR:'America/Detroit',
  OMA:'America/Chicago', DFW:'America/Chicago', DAL:'America/Chicago', IAH:'America/Chicago',
  HOU:'America/Chicago', SAT:'America/Chicago', AUS:'America/Chicago', ELP:'America/Denver',
  LBB:'America/Chicago', OKC:'America/Chicago', TUL:'America/Chicago', LIT:'America/Chicago',
  JAN:'America/Chicago', DEN:'America/Denver', PHX:'America/Phoenix', TUS:'America/Phoenix',
  LAS:'America/Los_Angeles', RNO:'America/Los_Angeles', SLC:'America/Denver', ABQ:'America/Denver',
  BOI:'America/Boise', BIL:'America/Denver', FAR:'America/Chicago', LAX:'America/Los_Angeles',
  SFO:'America/Los_Angeles', SJC:'America/Los_Angeles', OAK:'America/Los_Angeles', SAN:'America/Los_Angeles',
  SNA:'America/Los_Angeles', BUR:'America/Los_Angeles', LGB:'America/Los_Angeles', SMF:'America/Los_Angeles',
  FAT:'America/Los_Angeles', SEA:'America/Los_Angeles', PDX:'America/Los_Angeles', GEG:'America/Los_Angeles',
  HNL:'Pacific/Honolulu', OGG:'Pacific/Honolulu', KOA:'Pacific/Honolulu', ANC:'America/Anchorage',
  FAI:'America/Anchorage', GUM:'Pacific/Guam', YYZ:'America/Toronto', YYC:'America/Edmonton',
  YVR:'America/Vancouver', YUL:'America/Toronto', YOW:'America/Toronto', YEG:'America/Edmonton',
  YHZ:'America/Halifax', YWG:'America/Winnipeg', MEX:'America/Mexico_City', CUN:'America/Cancun',
  GDL:'America/Mexico_City', MTY:'America/Monterrey', SJD:'America/Mazatlan', PVR:'America/Bahia_Banderas',
  MZT:'America/Mazatlan', NAS:'America/Nassau', MBJ:'America/Jamaica', KIN:'America/Jamaica',
  SJU:'America/Puerto_Rico', PUJ:'America/Santo_Domingo', HAV:'America/Havana', GRU:'America/Sao_Paulo',
  GIG:'America/Sao_Paulo', BSB:'America/Sao_Paulo', EZE:'America/Argentina/Buenos_Aires', AEP:'America/Argentina/Buenos_Aires',
  SCL:'America/Santiago', BOG:'America/Bogota', MDE:'America/Bogota', LIM:'America/Lima',
  UIO:'America/Guayaquil', GYE:'America/Guayaquil', CCS:'America/Caracas', PTY:'America/Panama',
  SJO:'America/Costa_Rica', LHR:'Europe/London', LGW:'Europe/London', STN:'Europe/London',
  LTN:'Europe/London', LCY:'Europe/London', MAN:'Europe/London', EDI:'Europe/London',
  GLA:'Europe/London', BHX:'Europe/London', BRS:'Europe/London', NCL:'Europe/London',
  LPL:'Europe/London', ABZ:'Europe/London', BFS:'Europe/London', CDG:'Europe/Paris',
  ORY:'Europe/Paris', NCE:'Europe/Paris', LYS:'Europe/Paris', MRS:'Europe/Paris',
  FRA:'Europe/Berlin', MUC:'Europe/Berlin', BER:'Europe/Berlin', DUS:'Europe/Berlin',
  HAM:'Europe/Berlin', CGN:'Europe/Berlin', STR:'Europe/Berlin', AMS:'Europe/Amsterdam',
  BRU:'Europe/Brussels', ZRH:'Europe/Zurich', GVA:'Europe/Zurich', BSL:'Europe/Zurich',
  VIE:'Europe/Vienna', LIS:'Europe/Lisbon', OPO:'Europe/Lisbon', MAD:'Europe/Madrid',
  BCN:'Europe/Madrid', AGP:'Europe/Madrid', PMI:'Europe/Madrid', SVQ:'Europe/Madrid',
  VLC:'Europe/Madrid', FCO:'Europe/Rome', MXP:'Europe/Rome', LIN:'Europe/Rome',
  NAP:'Europe/Rome', VCE:'Europe/Rome', BGY:'Europe/Rome', BLQ:'Europe/Rome',
  PMO:'Europe/Rome', HEL:'Europe/Helsinki', ARN:'Europe/Stockholm', OSL:'Europe/Oslo',
  CPH:'Europe/Copenhagen', WAW:'Europe/Warsaw', KRK:'Europe/Warsaw', PRG:'Europe/Prague',
  BUD:'Europe/Budapest', BEG:'Europe/Belgrade', LJU:'Europe/Ljubljana', ZAG:'Europe/Zagreb',
  SPU:'Europe/Zagreb', DBV:'Europe/Zagreb', ATH:'Europe/Athens', SKG:'Europe/Athens',
  HER:'Europe/Athens', RHO:'Europe/Athens', SVO:'Europe/Moscow', DME:'Europe/Moscow',
  LED:'Europe/Moscow', KBP:'Europe/Kyiv', TLV:'Asia/Jerusalem', IST:'Europe/Istanbul',
  SAW:'Europe/Istanbul', AYT:'Europe/Istanbul', ESB:'Europe/Istanbul', ADB:'Europe/Istanbul',
  RIX:'Europe/Riga', TLL:'Europe/Tallinn', VNO:'Europe/Vilnius', OTP:'Europe/Bucharest',
  SOF:'Europe/Sofia', DXB:'Asia/Dubai', DWC:'Asia/Dubai', AUH:'Asia/Dubai',
  SHJ:'Asia/Dubai', DOH:'Asia/Qatar', BAH:'Asia/Bahrain', KWI:'Asia/Kuwait',
  MCT:'Asia/Muscat', RUH:'Asia/Riyadh', JED:'Asia/Riyadh', DMM:'Asia/Riyadh',
  MED:'Asia/Riyadh', AMM:'Asia/Amman', BEY:'Asia/Beirut', CAI:'Africa/Cairo',
  HRG:'Africa/Cairo', SSH:'Africa/Cairo', DEL:'Asia/Kolkata', BOM:'Asia/Kolkata',
  MAA:'Asia/Kolkata', BLR:'Asia/Kolkata', HYD:'Asia/Kolkata', CCU:'Asia/Kolkata',
  COK:'Asia/Kolkata', AMD:'Asia/Kolkata', PNQ:'Asia/Kolkata', GOI:'Asia/Kolkata',
  TRV:'Asia/Kolkata', IXC:'Asia/Kolkata', JAI:'Asia/Kolkata', LKO:'Asia/Kolkata',
  CMB:'Asia/Colombo', KTM:'Asia/Kathmandu', DAC:'Asia/Dhaka', KHI:'Asia/Karachi',
  LHE:'Asia/Karachi', ISB:'Asia/Karachi', SIN:'Asia/Singapore', KUL:'Asia/Kuala_Lumpur',
  PEN:'Asia/Kuala_Lumpur', CGK:'Asia/Jakarta', DPS:'Asia/Makassar', SUB:'Asia/Jakarta',
  BKK:'Asia/Bangkok', DMK:'Asia/Bangkok', HKT:'Asia/Bangkok', CNX:'Asia/Bangkok',
  MNL:'Asia/Manila', CEB:'Asia/Manila', SGN:'Asia/Ho_Chi_Minh', HAN:'Asia/Ho_Chi_Minh',
  DAD:'Asia/Ho_Chi_Minh', RGN:'Asia/Yangon', PNH:'Asia/Phnom_Penh', REP:'Asia/Phnom_Penh',
  VTE:'Asia/Vientiane', NRT:'Asia/Tokyo', HND:'Asia/Tokyo', KIX:'Asia/Tokyo',
  ITM:'Asia/Tokyo', NGO:'Asia/Tokyo', FUK:'Asia/Tokyo', CTS:'Asia/Tokyo',
  OKA:'Asia/Tokyo', ICN:'Asia/Seoul', GMP:'Asia/Seoul', PUS:'Asia/Seoul',
  HKG:'Asia/Hong_Kong', MFM:'Asia/Macau', PEK:'Asia/Shanghai', PKX:'Asia/Shanghai',
  PVG:'Asia/Shanghai', SHA:'Asia/Shanghai', CAN:'Asia/Shanghai', SZX:'Asia/Shanghai',
  CTU:'Asia/Shanghai', XIY:'Asia/Shanghai', KMG:'Asia/Shanghai', WUH:'Asia/Shanghai',
  CSX:'Asia/Shanghai', TSN:'Asia/Shanghai', NKG:'Asia/Shanghai', TPE:'Asia/Taipei',
  TSA:'Asia/Taipei', ULN:'Asia/Ulaanbaatar', ALA:'Asia/Almaty', NQZ:'Asia/Almaty',
  TAS:'Asia/Tashkent', FRU:'Asia/Bishkek', JNB:'Africa/Johannesburg', CPT:'Africa/Johannesburg',
  DUR:'Africa/Johannesburg', NBO:'Africa/Nairobi', MBA:'Africa/Nairobi', LOS:'Africa/Lagos',
  ABV:'Africa/Lagos', ACC:'Africa/Accra', CMN:'Africa/Casablanca', RAK:'Africa/Casablanca',
  TUN:'Africa/Tunis', ALG:'Africa/Algiers', ADD:'Africa/Addis_Ababa', DAR:'Africa/Dar_es_Salaam',
  JRO:'Africa/Dar_es_Salaam', EBB:'Africa/Kampala', KGL:'Africa/Kigali', DKR:'Africa/Dakar',
  ABJ:'Africa/Abidjan', TNR:'Indian/Antananarivo', MRU:'Indian/Mauritius', SYD:'Australia/Sydney',
  MEL:'Australia/Melbourne', BNE:'Australia/Brisbane', PER:'Australia/Perth', ADL:'Australia/Adelaide',
  OOL:'Australia/Brisbane', CNS:'Australia/Brisbane', CBR:'Australia/Sydney', AKL:'Pacific/Auckland',
  CHC:'Pacific/Auckland', WLG:'Pacific/Auckland', NAN:'Pacific/Fiji', PPT:'Pacific/Tahiti',
};

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
export function airportTimeZone(code?: string | null, country?: string | null): string | null {
  const iata = String(code ?? '').trim().toUpperCase();
  if (iata && AIRPORT_ZONES[iata]) return AIRPORT_ZONES[iata];
  if (iata && AIRPORT_ZONE_BY_CODE[iata]) return AIRPORT_ZONE_BY_CODE[iata];
  const c = String(country ?? '').trim();
  if (c && COUNTRY_ZONES[c]) return COUNTRY_ZONES[c];
  return null;
}

/** Every zone this module can return — used by the test to validate them all. */
export function allKnownZones(): string[] {
  return [...new Set([
    ...Object.values(AIRPORT_ZONES), ...Object.values(COUNTRY_ZONES),
    ...Object.values(AIRPORT_ZONE_BY_CODE),
  ])];
}

/** Airport codes with an explicit zone, for coverage reporting. */
export function mappedAirportCodes(): string[] {
  return Object.keys(AIRPORT_ZONES);
}
