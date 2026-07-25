/**
 * Sanitize a free-text payment note: strip any HTML/scripts, control chars, and
 * enforce a configurable length window. Returns the cleaned note or throws with
 * a user-safe message.
 */
export function sanitizeNote(raw: unknown, opts: { min: number; max: number; label?: string }): string {
  const label = opts.label || 'note';
  if (typeof raw !== 'string') throw new Error(`A ${label} is required.`);

  // Drop control characters (0x00–0x1F and 0x7F) by codepoint — avoids embedding
  // raw control bytes in source.
  let s = Array.from(raw)
    .filter((ch) => { const c = ch.codePointAt(0)!; return c >= 0x20 && c !== 0x7f; })
    .join('');

  s = s
    .replace(/<[^>]*>/g, '')      // strip HTML tags
    .replace(/javascript:/gi, '') // neutralize js: protocol
    .replace(/[<>]/g, '')         // no stray angle brackets survive
    .replace(/\s+/g, ' ')         // collapse whitespace
    .trim();

  if (s.length < opts.min) throw new Error(`The ${label} must be at least ${opts.min} characters.`);
  if (s.length > opts.max) s = s.slice(0, opts.max);
  return s;
}
