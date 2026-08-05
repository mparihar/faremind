/**
 * Phone country codes for the Mystifly Book request.
 *
 * `TravelerInfo.CountryCode` is the phone's DIALLING code — 1 for the US, 91 for
 * India — and not an ISO country. We were filling it with `toIsoCountry(...)`,
 * which yields "US", and because the checkout never sends a country at all it
 * fell through to that function's own 'US' default on every booking. Mystifly
 * flagged it across all references: the value was wrong AND constant, so an
 * Indian traveller was booked as US too.
 *
 * ISO codes still belong on `Passport.Country` and `PassengerNationality`.
 * Those are genuinely countries; only the phone block wants a dialling code.
 *
 * The number itself already carries it — checkout stores E.164 ("+19723456789")
 * — so the dialling code is read from the phone by longest-prefix match rather
 * than guessed from nationality. A traveller with an Indian passport and a US
 * mobile has a US phone, and the phone block describes the phone.
 */

export interface DialCountry {
  dial: string;
  name: string;
  /** ISO alpha-2 codes sharing this dialling code (+1 covers US and CA). */
  iso?: string[];
}

/** Dialling codes, longest first so +1 never shadows +1876. */
export const DIAL_COUNTRIES: DialCountry[] = [
  { dial: '93', name: "Afghanistan" },
  { dial: '355', name: "Albania" },
  { dial: '213', name: "Algeria" },
  { dial: '376', name: "Andorra" },
  { dial: '244', name: "Angola" },
  { dial: '54', name: "Argentina" },
  { dial: '374', name: "Armenia" },
  { dial: '61', name: "Australia", iso: ['AU'] },
  { dial: '43', name: "Austria", iso: ['AT'] },
  { dial: '994', name: "Azerbaijan" },
  { dial: '973', name: "Bahrain", iso: ['BH'] },
  { dial: '880', name: "Bangladesh", iso: ['BD'] },
  { dial: '375', name: "Belarus" },
  { dial: '32', name: "Belgium", iso: ['BE'] },
  { dial: '501', name: "Belize" },
  { dial: '591', name: "Bolivia" },
  { dial: '55', name: "Brazil", iso: ['BR'] },
  { dial: '673', name: "Brunei" },
  { dial: '359', name: "Bulgaria" },
  { dial: '855', name: "Cambodia" },
  { dial: '237', name: "Cameroon" },
  { dial: '56', name: "Chile" },
  { dial: '86', name: "China", iso: ['CN'] },
  { dial: '57', name: "Colombia" },
  { dial: '506', name: "Costa Rica" },
  { dial: '385', name: "Croatia" },
  { dial: '53', name: "Cuba" },
  { dial: '357', name: "Cyprus" },
  { dial: '420', name: "Czech Republic" },
  { dial: '45', name: "Denmark", iso: ['DK'] },
  { dial: '593', name: "Ecuador" },
  { dial: '20', name: "Egypt", iso: ['EG'] },
  { dial: '503', name: "El Salvador" },
  { dial: '372', name: "Estonia" },
  { dial: '251', name: "Ethiopia" },
  { dial: '679', name: "Fiji" },
  { dial: '358', name: "Finland", iso: ['FI'] },
  { dial: '33', name: "France", iso: ['FR'] },
  { dial: '995', name: "Georgia" },
  { dial: '49', name: "Germany", iso: ['DE'] },
  { dial: '233', name: "Ghana" },
  { dial: '30', name: "Greece", iso: ['GR'] },
  { dial: '502', name: "Guatemala" },
  { dial: '504', name: "Honduras" },
  { dial: '852', name: "Hong Kong", iso: ['HK'] },
  { dial: '36', name: "Hungary" },
  { dial: '354', name: "Iceland" },
  { dial: '91', name: "India", iso: ['IN'] },
  { dial: '62', name: "Indonesia", iso: ['ID'] },
  { dial: '98', name: "Iran" },
  { dial: '964', name: "Iraq" },
  { dial: '353', name: "Ireland", iso: ['IE'] },
  { dial: '972', name: "Israel", iso: ['IL'] },
  { dial: '39', name: "Italy", iso: ['IT'] },
  { dial: '81', name: "Japan", iso: ['JP'] },
  { dial: '962', name: "Jordan" },
  { dial: '7', name: "Kazakhstan / Russia" },
  { dial: '254', name: "Kenya", iso: ['KE'] },
  { dial: '965', name: "Kuwait", iso: ['KW'] },
  { dial: '856', name: "Laos" },
  { dial: '371', name: "Latvia" },
  { dial: '961', name: "Lebanon" },
  { dial: '370', name: "Lithuania" },
  { dial: '352', name: "Luxembourg" },
  { dial: '853', name: "Macau" },
  { dial: '60', name: "Malaysia", iso: ['MY'] },
  { dial: '960', name: "Maldives" },
  { dial: '356', name: "Malta" },
  { dial: '52', name: "Mexico", iso: ['MX'] },
  { dial: '373', name: "Moldova" },
  { dial: '976', name: "Mongolia" },
  { dial: '212', name: "Morocco" },
  { dial: '258', name: "Mozambique" },
  { dial: '95', name: "Myanmar" },
  { dial: '977', name: "Nepal", iso: ['NP'] },
  { dial: '31', name: "Netherlands", iso: ['NL'] },
  { dial: '64', name: "New Zealand", iso: ['NZ'] },
  { dial: '505', name: "Nicaragua" },
  { dial: '234', name: "Nigeria", iso: ['NG'] },
  { dial: '47', name: "Norway", iso: ['NO'] },
  { dial: '968', name: "Oman", iso: ['OM'] },
  { dial: '92', name: "Pakistan", iso: ['PK'] },
  { dial: '507', name: "Panama" },
  { dial: '595', name: "Paraguay" },
  { dial: '51', name: "Peru" },
  { dial: '63', name: "Philippines", iso: ['PH'] },
  { dial: '48', name: "Poland", iso: ['PL'] },
  { dial: '351', name: "Portugal", iso: ['PT'] },
  { dial: '974', name: "Qatar", iso: ['QA'] },
  { dial: '40', name: "Romania" },
  { dial: '966', name: "Saudi Arabia", iso: ['SA'] },
  { dial: '381', name: "Serbia" },
  { dial: '65', name: "Singapore", iso: ['SG'] },
  { dial: '421', name: "Slovakia" },
  { dial: '386', name: "Slovenia" },
  { dial: '27', name: "South Africa", iso: ['ZA'] },
  { dial: '82', name: "South Korea", iso: ['KR'] },
  { dial: '34', name: "Spain", iso: ['ES'] },
  { dial: '94', name: "Sri Lanka", iso: ['LK'] },
  { dial: '46', name: "Sweden", iso: ['SE'] },
  { dial: '41', name: "Switzerland", iso: ['CH'] },
  { dial: '963', name: "Syria" },
  { dial: '886', name: "Taiwan", iso: ['TW'] },
  { dial: '992', name: "Tajikistan" },
  { dial: '255', name: "Tanzania" },
  { dial: '66', name: "Thailand", iso: ['TH'] },
  { dial: '216', name: "Tunisia" },
  { dial: '90', name: "Turkey", iso: ['TR'] },
  { dial: '993', name: "Turkmenistan" },
  { dial: '256', name: "Uganda" },
  { dial: '380', name: "Ukraine" },
  { dial: '971', name: "United Arab Emirates", iso: ['AE'] },
  { dial: '44', name: "United Kingdom", iso: ['GB'] },
  { dial: '1', name: "United States / Canada", iso: ['US', 'CA'] },
  { dial: '598', name: "Uruguay" },
  { dial: '998', name: "Uzbekistan" },
  { dial: '58', name: "Venezuela" },
  { dial: '84', name: "Vietnam", iso: ['VN'] },
  { dial: '967', name: "Yemen" },
  { dial: '260', name: "Zambia" },
  { dial: '263', name: "Zimbabwe" },
];

