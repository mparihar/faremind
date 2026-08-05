/**
 * Build the `RefundDetails[]` a Mystifly RefundQuote requires.
 *
 * Without it the request is refused outright:
 *
 *   { "Success": false, "Data": null,
 *     "Message": "Refund quote request cannot be processed as the refund
 *                 details are missing from the request." }
 *
 * Proven on MF35565926 (FM83B9T2): the identical request with `passengers`
 * alone fails, and with `RefundDetails` added returns Success + PTRId 22982.
 * The wording is easy to misread as an airline-side limitation — it names no
 * field and mentions no fare — which is how this sat for a while blamed on the
 * provider. It is the `RefundDetails` property on their PostTicketingRequest
 * model, and it is on us to send it.
 *
 * The figures are the fare being refunded, not a proposed refund. They come
 * from TripDetails' own `TripDetailsPTC_FareBreakdowns`, so we are echoing the
 * provider's numbers back rather than inventing any — nothing here is a
 * FareMind-side calculation, and the airline still returns the actual refundable
 * amount asynchronously on the quote.
 */

export interface MystiflyRefundDetail {
  PassengerType: string;
  BaseFare: number;
  Tax: number;
  TotalFare: number;
  Currency: string;
  PaxCount: number;
  TicketNumber?: string;
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param tripDetails raw TripDetails response (any of the version shapes)
 * @param ticketByType e-ticket number per PTC, when known — Mystifly accepts the
 *                     detail without it, but including it ties each row to the
 *                     coupon being refunded.
 */
export function buildRefundDetails(
  tripDetails: any,
  ticketByType: Partial<Record<string, string>> = {},
): MystiflyRefundDetail[] {
  const itinerary =
    tripDetails?.Data?.TripDetailsResult?.TravelItinerary ??
    tripDetails?.Data?.TravelItinerary ??
    tripDetails?.TravelItinerary ??
    null;

  const breakdowns = itinerary?.TripDetailsPTC_FareBreakdowns;
  if (!Array.isArray(breakdowns) || breakdowns.length === 0) return [];

  const details: MystiflyRefundDetail[] = [];
  for (const b of breakdowns) {
    const code = String(b?.PassengerTypeQuantity?.Code ?? '').toUpperCase();
    if (!code) continue;

    const fare = b?.TripDetailsPassengerFare ?? {};
    const base = num(fare?.EquiFare?.Amount ?? fare?.BaseFare?.Amount);
    const tax = num(fare?.Tax?.Amount);
    const total = num(fare?.TotalFare?.Amount) || base + tax;

    // A row with no money in it tells the airline nothing and is what the
    // refusal is about; skip rather than send zeroes.
    if (total <= 0) continue;

    const detail: MystiflyRefundDetail = {
      PassengerType: code,
      BaseFare: base,
      Tax: tax,
      TotalFare: total,
      Currency: String(fare?.TotalFare?.CurrencyCode ?? fare?.EquiFare?.CurrencyCode ?? 'USD'),
      PaxCount: Number(b?.PassengerTypeQuantity?.Quantity ?? 1) || 1,
    };
    const ticket = ticketByType[code];
    if (ticket) detail.TicketNumber = ticket;

    details.push(detail);
  }
  return details;
}

/** e-ticket number per passenger type, taken from the PTR passenger array. */
export function ticketNumbersByType(
  passengers: Array<{ passengerType?: string; eTicket?: string }> = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of passengers) {
    const t = String(p?.passengerType ?? '').toUpperCase();
    if (t && p?.eTicket && !out[t]) out[t] = p.eTicket;
  }
  return out;
}
