// FILE: src/lib/agent-auth.ts
// Agent authentication middleware for Next.js API routes.
// Validates the user session token and ensures the user has the FAREMIND_AGENT role.
// Reuses the existing user session system — no separate admin auth.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export interface AgentContext {
  id: string;
  email: string;
  name: string;
  role: 'FAREMIND_AGENT';
  isActive?: boolean; // false = wallet-disabled (recharge-only access)
}

export type AgentHandler = (
  req: NextRequest,
  ctx: { agent: AgentContext; params: Record<string, string> }
) => Promise<NextResponse>;

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Middleware that wraps an API handler to enforce agent authentication.
 * - Validates the Bearer session token
 * - Checks the user has role = FAREMIND_AGENT
 * - Injects `agent` context into the handler
 */
export function withAgent(handler: AgentHandler) {
  return async (
    req: NextRequest,
    context: { params: Promise<Record<string, string>> }
  ) => {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate session
    const session = await prisma.session.findFirst({
      where: { token, expiresAt: { gt: new Date() } },
      include: { user: true },
    });

    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    // Inactivity check
    const lastActivity = session.lastActivityAt?.getTime() ?? session.createdAt.getTime();
    if (Date.now() - lastActivity > INACTIVITY_TIMEOUT_MS) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return NextResponse.json({ error: 'Session expired due to inactivity' }, { status: 401 });
    }

    // Touch session
    await prisma.session.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() },
    }).catch(() => {});

    // Enforce agent role
    if (session.user.role !== 'FAREMIND_AGENT') {
      return NextResponse.json({ error: 'Forbidden — agent role required' }, { status: 403 });
    }

    if (!session.user.isActive) {
      return NextResponse.json({ error: 'Account is disabled' }, { status: 403 });
    }

    const agent: AgentContext = {
      id: session.user.id,
      email: session.user.email,
      name: `${session.user.firstName} ${session.user.lastName}`.trim(),
      role: 'FAREMIND_AGENT',
      isActive: session.user.isActive,
    };

    const params = await context.params;
    return handler(req, { agent, params });
  };
}

/**
 * Like withAgent, but ALLOWS a wallet-disabled agent (isActive=false) through.
 * Use for READ / SERVICING surfaces a disabled agent must still reach — viewing
 * their bookings & dashboard, wallet recharge, post-booking servicing. Being over
 * the prepaid wallet limit should never hide existing bookings; only NEW booking
 * creation is gated (by the wallet check at checkout). Booking-CREATION endpoints
 * must keep using withAgent (which blocks disabled accounts).
 */
export function withAgentServicing(handler: AgentHandler) {
  return async (
    req: NextRequest,
    context: { params: Promise<Record<string, string>> }
  ) => {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const session = await prisma.session.findFirst({
      where: { token, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!session) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

    const lastActivity = session.lastActivityAt?.getTime() ?? session.createdAt.getTime();
    if (Date.now() - lastActivity > INACTIVITY_TIMEOUT_MS) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return NextResponse.json({ error: 'Session expired due to inactivity' }, { status: 401 });
    }
    await prisma.session.update({ where: { id: session.id }, data: { lastActivityAt: new Date() } }).catch(() => {});

    if (session.user.role !== 'FAREMIND_AGENT') {
      return NextResponse.json({ error: 'Forbidden — agent role required' }, { status: 403 });
    }
    // NOTE: intentionally NOT enforcing isActive here — recharge must work while disabled.

    const agent: AgentContext = {
      id: session.user.id,
      email: session.user.email,
      name: `${session.user.firstName} ${session.user.lastName}`.trim(),
      role: 'FAREMIND_AGENT',
      isActive: session.user.isActive,
    };
    const params = await context.params;
    return handler(req, { agent, params });
  };
}

/** @deprecated Alias of withAgentServicing (kept for existing recharge routes). */
export const withAgentWalletAccess = withAgentServicing;
