/**
 * Limit Order Scheduler — Fallback Evaluation Engine
 *
 * For routes that never receive a live customer search, this scheduler
 * periodically evaluates active limit orders by performing targeted
 * provider searches.
 *
 * Algorithm:
 * 1. Query orders WHERE status='ACTIVE' AND nextEvaluationAt <= NOW()
 * 2. Group by route to batch searches
 * 3. Call searchFlights() for routes not recently searched
 * 4. Pass results through the matcher
 * 5. Update lastEvaluatedAt and compute nextEvaluationAt
 */
import { prisma } from '../lib/db';
import { searchFlights } from './orchestrator';
import { evaluateOrderAgainstFlights } from './limit-order-matcher';
import { applyMarkupToOffers } from './markup-service';
import {
  computePurgeAt,
  DEFAULT_MIN_PURCHASE_LEAD_TIME_HOURS,
} from './limit-order-validator';
import type { UnifiedFlight } from '../lib/types';

/**
 * Run a single scheduler cycle.
 * Called by the cron job — processes all orders due for evaluation.
 */
export async function runLimitOrderSchedulerCycle(): Promise<{
  ordersEvaluated: number;
  routesSearched: number;
  matchesFound: number;
  errors: number;
}> {
  const stats = { ordersEvaluated: 0, routesSearched: 0, matchesFound: 0, errors: 0 };

  try {
    const now = new Date();

    // Get orders due for evaluation
    const dueOrders = await prisma.limitOrder.findMany({
      where: {
        status: { in: ['ACTIVE', 'MONITORING'] },
        nextEvaluationAt: { lte: now },
        expiresAt: { gt: now },
      },
      orderBy: { nextEvaluationAt: 'asc' },
      take: 50, // Process max 50 per cycle to avoid overloading
    });

    if (dueOrders.length === 0) {
      console.log('[limit-order-scheduler] No orders due for evaluation.');
      return stats;
    }

    console.log(`[limit-order-scheduler] Processing ${dueOrders.length} orders due for evaluation.`);

    // Group orders by route + date to batch searches
    const routeGroups = new Map<string, typeof dueOrders>();
    for (const order of dueOrders) {
      const retDate = order.returnDate ? order.returnDate.toISOString().split('T')[0] : '';
      const key = `${order.origin}|${order.destination}|${order.departureDate.toISOString().split('T')[0]}|${retDate}`;
      if (!routeGroups.has(key)) routeGroups.set(key, []);
      routeGroups.get(key)!.push(order);
    }

    console.log(`[limit-order-scheduler] ${routeGroups.size} unique routes to search.`);

    // Search each route and evaluate
    for (const [routeKey, orders] of routeGroups) {
      const [origin, destination, date, returnDate] = routeKey.split('|');
      const refOrder = orders[0]; // Use first order's passenger counts for the search

      try {
        console.log(`[limit-order-scheduler] Searching ${origin}→${destination} on ${date}${returnDate ? ` (RT: ${returnDate})` : ''}...`);

        const result = await searchFlights({
          origin,
          destination,
          date,
          returnDate: returnDate || undefined,
          adults: refOrder.adults,
          children: refOrder.children,
          infants: refOrder.infants,
        });

        const flights = result.flights as UnifiedFlight[];

        if (flights.length > 0) {
          // Apply markup so fares are comparable to what customers see
          await applyMarkupToOffers(flights);

          stats.routesSearched++;

          // Evaluate each order against the results
          for (const order of orders) {
            try {
              const matched = await evaluateOrderAgainstFlights(order, flights, 'SCHEDULER');
              if (matched) stats.matchesFound++;
              stats.ordersEvaluated++;
            } catch (err) {
              console.error(`[limit-order-scheduler] Error evaluating order ${order.id}:`, err);
              stats.errors++;
            }
          }
        } else {
          console.log(`[limit-order-scheduler] No flights found for ${origin}→${destination} on ${date}`);
        }

        // Update evaluation timestamps for all orders in this group
        const nextEvalMs = computeNextEvaluation(orders.length);
        await prisma.limitOrder.updateMany({
          where: { id: { in: orders.map(o => o.id) }, status: { in: ['ACTIVE', 'MONITORING'] } },
          data: {
            lastEvaluatedAt: now,
            nextEvaluationAt: new Date(now.getTime() + nextEvalMs),
          },
        });
      } catch (err) {
        console.error(`[limit-order-scheduler] Search failed for ${routeKey}:`, err);
        stats.errors++;

        // Still push back nextEvaluationAt to avoid hammering a broken route
        await prisma.limitOrder.updateMany({
          where: { id: { in: orders.map(o => o.id) } },
          data: {
            lastEvaluatedAt: now,
            nextEvaluationAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // Retry in 24h
          },
        }).catch(() => {});
      }
    }

    console.log(`[limit-order-scheduler] Cycle complete. ${JSON.stringify(stats)}`);
    return stats;
  } catch (err) {
    console.error('[limit-order-scheduler] Fatal scheduler error:', err);
    stats.errors++;
    return stats;
  }
}

/**
 * Expire limit orders that have passed their expiration date, departure date,
 * or are within the minimum purchase lead time.
 *
 * Enhanced for lifecycle enforcement:
 * - Sets expiredAt timestamp
 * - Sets purgeAt for scheduled deletion
 * - Creates audit events for each expired order
 * - Handles minimumPurchaseLeadTimeHours
 */
