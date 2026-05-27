import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';

export const POST = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  const bookingId = params?.id;
  if (!bookingId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { note, isInternal = true } = await req.json();
  if (!note?.trim()) return NextResponse.json({ error: 'Note is required' }, { status: 400 });

  // Resolve the booking — id may be a masterBookingReference or cuid
  const mb = await prisma.masterBooking.findFirst({
    where: {
      OR: [
        { id: bookingId },
        { masterBookingReference: bookingId },
      ],
    },
    select: { id: true },
  });
  if (!mb) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const record = await prisma.bookingNote.create({
    data: {
      bookingId:    mb.id,
      createdById:  admin.sub,
      noteText:     note.trim(),
      isInternal,
    },
    include: { createdBy: { select: { fullName: true, role: true } } },
  });

  await auditLog({
    adminUserId: admin.sub,
    action: 'ADD_NOTE',
    entityType: 'MasterBooking',
    entityId: mb.id,
    after: { note: note.trim(), isInternal },
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  });

  // Normalize to match page expectation
  return NextResponse.json({
    note: {
      id:         record.id,
      note:       record.noteText,
      isInternal: record.isInternal,
      createdAt:  record.createdAt,
      adminUser:  record.createdBy ?? null,
    },
  });
}, 'SUPPORT');
