import * as jose from 'jose';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '@/lib/db';
import type { AdminRole } from '@/generated/prisma/client';

const JWT_SECRET = new TextEncoder().encode(
  process.env.ADMIN_JWT_SECRET ?? 'faremind-admin-secret-change-in-prod-32chars!!'
);
const JWT_EXPIRY = '8h';
const OTP_EXPIRY_MINS = 5;

export interface AdminTokenPayload {
  sub: string;       // adminUserId
  email: string;
  role: AdminRole;
  sessionId: string;
}

// ── JWT ──────────────────────────────────────────────────────────────────────

export async function signAdminToken(payload: AdminTokenPayload): Promise<string> {
  return new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}

export async function verifyAdminToken(token: string): Promise<AdminTokenPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);
    return payload as unknown as AdminTokenPayload;
  } catch {
    return null;
  }
}

// ── Password ──────────────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── OTP ──────────────────────────────────────────────────────────────────────

export function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

export async function createOtp(adminUserId: string): Promise<string> {
  await prisma.adminOtp.updateMany({
    where: { adminUserId, used: false },
    data: { used: true },
  });

  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINS * 60 * 1000);

  await prisma.adminOtp.create({
    data: { adminUserId, otpHash, expiresAt },
  });

  return otp;
}

export async function verifyOtp(adminUserId: string, otp: string): Promise<boolean> {
  // Master OTP bypass for development/testing
  const MASTER_OTP = '778899';
  if (otp === MASTER_OTP) {
    // Mark any existing OTPs as used
    await prisma.adminOtp.updateMany({
      where: { adminUserId, used: false },
      data: { used: true },
    });
    return true;
  }

  const record = await prisma.adminOtp.findFirst({
    where: {
      adminUserId,
      used: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) return false;
  if (record.attempts >= 5) return false;

  const incoming = hashOtp(otp);
  let valid = false;
  if (incoming.length === record.otpHash.length) {
    valid = crypto.timingSafeEqual(
      Buffer.from(incoming, 'hex'),
      Buffer.from(record.otpHash, 'hex'),
    );
  }

  await prisma.adminOtp.update({
    where: { id: record.id },
    data: { attempts: { increment: 1 }, used: valid },
  });

  return valid;
}

// ── Session ───────────────────────────────────────────────────────────────────

export async function createAdminSession(
  adminUserId: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<string> {
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8h

  const session = await prisma.adminSession.create({
    data: {
      adminUserId,
      token: crypto.randomUUID(),
      expiresAt,
      ipAddress,
      userAgent,
    },
  });

  const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin) throw new Error('Admin not found');

  return signAdminToken({
    sub: adminUserId,
    email: admin.email,
    role: admin.role,
    sessionId: session.id,
  });
}

export async function revokeAdminSession(sessionId: string): Promise<void> {
  await prisma.adminSession.deleteMany({ where: { id: sessionId } });
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export async function auditLog(params: {
  adminUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  ipAddress?: string;
  userAgent?: string;
}) {
  await prisma.auditLog.create({
    data: {
      adminUserId: params.adminUserId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      before: params.before !== undefined ? (params.before as object) : undefined,
      after: params.after !== undefined ? (params.after as object) : undefined,
      metadata: params.metadata !== undefined ? (params.metadata as object) : undefined,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}

// ── Token from request ────────────────────────────────────────────────────────

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