export async function expireStaleOrders(): Promise<number> {
  const now = new Date();

  // ── Step 1: Expire by expiresAt (90-day validity) ──
  const byExpiry = await prisma.limitOrder.findMany({
    where: {
      status: { in: ['ACTIVE', 'MONITORING', 'DRAFT', 'AWAITING_CUSTOMER', 'MATCHED'] },
      expiresAt: { lte: now },
    },
    select: { id: true, userId: true, origin: true, destination: true },
  });

  // ── Step 2: Expire by departure date passed ──
  const byDeparture = await prisma.limitOrder.findMany({
    where: {
      status: { in: ['ACTIVE', 'MONITORING', 'DRAFT', 'AWAITING_CUSTOMER', 'MATCHED'] },
      departureDate: { lt: now },
      id: { notIn: byExpiry.map(o => o.id) },
    },
    select: { id: true, userId: true, origin: true, destination: true },
  });

  // ── Step 3: Expire by minimum purchase lead time (24h before departure) ──
  const leadTimeCutoff = new Date(now.getTime() + DEFAULT_MIN_PURCHASE_LEAD_TIME_HOURS * 60 * 60 * 1000);
  const existingIds = [...byExpiry.map(o => o.id), ...byDeparture.map(o => o.id)];
  const byLeadTime = await prisma.limitOrder.findMany({
    where: {
      status: { in: ['ACTIVE', 'MONITORING'] },
      departureDate: { lte: leadTimeCutoff },
      id: { notIn: existingIds },
    },
    select: { id: true, userId: true, origin: true, destination: true },
  });

  const allToExpire = [...byExpiry, ...byDeparture, ...byLeadTime];
  if (allToExpire.length === 0) return 0;

  const allIds = allToExpire.map(o => o.id);
  const purgeAt = computePurgeAt(now);

  // Batch update all to EXPIRED
  await prisma.limitOrder.updateMany({
    where: { id: { in: allIds } },
    data: {
      status: 'EXPIRED',
      expiredAt: now,
      purgeAt,
      nextEvaluationAt: null,
    },
  });

  // Create audit events in bulk
  await prisma.limitOrderEvent.createMany({
    data: allToExpire.map(o => ({
      limitOrderId: o.id,
      eventType: 'EXPIRED',
      eventTitle: 'Limit order expired',
      eventDescription: byExpiry.find(e => e.id === o.id)
        ? 'The 90-day validity period has ended. Order can no longer be monitored, matched, or booked.'
        : byDeparture.find(e => e.id === o.id)
        ? 'The departure date has passed. Order expired automatically.'
        : `Departure is within ${DEFAULT_MIN_PURCHASE_LEAD_TIME_HOURS}h. Order expired to prevent unsafe last-minute purchase.`,
      actorType: 'system',
    })),
  });

  console.log(`[limit-order-scheduler] Expired ${allToExpire.length} orders (${byExpiry.length} by validity, ${byDeparture.length} by departure, ${byLeadTime.length} by lead time).`);
  return allToExpire.length;
}

/**
 * Purge expired orders after the configured delay.
 * Permanently deletes expired orders and all dependent data from the database.
 *
 * Safety checks:
 * - Only purges orders with status = EXPIRED and purgeAt <= now
 * - Transactionally deletes passengers, matches, events, then the order itself
 * - No tombstone is kept — the order is fully removed from the platform
 */
export async function purgeExpiredOrders(): Promise<number> {
  const now = new Date();

  const toPurge = await prisma.limitOrder.findMany({
    where: {
      status: 'EXPIRED',
      purgeAt: { lte: now },
    },
    select: { id: true, userId: true, origin: true, destination: true, createdAt: true, expiredAt: true },
    take: 100, // Process max 100 per cycle
  });

  if (toPurge.length === 0) return 0;

  let purged = 0;

  for (const order of toPurge) {
    try {
      // Transactional hard-delete: all dependent records + the order itself
      await prisma.$transaction(async (tx) => {
        // Delete passengers
        await tx.limitOrderPassenger.deleteMany({ where: { limitOrderId: order.id } });
        // Delete matches
        await tx.limitOrderMatch.deleteMany({ where: { limitOrderId: order.id } });
        // Delete events
        await tx.limitOrderEvent.deleteMany({ where: { limitOrderId: order.id } });
        // Delete the order itself — fully removed from the database
        await tx.limitOrder.delete({ where: { id: order.id } });
      });

      console.log(
        `[limit-order-scheduler] 🗑️ Purged order ${order.id} ` +
        `(${order.origin}→${order.destination}, created ${order.createdAt.toISOString()}, expired ${order.expiredAt?.toISOString() || 'N/A'})`
      );
      purged++;
    } catch (err) {
      console.error(`[limit-order-scheduler] Purge failed for order ${order.id}:`, err);
      // Don't stop — continue with other orders
    }
  }

  if (purged > 0) {
    console.log(`[limit-order-scheduler] Purged ${purged}/${toPurge.length} expired orders.`);
  }

  return purged;
}

/**
 * Smart next-evaluation interval based on route popularity.
 *
 * - Busy routes (5+ active orders): every 12 hours
 * - Normal routes (2-4 orders): every 24 hours
 * - Rare routes (1 order): every 48 hours
 */
function computeNextEvaluation(orderCount: number): number {
  if (orderCount >= 5) return 12 * 60 * 60 * 1000; // 12h
  if (orderCount >= 2) return 24 * 60 * 60 * 1000; // 24h
  return 48 * 60 * 60 * 1000; // 48h
}
