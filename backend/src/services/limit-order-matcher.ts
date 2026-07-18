/**
 * Limit Order Matcher — Live Search Reuse Engine
 *
 * Called after every customer search to check if any active limit orders
 * match the search results. This is the PRIMARY matching engine — zero
 * extra provider API calls.
 *
 * Algorithm:
 * 1. Normalize search results
 * 2. Query active limit orders matching the route + travel date window
 * 3. For each match: check fare range, duration, cabin, airline preferences
 * 4. Record match with idempotency via searchHash
 * 5. Trigger notification or auto-purchase workflow
 */
import { prisma } from '../lib/db';
import crypto from 'crypto';
import type { UnifiedFlight } from '../lib/types';

interface SearchMeta {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  cabin: string;
}

/**
 * Match search results against active limit orders.
 * FIRE-AND-FORGET — never blocks the customer's search response.
 */
export async function matchSearchResultsAgainstLimitOrders(
  flights: UnifiedFlight[],
  meta: SearchMeta,
): Promise<void> {
  try {
    if (!flights || flights.length === 0) return;

    const origin = meta.origin.toUpperCase();
    const destination = meta.destination.toUpperCase();
    const depDate = new Date(meta.departureDate);

    // Query active limit orders for this route
    const activeOrders = await prisma.limitOrder.findMany({
      where: {
        origin,
        destination,
        status: { in: ['ACTIVE', 'MONITORING'] },
        departureDate: depDate,
        expiresAt: { gt: new Date() },
      },
    });

    if (activeOrders.length === 0) return;

    console.log(`[limit-order-matcher] Found ${activeOrders.length} active orders for ${origin}→${destination} on ${meta.departureDate}`);

    for (const order of activeOrders) {
      try {
        await evaluateOrderAgainstFlights(order, flights, 'LIVE_SEARCH');
      } catch (err) {
        console.error(`[limit-order-matcher] Error evaluating order ${order.id}:`, err);
      }
    }

    // Update lastEvaluatedAt and nextEvaluationAt for matched orders
    const now = new Date();
    await prisma.limitOrder.updateMany({
      where: { id: { in: activeOrders.map(o => o.id) } },
      data: {
        lastEvaluatedAt: now,
        nextEvaluationAt: new Date(now.getTime() + 12 * 60 * 60 * 1000), // Push back 12h since we just evaluated
      },
    });
  } catch (err) {
    console.error('[limit-order-matcher] Fatal error in matcher:', err);
  }
}

/**
 * Evaluate a single limit order against a set of flights.
 * Used by both Live Search Reuse and Scheduler.
 */
