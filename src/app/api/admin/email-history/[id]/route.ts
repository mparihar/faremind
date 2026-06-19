import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withAdmin } from '@/lib/admin-rbac';

// DELETE — Remove a single email log
export const DELETE = withAdmin(async (req: NextRequest, { params }: any) => {
  try {
    const emailId = params?.id;
    if (!emailId) return NextResponse.json({ error: 'Missing email ID' }, { status: 400 });

    await prisma.emailLog.delete({ where: { id: emailId } });

    return NextResponse.json({ success: true, deletedId: emailId });
  } catch (err: any) {
    console.error('[email-history/[id]] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete email log' }, { status: 500 });
  }
}, 'SUPER_ADMIN');
