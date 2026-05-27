import { FastifyPluginAsync } from 'fastify';
import { getUserNotifications, markNotificationRead, getUnreadCount } from '../lib/db-queries';
import { fireNotification } from '../lib/notify';

const NOTIFICATION_SERVICE = process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:8001';

async function proxyToService(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${NOTIFICATION_SERVICE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: 'Invalid response from notification service' }));
  return { status: res.status, data };
}

const plugin: FastifyPluginAsync = async (fastify) => {

  // ── Existing user-facing endpoints (unchanged) ────────────────────────────

  fastify.get('/', async (request, reply) => {
    const { userId, limit: limitStr = '50' } = request.query as { userId?: string; limit?: string };
    const limit = parseInt(limitStr);
    if (!userId) return reply.code(400).send({ error: 'userId is required' });
    try {
      const [notifications, unreadCount] = await Promise.all([
        getUserNotifications(userId, limit),
        getUnreadCount(userId),
      ]);
      return { notifications, unreadCount };
    } catch {
      reply.code(500).send({ error: 'Failed to fetch notifications' });
    }
  });

  fastify.patch('/', async (request, reply) => {
    try {
      const { notificationId } = request.body as { notificationId?: string };
      if (!notificationId) return reply.code(400).send({ error: 'notificationId is required' });
      const notification = await markNotificationRead(notificationId);
      return { notification };
    } catch {
      reply.code(500).send({ error: 'Failed to update notification' });
    }
  });

  // ── Notification service gateway endpoints ────────────────────────────────

  // POST /api/notifications/event — trigger a booking lifecycle event (direct Brevo)
  fastify.post('/event', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (!body?.event_type) return reply.code(400).send({ error: 'event_type is required' });
    try {
      await fireNotification({
        event_type: body.event_type as any,
        booking_id: body.booking_id as string | undefined,
        customer_email: body.customer_email as string | undefined,
        data: (body.data as Record<string, unknown>) ?? {},
      });
      return reply.code(200).send({ status: 'processing', notifications_queued: 1 });
    } catch (err) {
      fastify.log.error({ err }, '[notifications/event] send failed');
      return reply.code(202).send({ queued: false, error: 'Notification send failed — booking not affected' });
    }
  });

  // POST /api/notifications/send — direct send via template key
  fastify.post('/send', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (!body?.to || !body?.template_key) {
      return reply.code(400).send({ error: 'to and template_key are required' });
    }
    try {
      const { status, data } = await proxyToService('/notifications/send', 'POST', body);
      return reply.code(status).send(data);
    } catch (err) {
      fastify.log.error({ err }, '[notifications/send] proxy failed');
      return reply.code(502).send({ error: 'Notification service unavailable' });
    }
  });

  // POST /api/notifications/resend — resend existing notification by ID
  fastify.post('/resend', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (!body?.notification_id) return reply.code(400).send({ error: 'notification_id is required' });
    try {
      const { status, data } = await proxyToService('/notifications/resend', 'POST', body);
      return reply.code(status).send(data);
    } catch (err) {
      fastify.log.error({ err }, '[notifications/resend] proxy failed');
      return reply.code(502).send({ error: 'Notification service unavailable' });
    }
  });

  // GET /api/notifications/status/:notification_id
  fastify.get('/status/:notification_id', async (request, reply) => {
    const { notification_id } = request.params as { notification_id: string };
    try {
      const { status, data } = await proxyToService(`/notifications/status/${notification_id}`, 'GET');
      return reply.code(status).send(data);
    } catch (err) {
      fastify.log.error({ err }, '[notifications/status] proxy failed');
      return reply.code(502).send({ error: 'Notification service unavailable' });
    }
  });

  // GET /api/notifications/booking/:booking_id
  fastify.get('/booking/:booking_id', async (request, reply) => {
    const { booking_id } = request.params as { booking_id: string };
    try {
      const { status, data } = await proxyToService(`/notifications/booking/${booking_id}`, 'GET');
      return reply.code(status).send(data);
    } catch (err) {
      fastify.log.error({ err }, '[notifications/booking] proxy failed');
      return reply.code(502).send({ error: 'Notification service unavailable' });
    }
  });
};

export default plugin;
