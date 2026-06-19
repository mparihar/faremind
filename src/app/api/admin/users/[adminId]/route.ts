import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';

export const GET = withAdmin(async (_req: NextRequest, { params }: any) => {
  try {
    const adminId = params?.adminId;
    if (!adminId) return NextResponse.json({ error: 'Missing adminId' }, { status: 400 });

    const user = await prisma.adminUser.findUnique({
      where: { id: adminId },
      select: {
        id: true, email: true, fullName: true, phone: true, role: true,
        isActive: true, lastLoginAt: true, lastLoginIp: true,
        createdById: true, createdAt: true, updatedAt: true,
      },
    });
    if (!user) return NextResponse.json({ error: 'Admin user not found' }, { status: 404 });

    return NextResponse.json({ user });
  } catch (err: any) {
    console.error('[admin/users/[adminId]] GET error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'SUPER_ADMIN');

export const PATCH = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const adminId = params?.adminId;
    if (!adminId) return NextResponse.json({ error: 'Missing adminId' }, { status: 400 });

    const target = await prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, fullName: true, phone: true, role: true, isActive: true },
    });
    if (!target) return NextResponse.json({ error: 'Admin user not found' }, { status: 404 });

    const body = await req.json();
    const allowed = ['fullName', 'email', 'phone', 'role', 'isActive'];
    const update: any = {};
    for (const key of allowed) {
      if (body[key] !== undefined) update[key] = body[key];
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Phone and email are mandatory for SUPER_ADMIN
    const effectiveRole = update.role || target.role;
    if (effectiveRole === 'SUPER_ADMIN') {
      const effectivePhone = update.phone !== undefined ? update.phone : target.phone;
      const effectiveEmail = update.email !== undefined ? update.email : target.email;
      if (!effectivePhone?.trim()) {
        return NextResponse.json({ error: 'Phone number is mandatory for Super Admin' }, { status: 400 });
      }
      if (!effectiveEmail?.trim()) {
        return NextResponse.json({ error: 'Email is mandatory for Super Admin' }, { status: 400 });
      }
    }

    // Super admin protection: cannot demote last SUPER_ADMIN
    if (update.role && update.role !== 'SUPER_ADMIN' && target.role === 'SUPER_ADMIN') {
      const superAdminCount = await prisma.adminUser.count({
        where: { role: 'SUPER_ADMIN', isActive: true },
      });
      if (superAdminCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot demote the last active Super Admin. There must always be at least one.' },
          { status: 403 }
        );
      }
    }

    // Super admin protection: cannot deactivate last SUPER_ADMIN
    if (update.isActive === false && target.role === 'SUPER_ADMIN') {
      const superAdminCount = await prisma.adminUser.count({
        where: { role: 'SUPER_ADMIN', isActive: true },
      });
      if (superAdminCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot deactivate the last active Super Admin.' },
          { status: 403 }
        );
      }
    }

    if (update.email) update.email = update.email.toLowerCase();

    const updated = await prisma.adminUser.update({
      where: { id: adminId },
      data: update,
      select: { id: true, email: true, fullName: true, phone: true, role: true, isActive: true },
    });

    if (update.role === 'SUPPORT' && target.role !== 'SUPPORT') {
      import('@/lib/email').then(m => m.sendSupportRoleGrantedEmail(updated.email, updated.fullName)).catch(e => console.error(e));
    }

    await auditLog({
      adminUserId: admin.sub,
      action: 'UPDATE_ADMIN_USER',
      entityType: 'AdminUser',
      entityId: adminId,
      before: { fullName: target.fullName, email: target.email, phone: target.phone, role: target.role, isActive: target.isActive },
      after: update,
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({ success: true, user: updated });
  } catch (err: any) {
    console.error('[admin/users/[adminId]] PATCH error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'SUPER_ADMIN');

export const DELETE = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const adminId = params?.adminId;
    if (!adminId) return NextResponse.json({ error: 'Missing adminId' }, { status: 400 });

    // Cannot delete yourself
    if (adminId === admin.sub) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 403 });
    }

    const target = await prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, fullName: true, role: true },
    });
    if (!target) return NextResponse.json({ error: 'Admin user not found' }, { status: 404 });

    // Super admin protection: cannot delete last SUPER_ADMIN
    if (target.role === 'SUPER_ADMIN') {
      const superAdminCount = await prisma.adminUser.count({
        where: { role: 'SUPER_ADMIN', isActive: true },
      });
      if (superAdminCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot delete the last Super Admin. There must always be at least one.' },
          { status: 403 }
        );
      }
    }

    await prisma.adminUser.delete({ where: { id: adminId } });

    await auditLog({
      adminUserId: admin.sub,
      action: 'DELETE_ADMIN_USER',
      entityType: 'AdminUser',
      entityId: adminId,
      before: { email: target.email, fullName: target.fullName, role: target.role },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({ success: true, deleted: target.email });
  } catch (err: any) {
    console.error('[admin/users/[adminId]] DELETE error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'SUPER_ADMIN');
