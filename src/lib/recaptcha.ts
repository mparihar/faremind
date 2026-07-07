/**
 * Google reCAPTCHA v2 Server-Side Verification
 *
 * Shared helper for Next.js API routes (admin auth).
 * Verifies a reCAPTCHA token with Google's siteverify endpoint.
 *
 * Environment variables:
 *   GOOGLE_RECAPTCHA_SECRET_KEY — required in production
 *   RECAPTCHA_ENABLED           — set to "true" to enforce (default: "false")
 */

const GOOGLE_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/**
 * Returns true if reCAPTCHA is enforced (RECAPTCHA_ENABLED === "true").
 */
export function isRecaptchaEnabled(): boolean {
  return (process.env.RECAPTCHA_ENABLED ?? 'false') === 'true';
}

/**
 * Verifies a reCAPTCHA token with Google.
 *
 * @param token - The reCAPTCHA response token from the frontend
 * @returns true if valid, false if invalid or on error
 *
 * Bypasses verification when RECAPTCHA_ENABLED !== "true" (local dev).
 * Never throws — returns false on any error.
 */
export async function verifyCaptcha(token: string | undefined | null): Promise<boolean> {
  // Dev bypass — skip verification when disabled
  if (!isRecaptchaEnabled()) return true;

  if (!token) {
    console.warn('[recaptcha] Token missing — verification failed');
    return false;
  }

  const secretKey = process.env.GOOGLE_RECAPTCHA_SECRET_KEY;
  if (!secretKey) {
    console.error('[recaptcha] GOOGLE_RECAPTCHA_SECRET_KEY not set — blocking request');
    return false;
  }

  try {
    const res = await fetch(GOOGLE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: secretKey,
        response: token,
      }),
    });

    if (!res.ok) {
      console.error(`[recaptcha] Google API returned HTTP ${res.status}`);
      return false;
    }

    const data = await res.json();

    if (!data.success) {
      // Log error codes (safe — no user data)
      console.warn('[recaptcha] Verification failed:', data['error-codes'] ?? 'unknown');
      return false;
    }

    return true;
  } catch (err) {
    console.error('[recaptcha] Verification error:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Standard CAPTCHA failure response body.
 * Use this to return consistent 403 responses across all auth endpoints.
 */
export const CAPTCHA_FAILED_RESPONSE = {
  success: false,
  error: 'CAPTCHA verification failed. Please try again.',
  code: 'CAPTCHA_FAILED',
} as const;
