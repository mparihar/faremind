import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * Admin System — Feature Flags API
 * CRUD for SystemConfig entries.
 * NEW API — does not modify any existing routes.
 */

// GET — List all configs
export const GET = withAdmin(async (req: NextRequest) => {
  const configs = await prisma.systemConfig.findMany({
    orderBy: { key: 'asc' },
  });

  return NextResponse.json({
    configs: configs.map(c => ({
      id: c.id,
      key: c.key,
      value: c.value,
      description: c.description,
      updatedBy: c.updatedBy,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
  });
}, 'OPS_ADMIN');

// POST — Create new config
export const POST = withAdmin(async (req: NextRequest) => {
  const body = await req.json();
  const { key, value, description } = body;

  if (!key || !value) {
    return NextResponse.json({ error: 'key and value are required' }, { status: 400 });
  }

  // Check for duplicate key
  const existing = await prisma.systemConfig.findUnique({ where: { key } });
  if (existing) {
    return NextResponse.json({ error: `Key "${key}" already exists` }, { status: 409 });
  }

  const config = await prisma.systemConfig.create({
    data: { key, value, description: description || null },
  });

  return NextResponse.json({ config });
}, 'SUPER_ADMIN');

// PATCH — Update config value
export const PATCH = withAdmin(async (req: NextRequest) => {
  const body = await req.json();
  const { id, value } = body;

  if (!id || value === undefined) {
    return NextResponse.json({ error: 'id and value are required' }, { status: 400 });
  }

  const config = await prisma.systemConfig.update({
    where: { id },
    data: { value, updatedBy: 'admin' },
  });

  return NextResponse.json({ config });
}, 'OPS_ADMIN');

// DELETE — Remove config
export const DELETE = withAdmin(async (req: NextRequest) => {
  const body = await req.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  await prisma.systemConfig.delete({ where: { id } });

  return NextResponse.json({ success: true });
}, 'SUPER_ADMIN');