export async function evaluateOrderAgainstFlights(
  order: any,
  flights: UnifiedFlight[],
  matchSource: 'LIVE_SEARCH' | 'SCHEDULER',
): Promise<boolean> {
  const now = new Date();

  for (const flight of flights) {
    // ── Check fare range ──
    if (flight.totalPrice < Number(order.minFare) || flight.totalPrice > Number(order.maxFare)) {
      continue;
    }

    // ── Check duration ──
    if (order.maxDurationMinutes && flight.totalDuration > order.maxDurationMinutes) {
      continue;
    }

    // ── Check cabin class ──
    const flightCabin = flight.cabinClass?.toUpperCase() || 'ECONOMY';
    if (flightCabin !== order.cabinClass) {
      continue;
    }

    // ── Check airline preferences ──
    const airlineCode = flight.airline?.code?.toUpperCase() || '';
    if (order.airlinePreferences && order.airlinePreferences.length > 0) {
      const prefs = order.airlinePreferences.map((a: string) => a.toUpperCase());
      if (order.airlinePreferenceMode === 'ACCEPT') {
        if (!prefs.includes(airlineCode)) continue;
      } else if (order.airlinePreferenceMode === 'EXCLUDE') {
        if (prefs.includes(airlineCode)) continue;
      }
    }

    // ── Check booking window ──
    const daysUntilDeparture = Math.ceil(
      (order.departureDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntilDeparture > order.bookingWindowDays) {
      continue;
    }

    // ── Match found! Check for duplicates ──
    const searchHash = crypto.createHash('sha256').update(
      `${order.id}|${order.departureDate.toISOString()}|${flight.totalPrice}|${airlineCode}|${flight.provider}`
    ).digest('hex');

    // Check if we already have this match in the last 24h
    const existingMatch = await prisma.limitOrderMatch.findFirst({
      where: {
        searchHash,
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    });

    if (existingMatch) {
      console.log(`[limit-order-matcher] Duplicate match skipped for order ${order.id} (hash: ${searchHash.slice(0, 12)})`);
      continue;
    }

    // ── Record the match ──
    console.log(`[limit-order-matcher] ✅ Match found for order ${order.id}: $${flight.totalPrice} on ${airlineCode} via ${flight.provider}`);

    const action = order.executionMode === 'AUTO_PURCHASE' ? 'AUTO_PURCHASED' : 'NOTIFIED';

    const match = await prisma.limitOrderMatch.create({
      data: {
        limitOrderId: order.id,
        matchSource,
        matchedFare: flight.totalPrice,
        matchedCurrency: flight.currency || 'USD',
        matchedDuration: flight.totalDuration || null,
        matchedAirline: airlineCode || null,
        matchedCabin: flightCabin,
        matchedProvider: flight.provider,
        providerOfferId: flight.providerOfferId || null,
        searchHash,
        action,
        notifiedAt: action === 'NOTIFIED' ? now : null,
      },
    });

    // Update order state
    await prisma.limitOrder.update({
      where: { id: order.id },
      data: {
        status: 'MATCHED',
        lastMatchedAt: now,
        ...(action === 'NOTIFIED' ? { lastNotificationAt: now, status: 'AWAITING_CUSTOMER' as any } : {}),
      },
    });

    // Create audit event
    await prisma.limitOrderEvent.create({
      data: {
        limitOrderId: order.id,
        eventType: 'MATCHED',
        eventTitle: `Flight matched via ${matchSource === 'LIVE_SEARCH' ? 'Live Search' : 'Scheduler'}`,
        eventDescription: `$${flight.totalPrice} ${flightCabin} on ${airlineCode} (${flight.provider}) | Duration: ${flight.totalDuration}min`,
        actorType: 'system',
        payloadJson: {
          matchId: match.id,
          fare: flight.totalPrice,
          airline: airlineCode,
          provider: flight.provider,
          duration: flight.totalDuration,
          offerId: flight.providerOfferId,
        },
      },
    });

    // Trigger post-match workflow
    if (order.executionMode === 'AUTO_PURCHASE') {
      triggerAutoPurchase(order, match, flight).catch((err) => {
        console.error(`[limit-order-matcher] Auto-purchase trigger failed for order ${order.id}:`, err);
      });
    } else {
      triggerNotification(order, match, flight).catch((err) => {
        console.error(`[limit-order-matcher] Notification trigger failed for order ${order.id}:`, err);
      });
    }

    // First match is enough — don't continue checking other flights for this order
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════
// Post-match workflows
// ═══════════════════════════════════════════════════════════

async function triggerNotification(order: any, match: any, flight: UnifiedFlight): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: order.userId }, select: { email: true, firstName: true, lastName: true } });
    if (!user) return;

    // Import notify from backend lib
    const { fireNotification } = await import('../lib/notify');

    await fireNotification({
      event_type: 'LIMIT_ORDER_MATCHED' as any,
      customer_email: user.email,
      data: {
        customer_name: `${user.firstName} ${user.lastName}`.trim(),
        booking_reference: order.id,
        route: `${order.origin} → ${order.destination}`,
        origin: order.origin,
        destination: order.destination,
        matched_fare: `$${Number(match.matchedFare).toFixed(2)}`,
        matched_airline: match.matchedAirline || 'Multiple Airlines',
        matched_cabin: match.matchedCabin,
        matched_duration: match.matchedDuration ? `${Math.floor(match.matchedDuration / 60)}h ${match.matchedDuration % 60}m` : 'N/A',
        departure_date: order.departureDate.toISOString().split('T')[0],
        fare_range: `$${Number(order.minFare).toFixed(0)} – $${Number(order.maxFare).toFixed(0)}`,
        limit_order_id: order.id,
      },
    });

    await prisma.limitOrderEvent.create({
      data: {
        limitOrderId: order.id,
        eventType: 'NOTIFIED',
        eventTitle: 'Customer notified of match',
        eventDescription: `Email sent to ${user.email} for $${match.matchedFare} match on ${match.matchedAirline}.`,
        actorType: 'system',
      },
    });

    console.log(`[limit-order-matcher] 📧 Notification sent to ${user.email} for order ${order.id}`);
  } catch (err) {
    console.error(`[limit-order-matcher] Failed to send notification for order ${order.id}:`, err);
  }
}

