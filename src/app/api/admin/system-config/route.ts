import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * GET /api/admin/system-config
 * List all system configuration entries (admin-authenticated).
 */
export const GET = withAdmin(async () => {
  try {
    const configs = await prisma.systemConfig.findMany({
      orderBy: { key: 'asc' },
    });

    return NextResponse.json({ configs });
  } catch (err: any) {
    console.error('[admin/system-config] GET error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');

/**
 * PUT /api/admin/system-config
 * Update a system config entry by key. Creates if it doesn't exist (upsert).
 *
 * Body: { key: string, value: string, description?: string }
 */
export const PUT = withAdmin(async (req: NextRequest, { admin }) => {
  try {
    const body = await req.json();
    const { key, value, description } = body;

    if (!key || value === undefined || value === null) {
      return NextResponse.json({ error: 'key and value are required' }, { status: 400 });
    }

    // Validate offer_expiry_minutes specifically
    if (key === 'offer_expiry_minutes') {
      const minutes = parseInt(value, 10);
      if (isNaN(minutes) || minutes < 5 || minutes > 60) {
        return NextResponse.json(
          { error: 'offer_expiry_minutes must be between 5 and 60' },
          { status: 400 },
        );
      }
    }

    // Validate rate limit config keys
    if (key === 'rate_limit_enabled') {
      if (value !== 'true' && value !== 'false') {
        return NextResponse.json(
          { error: 'rate_limit_enabled must be "true" or "false"' },
          { status: 400 },
        );
      }
    } else if (key.startsWith('rate_limit_') && key.endsWith('_per_minute')) {
      const limit = parseInt(value, 10);
      if (isNaN(limit) || limit < 1 || limit > 10000) {
        return NextResponse.json(
          { error: `${key} must be a number between 1 and 10000` },
          { status: 400 },
        );
      }
    }

    const config = await prisma.systemConfig.upsert({
      where: { key },
      create: {
        key,
        value: String(value),
        description: description ?? null,
        updatedBy: admin.email,
      },
      update: {
        value: String(value),
        description: description !== undefined ? description : undefined,
        updatedBy: admin.email,
      },
    });

    console.log(`[SystemConfig] Updated "${key}" = "${value}" by ${admin.email}`);

    return NextResponse.json({ config });
  } catch (err: any) {
    console.error('[admin/system-config] PUT error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');
