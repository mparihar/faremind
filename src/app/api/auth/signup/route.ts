import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { createHash, randomBytes } from 'crypto';

/**
 * POST /api/auth/signup
 * Creates a new user account with hashed password.
 */
export async function POST(request: NextRequest) {
  try {
    const { firstName, lastName, email, password } = await request.json();

    if (!firstName || !lastName || !email || !password) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Check for existing user
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    // Hash password with salt
    const salt = randomBytes(16).toString('hex');
    const hashedPassword = createHash('sha256')
      .update(password + salt)
      .digest('hex');

    const user = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        passwordHash: `${salt}:${hashedPassword}`,
      },
    });

    // Create session token stored in DB
    const token = randomBytes(32).toString('hex');
    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600000), // 7 days
      },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
      },
      sessionToken: token,
    });
  } catch (error) {
    console.error('[Auth] Signup error:', error);
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    );
  }
}