const BY_LENGTH = [...DIAL_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

export interface SplitPhone {
  /** Dialling code without '+', e.g. "1" or "91". Empty when undeterminable. */
  countryCode: string;
  /** The national number, dialling code removed. */
  phoneNumber: string;
}

/**
 * Split an E.164-ish phone into its dialling code and national number.
 *
 * Only a leading '+' is treated as proof of a dialling code. A bare
 * "9723456789" is a national number that happens to start with 9 — reading that
 * as Zambia (+972 is Israel, +9 nothing) would be an invention, so it is left
 * whole and the caller falls back to the country hint.
 */
export function splitPhone(raw: string | null | undefined, isoHint?: string | null): SplitPhone {
  const s = String(raw ?? '').trim();
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return { countryCode: '', phoneNumber: '' };

  if (s.startsWith('+') || s.startsWith('00')) {
    const body = s.startsWith('00') ? digits.slice(2) : digits;
    for (const c of BY_LENGTH) {
      // Leave at least four digits behind, so a short string cannot be consumed
      // entirely by its own prefix.
      if (body.startsWith(c.dial) && body.length - c.dial.length >= 4) {
        return { countryCode: c.dial, phoneNumber: body.slice(c.dial.length) };
      }
    }
    return { countryCode: '', phoneNumber: body };
  }

  const hinted = dialCodeForCountry(isoHint);
  if (hinted && digits.startsWith(hinted) && digits.length - hinted.length >= 4) {
    return { countryCode: hinted, phoneNumber: digits.slice(hinted.length) };
  }
  return { countryCode: hinted, phoneNumber: digits };
}

/** Dialling code for an ISO alpha-2 or a country name. */
export function dialCodeForCountry(value: string | null | undefined): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (/^[A-Za-z]{2}$/.test(v)) {
    const iso = v.toUpperCase();
    return DIAL_COUNTRIES.find((c) => c.iso?.includes(iso))?.dial ?? '';
  }
  const name = v.toLowerCase();
  const alias: Record<string, string> = {
    'usa': 'united states', 'us': 'united states', 'america': 'united states',
    'uk': 'united kingdom', 'great britain': 'united kingdom', 'uae': 'united arab emirates',
  };
  const target = alias[name] ?? name;
  const exact = DIAL_COUNTRIES.find((c) => c.name.toLowerCase() === target);
  if (exact) return exact.dial;
  // Several entries label a shared code as "United States / Canada"; match the
  // country inside the label rather than only the whole label.
  const combined = DIAL_COUNTRIES.find((c) =>
    c.name.toLowerCase().split('/').map((part) => part.trim()).includes(target));
  return combined?.dial ?? '';
}

/**
 * The phone block for a Book request: dialling code and national number.
 *
 * Falls back to the traveller's country only when the phone carries no code,
 * and to US 1 only when nothing at all is known — matching the old default so a
 * missing phone cannot start failing bookings that used to succeed.
 */
export function bookPhoneFields(
  phone: string | null | undefined,
  countryHint?: string | null,
): { countryCode: string; phoneNumber: string } {
  const split = splitPhone(phone, countryHint);
  const countryCode = split.countryCode || dialCodeForCountry(countryHint) || '1';
  return { countryCode, phoneNumber: split.phoneNumber || String(phone ?? '').replace(/[^0-9]/g, '') };
}
