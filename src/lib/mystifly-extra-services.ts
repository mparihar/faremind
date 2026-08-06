/**
 * Mystifly paid extras — baggage and meals — from the revalidation response.
 *
 * ── Two things were wrong, and either alone hid every service ────────────────
 *
 * The revalidation response carries BOTH keys, and only one of them has
 * anything in it:
 *
 *     "ExtraServices":     { "NameNumbers": [], "Services": [] }        <- always empty
 *     "ExtraServices1_1":  { "NameNumbers": [], "Services": [ … ] }     <- the real one
 *
 * We read `ExtraServices`. Live on BCN→MUC that is an empty list while
 * `ExtraServices1_1` holds four purchasable bags (15/20/25/30 kg, $54.89–$80.81).
 *
 * And the value is an OBJECT with the array nested under `.Services`, not a bare
 * array — the old code went straight to `Array.isArray(...)`, which is false for
 * an object, so even aimed at the right key it would have skipped everything.
 *
 * Net effect: no customer was ever offered a paid bag or meal, on any booking.
 *
 * ── Booking them back ────────────────────────────────────────────────────────
 *
 * Per Mystifly's ExtraServices doc, the chosen `ServiceId`s go back on the Book
 * request under each traveller as
 *
 *     "ExtraServices1_1": [ { "ExtraServiceId": 5 }, { "ExtraServiceId": 10 } ]
 *
 * and TripDetails is the way to confirm what was actually purchased.
 *
 * Extras exist only for WebFare and Private fares, so an empty list is a normal
 * answer for a public fare and not a failure.
 */

export type ExtraServiceType = 'BAGGAGE' | 'MEAL' | 'OTHER';

/**
 * Who the service applies to, verbatim from the provider.
 * PER_PAX* is per traveller, GROUP_PAX* covers everyone on the booking, and the
 * INBOUND/OUTBOUND suffix limits it to one direction.
 */
export type ExtraServiceBehavior =
  | 'PER_PAX' | 'PER_PAX_INBOUND' | 'PER_PAX_OUTBOUND'
  | 'GROUP_PAX' | 'GROUP_PAX_INBOUND' | 'GROUP_PAX_OUTBOUND'
  | '';

