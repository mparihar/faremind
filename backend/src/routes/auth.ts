import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/db';
import { createHash, randomBytes } from 'crypto';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/login', async (request, reply) => {
    try {
      const { email, password } = request.body as { email?: string; password?: string };
      if (!email || !password) return reply.code(400).send({ error: 'Email and password are required' });

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.passwordHash) return reply.code(401).send({ error: 'Invalid email or password' });

      const [salt, storedHash] = user.passwordHash.split(':');
      const inputHash = createHash('sha256').update(password + salt).digest('hex');
      if (inputHash !== storedHash) return reply.code(401).send({ error: 'Invalid email or password' });

      const token = randomBytes(32).toString('hex');
      await prisma.session.create({ data: { userId: user.id, token, expiresAt: new Date(Date.now() + 7 * 24 * 3600000) } });
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      return { success: true, user: { id: user.id, email: user.email, name: `${user.firstName} ${user.lastName}` }, sessionToken: token };
    } catch (error) {
      console.error('[Auth] Login error:', error);
      reply.code(500).send({ error: 'Failed to authenticate' });
    }
  });

  fastify.post('/signup', async (request, reply) => {
    try {
      const { firstName, lastName, email, password } = request.body as {
        firstName?: string; lastName?: string; email?: string; password?: string;
      };
      if (!firstName || !lastName || !email || !password) return reply.code(400).send({ error: 'All fields are required' });
      if (password.length < 8) return reply.code(400).send({ error: 'Password must be at least 8 characters' });

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) return reply.code(409).send({ error: 'An account with this email already exists' });

      const salt = randomBytes(16).toString('hex');
      const hashedPassword = createHash('sha256').update(password + salt).digest('hex');

      const user = await prisma.user.create({ data: { email, firstName, lastName, passwordHash: `${salt}:${hashedPassword}` } });
      const token = randomBytes(32).toString('hex');
      await prisma.session.create({ data: { userId: user.id, token, expiresAt: new Date(Date.now() + 7 * 24 * 3600000) } });

      return { success: true, user: { id: user.id, email: user.email, name: `${user.firstName} ${user.lastName}` }, sessionToken: token };
    } catch (error) {
      console.error('[Auth] Signup error:', error);
      reply.code(500).send({ error: 'Failed to create account' });
    }
  });
};

export default plugin;
