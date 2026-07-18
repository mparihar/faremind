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
      const key = `${order.origin}|${order.destination}|${order.departureDate.toISOString().split('T')[0]}`;
      if (!routeGroups.has(key)) routeGroups.set(key, []);
      routeGroups.get(key)!.push(order);
    }

    console.log(`[limit-order-scheduler] ${routeGroups.size} unique routes to search.`);

    // Search each route and evaluate
    for (const [routeKey, orders] of routeGroups) {
      const [origin, destination, date] = routeKey.split('|');

      try {
        console.log(`[limit-order-scheduler] Searching ${origin}→${destination} on ${date}...`);

        const result = await searchFlights({
          origin,
          destination,
          date,
          adults: 1,
          children: 0,
          infants: 0,
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
 * Expire limit orders that have passed their expiration date or departure date.
 */
export async function expireStaleOrders(): Promise<number> {
  const now = new Date();

  // Expire orders past expiresAt
  const expiredByExpiry = await prisma.limitOrder.updateMany({
    where: {
      status: { in: ['ACTIVE', 'MONITORING', 'DRAFT', 'AWAITING_CUSTOMER'] },
      expiresAt: { lte: now },
    },
    data: { status: 'EXPIRED', nextEvaluationAt: null },
  });

  // Expire orders past departure date
  const expiredByDeparture = await prisma.limitOrder.updateMany({
    where: {
      status: { in: ['ACTIVE', 'MONITORING', 'DRAFT', 'AWAITING_CUSTOMER'] },
      departureDate: { lt: now },
    },
    data: { status: 'EXPIRED', nextEvaluationAt: null },
  });

  const totalExpired = expiredByExpiry.count + expiredByDeparture.count;
  if (totalExpired > 0) {
    console.log(`[limit-order-scheduler] Expired ${totalExpired} stale orders.`);
  }

  return totalExpired;
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
