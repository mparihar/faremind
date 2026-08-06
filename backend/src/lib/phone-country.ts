/**
 * The phone block for a Mystifly Book request: CountryCode, AreaCode, PhoneNumber.
 *
 * Mystifly asked for the numeric dialling code — 1 for the US, 91 for India —
 * with no special characters, and only for phone numbers. Two things were wrong:
 *
 *   CountryCode was filled by toIsoCountry(), which yields "US". And because
 *   checkout sends no country at all, it fell through to that function's own
 *   'US' default, so the value was not merely the wrong format but the same
 *   literal on every booking regardless of traveller.
 *
 *   AreaCode was hard-coded '1'. Every booking, every country. An Indian number
 *   went out with a US area code.
 *
 * Splitting is done by libphonenumber-js, against Google's own numbering-plan
 * metadata, rather than a table of our own. Hand-rolled rules do not survive
 * contact with the world: NANP area codes are always three digits, India's STD
 * codes are two to four, UK's are two to five, and Singapore has none at all.
 *
 * ── What goes in AreaCode ────────────────────────────────────────────────────
 *
 * The national destination code — the first group the numbering plan defines
 * after the country code:
 *
 *   +1  972 345 6789   -> 1  / 972   / 3456789    (Dallas)
 *   +91 22 1234 5678   -> 91 / 22    / 12345678   (Mumbai STD)
 *   +44 20 7123 4567   -> 44 / 20    / 71234567   (London)
 *   +91 98262 40929    -> 91 / 98262 / 40929      (mobile block)
 *
 * For a landline that is the area code proper. For a mobile it is the operator
 * block, which is what the numbering plan puts in the same position — we do not
 * separate mobile from landline, so the same rule applies to both.
 *
 * ── The invariant ───────────────────────────────────────────────────────────
 *
 * CountryCode + AreaCode + PhoneNumber always reconstructs the full number,
 * digits only, nothing dropped and nothing duplicated. However Mystifly chooses
 * to reassemble the three parts, the traveller's number comes back out.
 */
import { parsePhoneNumber } from 'libphonenumber-js/max';

export interface BookPhoneFields {
  /** Numeric dialling code, digits only. "1", "91". */
  countryCode: string;
  /** National destination code, digits only. Empty where the plan defines none. */
  areaCode: string;
  /** Subscriber number, digits only, with the code and area code removed. */
  phoneNumber: string;
}

const digits = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '');

/** Dialling code for an ISO alpha-2 or a country name, when the phone has none. */
export function dialCodeForCountry(value: string | null | undefined): string {
  const v = String(value ?? '').trim();
  if (!v) return '';

  // A two-letter code is an ISO country; ask the library for its dialling code
  // by parsing a placeholder national number against it.
  if (/^[A-Za-z]{2}$/.test(v)) {
    try {
      const p = parsePhoneNumber('000000000', v.toUpperCase() as any);
      return String(p?.countryCallingCode ?? '');
    } catch { return ''; }
  }

  const name = v.toLowerCase();
  const byName: Record<string, string> = {
    'united states': 'US', 'united states of america': 'US', 'usa': 'US', 'us': 'US',
    'america': 'US', 'india': 'IN', 'united kingdom': 'GB', 'uk': 'GB',
    'great britain': 'GB', 'canada': 'CA', 'australia': 'AU', 'singapore': 'SG',
    'united arab emirates': 'AE', 'uae': 'AE', 'germany': 'DE', 'france': 'FR',
    'malaysia': 'MY', 'thailand': 'TH', 'hong kong': 'HK', 'japan': 'JP',
    'china': 'CN', 'saudi arabia': 'SA', 'qatar': 'QA', 'nepal': 'NP',
    'sri lanka': 'LK', 'bangladesh': 'BD', 'pakistan': 'PK', 'indonesia': 'ID',
    'philippines': 'PH', 'vietnam': 'VN', 'new zealand': 'NZ', 'south africa': 'ZA',
  };
  const iso = byName[name];
  return iso ? dialCodeForCountry(iso) : '';
}

/**
 * Split a phone number into the three fields the Book request wants.
 *
 * `countryHint` (an ISO code or country name) is used only when the number
 * carries no dialling code of its own — a bare "9723456789" is a national
 * number, and reading its leading digits as a country would invent one.
 *
 * Never throws. An unparseable number still yields digits-only fields rather
 * than blocking a booking, and falls back to the previous behaviour's '1' only
 * when nothing at all can be determined.
 */
export function bookPhoneFields(
  phone: string | null | undefined,
  countryHint?: string | null,
): BookPhoneFields {
  const raw = String(phone ?? '').trim();
  const allDigits = digits(raw);

  const attempt = (input: string, country?: string) => {
    try {
      const p = country
        ? parsePhoneNumber(input, country.toUpperCase() as any)
        : parsePhoneNumber(input);
      // isPossible, not isValid. isValid checks the number against known
      // subscriber ranges, which rejects a perfectly real number whenever that
      // range data lags a telecom operator — and refusing to split a number is
      // how a booking fails. Length is the right bar: it catches genuine
      // nonsense without second-guessing the carrier.
      return p && p.isPossible() ? p : null;
    } catch { return null; }
  };

  // A leading + (or 00) means the number states its own country.
  const hintIso = /^[A-Za-z]{2}$/.test(String(countryHint ?? '').trim())
    ? String(countryHint).trim().toUpperCase()
    : undefined;

  const parsed =
    attempt(raw.startsWith('00') ? `+${allDigits.slice(2)}` : raw) ??
    (hintIso ? attempt(raw, hintIso) : null) ??
    attempt(`+${allDigits}`);

  if (!parsed) {
    // Unparseable. Keep every digit and say nothing we cannot support.
    const cc = dialCodeForCountry(countryHint) || '1';
    const national = allDigits.startsWith(cc) && allDigits.length - cc.length >= 4
      ? allDigits.slice(cc.length)
      : allDigits;
    return { countryCode: cc, areaCode: '', phoneNumber: national };
  }

  const countryCode = digits(parsed.countryCallingCode);
  const national = digits(parsed.nationalNumber);

  // formatInternational() groups the number the way the numbering plan does:
  // "+1 972 345 6789". The first group after the dialling code is the national
  // destination code — the area code for a landline, the operator block for a
  // mobile, and absent where the plan has neither.
  const groups = parsed.formatInternational().split(' ').slice(1).map(digits).filter(Boolean);
  const ndc = groups.length > 1 ? groups[0] : '';

  const areaCode = ndc && national.startsWith(ndc) ? ndc : '';
  const phoneNumber = areaCode ? national.slice(areaCode.length) : national;

  return { countryCode, areaCode, phoneNumber };
}
