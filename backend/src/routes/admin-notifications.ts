/**
 * Admin Notification Recipients — CRUD API
 *
 * Manages the list of admin/support emails that receive
 * platform notification emails (booking confirmations, cancellations, etc.).
 *
 * Super admin (mparihar@gmail.com) is always included and cannot be removed.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/db';

const SUPER_ADMIN_EMAIL = 'mparihar@gmail.com';

/**
 * Checks if the given email has admin access (super_admin or admin role).
 * Returns the recipient record if authorized, null otherwise.
 */
async function checkAdminAccess(email?: string) {
  if (!email) return null;
  const recipient = await prisma.notificationRecipient.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
  if (!recipient || !recipient.isActive) return null;
  if (recipient.role === 'super_admin' || recipient.role === 'admin') return recipient;
  return null;
}

const adminNotificationsPlugin: FastifyPluginAsync = async (fastify) => {

  // ── GET / — List all recipients ───────────────────────────────
  fastify.get('/', async (_request, reply) => {
    try {
      const recipients = await prisma.notificationRecipient.findMany({
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      });

      // Ensure super admin is always in the list
      const hasSuperAdmin = recipients.some(r => r.email.toLowerCase() === SUPER_ADMIN_EMAIL);
      if (!hasSuperAdmin) {
        const sa = await prisma.notificationRecipient.create({
          data: {
            email: SUPER_ADMIN_EMAIL,
            name: 'Super Admin',
            role: 'super_admin',
            events: [],
            isActive: true,
          },
        });
        recipients.unshift(sa);
      }

      return reply.send({ recipients });
    } catch (err: any) {
      fastify.log.error(err, '[admin-notifications] List failed');
      return reply.code(500).send({ error: 'Failed to fetch recipients' });
    }
  });

  // ── POST / — Add a new recipient (admin-only) ────────────────
  fastify.post('/', async (request, reply) => {
    try {
      const { email, name, role, events, callerEmail } = request.body as {
        email: string;
        name: string;
        role?: string;
        events?: string[];
        callerEmail?: string;
      };

      // Auth check: only admin/super_admin can add recipients
      const caller = await checkAdminAccess(callerEmail);
      if (!caller) {
        return reply.code(403).send({ error: 'Only admin users can manage notification recipients' });
      }

      if (!email || !name) {
        return reply.code(400).send({ error: 'Email and name are required' });
      }

      // Check for duplicates
      const existing = await prisma.notificationRecipient.findUnique({
        where: { email: email.toLowerCase().trim() },
      });
      if (existing) {
        return reply.code(409).send({ error: 'Recipient with this email already exists' });
      }

      const recipient = await prisma.notificationRecipient.create({
        data: {
          email: email.toLowerCase().trim(),
          name: name.trim(),
          role: role || 'support',
          events: events || [],
          isActive: true,
          addedBy: SUPER_ADMIN_EMAIL,
        },
      });

      return reply.code(201).send({ recipient });
    } catch (err: any) {
      fastify.log.error(err, '[admin-notifications] Create failed');
      return reply.code(500).send({ error: 'Failed to add recipient' });
    }
  });

  // ── PUT /:id — Update a recipient (admin-only) ────────────────
  fastify.put('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { name, role, events, isActive, callerEmail } = request.body as {
        name?: string;
        role?: string;
        events?: string[];
        isActive?: boolean;
        callerEmail?: string;
      };

      // Auth check
      const caller = await checkAdminAccess(callerEmail);
      if (!caller) {
        return reply.code(403).send({ error: 'Only admin users can manage notification recipients' });
      }

      // Cannot modify super admin's role or deactivate them
      const existing = await prisma.notificationRecipient.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'Recipient not found' });
      }
      if (existing.email.toLowerCase() === SUPER_ADMIN_EMAIL) {
        if (isActive === false) {
          return reply.code(403).send({ error: 'Cannot deactivate super admin' });
        }
        if (role && role !== 'super_admin') {
          return reply.code(403).send({ error: 'Cannot change super admin role' });
        }
      }

      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name.trim();
      if (role !== undefined) updates.role = role;
      if (events !== undefined) updates.events = events;
      if (isActive !== undefined) updates.isActive = isActive;

      const recipient = await prisma.notificationRecipient.update({
        where: { id },
        data: updates,
      });

      return reply.send({ recipient });
    } catch (err: any) {
      fastify.log.error(err, '[admin-notifications] Update failed');
      return reply.code(500).send({ error: 'Failed to update recipient' });
    }
  });

  // ── DELETE /:id — Remove a recipient (admin-only) ─────────────
  fastify.delete('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const callerEmail = (request.query as any)?.callerEmail;

      // Auth check
      const caller = await checkAdminAccess(callerEmail);
      if (!caller) {
        return reply.code(403).send({ error: 'Only admin users can manage notification recipients' });
      }

      const existing = await prisma.notificationRecipient.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'Recipient not found' });
      }
      if (existing.email.toLowerCase() === SUPER_ADMIN_EMAIL) {
        return reply.code(403).send({ error: 'Cannot remove super admin' });
      }

      await prisma.notificationRecipient.delete({ where: { id } });
      return reply.send({ success: true });
    } catch (err: any) {
      fastify.log.error(err, '[admin-notifications] Delete failed');
      return reply.code(500).send({ error: 'Failed to remove recipient' });
    }
  });
};

export default adminNotificationsPlugin;
