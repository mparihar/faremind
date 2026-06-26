/**
 * FAREMIND Bundle Feature Flags
 *
 * Controls availability of Price Drop Protection and Travel Insurance.
 * Reads NEXT_PUBLIC_FAREMIND_BUNDLE (frontend) or FAREMIND_BUNDLE (backend).
 *
 * Set to 'true' only when a real insurance provider partnership is active.
 */

export function isBundleEnabled(): boolean {
  // NEXT_PUBLIC_ prefix makes it available in Next.js client components
  const val = process.env.NEXT_PUBLIC_FAREMIND_BUNDLE ?? process.env.FAREMIND_BUNDLE ?? 'false';
  return val.toLowerCase() === 'true';
}
