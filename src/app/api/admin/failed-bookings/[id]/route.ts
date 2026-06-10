import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withAdmin } from '@/lib/admin-rbac';
import type { AdminTokenPayload } from '@/lib/admin-auth';

// ── DELETE — Remove a failed booking audit record ────────────────────────────
// Only OPS_ADMIN and SUPER_ADMIN can delete records.
export const DELETE = withAdmin(async (
  _req: NextRequest,
  { params }: { admin: AdminTokenPayload; params: Record<string, string> },
) => {
  const id = params.id;

  const existing = await (prisma as any).bookingFailureAudit.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }

  await (prisma as any).bookingFailureAudit.delete({ where: { id } });

  return NextResponse.json({ success: true, deletedId: id });
}, 'OPS_ADMIN');

// ── PATCH — Mark as resolved or update resolution notes ──────────────────────
// SUPPORT role and above can resolve records.
export const PATCH = withAdmin(async (
  req: NextRequest,
  { admin, params }: { admin: AdminTokenPayload; params: Record<string, string> },
) => {
  const id = params.id;
  const body = await req.json();
  const { resolutionNotes } = body;

  const existing = await (prisma as any).bookingFailureAudit.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }

  const resolvedBy = admin.email || 'Admin';

  const updated = await (prisma as any).bookingFailureAudit.update({
    where: { id },
    data: {
      resolvedAt: new Date(),
      resolvedBy,
      resolutionNotes: resolutionNotes || null,
    },
  });

  return NextResponse.json({ success: true, record: updated });
}, 'SUPPORT');
