import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';

export const DELETE = withAdmin(async (_req: NextRequest, { admin, params }: any) => {
  try {
    const { payloadId } = params;

    const payload = await prisma.bookingProviderPayload.findUnique({ where: { id: payloadId } });
    if (!payload) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await prisma.bookingProviderPayload.delete({ where: { id: payloadId } });

    await prisma.bookingEvent.create({
      data: {
        bookingId:        payload.bookingId,
        eventType:        'PROVIDER_PAYLOAD_DELETED',
        eventTitle:       'Provider Payload Deleted',
        eventDescription: `${payload.provider} ${payload.payloadType} payload deleted by admin`,
        actorType:        'admin',
        actorId:          admin.sub,
        actorName:        admin.email,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}, 'OPS_ADMIN');
