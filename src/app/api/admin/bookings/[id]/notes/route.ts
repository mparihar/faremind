import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';

export const POST = withAdmin(async (req: NextRequest, { admin, params }) => {
  const bookingId = params?.id;
  if (!bookingId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { note, isInternal = true } = await req.json();
  if (!note?.trim()) return NextResponse.json({ error: 'Note is required' }, { status: 400 });

  const record = await prisma.supportNote.create({
    data: { bookingId, adminUserId: admin.sub, note: note.trim(), isInternal },
    include: { adminUser: { select: { fullName: true, role: true } } },
  });

  await auditLog({
    adminUserId: admin.sub,
    action: 'ADD_NOTE',
    entityType: 'Booking',
    entityId: bookingId,
    after: { note: note.trim(), isInternal },
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  });

  return NextResponse.json({ note: record });
}, 'SUPPORT');
