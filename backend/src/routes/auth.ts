import { FastifyPluginAsync } from 'fastify';
import { createHash, randomBytes } from 'crypto';
import prisma from '../lib/db';

const BREVO_URL    = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL ?? 'noreply@faremind.ai';
const SENDER_NAME  = 'FAREMIND';

// Master OTP for super admin — bypasses normal OTP validation
const MASTER_OTP = '778899';
const SUPER_ADMIN_EMAILS = ['mparihar@gmail.com'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateOtp(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

async function sendOtpEmail(toEmail: string, toName: string, otp: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn(`[auth] BREVO_API_KEY not set — OTP for ${toEmail}: ${otp}`);
    return;
  }
  const emailSubject = `${otp} — Your FAREMIND sign-in code`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
      <h2 style="color:#1ABC9C;margin-bottom:8px">Your FAREMIND sign-in code</h2>
      <p style="color:#475569;margin-bottom:24px">Hi ${toName}, use the code below to sign in. It expires in 5 minutes.</p>
      <div style="background:#0F172A;border-radius:12px;padding:24px;text-align:center">
        <span style="font-size:36px;font-weight:900;letter-spacing:0.15em;color:#fff">${otp}</span>
      </div>
      <p style="color:#94A3B8;font-size:12px;margin-top:24px">If you didn't request this, you can ignore this email.</p>
    </div>`;

  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: toEmail, name: toName }],
      subject: emailSubject,
      htmlContent: html,
      textContent: `Your FAREMIND sign-in code is: ${otp}\n\nValid for 5 minutes. Do not share it.`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[auth] Brevo error ${res.status}:`, body);
    try { await prisma.emailLog.create({ data: { recipient: toEmail, recipientName: toName, subject: emailSubject, template: 'OTP Verification', status: 'FAILED', provider: 'Brevo', errorMessage: `HTTP ${res.status}` } }); } catch {}
    throw new Error(`Brevo ${res.status}: ${body}`);
  }

  try { await prisma.emailLog.create({ data: { recipient: toEmail, recipientName: toName, subject: emailSubject, template: 'OTP Verification', status: 'SENT', provider: 'Brevo' } }); } catch {}
}

