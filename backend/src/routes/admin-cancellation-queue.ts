/**
 * Admin Cancellation Queue — Backend Routes
 *
 * Provides endpoints for the admin support queue to view and manage
 * cancellation workflows, including:
 *   - List all cancellation refunds with filters
 *   - Manual actions (refresh status, mark reimbursed, escalate, reconcile)
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/db';
import { checkProviderReimbursement, reconcileRefund } from '../services/cancellation-orchestrator';
import * as mbq from '../lib/manage-booking-queries';

const cancellationQueuePlugin: FastifyPluginAsync = async (fastify) => {

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/admin/cancellation-queue — List cancellation refunds
  // ═══════════════════════════════════════════════════════════════════════

  fastify.get('/', async (request, reply) => {
    try {
      const {
        status,
        provider,
        reimbursementStatus,
        reconciliationStatus,
        page = '1',
        limit = '50',
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = request.query as Record<string, string>;

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const take = Math.min(parseInt(limit), 100);

      const where: any = {};
      if (status) where.customerRefundStatus = status;
      if (provider) where.provider = provider.toLowerCase();
      if (reimbursementStatus) where.providerReimbursementStatus = reimbursementStatus;
      if (reconciliationStatus) where.reconciliationStatus = reconciliationStatus;

      const [refunds, total] = await prisma.$transaction([
        prisma.bookingRefund.findMany({
          where,
          skip,
          take,
          orderBy: { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' },
          include: {
            cancellation: {
              select: {
                id: true,
                status: true,
                requestedBy: true,
                originalAmount: true,
                refundAmount: true,
                currency: true,
                createdAt: true,
                booking: {
                  select: {
                    id: true,
                    masterBookingReference: true,
                    customerName: true,
                    customerEmail: true,
                    primaryProvider: true,
                    masterPnr: true,
                    originAirport: true,
                    destinationAirport: true,
                    departureDate: true,
                  },
                },
              },
            },
          },
        }),
        prisma.bookingRefund.count({ where }),
      ]);

      // Fetch linked support tickets in one query
      const ticketIds = refunds.map(r => r.supportTicketId).filter(Boolean) as string[];
      const tickets = ticketIds.length > 0
        ? await prisma.supportTicket.findMany({
            where: { id: { in: ticketIds } },
            select: {
              id: true,
              ticketNumber: true,
              status: true,
              priority: true,
              queue: true,
              escalatedAt: true,
              closedAt: true,
            },
          })
        : [];
      const ticketMap = new Map(tickets.map(t => [t.id, t]));

      const items = refunds.map(r => ({
        id: r.id,
        bookingId: r.bookingId,
        bookingReference: r.cancellation?.booking?.masterBookingReference ?? 'N/A',
        customerName: r.cancellation?.booking?.customerName ?? 'N/A',
        customerEmail: r.cancellation?.booking?.customerEmail ?? 'N/A',
        provider: r.provider ?? r.cancellation?.booking?.primaryProvider ?? 'N/A',
        providerPnr: r.providerPnr ?? 'N/A',
        route: r.cancellation?.booking
          ? `${r.cancellation.booking.originAirport} → ${r.cancellation.booking.destinationAirport}`
          : 'N/A',

        // Status domains
        cancellationStatus: r.cancellation?.status ?? 'N/A',
        customerRefundStatus: r.customerRefundStatus ?? r.status,
        providerReimbursementStatus: r.providerReimbursementStatus,
        reconciliationStatus: r.reconciliationStatus,

        // Financial
        customerRefundAmount: Number(r.amount),
        providerExpectedReimbursement: Number(r.providerExpectedReimbursementAmount ?? 0),
        actualProviderReimbursement: Number(r.actualProviderReimbursementAmount ?? 0),
        fareMindFee: Number(r.fareMindCancellationFee ?? 0),
        currency: r.currency,

        // Monitoring
        lastProviderCheck: r.lastProviderStatusCheckAt,
        nextProviderCheck: r.nextProviderStatusCheckAt,
        checkCount: r.providerStatusCheckCount,
        daysOutstanding: r.createdAt
          ? Math.round((Date.now() - r.createdAt.getTime()) / (1000 * 60 * 60 * 24))
          : 0,

        // Stripe
        stripeRefundId: r.stripeRefundId ?? null,
        providerRefundId: r.providerRefundId ?? null,
        providerSettlementReference: r.providerSettlementReference ?? null,

        // Support ticket
        supportTicket: r.supportTicketId ? ticketMap.get(r.supportTicketId) ?? null : null,

        // Timestamps
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        providerReimbursedAt: r.providerReimbursedAt,
        reconciledAt: r.reconciledAt,
      }));

      return {
        items,
        pagination: {
          page: parseInt(page),
          limit: take,
          total,
          totalPages: Math.ceil(total / take),
        },
      };
    } catch (err) {
      fastify.log.error(err, '[cancellation-queue] List error');
      reply.code(500).send({ error: 'Failed to fetch cancellation queue' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST /api/admin/cancellation-queue/:refundId/actions — Manual actions
  // ═══════════════════════════════════════════════════════════════════════

  fastify.post('/:refundId/actions', async (request, reply) => {
    try {
      const { refundId } = request.params as { refundId: string };
      const { action, adminUserId, note, settlementReference, settlementAmount } = request.body as {
        action: string;
        adminUserId?: string;
        note?: string;
        settlementReference?: string;
        settlementAmount?: number;
      };

      const refund = await prisma.bookingRefund.findUnique({ where: { id: refundId } });
      if (!refund) return reply.code(404).send({ error: 'Refund record not found' });

      switch (action) {
        case 'refresh_provider_status': {
          await checkProviderReimbursement(refundId);

          // Audit
          await prisma.auditLog.create({
            data: {
              action: 'MANUAL_PROVIDER_STATUS_CHECK',
              entityType: 'BookingRefund',
              entityId: refundId,
              bookingId: refund.bookingId,
              adminUserId: adminUserId ?? null,
              metadata: { trigger: 'admin_manual' },
            },
          });

          const updated = await prisma.bookingRefund.findUnique({ where: { id: refundId } });
          return { success: true, action: 'refresh_provider_status', result: {
            providerReimbursementStatus: updated?.providerReimbursementStatus,
            lastProviderStatusCheckAt: updated?.lastProviderStatusCheckAt,
            providerStatusCheckCount: updated?.providerStatusCheckCount,
          }};
        }

        case 'mark_reimbursed': {
          if (!settlementReference) return reply.code(400).send({ error: 'settlementReference required' });

          await prisma.bookingRefund.update({
            where: { id: refundId },
            data: {
              providerReimbursementStatus: 'REIMBURSED',
              providerSettlementReference: settlementReference,
              actualProviderReimbursementAmount: settlementAmount ?? refund.providerExpectedReimbursementAmount,
              providerReimbursedAt: new Date(),
              nextProviderStatusCheckAt: null,
            },
          });

          // Audit
          await prisma.auditLog.create({
            data: {
              action: 'MANUAL_REIMBURSEMENT_MARKED',
              entityType: 'BookingRefund',
              entityId: refundId,
              bookingId: refund.bookingId,
              adminUserId: adminUserId ?? null,
              metadata: {
                settlementReference,
                settlementAmount,
                source: 'SUPPORT_AGENT',
              },
            },
          });

          // Run reconciliation
          const recon = await reconcileRefund(refundId);

          // Update ticket
          if (refund.supportTicketId) {
            if (recon.status === 'MATCHED') {
              await prisma.supportTicket.update({
                where: { id: refund.supportTicketId },
                data: { status: 'CLOSED', closedAt: new Date() },
              });
            } else {
              await prisma.supportTicket.update({
                where: { id: refund.supportTicketId },
                data: { status: 'REFUND_REIMBURSED' },
              });
            }
          }

          // Booking event
          await mbq.createBookingEvent({
            bookingId: refund.bookingId,
            eventType: 'MANUAL_REIMBURSEMENT_RECORDED',
            eventTitle: 'Provider reimbursement manually recorded',
            eventDescription: `Settlement ref: ${settlementReference}. Amount: ${settlementAmount ?? 'N/A'}. Reconciliation: ${recon.status}.`,
            actorType: 'admin',
            actorId: adminUserId ?? undefined,
          });

          return { success: true, action: 'mark_reimbursed', reconciliation: recon };
        }

        case 'escalate': {
          if (refund.supportTicketId) {
            await prisma.supportTicket.update({
              where: { id: refund.supportTicketId },
              data: {
                status: 'ESCALATED',
                priority: 'HIGH',
                queue: 'REFUND_RECONCILIATION_QUEUE',
                escalatedAt: new Date(),
              },
            });
          }

          await prisma.auditLog.create({
            data: {
              action: 'MANUAL_ESCALATION',
              entityType: 'BookingRefund',
              entityId: refundId,
              bookingId: refund.bookingId,
              adminUserId: adminUserId ?? null,
              metadata: { reason: note },
            },
          });

          return { success: true, action: 'escalate' };
        }

        case 'reconcile': {
          const recon = await reconcileRefund(refundId);

          await prisma.auditLog.create({
            data: {
              action: 'MANUAL_RECONCILIATION',
              entityType: 'BookingRefund',
              entityId: refundId,
              bookingId: refund.bookingId,
              adminUserId: adminUserId ?? null,
              metadata: { ...recon } as any,
            },
          });

          return { success: true, action: 'reconcile', result: recon };
        }

        case 'add_note': {
          if (!note) return reply.code(400).send({ error: 'note required' });
          if (refund.supportTicketId) {
            await prisma.supportTicketMessage.create({
              data: {
                ticketId: refund.supportTicketId,
                senderId: adminUserId ?? null,
                content: note,
                isInternal: true,
              },
            });
          }

          await prisma.auditLog.create({
            data: {
              action: 'INTERNAL_NOTE_ADDED',
              entityType: 'BookingRefund',
              entityId: refundId,
              bookingId: refund.bookingId,
              adminUserId: adminUserId ?? null,
              metadata: { note },
            },
          });

          return { success: true, action: 'add_note' };
        }

        default:
          return reply.code(400).send({ error: `Unknown action: ${action}` });
      }
    } catch (err) {
      fastify.log.error(err, '[cancellation-queue] Action error');
      reply.code(500).send({ error: 'Action failed' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/admin/cancellation-queue/:refundId/checks — Audit trail
  // ═══════════════════════════════════════════════════════════════════════

  fastify.get('/:refundId/checks', async (request, reply) => {
    try {
      const { refundId } = request.params as { refundId: string };

      const checks = await prisma.providerReimbursementCheck.findMany({
        where: { bookingRefundId: refundId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      return { checks };
    } catch (err) {
      fastify.log.error(err, '[cancellation-queue] Checks error');
      reply.code(500).send({ error: 'Failed to fetch reimbursement checks' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/admin/cancellation-queue/stats — Dashboard stats
  // ═══════════════════════════════════════════════════════════════════════

  fastify.get('/stats', async (request, reply) => {
    try {
      const [
        totalPending,
        totalOverdue,
        totalReimbursed,
        totalMismatch,
        totalClosed,
      ] = await prisma.$transaction([
        prisma.bookingRefund.count({ where: { providerReimbursementStatus: 'PENDING' } }),
        prisma.bookingRefund.count({ where: { providerReimbursementStatus: 'OVERDUE' } }),
        prisma.bookingRefund.count({ where: { providerReimbursementStatus: 'REIMBURSED' } }),
        prisma.bookingRefund.count({ where: { reconciliationStatus: 'MISMATCH' } }),
        prisma.bookingRefund.count({ where: { reconciliationStatus: 'RECONCILIATION_COMPLETED' } }),
      ]);

      return {
        pending: totalPending,
        overdue: totalOverdue,
        reimbursed: totalReimbursed,
        mismatch: totalMismatch,
        closed: totalClosed,
      };
    } catch (err) {
      fastify.log.error(err, '[cancellation-queue] Stats error');
      reply.code(500).send({ error: 'Failed to fetch stats' });
    }
  });
};

export default cancellationQueuePlugin;