export interface MystiflyExtraServiceOption {
  /** The id sent back at book time. String here; numeric on the request. */
  serviceId: string;
  type: ExtraServiceType;
  /** Provider's own wording, e.g. "1 bags -20Kg " or "Child Menu 39.12 USD". */
  description: string;
  amount: number;
  currency: string;
  behavior: ExtraServiceBehavior;
  /** 'AIRPORT' | 'ONLINE' — where the service is redeemed. */
  checkInType: string;
  isMandatory: boolean;
  /** Direction it applies to, derived from behavior. */
  direction: 'OUTBOUND' | 'INBOUND' | 'BOTH';
  /** True when one purchase covers every passenger rather than one each. */
  perBooking: boolean;
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

function classify(raw: unknown): ExtraServiceType {
  const t = String(raw ?? '').trim().toUpperCase();
  if (t === 'BAGGAGE') return 'BAGGAGE';
  // The doc's own example writes "Meal" for meals and "BAGGAGE" for bags, so
  // the casing is not dependable.
  if (t === 'MEAL' || t === 'MEALS') return 'MEAL';
  return 'OTHER';
}

/**
 * Pull the service list out of a revalidation response.
 *
 * Accepts the whole response, its `Data`, or the `ExtraServices1_1` object
 * itself, because callers hold it at different depths. `ExtraServices` is read
 * only as a fallback — it has always been empty in practice, but if Mystifly
 * ever populates it there is no reason to ignore it.
 */
export function parseExtraServices(input: any): MystiflyExtraServiceOption[] {
  const container =
    input?.Data?.ExtraServices1_1 ??
    input?.ExtraServices1_1 ??
    input?.raw?.Data?.ExtraServices1_1 ??
    input?.raw?.ExtraServices1_1 ??
    input?.Data?.ExtraServices ??
    input?.ExtraServices ??
    input?.raw?.Data?.ExtraServices ??
    input?.raw?.ExtraServices ??
    null;

  // The array lives under .Services; a bare array is accepted in case the shape
  // ever flattens.
  const services = Array.isArray(container) ? container
    : Array.isArray(container?.Services) ? container.Services
    : [];

  const out: MystiflyExtraServiceOption[] = [];
  for (const s of services) {
    const serviceId = String(s?.ServiceId ?? s?.ExtraServiceId ?? s?.Id ?? '').trim();
    if (!serviceId) continue;   // unbookable without an id

    const behavior = String(s?.Behavior ?? '').trim().toUpperCase() as ExtraServiceBehavior;
    const cost = s?.ServiceCost ?? {};

    out.push({
      serviceId,
      type: classify(s?.Type),
      description: String(s?.Description ?? '').trim(),
      amount: num(cost?.Amount ?? s?.Amount),
      currency: String(cost?.CurrencyCode ?? s?.CurrencyCode ?? 'USD'),
      behavior,
      checkInType: String(s?.CheckInType ?? '').trim().toUpperCase(),
      isMandatory: s?.IsMandatory === true,
      direction: behavior.endsWith('_INBOUND') ? 'INBOUND'
        : behavior.endsWith('_OUTBOUND') ? 'OUTBOUND'
        : 'BOTH',
      perBooking: behavior.startsWith('GROUP_PAX'),
    });
  }
  return out;
}

/** Only the baggage options. */
export function baggageServices(input: any): MystiflyExtraServiceOption[] {
  return parseExtraServices(input).filter((s) => s.type === 'BAGGAGE');
}

/** Only the meal options. */
export function mealServices(input: any): MystiflyExtraServiceOption[] {
  return parseExtraServices(input).filter((s) => s.type === 'MEAL');
}

/**
 * Checked-weight in kg from a baggage description, when it states one.
 *
 * The wording is not a contract — "1 bags -20Kg ", "Total Weight: 20kgs each ||
 * 1 Bag(s) || 44.7 USD" — so this reads what it can and returns null otherwise
 * rather than guessing a number that would then be shown as fact.
 */
export function baggageWeightKg(description: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*kgs?\b/i.exec(String(description ?? ''));
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The Book-request shape: `[{ ExtraServiceId: 5 }, …]`, numeric ids. */
export function toBookExtraServices(
  serviceIds: Array<string | number>,
): Array<{ ExtraServiceId: number }> {
  const seen = new Set<number>();
  const out: Array<{ ExtraServiceId: number }> = [];
  for (const id of serviceIds ?? []) {
    const n = Number(id);
    // The provider ids are numeric strings; anything else is not one of theirs.
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push({ ExtraServiceId: n });
  }
  return out;
}

/**
 * An IATA meal code from the provider's own wording.
 *
 * Mystifly describes meals in prose — "Child Menu 39.12 USD", "Gluten-free Menu
 * 39.12 USD" — with no code anywhere in the payload, so the code has to be read
 * out of the text. Returns 'STANDARD' when nothing matches, which keeps the menu
 * on offer under the provider's own label rather than dropping it.
 */
export function mealCodeFromDescription(description: string): string {
  const d = String(description ?? '').toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/child/, 'CHML'],
    [/diabet/, 'DBML'],
    [/gluten/, 'GFML'],
    [/kosher/, 'KSML'],
    [/halal|moslem|muslim/, 'MOML'],
    [/no lactose|lactose/, 'NLML'],
    [/hindu/, 'HNML'],
    [/jain/, 'VJML'],
    [/vegan/, 'VGML'],
    [/vegetarian/, 'VLML'],
    [/low fat|low-fat/, 'LFML'],
    [/low salt|low sodium/, 'LSML'],
    [/seafood/, 'SFML'],
    [/fruit/, 'FPML'],
    [/baby|infant/, 'BBML'],
    [/classic|standard|regular/, 'STANDARD'],
  ];
  for (const [re, code] of map) if (re.test(d)) return code;
  return 'STANDARD';
}