async function createAndSendOtp(email: string, name: string): Promise<void> {
  // Invalidate old codes for this email
  await prisma.otpCode.updateMany({
    where: { email, isUsed: false },
    data:  { isUsed: true },
  });

  const otp       = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60_000);

  await prisma.otpCode.create({
    data: { email, otpHash: hashOtp(otp), expiresAt },
  });

  // Always log in dev; attempt email send (non-blocking failure)
  console.log(`[auth][dev] OTP for ${email}: ${otp}`);
  try { await sendOtpEmail(email, name, otp); } catch (e) {
    console.error('[auth] Email send failed:', e);
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

const plugin: FastifyPluginAsync = async (fastify) => {

  // POST /api/auth/check-user
  fastify.post('/check-user', async (request, reply) => {
    try {
      const { email } = request.body as { email?: string };
      if (!email) return reply.code(400).send({ error: 'Email is required' });
      const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      return reply.send({ exists: !!user });
    } catch (e) {
      fastify.log.error(e, '[auth/check-user]');
      return reply.code(500).send({ error: 'Server error' });
    }
  });

  // POST /api/auth/send-otp  (existing users only)
  fastify.post('/send-otp', async (request, reply) => {
    try {
      const { email } = request.body as { email?: string };
      if (!email) return reply.code(400).send({ error: 'Email is required' });
      const norm = email.trim().toLowerCase();
      const user = await prisma.user.findUnique({ where: { email: norm } });
      if (!user) return reply.code(404).send({ error: 'User not found' });

      await createAndSendOtp(norm, `${user.firstName} ${user.lastName}`);
      return reply.send({ success: true });
    } catch (e) {
      fastify.log.error(e, '[auth/send-otp]');
      return reply.code(500).send({ error: 'Server error' });
    }
  });

  // POST /api/auth/register
  fastify.post('/register', async (request, reply) => {
    try {
      const body = request.body as {
        email?: string;
        first_name?: string;
        last_name?: string;
        phone?: string;
      };
      const { email, first_name, last_name, phone } = body;
      if (!email || !first_name || !last_name) {
        return reply.code(400).send({ error: 'email, first_name and last_name are required' });
      }
      const norm = email.trim().toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email: norm } });
      if (existing) return reply.code(409).send({ error: 'Email already registered' });

      await prisma.user.create({
        data: {
          email:        norm,
          firstName:    first_name.trim(),
          lastName:     last_name.trim(),
          phone:        phone?.trim() ?? null,
          passwordHash: 'otp-only',
          emailVerified: true,
        },
      });

      await createAndSendOtp(norm, `${first_name.trim()} ${last_name.trim()}`);
      return reply.send({ success: true });
    } catch (e) {
      fastify.log.error(e, '[auth/register]');
      return reply.code(500).send({ error: 'Server error' });
    }
  });

  // POST /api/auth/verify-otp
  fastify.post('/verify-otp', async (request, reply) => {
    try {
      const { email, otp } = request.body as { email?: string; otp?: string };
      if (!email || !otp) return reply.code(400).send({ error: 'email and otp are required' });
      const norm = email.trim().toLowerCase();

      const record = await prisma.otpCode.findFirst({
        where: { email: norm, isUsed: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });

      if (!record) return reply.code(400).send({ error: 'OTP expired or not found. Request a new one.' });
      if (record.attempts >= 5) {
        await prisma.otpCode.update({ where: { id: record.id }, data: { isUsed: true } });
        return reply.code(400).send({ error: 'Too many failed attempts. Request a new OTP.' });
      }

      // Master OTP bypass for super admin AND testing accounts
      const isMasterOtp = (SUPER_ADMIN_EMAILS.includes(norm) && otp.trim() === MASTER_OTP) || 
                          (norm.startsWith('test_') && otp.trim() === '123456');

      if (!isMasterOtp && record.otpHash !== hashOtp(otp.trim())) {
        await prisma.otpCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
        const left = 5 - record.attempts - 1;
        return reply.code(400).send({ error: `Invalid OTP. ${left} attempt${left !== 1 ? 's' : ''} remaining.` });
      }

      // Mark used
      await prisma.otpCode.update({ where: { id: record.id }, data: { isUsed: true } });

      const user = await prisma.user.update({
        where: { email: norm },
        data:  { lastLoginAt: new Date(), emailVerified: true },
      });

      // Create session (24h absolute max; 15-min inactivity timeout is the real guard)
      const token     = generateToken();
      const now       = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await prisma.session.create({
        data: { userId: user.id, token, expiresAt, lastActivityAt: now },
      });

      // Check if user is also an admin (for score visibility on platform)
      const adminUser = await prisma.adminUser.findUnique({
        where: { email: norm },
        select: { role: true, isActive: true },
      }).catch(() => null);

      const isAdminViewer = !!(
        adminUser &&
        adminUser.isActive &&
        ['SUPER_ADMIN', 'OPS_ADMIN', 'SUPPORT'].includes(adminUser.role)
      );

      return reply.send({
        success: true,
        sessionToken: token,
        user: { id: user.id, email: user.email, name: `${user.firstName} ${user.lastName}`, avatar: user.avatar || null, isAdminViewer, role: user.role },
      });
    } catch (e) {
      fastify.log.error(e, '[auth/verify-otp]');
      return reply.code(500).send({ error: 'Server error' });
    }
  });

  // POST /api/auth/resend-otp
  fastify.post('/resend-otp', async (request, reply) => {
    try {
      const { email } = request.body as { email?: string };
      if (!email) return reply.code(400).send({ error: 'Email is required' });
      const norm = email.trim().toLowerCase();
      const user = await prisma.user.findUnique({ where: { email: norm } });
      if (!user) return reply.code(404).send({ error: 'User not found' });

      await createAndSendOtp(norm, `${user.firstName} ${user.lastName}`);
      return reply.send({ success: true });
    } catch (e) {
      fastify.log.error(e, '[auth/resend-otp]');
      return reply.code(500).send({ error: 'Server error' });
    }
  });

  // GET /api/auth/validate-session
  // Enforces 15-min server-side inactivity + sliding window
  fastify.get('/validate-session', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) return reply.send({ valid: false });

      const session = await prisma.session.findFirst({
        where: { token, expiresAt: { gt: new Date() } },
        include: { user: true },
      });

      if (!session) return reply.send({ valid: false });

      // ── Server-side inactivity check (15 minutes) ────────────────────
      const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
      const lastActivity = session.lastActivityAt?.getTime() ?? session.createdAt.getTime();
      if (Date.now() - lastActivity > INACTIVITY_TIMEOUT_MS) {
        // Session expired due to inactivity — revoke it
        await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
        return reply.send({ valid: false, reason: 'inactivity' });
      }

      // ── Sliding window: touch lastActivityAt ─────────────────────────
      await prisma.session.update({
        where: { id: session.id },
        data: { lastActivityAt: new Date() },
      });

      // ── Check if this user is also an admin (for score visibility) ──
      const adminUser = await prisma.adminUser.findUnique({
        where: { email: session.user.email },
        select: { role: true, isActive: true },
      }).catch(() => null);

      const isAdminViewer = !!(
        adminUser &&
        adminUser.isActive &&
        ['SUPER_ADMIN', 'OPS_ADMIN', 'SUPPORT'].includes(adminUser.role)
      );

      return reply.send({
        valid: true,
        user: {
          id: session.user.id,
          email: session.user.email,
          name: `${session.user.firstName} ${session.user.lastName}`,
          avatar: session.user.avatar || null,
          isAdminViewer,
          role: session.user.role,
        },
      });
    } catch (e) {
      fastify.log.error(e, '[auth/validate-session]');
      return reply.send({ valid: false });
    }
  });

  // DELETE /api/auth/session — Server-side session revocation
  // Called by the client when inactivity logout fires, to clean up the DB session.
  fastify.delete('/session', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) return reply.code(401).send({ error: 'No token' });

      await prisma.session.deleteMany({ where: { token } });
      return reply.send({ ok: true });
    } catch (e) {
      fastify.log.error(e, '[auth/delete-session]');
      return reply.code(500).send({ error: 'Server error' });
    }
  });
};

export default plugin;
