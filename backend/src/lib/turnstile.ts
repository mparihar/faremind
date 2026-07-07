/**
 * Cloudflare Turnstile Server-Side Verification
 *
 * Helper for the Fastify backend (user + agent auth).
 * Verifies a Turnstile token with Cloudflare's siteverify endpoint.
 *
 * Environment variables:
 *   TURNSTILE_SECRET_KEY — required in production
 *   TURNSTILE_ENABLED    — set to "true" to enforce (default: "false")
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Returns true if Turnstile is enforced (TURNSTILE_ENABLED === "true").
 */
export function isTurnstileEnabled(): boolean {
  return (process.env.TURNSTILE_ENABLED ?? 'false') === 'true';
}

/**
 * Verifies a Turnstile token with Cloudflare.
 *
 * @param token - The Turnstile response token from the frontend
 * @returns true if valid, false if invalid or on error
 *
 * Bypasses verification when TURNSTILE_ENABLED !== "true" (local dev).
 * Never throws — returns false on any error.
 */
export async function verifyTurnstile(token: string | undefined | null): Promise<boolean> {
  // Dev bypass — skip verification when disabled
  if (!isTurnstileEnabled()) return true;

  if (!token) {
    console.warn('[turnstile] Token missing — verification failed');
    return false;
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.error('[turnstile] TURNSTILE_SECRET_KEY not set — blocking request');
    return false;
  }

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: secretKey,
        response: token,
      }),
    });

    if (!res.ok) {
      console.error(`[turnstile] Cloudflare API returned HTTP ${res.status}`);
      return false;
    }

    const data = await res.json();

    if (!data.success) {
      console.warn('[turnstile] Verification failed:', data['error-codes'] ?? 'unknown');
      return false;
    }

    return true;
  } catch (err) {
    console.error('[turnstile] Verification error:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Standard Turnstile failure response body.
 */
export const TURNSTILE_FAILED_RESPONSE = {
  success: false,
  error: 'Security verification failed. Please try again.',
  code: 'TURNSTILE_FAILED',
} as const;