async function triggerAutoPurchase(order: any, match: any, flight: UnifiedFlight): Promise<void> {
  try {
    // Update order status to PURCHASING
    await prisma.limitOrder.update({
      where: { id: order.id },
      data: { status: 'PURCHASING', lastPurchaseAttempt: new Date() },
    });

    await prisma.limitOrderEvent.create({
      data: {
        limitOrderId: order.id,
        eventType: 'PURCHASE_ATTEMPTED',
        eventTitle: 'Auto-purchase initiated',
        eventDescription: `Attempting to purchase $${match.matchedFare} ${match.matchedCabin} ticket on ${match.matchedAirline}.`,
        actorType: 'system',
      },
    });

    // Verify payment authorization
    if (!order.stripeCustomerId || !order.stripePaymentMethodId) {
      throw new Error('Payment method not authorized for auto-purchase');
    }

    // TODO: Phase 2B — Full auto-purchase integration
    // 1. Re-validate pricing with provider (fresh revalidate call)
    // 2. If price still within range → execute booking via existing book flow
    // 3. Charge via Stripe off-session payment
    // 4. Create MasterBooking record
    // 5. Link to match
    // 6. Send confirmation emails

    // For now, create support ticket for manual processing
    const supportTicket = await prisma.supportTicket.create({
      data: {
        subject: `[Limit Order] Auto-Purchase Required – ${order.origin}→${order.destination}`,
        description: `Limit Order ${order.id} matched a flight at $${match.matchedFare} on ${match.matchedAirline}.\n\nCustomer authorized auto-purchase but automated booking is pending implementation.\n\nPlease process manually.\n\nFlight Details:\n- Fare: $${match.matchedFare}\n- Airline: ${match.matchedAirline}\n- Cabin: ${match.matchedCabin}\n- Provider: ${match.matchedProvider}\n- Offer ID: ${match.providerOfferId || 'N/A'}\n- Departure: ${order.departureDate.toISOString().split('T')[0]}`,
        priority: 'HIGH',
        status: 'OPEN',
        category: 'LIMIT_ORDER',
        customerName: (await prisma.user.findUnique({ where: { id: order.userId }, select: { firstName: true, lastName: true } }))?.firstName + ' ' + (await prisma.user.findUnique({ where: { id: order.userId }, select: { lastName: true } }))?.lastName || 'Unknown',
        customerEmail: (await prisma.user.findUnique({ where: { id: order.userId }, select: { email: true } }))?.email || '',
      },
    });

    // Update match with support ticket
    await prisma.limitOrderMatch.update({
      where: { id: match.id },
      data: { supportTicketId: supportTicket.id },
    });

    // Set order to support required
    await prisma.limitOrder.update({
      where: { id: order.id },
      data: { status: 'SUPPORT_REQUIRED', failureCount: { increment: 1 } },
    });

    await prisma.limitOrderEvent.create({
      data: {
        limitOrderId: order.id,
        eventType: 'SUPPORT_TICKET_CREATED',
        eventTitle: 'Support ticket created for auto-purchase',
        eventDescription: `Ticket ${supportTicket.ticketNumber || supportTicket.id} created for manual processing.`,
        actorType: 'system',
        payloadJson: { supportTicketId: supportTicket.id },
      },
    });

    console.log(`[limit-order-matcher] 🎫 Support ticket created for auto-purchase order ${order.id}`);
  } catch (err: any) {
    console.error(`[limit-order-matcher] Auto-purchase failed for order ${order.id}:`, err);

    // Record failure
    await prisma.limitOrder.update({
      where: { id: order.id },
      data: { status: 'FAILED', failureCount: { increment: 1 }, retryCount: { increment: 1 } },
    }).catch(() => {});

    await prisma.limitOrderMatch.update({
      where: { id: match.id },
      data: { action: 'SKIPPED', failureReason: err.message || 'Auto-purchase failed' },
    }).catch(() => {});

    await prisma.limitOrderEvent.create({
      data: {
        limitOrderId: order.id,
        eventType: 'PURCHASE_FAILED',
        eventTitle: 'Auto-purchase failed',
        eventDescription: err.message || 'Unknown error during auto-purchase.',
        actorType: 'system',
        payloadJson: { error: err.message },
      },
    }).catch(() => {});
  }
}
