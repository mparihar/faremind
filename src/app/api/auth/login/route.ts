import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { createHash, randomBytes } from 'crypto';

/**
 * POST /api/auth/login
 * Validates credentials and returns a session token.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Verify password
    const [salt, storedHash] = user.passwordHash.split(':');
    const inputHash = createHash('sha256')
      .update(password + salt)
      .digest('hex');

    if (inputHash !== storedHash) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Create session token stored in DB
    const token = randomBytes(32).toString('hex');
    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600000), // 7 days
      },
    });

    // Update last login time
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        avatar: user.avatar || null,
      },
      sessionToken: token,
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    return NextResponse.json(
      { error: 'Failed to authenticate' },
      { status: 500 }
    );
  }
}
