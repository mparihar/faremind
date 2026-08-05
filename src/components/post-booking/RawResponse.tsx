'use client';

/**
 * The provider payload behind a post-booking action, printed under the result.
 *
 * Every PTR button — void quote, refund quote, reissue quote, and the three
 * executes — routes its answer through here, including the failures. The
 * failures are the ones that mattered: the error branches used to return the
 * message alone, so the moment a call went wrong the payload that explains why
 * disappeared. "Voiding window expired" and "PTR 22981 is already in process"
 * both arrived that way, and diagnosing either meant querying the database by
 * hand for `provider_quote_response`.
 *
 * Open by default. A collapsed disclosure is the same as not showing it when
 * the point is to see what the airline actually said.
 */
export default function RawResponse({
  data,
  label = 'Provider response',
  defaultOpen = true,
}: {
  data: unknown;
  label?: string;
  /** Collapse where the payload is long and rarely the point (e.g. a booking dump). */
  defaultOpen?: boolean;
}) {
  if (data == null) return null;

  // Our own envelope wraps the provider's reply in `raw`. Show that first when
  // present — it is what Mystifly sent, and it is what staff quote back to them.
  const envelope = data as Record<string, unknown>;
  const provider = envelope && typeof envelope === 'object' ? envelope.raw : null;

  return (
    <div className="mt-2 space-y-2">
      {provider != null && (
        <details open={defaultOpen} className="bg-slate-900/50 border border-slate-700/30 rounded-xl">
          <summary className="px-3 py-2 text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-300 uppercase tracking-wider">
            {label} · Mystifly
          </summary>
          <pre className="px-3 pb-3 text-xs text-slate-400 font-mono overflow-x-auto max-h-72">
            {safeJson(provider)}
          </pre>
        </details>
      )}

      <details open={defaultOpen && provider == null} className="bg-slate-900/50 border border-slate-700/30 rounded-xl">
        <summary className="px-3 py-2 text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-300 uppercase tracking-wider">
          {provider != null ? 'Full response (FareMind envelope)' : label}
        </summary>
        <pre className="px-3 pb-3 text-xs text-slate-400 font-mono overflow-x-auto max-h-72">
          {safeJson(data)}
        </pre>
      </details>
    </div>
  );
}

/** Never let an unserialisable payload take the panel — or the page — down. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
