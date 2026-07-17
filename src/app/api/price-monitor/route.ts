import { NextRequest, NextResponse } from 'next/server';
import { searchFlights } from '@/lib/providers/orchestrator';
import {
  getActiveTrackingJobs,
  updateTrackingJob,
  addPriceHistoryEntry,
  createPriceAlert,
  createNotification,
} from '@/lib/db-queries';
import prisma from '@/lib/db';
import { fireNotification } from '@/lib/notify';

/**
 * POST /api/price-monitor
 *
 * Price monitoring cron endpoint.
 * Called periodically (e.g., every 4 hours) to:
 * 1. Fetch all active tracking jobs
 * 2. Re-search for current prices
 * 3. Compare with booked price
 * 4. Record price history
 * 5. Create alerts if price drops below threshold
 *
 * Auth: Should be protected with a cron secret in production.
 */
export async function POST(request: NextRequest) {
  // Simple auth for cron
  const cronSecret = request.headers.get('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET || 'faremind-cron';
  if (cronSecret !== expectedSecret) {
    // Allow in development
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    // Get active tracking jobs that are due
    const jobs = await getActiveTrackingJobs(50);

    if (jobs.length === 0) {
      return NextResponse.json({
        message: 'No tracking jobs due',
        processed: 0,
      });
    }

    const results = [];

    for (const job of jobs) {
      try {
        // Re-search for current prices
        const searchResult = await searchFlights({
          origin: job.origin,
          destination: job.destination,
          date: job.departureDate.toISOString().split('T')[0],
          adults: 1,
          cabin: job.cabinClass.toLowerCase(),
        });

        if (searchResult.flights.length === 0) {
          // No results — skip but reschedule
          await updateTrackingJob(job.id, {
            lastRunAt: new Date(),
            nextRunAt: new Date(Date.now() + 6 * 3600000), // Retry in 6 hours
            runCount: { increment: 1 },
          });
          results.push({ jobId: job.id, status: 'no_results' });
          continue;
        }

        // Find the cheapest current price
        const currentPrice = Math.min(...searchResult.flights.map((f) => f.totalPrice));
        const bookedPrice = Number(job.bookedPrice);
        const provider = searchResult.flights[0].provider === 'duffel' ? 'DUFFEL' : 'AMADEUS';

        // Record price history
        await addPriceHistoryEntry(job.bookingId, currentPrice, job.currency, provider as any);

        // Check if price dropped below threshold
        const priceDiff = bookedPrice - currentPrice;
        const percentDrop = (priceDiff / bookedPrice) * 100;
        const thresholdPercent = Number(job.threshold) * 100;

        if (percentDrop >= thresholdPercent && priceDiff > 0) {
          // Price drop detected!

          // Get booking to find userId
          const booking = await prisma.booking.findUnique({
            where: { id: job.bookingId },
            select: { userId: true, originAirport: true, destinationAirport: true },
          });

          if (booking && booking.userId) {
            // Create price alert
            await createPriceAlert({
              bookingId: job.bookingId,
              userId: booking.userId,
              bookedPrice: bookedPrice,
              currentPrice: currentPrice,
              savings: priceDiff,
              percentDrop: percentDrop,
              currency: job.currency,
            });

            // Create in-app notification
            await createNotification({
              userId: booking.userId,
              bookingId: job.bookingId,
              type: 'PRICE_DROP',
              channel: 'IN_APP',
              title: 'Price Drop Detected!',
              body: `Your ${booking.originAirport} → ${booking.destinationAirport} flight dropped by $${priceDiff.toFixed(0)} (${percentDrop.toFixed(0)}%). Save now with smart rebooking.`,
            });

            // Fire email notification for price drop
            fireNotification({
              event_type: 'PRICE_DROP_ALERT',
              booking_id: job.bookingId,
              data: {
                route: `${booking.originAirport} - ${booking.destinationAirport}`,
                origin: booking.originAirport,
                destination: booking.destinationAirport,
                booked_price: `$${bookedPrice.toFixed(2)}`,
                current_price: `$${currentPrice.toFixed(2)}`,
                savings: `$${priceDiff.toFixed(2)}`,
                percent_drop: `${percentDrop.toFixed(1)}%`,
                currency: job.currency,
              },
            }).catch(err => console.error('[PriceMonitor] PRICE_DROP_ALERT notification error:', err instanceof Error ? err.message : err));
          }

          results.push({
            jobId: job.id,
            status: 'price_drop',
            bookedPrice,
            currentPrice,
            savings: priceDiff,
            percentDrop,
          });
        } else {
          results.push({
            jobId: job.id,
            status: 'no_change',
            bookedPrice,
            currentPrice,
          });
        }

        // Update job schedule
        await updateTrackingJob(job.id, {
          lastRunAt: new Date(),
          nextRunAt: new Date(Date.now() + 4 * 3600000), // Next check in 4 hours
          runCount: { increment: 1 },
          lastError: null,
        });
      } catch (jobError) {
        const msg = jobError instanceof Error ? jobError.message : 'Unknown error';
        console.error(`[PriceMonitor] Job ${job.id} failed:`, msg);

        await updateTrackingJob(job.id, {
          lastRunAt: new Date(),
          nextRunAt: new Date(Date.now() + 6 * 3600000),
          errorCount: { increment: 1 },
          lastError: msg,
        }).catch(() => {});

        results.push({ jobId: job.id, status: 'error', error: msg });
      }
    }

    const dropsFound = results.filter((r) => r.status === 'price_drop').length;

    return NextResponse.json({
      message: `Processed ${jobs.length} jobs, found ${dropsFound} price drops`,
      processed: jobs.length,
      dropsFound,
      results,
    });
  } catch (error) {
    console.error('[PriceMonitor] Critical error:', error);
    return NextResponse.json(
      { error: 'Price monitoring failed' },
      { status: 500 }
    );
  }
}
