import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken, type AdminTokenPayload } from '@/lib/admin-auth';
import type { AdminRole } from '@/generated/prisma/client';

export type AdminHandler = (
  req: NextRequest,
  ctx: { admin: AdminTokenPayload; params: Record<string, string> }
) => Promise<NextResponse>;

const ROLE_RANK: Record<AdminRole, number> = {
  SUPER_ADMIN: 5,
  OPS_ADMIN:   4,
  FINANCE:     3,
  SUPPORT:     2,
  READ_ONLY:   1,
};

const COOKIE_NAME = 'admin_token';

export function hasRole(userRole: AdminRole, required: AdminRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[required];
}

export function withAdmin(handler: AdminHandler, minRole: AdminRole = 'READ_ONLY') {
  return async (
    req: NextRequest,
    context: { params: Promise<Record<string, string>> }
  ) => {
    // Cookie takes priority (HttpOnly); fall back to Authorization header
    const token = req.cookies.get(COOKIE_NAME)?.value
      ?? req.headers.get('authorization')?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyAdminToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    if (!hasRole(payload.role, minRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const params = await context.params;
    return handler(req, { admin: payload, params });
  };
}
