import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';

export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit  = 20;
  const search = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { slug: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [partners, total] = await Promise.all([
    prisma.partner.findMany({
      where,
      take: limit,
      skip: (page - 1) * limit,
      orderBy: { createdAt: 'desc' },
      include: {
        users: { select: { id: true, email: true, fullName: true, isActive: true } },
        _count: { select: { commissionRules: true, settlements: true } },
      },
    }),
    prisma.partner.count({ where }),
  ]);

  return NextResponse.json({ partners, total, page, limit });
}, 'READ_ONLY');

export const POST = withAdmin(async (req: NextRequest, { admin }) => {
  const body = await req.json();
  const { name, email, phone, country, creditLimit } = body;

  if (!name || !email) {
    return NextResponse.json({ error: 'name and email required' }, { status: 400 });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const partner = await prisma.partner.create({
    data: {
      name, email: email.toLowerCase(), slug, phone, country,
      creditLimit: creditLimit ? parseFloat(creditLimit) : null,
      apiKey: `pk_${crypto.randomUUID().replace(/-/g, '')}`,
    },
  });

  await auditLog({
    adminUserId: admin.sub,
    action: 'CREATE_PARTNER',
    entityType: 'Partner',
    entityId: partner.id,
    after: { name, email },
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  });

  return NextResponse.json({ partner }, { status: 201 });
}, 'OPS_ADMIN');
