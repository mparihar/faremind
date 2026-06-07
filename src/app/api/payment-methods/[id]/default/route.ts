import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  try {
    const { id } = context.params;
    const body = await req.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Un-default others
    await prisma.paymentMethod.updateMany({
      where: { userId, id: { not: id } },
      data: { isDefault: false }
    });

    // Default this one
    const updated = await prisma.paymentMethod.update({
      where: { id },
      data: { isDefault: true }
    });

    return NextResponse.json({ success: true, paymentMethod: updated });
  } catch (error) {
    console.error('[PATCH /api/payment-methods/default]', error);
    return NextResponse.json({ error: 'Failed to update default status' }, { status: 500 });
  }
}
