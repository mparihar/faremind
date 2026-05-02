/**
 * API Client for Frontend → Backend communication.
 *
 * Routes all API calls to the standalone Express backend (port 3001)
 * instead of Next.js API routes.
 *
 * Falls back to relative URLs if NEXT_PUBLIC_API_URL is not set,
 * which would hit Next.js API routes as a legacy fallback.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

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
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(error.error || `API request failed: ${response.status}`);
  }

  return response.json();
}
