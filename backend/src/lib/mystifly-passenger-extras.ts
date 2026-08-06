/**
 * Everything a traveller chose, in the shape the Mystifly Book request wants.
 *
 * Baggage, meals and seats are picked on several surfaces — web checkout, the
 * booking page, the AI bot, the agent console — and were assembled separately at
 * each book path. They drifted, as duplicated mapping always does:
 *
 *   /api/checkout/bookings/confirm  collected baggage only, and recovered the id
 *                                   by stripping a literal 'baggage-' prefix, so
 *                                   anything keyed differently became NaN.
 *   /api/book                       sent none of it. No bag, no seat, no meal —
 *                                   every add-on chosen on the booking page was
 *                                   silently dropped at book time.
 *
 * One mapper now serves every path. A surface that offers an add-on cannot book
 * without it, because there is only one place left that builds this.
 *
 * ── Two kinds of meal, deliberately kept apart ───────────────────────────────
 *
 * A free IATA meal PREFERENCE (VGML, KSML …) is an SSR and travels on
 * SpecialServiceRequest.MealPreference. A paid meal PRODUCT comes from
 * ExtraServices1_1 and travels as an ExtraServiceId. Sending one as the other
 * either charges for nothing or asks for a meal that was never bought, so the
 * paid ones are recognised by carrying a provider service id and the free ones
 * by not having one.
 */

export interface SelectedAncillaryLike {
  provider?: string;
  ancillaryType?: string;
  providerServiceId?: string | null;
  passengerId?: string | null;
  included?: boolean;
  quantity?: number;
  rawProviderData?: Record<string, unknown> | null;
}

export interface SeatSelectionLike {
  passengerId?: string | null;
  passengerIndex?: number;
  seatPreference?: string | null;
  seatSelectionKey?: string | null;
  seatSelectionKeys?: string[] | null;
}

export interface MealSelectionLike {
  passengerId?: string | null;
  passengerIndex?: number;
  mealCode?: string | null;
  code?: string | null;
}

export interface MystiflyPassengerExtras {
  /** Provider service ids for paid baggage and meals. */
  extraServices?: Array<string | number>;
  /** Specific seats from the seat map. */
  seatSelectionKeys?: string[];
  /** Free SSR seat preference — 'A' aisle, 'W' window. */
  seatPreference?: string;
  /** Free SSR meal preference — an IATA code. */
  mealPreference?: string;
}

/** The provider's own service id, whatever prefix the surface gave it. */
export function providerServiceIdOf(anc: SelectedAncillaryLike): string | null {
  const raw = anc?.rawProviderData as Record<string, unknown> | undefined;
  const direct = raw?.extraServiceId ?? raw?.ExtraServiceId ?? raw?.ServiceId ?? raw?.serviceId;
  if (direct != null && String(direct).trim() !== '') return String(direct).trim();

  // Fall back to the trailing digits of providerServiceId. Surfaces key these
  // differently — 'baggage-12', 'extra-3', 'meal-svc-7' — and stripping one
  // literal prefix, as the confirm route did, turns every other shape into NaN.
  const m = /(\d+)\s*$/.exec(String(anc?.providerServiceId ?? ''));
  return m ? m[1] : null;
}

/** Is this a PAID extra that books as an ExtraServiceId? */
function isPaidExtra(anc: SelectedAncillaryLike): boolean {
  if (String(anc?.provider ?? '').toUpperCase() !== 'MYSTIFLY') return false;
  if (anc?.included) return false;   // already in the fare; nothing to buy
  const type = String(anc?.ancillaryType ?? '').toUpperCase();
  if (!['EXTRA_CHECKED_BAG', 'CHECKED_BAG', 'MEAL'].includes(type)) return false;
  // A free meal SSR has no provider id — that one goes on MealPreference.
  return providerServiceIdOf(anc) != null;
}

/**
 * Build the extras for one passenger.
 *
 * An ancillary with no `passengerId` applies to the whole booking, which is how
 * GROUP_PAX services and single-traveller bookings arrive.
 */
export function buildPassengerExtras(params: {
  passengerId?: string | null;
  passengerIndex: number;
  selectedAncillaries?: SelectedAncillaryLike[] | null;
  seatSelections?: SeatSelectionLike[] | null;
  mealSelections?: MealSelectionLike[] | null;
}): MystiflyPassengerExtras {
  const { passengerId, passengerIndex } = params;
  const mine = (owner?: string | null, index?: number) =>
    (owner != null && owner === passengerId) ||
    (index != null && index === passengerIndex) ||
    (owner == null && index == null);

  const out: MystiflyPassengerExtras = {};

  // ── Paid baggage and meals ──
  const extras = (params.selectedAncillaries ?? [])
    .filter((a) => isPaidExtra(a) && mine(a.passengerId ?? null, undefined))
    .map(providerServiceIdOf)
    .filter((id): id is string => id != null);
  if (extras.length > 0) out.extraServices = extras;

  // ── Seats ──
  const seat = (params.seatSelections ?? []).find((s) => mine(s.passengerId ?? null, s.passengerIndex));
  if (seat?.seatPreference) out.seatPreference = seat.seatPreference;
  const keys = seat?.seatSelectionKeys ?? (seat?.seatSelectionKey ? [seat.seatSelectionKey] : null);
  if (keys && keys.length > 0) out.seatSelectionKeys = keys.filter(Boolean) as string[];

  // ── Free meal preference (SSR) ──
  const meal = (params.mealSelections ?? []).find((m) => mine(m.passengerId ?? null, m.passengerIndex));
  const mealCode = meal?.mealCode ?? meal?.code;
  if (mealCode) out.mealPreference = mealCode;

  return out;
}
