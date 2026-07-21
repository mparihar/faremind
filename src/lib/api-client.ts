/**
 * API Client for Frontend → Backend communication.
 *
 * Routes all API calls to the standalone Express backend (port 3001)
 * instead of Next.js API routes.
 *
 * Falls back to relative URLs if NEXT_PUBLIC_API_URL is not set,
 * which would hit Next.js API routes as a legacy fallback.
 */

let API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
API_BASE_URL = API_BASE_URL.replace(/\/$/, '');

/**
 * Get the full API URL for a given path.
 * @param path - API path (e.g., '/api/search')
 * @returns Full URL (e.g., 'http://localhost:3001/api/search')
 */
export function apiUrl(path: string): string {
  // Ensure path starts with /api/
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

/**
 * Typed fetch wrapper for API calls.
 */
export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = apiUrl(path);
  // Only advertise a JSON body when we actually send one. Setting
  // Content-Type: application/json on a body-less request makes Fastify
  // reject it with FST_ERR_CTP_EMPTY_JSON_BODY (400) — e.g. the offer-session
  // /expire and /booked pings.
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> | undefined) };
  const hasBody = options?.body != null;
  const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');
  if (hasBody && !hasContentType) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      // Try to read the reason (inactivity vs generic auth failure)
      let reason = 'unknown';
      try {
        const body = await response.clone().json();
        reason = body.reason || 'expired';
      } catch {}

      const { useAuthStore } = require('@/store/useAuthStore');
      useAuthStore.getState().logout();

      if (reason === 'inactivity') {
        console.warn('[apiFetch] Session expired due to inactivity');
      }
      window.location.href = '/';
    }
    throw new Error('Session expired');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(error.error || `API request failed: ${response.status}`);
  }

  return response.json();
}
