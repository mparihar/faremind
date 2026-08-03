/**
 * The flight designator, rendered once.
 *
 * `BookingSegment.flightNumber` already carries the carrier — the normalizer
 * builds it as `${marketingCode}${FlightNumber}`, so an Air India flight is
 * stored "AI1735", not "1735". Screens then rendered `{airlineCode}{flightNumber}`
 * and printed **AIAI1735** on every booking.
 *
 * This joins them without repeating: the code is prepended only when the number
 * does not already start with it.
 */
export function flightDesignator(
  airlineCode?: string | null,
  flightNumber?: string | null,
): string {
  const code = String(airlineCode ?? '').trim().toUpperCase();
  const num = String(flightNumber ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!num) return code;
  if (!code) return num;
  return num.startsWith(code) ? num : `${code}${num}`;
}
