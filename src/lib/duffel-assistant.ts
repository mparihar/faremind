/**
 * Duffel Assistant — Server-Side Utility
 *
 * Handles Duffel component client key creation and feature flag checks.
 * This file is server-side only — never imported by client components.
 *
 * Security:
 * - DUFFEL_API_TOKEN is read from process.env (server only)
 * - Client keys are ephemeral and scoped to a single component session
 * - Feature flag check prevents usage when disabled
 */

import { prisma } from '@/lib/db';

const DUFFEL_API_URL = process.env.DUFFEL_API_URL || 'https://api.duffel.com';

// ── Feature Flag ──────────────────────────────────────────────────────────────

/**
 * Check if Duffel Assistant is enabled.
 * Priority: SystemConfig DB row > env var > default (false).
 */
export async function isDuffelAssistantEnabled(): Promise<boolean> {
  // 1. Check env var first (fastest)
  const envFlag = process.env.DUFFEL_ASSISTANT_ENABLED;
  if (envFlag === 'false') return false;

  // 2. Check DB SystemConfig for runtime override
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'DUFFEL_ASSISTANT_ENABLED' },
    });
    if (config) {
      return config.value === 'true';
    }
  } catch {
    // DB check failed — fall through to env var
  }

  // 3. Fall back to env var
  return envFlag === 'true';
}

// ── Client Key Creation ───────────────────────────────────────────────────────

export interface DuffelAssistantSession {
  clientKey: string;
}

/**
 * Create a Duffel component client key for the Assistant.
 * Called from the backend only — the DUFFEL_API_TOKEN never leaves the server.
 */
export async function createDuffelAssistantSession(
  orderId: string,
  customerUserId?: string | null,
): Promise<DuffelAssistantSession> {
  const token = process.env.DUFFEL_API_TOKEN;
  if (!token) {
    throw new Error('DUFFEL_API_TOKEN is not configured');
  }

  // Build the component client key request
  // Duffel API: POST /components/client_keys
  const body: Record<string, unknown> = {};

  // If we have a customer user ID, scope the key to that user
  if (customerUserId) {
    body.user_id = customerUserId;
  }

  const response = await fetch(`${DUFFEL_API_URL}/components/client_keys`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Duffel-Version': 'v2',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ data: body }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    console.error(
      `[duffel-assistant] Failed to create client key: ${response.status}`,
      errorBody,
    );
    throw new Error(`Duffel API error ${response.status}: Failed to create assistant session`);
  }

  const result = await response.json();
  const clientKey = result?.data?.component_client_key;

  if (!clientKey) {
    throw new Error('Duffel API did not return a component_client_key');
  }

  return { clientKey };
}
