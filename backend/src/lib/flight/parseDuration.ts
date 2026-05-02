/**
 * Parses an ISO-8601 duration string (e.g. "PT6H30M") into total minutes.
 * Handles hours (H) and minutes (M). Days (D) are treated as 24h each.
 */
export function parseDurationToMinutes(iso: string): number {
  if (!iso) return 0;
  let total = 0;
  const dayMatch = iso.match(/(\d+)D/);
  const hourMatch = iso.match(/(\d+)H/);
  const minMatch = iso.match(/(\d+)M/);
  if (dayMatch) total += parseInt(dayMatch[1]) * 1440;
  if (hourMatch) total += parseInt(hourMatch[1]) * 60;
  if (minMatch) total += parseInt(minMatch[1]);
  return total;
}
