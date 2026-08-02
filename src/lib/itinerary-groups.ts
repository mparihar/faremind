/**
 * Itinerary grouping — one search card per journey, every fare kept.
 *
 * A search returns each fare the airline filed as its own offer, so the same
 * flights arrive several times at "ECO VALUE", "CLASSIC", "FLEX" and so on.
 * Rendering all of them as separate search cards buries the list; discarding
 * all but the cheapest destroys the fare panel. Neither is right.
 *
 * So we collapse for DISPLAY and preserve for SELECTION: one card per
 * `itineraryKey`, carrying every offer for that journey on `fareOffers`. The
 * card shows the lowest price ("from $245"); opening it reveals the ladder.
 *
 * Ranking is untouched. Grouping runs AFTER the ranker and keeps whichever
 * offer the ranker placed highest as the representative, so card order is
 * exactly the order the scoring engine produced.
 */

/** The minimum an offer must expose to be grouped. */
interface GroupableOffer {
  itineraryKey?: string;
  totalPrice?: number;
  providerOfferId?: string;
  id?: string;
  airlineFareFamily?: string | null;
  cabinClass?: string;
  bookingClass?: string | null;
  segments?: Array<{ cabinClassCode?: string; fareBasisCode?: string }>;
  airline?: { code?: string } | null;
  provider?: string;
  fareRules?: { refundable?: boolean | null; changeable?: boolean | null; changeFee?: number | null; cancellationFee?: number | null } | null;
  baggage?: { carryOn?: number; checked?: number } | null;
  checkedBaggageAllowance?: string | null;
  cabinBaggageAllowance?: string | null;
  seatsRemaining?: number | null;
  currency?: string;
}

/** A sibling fare, trimmed to what the fare panel needs. */
export interface FareOfferSummary {
  id?: string;
  providerOfferId?: string;
  airlineFareFamily: string | null;
  normalizedFareTier?: string;
  cabinClass?: string;
  bookingClass: string | null;
  /**
   * Per-segment cabin codes and fare bases. The fare panel classifies each
   * offer into a UI tab from these when the offer-level cabin is absent, and
   * uses them to spot a mixed-cabin itinerary rather than labelling it by
   * whichever segment happened to be first.
   */
  segmentCabinCodes?: Array<string | null | undefined>;
  fareBasisCodes?: Array<string | null | undefined>;
  airlineCode?: string | null;
  provider?: string | null;
  totalPrice: number;
  currency?: string;
  seatsRemaining: number | null;
  checkedBaggageAllowance: string | null;
  cabinBaggageAllowance: string | null;
  baggage: { carryOn?: number; checked?: number } | null;
  fareRules: {
    refundable: boolean | null;
    changeable: boolean | null;
    changeFee: number | null;
    cancellationFee: number | null;
  };
}

function toSummary(o: any): FareOfferSummary {
  return {
    id: o.id,
    providerOfferId: o.providerOfferId,
    airlineFareFamily: o.airlineFareFamily ?? null,
    normalizedFareTier: o.normalizedFareTier,
    cabinClass: o.cabinClass,
    bookingClass: o.bookingClass ?? null,
    segmentCabinCodes: (o.segments ?? []).map((sg: any) => sg?.cabinClassCode).filter(Boolean),
    fareBasisCodes: (o.segments ?? []).map((sg: any) => sg?.fareBasisCode).filter(Boolean),
    airlineCode: o.airline?.code ?? null,
    provider: o.provider ?? null,
    totalPrice: o.totalPrice ?? 0,
    currency: o.currency,
    seatsRemaining: typeof o.seatsRemaining === 'number' ? o.seatsRemaining : null,
    checkedBaggageAllowance: o.checkedBaggageAllowance ?? null,
    cabinBaggageAllowance: o.cabinBaggageAllowance ?? null,
    baggage: o.baggage ?? null,
    fareRules: {
      refundable: o.fareRules?.refundable ?? null,
      changeable: o.fareRules?.changeable ?? null,
      changeFee: o.fareRules?.changeFee ?? null,
      cancellationFee: o.fareRules?.cancellationFee ?? null,
    },
  };
}

/**
 * What makes two offers genuinely different fares of the SAME journey.
 * Two offers identical on all of these are the same bookable thing and only
 * one needs a card in the panel.
 */
function fareIdentity(o: any): string {
  return [
    o.providerOfferId ?? '',
    (o.airlineFareFamily ?? '').toUpperCase(),
    (o.cabinClass ?? '').toLowerCase(),
    o.bookingClass ?? '',
    o.totalPrice ?? '',
    o.checkedBaggageAllowance ?? '',
    o.cabinBaggageAllowance ?? '',
    o.fareRules?.refundable ?? '',
    o.fareRules?.changeable ?? '',
  ].join('|');
}

/**
 * Collapse a ranked offer list to one entry per journey.
 *
 * Input order is preserved — the first offer seen for a journey becomes the
 * representative, so the ranker decides which fare fronts the card. `fareOffers`
 * is sorted cheapest-first and always contains the representative itself, so a
 * journey the airline sells at a single fare yields a one-entry ladder rather
 * than an empty panel.
 *
 * `fromPrice` is the cheapest fare on the journey, for "from $245" display.
 */
export function groupByItinerary<T extends GroupableOffer>(
  ranked: T[],
): Array<T & { fareOffers: FareOfferSummary[]; fareOfferCount: number; fromPrice: number }> {
  const order: string[] = [];
  const groups = new Map<string, { rep: T; offers: any[] }>();

  for (const offer of ranked || []) {
    // Without a key we cannot group safely — give the offer its own bucket
    // rather than risk merging two unrelated journeys.
    const key = offer.itineraryKey || `__ungrouped__${offer.providerOfferId ?? offer.id ?? order.length}`;
    const existing = groups.get(key);
    if (existing) {
      existing.offers.push(offer);
    } else {
      groups.set(key, { rep: offer, offers: [offer] });
      order.push(key);
    }
  }

  return order.map((key) => {
    const { rep, offers } = groups.get(key)!;

    const seen = new Set<string>();
    const fareOffers = offers
      .filter((o) => {
        const id = fareIdentity(o);
        if (seen.has(id)) return false;
        seen.add(id);
        return (o.totalPrice ?? 0) > 0;
      })
      .map(toSummary)
      .sort((a, b) => a.totalPrice - b.totalPrice);

    const fromPrice = fareOffers.length ? fareOffers[0].totalPrice : (rep.totalPrice ?? 0);

    return { ...rep, fareOffers, fareOfferCount: fareOffers.length, fromPrice };
  });
}
