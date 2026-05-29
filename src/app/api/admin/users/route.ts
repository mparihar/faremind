import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { hashPassword, auditLog } from '@/lib/admin-auth';

export const GET = withAdmin(async () => {
  const users = await prisma.adminUser.findMany({
    select: {
      id: true, email: true, fullName: true, role: true,
      isActive: true, lastLoginAt: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ users });
}, 'SUPER_ADMIN');

export const POST = withAdmin(async (req: NextRequest, { admin }) => {
  const { email, fullName, phone, role, password } = await req.json();

  if (!email || !fullName || !role) {
    return NextResponse.json({ error: 'email, fullName, role required' }, { status: 400 });
  }

  // Phone and email are mandatory for SUPER_ADMIN
  if (role === 'SUPER_ADMIN') {
    if (!phone?.trim()) {
      return NextResponse.json({ error: 'Phone number is mandatory for Super Admin' }, { status: 400 });
    }
  }

  const passwordHash = password ? await hashPassword(password) : null;

  const user = await prisma.adminUser.create({
    data: {
      email: email.toLowerCase(),
      fullName,
      phone: phone?.trim() || null,
      role,
      passwordHash,
      createdById: admin.sub,
    },
    select: { id: true, email: true, fullName: true, role: true, isActive: true },
  });

  await auditLog({
    adminUserId: admin.sub,
    action: 'CREATE_ADMIN_USER',
    entityType: 'AdminUser',
    entityId: user.id,
    after: { email, fullName, role },
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  });

  return NextResponse.json({ user }, { status: 201 });
}, 'SUPER_ADMIN');
