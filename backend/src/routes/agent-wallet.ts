/**
 * Agent Wallet — internal backend endpoints.
 *
 * Called server-side by the Next.js API layer AFTER it has enforced RBAC
 * (withAdmin / withAgent) or established the agent context (checkout confirm).
 * Not exposed to browsers directly. Mounted at /api/agent-wallet.
 */

import { FastifyPluginAsync } from 'fastify';
import * as wallet from '../services/agent-wallet';

const agentWalletPlugin: FastifyPluginAsync = async (fastify) => {
  // Pre-booking gate — { userId, amount } → { allowed, remaining, reason, code }
  fastify.post('/check', async (request, reply) => {
    try {
      const { userId, amount } = request.body as { userId?: string; amount?: number };
      if (!userId || typeof amount !== 'number') return reply.code(400).send({ error: 'userId and amount are required' });
      return await wallet.checkBookingAllowed(userId, amount);
    } catch (e: any) {
      return reply.code(500).send({ error: e?.message || 'Wallet check failed' });
    }
  });

  // Post-booking utilization — { userId, amount, bookingId }
  fastify.post('/record', async (request, reply) => {
    try {
      const { userId, amount, bookingId } = request.body as { userId?: string; amount?: number; bookingId?: string };
      if (!userId || typeof amount !== 'number') return reply.code(400).send({ error: 'userId and amount are required' });
      await wallet.recordBookingUtilization(userId, amount, bookingId);
      return { success: true };
    } catch (e: any) {
      return reply.code(500).send({ error: e?.message || 'Wallet record failed' });
    }
  });

  // Refund/cancellation release — { userId, amount, kind, actor, bookingId }
  fastify.post('/release', async (request, reply) => {
    try {
      const { userId, amount, kind, actor, bookingId } = request.body as { userId?: string; amount?: number; kind?: 'REFUND' | 'CANCELLATION'; actor?: string; bookingId?: string };
      if (!userId || typeof amount !== 'number') return reply.code(400).send({ error: 'userId and amount are required' });
      await wallet.releaseUtilization(userId, amount, kind || 'REFUND', actor || 'SYSTEM', bookingId);
      return { success: true };
    } catch (e: any) {
      return reply.code(500).send({ error: e?.message || 'Wallet release failed' });
    }
  });

  // Admin action — { userId, action, amount?, reason?, actor }
  fastify.post('/action', async (request, reply) => {
    try {
      const { userId, action, amount, reason, actor } = request.body as { userId?: string; action?: string; amount?: number; reason?: string; actor?: string };
      if (!userId || !action) return reply.code(400).send({ error: 'userId and action are required' });
      const by = actor || 'ADMIN';
      let summary;
      switch (action) {
        case 'recharge':
          if (!(Number(amount) > 0)) return reply.code(400).send({ error: 'A positive amount is required.' });
          summary = await wallet.rechargeWallet(userId, Number(amount), by, reason);
          break;
        case 'adjust':
          if (typeof amount !== 'number' || amount < 0) return reply.code(400).send({ error: 'A non-negative wallet amount is required.' });
          summary = await wallet.setWalletAmount(userId, Number(amount), by, reason);
          break;
        case 'enable':
          summary = await wallet.setAgentPrivilege(userId, true, by, reason);
          break;
        case 'disable':
          summary = await wallet.setAgentPrivilege(userId, false, by, reason);
          break;
        case 'reset':
          summary = await wallet.resetUtilized(userId, by, reason);
          break;
        default:
          return reply.code(400).send({ error: 'Unknown action.' });
      }
      return { success: true, action, wallet: summary };
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message || 'Wallet action failed' });
    }
  });
};

export default agentWalletPlugin;
