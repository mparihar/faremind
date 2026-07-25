/**
 * Resolve the authenticated user from a Bearer session token or the
 * faremind_session cookie. Used by generic payment routes to derive payer
 * identity SERVER-SIDE (never trust client-supplied identity).
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

export interface SessionUser {
  id: string; email: string; firstName: string | null; lastName: string | null;
  phone: string | null; role: string; isActive: boolean;
}

export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '') || req.cookies.get('faremind_session')?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, isActive: true } } },
  });
  if (!session || !session.user || new Date(session.expiresAt) < new Date()) return null;
  return session.user as SessionUser;
}
