/**
 * Journey Type Detection
 *
 * Determines whether a flight itinerary is domestic or international
 * by comparing the country codes of origin and destination airports.
 *
 * Supports:
 *   1. Explicit override via searchContext.journeyType
 *   2. Auto-detection from IATA airport codes
 *   3. Fallback to international if unknown
 */

import type { JourneyType } from '../types';

/**
 * Top ~350 IATA airport codes → ISO 3166-1 alpha-2 country codes.
 * Covers all major commercial airports. Add more as needed.
 */
const AIRPORT_COUNTRY: Record<string, string> = {
  // ── United States ──
  ATL: 'US', LAX: 'US', ORD: 'US', DFW: 'US', DEN: 'US', JFK: 'US', SFO: 'US',
  SEA: 'US', LAS: 'US', MCO: 'US', EWR: 'US', CLT: 'US', PHX: 'US', IAH: 'US',
  MIA: 'US', BOS: 'US', MSP: 'US', FLL: 'US', DTW: 'US', PHL: 'US', LGA: 'US',
  BWI: 'US', SLC: 'US', SAN: 'US', IAD: 'US', DCA: 'US', MDW: 'US', TPA: 'US',
  PDX: 'US', HNL: 'US', STL: 'US', BNA: 'US', AUS: 'US', OAK: 'US', SJC: 'US',
  RDU: 'US', MCI: 'US', SMF: 'US', CLE: 'US', IND: 'US', SAT: 'US', PIT: 'US',
  CVG: 'US', CMH: 'US', JAX: 'US', SNA: 'US', MKE: 'US', OGG: 'US', RSW: 'US',
  RNO: 'US', ABQ: 'US', ANC: 'US', ONT: 'US', BUR: 'US', BDL: 'US', PBI: 'US',
  BUF: 'US', OMA: 'US', BOI: 'US', TUS: 'US', ELP: 'US', LIT: 'US',
  // ── India ──
  DEL: 'IN', BOM: 'IN', BLR: 'IN', MAA: 'IN', CCU: 'IN', HYD: 'IN', COK: 'IN',
  AMD: 'IN', PNQ: 'IN', GOI: 'IN', JAI: 'IN', LKO: 'IN', GAU: 'IN', TRV: 'IN',
  IXC: 'IN', PAT: 'IN', VNS: 'IN', SXR: 'IN', IXB: 'IN', IXR: 'IN', BBI: 'IN',
  IDR: 'IN', NAG: 'IN', VTZ: 'IN', CJB: 'IN', IXE: 'IN', CCJ: 'IN', RPR: 'IN',
  // ── United Kingdom ──
  LHR: 'GB', LGW: 'GB', STN: 'GB', MAN: 'GB', EDI: 'GB', BRS: 'GB', BHX: 'GB',
  GLA: 'GB', LTN: 'GB', NCL: 'GB', BFS: 'GB', LCY: 'GB',
  // ── Canada ──
  YYZ: 'CA', YVR: 'CA', YUL: 'CA', YYC: 'CA', YOW: 'CA', YEG: 'CA', YHZ: 'CA',
  YWG: 'CA', YQB: 'CA', YXE: 'CA', YQR: 'CA', YLW: 'CA',
  // ── UAE ──
  DXB: 'AE', AUH: 'AE', SHJ: 'AE',
  // ── Qatar ──
  DOH: 'QA',
  // ── Turkey ──
  IST: 'TR', SAW: 'TR', AYT: 'TR', ESB: 'TR', ADB: 'TR',
  // ── Germany ──
  FRA: 'DE', MUC: 'DE', BER: 'DE', DUS: 'DE', HAM: 'DE', CGN: 'DE', STR: 'DE',
  // ── France ──
  CDG: 'FR', ORY: 'FR', NCE: 'FR', LYS: 'FR', MRS: 'FR', TLS: 'FR', BOD: 'FR',
  // ── Netherlands ──
  AMS: 'NL',
  // ── Spain ──
  MAD: 'ES', BCN: 'ES', AGP: 'ES', PMI: 'ES', VLC: 'ES', SVQ: 'ES',
  // ── Italy ──
  FCO: 'IT', MXP: 'IT', VCE: 'IT', NAP: 'IT', BGY: 'IT', BLQ: 'IT',
  // ── Japan ──
  NRT: 'JP', HND: 'JP', KIX: 'JP', NGO: 'JP', FUK: 'JP', CTS: 'JP',
  // ── South Korea ──
  ICN: 'KR', GMP: 'KR', PUS: 'KR',
  // ── China ──
  PEK: 'CN', PVG: 'CN', CAN: 'CN', CTU: 'CN', SZX: 'CN', HKG: 'HK',
  SHA: 'CN', KMG: 'CN', XIY: 'CN', WUH: 'CN', CSX: 'CN', NKG: 'CN',
  // ── Singapore ──
  SIN: 'SG',
  // ── Thailand ──
  BKK: 'TH', DMK: 'TH', HKT: 'TH', CNX: 'TH',
  // ── Australia ──
  SYD: 'AU', MEL: 'AU', BNE: 'AU', PER: 'AU', ADL: 'AU', OOL: 'AU',
  // ── Brazil ──
  GRU: 'BR', GIG: 'BR', BSB: 'BR', CNF: 'BR', SSA: 'BR', REC: 'BR',
  // ── Mexico ──
  MEX: 'MX', CUN: 'MX', GDL: 'MX', MTY: 'MX', SJD: 'MX', PVR: 'MX',
  // ── South Africa ──
  JNB: 'ZA', CPT: 'ZA', DUR: 'ZA',
  // ── Ethiopia ──
  ADD: 'ET',
  // ── Kenya ──
  NBO: 'KE',
  // ── Egypt ──
  CAI: 'EG', HRG: 'EG',
  // ── Nigeria ──
  LOS: 'NG', ABV: 'NG',
  // ── Saudi Arabia ──
  JED: 'SA', RUH: 'SA', DMM: 'SA',
  // ── Malaysia ──
  KUL: 'MY', PEN: 'MY', LGK: 'MY', BKI: 'MY',
  // ── Indonesia ──
  CGK: 'ID', DPS: 'ID', SUB: 'ID',
  // ── Philippines ──
  MNL: 'PH', CEB: 'PH',
  // ── Pakistan ──
  ISB: 'PK', KHI: 'PK', LHE: 'PK',
  // ── Bangladesh ──
  DAC: 'BD', CGP: 'BD',
  // ── Sri Lanka ──
  CMB: 'LK',
  // ── Nepal ──
  KTM: 'NP',
  // ── Russia ──
  SVO: 'RU', DME: 'RU', LED: 'RU',
  // ── New Zealand ──
  AKL: 'NZ', WLG: 'NZ', CHC: 'NZ',
  // ── Argentina ──
  EZE: 'AR', AEP: 'AR',
  // ── Chile ──
  SCL: 'CL',
  // ── Colombia ──
  BOG: 'CO', MDE: 'CO',
  // ── Peru ──
  LIM: 'PE',
  // ── Israel ──
  TLV: 'IL',
  // ── Jordan ──
  AMM: 'JO',
  // ── Kuwait ──
  KWI: 'KW',
  // ── Oman ──
  MCT: 'OM',
  // ── Bahrain ──
  BAH: 'BH',
  // ── Ireland ──
  DUB: 'IE', SNN: 'IE',
  // ── Switzerland ──
  ZRH: 'CH', GVA: 'CH',
  // ── Austria ──
  VIE: 'AT',
  // ── Portugal ──
  LIS: 'PT', OPO: 'PT',
  // ── Belgium ──
  BRU: 'BE',
  // ── Sweden ──
  ARN: 'SE', GOT: 'SE',
  // ── Norway ──
  OSL: 'NO', BGO: 'NO',
  // ── Denmark ──
  CPH: 'DK',
  // ── Finland ──
  HEL: 'FI',
  // ── Poland ──
  WAW: 'PL', KRK: 'PL',
  // ── Czech Republic ──
  PRG: 'CZ',
  // ── Greece ──
  ATH: 'GR', SKG: 'GR',
  // ── Hungary ──
  BUD: 'HU',
  // ── Romania ──
  OTP: 'RO',
  // ── Vietnam ──
  SGN: 'VN', HAN: 'VN',
  // ── Taiwan ──
  TPE: 'TW',
  // ── Maldives ──
  MLE: 'MV',
  // ── Mauritius ──
  MRU: 'MU',
  // ── Morocco ──
  CMN: 'MA', RAK: 'MA',
};

/**
 * Get the country code for an IATA airport code.
 * Returns undefined if unknown.
 */
export function getAirportCountry(iataCode: string): string | undefined {
  return AIRPORT_COUNTRY[iataCode.toUpperCase()];
}

/**
 * Detect whether a route is domestic or international.
 *
 * @param origin - Origin IATA airport code
 * @param destination - Destination IATA airport code
 * @param explicitJourneyType - Explicit override from search context
 * @returns JourneyType — 'domestic' or 'international'
 */
export function detectJourneyType(
  origin: string,
  destination: string,
  explicitJourneyType?: JourneyType,
): JourneyType {
  // Explicit override takes priority
  if (explicitJourneyType) return explicitJourneyType;

  const originCountry = getAirportCountry(origin);
  const destCountry = getAirportCountry(destination);

  // If both are known and same country → domestic
  if (originCountry && destCountry && originCountry === destCountry) {
    return 'domestic';
  }

  // If either is unknown, default to international (safer assumption)
  // If different countries → international
  return 'international';
}
