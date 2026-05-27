import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';

export const PATCH = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const { noteId } = params;
    const { note, isInternal } = await req.json();

    const existing = await prisma.bookingNote.findUnique({ where: { id: noteId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const update: any = {};
    if (note !== undefined) update.noteText = note.trim();
    if (isInternal !== undefined) update.isInternal = isInternal;
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
    }

    const updated = await prisma.bookingNote.update({
      where: { id: noteId },
      data: update,
      include: { createdBy: { select: { fullName: true, role: true } } },
    });

    await prisma.bookingEvent.create({
      data: {
        bookingId:        existing.bookingId,
        eventType:        'NOTE_UPDATED',
        eventTitle:       'Note Updated',
        eventDescription: `Note updated by admin`,
        actorType:        'admin',
        actorId:          admin.sub,
        actorName:        admin.email,
      },
    });

    return NextResponse.json({
      note: {
        id:         updated.id,
        note:       updated.noteText,
        isInternal: updated.isInternal,
        createdAt:  updated.createdAt,
        adminUser:  updated.createdBy ?? null,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}, 'SUPPORT');

export const DELETE = withAdmin(async (_req: NextRequest, { admin, params }: any) => {
  try {
    const { noteId } = params;

    const note = await prisma.bookingNote.findUnique({ where: { id: noteId } });
    if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await prisma.bookingNote.delete({ where: { id: noteId } });

    await prisma.bookingEvent.create({
      data: {
        bookingId:        note.bookingId,
        eventType:        'NOTE_DELETED',
        eventTitle:       'Note Deleted',
        eventDescription: `Note deleted by admin`,
        actorType:        'admin',
        actorId:          admin.sub,
        actorName:        admin.email,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}, 'SUPPORT');
