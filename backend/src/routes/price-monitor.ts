import { FastifyPluginAsync } from 'fastify';
import { searchFlights } from '../services/orchestrator';
import { getActiveTrackingJobs, updateTrackingJob, addPriceHistoryEntry, createPriceAlert, createNotification } from '../lib/db-queries';
import { prisma } from '../lib/db';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    const cronSecret = (request.headers as any)['x-cron-secret'] as string;
    const expectedSecret = process.env.CRON_SECRET || 'faremind-cron';
    if (cronSecret !== expectedSecret && process.env.NODE_ENV === 'production') {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    try {
      const jobs = await getActiveTrackingJobs(50);
      if (jobs.length === 0) return { message: 'No tracking jobs due', processed: 0 };

      console.log(`[PriceMonitor] Processing ${jobs.length} jobs`);
      const results = [];

      for (const job of jobs) {
        try {
          const searchResult = await searchFlights({
            origin: job.origin, destination: job.destination,
            date: job.departureDate.toISOString().split('T')[0], adults: 1,
            cabin: job.cabinClass.toLowerCase(),
          });

          if (searchResult.flights.length === 0) {
            await updateTrackingJob(job.id, { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + 6 * 3600000), runCount: { increment: 1 } });
            results.push({ jobId: job.id, status: 'no_results' });
            continue;
          }

          const currentPrice = Math.min(...searchResult.flights.map((f) => f.totalPrice));
          const bookedPrice = Number(job.bookedPrice);
          const provider = searchResult.flights[0].provider === 'duffel' ? 'DUFFEL' : 'AMADEUS';

          await addPriceHistoryEntry(job.bookingId, currentPrice, job.currency, provider as any);

          const priceDiff = bookedPrice - currentPrice;
          const percentDrop = (priceDiff / bookedPrice) * 100;
          const thresholdPercent = Number(job.threshold) * 100;

          if (percentDrop >= thresholdPercent && priceDiff > 0) {
            const booking = await prisma.booking.findUnique({ where: { id: job.bookingId }, select: { userId: true, originAirport: true, destinationAirport: true } });
            if (booking) {
              await createPriceAlert({ bookingId: job.bookingId, userId: booking.userId, bookedPrice, currentPrice, savings: priceDiff, percentDrop, currency: job.currency });
              await createNotification({ userId: booking.userId, bookingId: job.bookingId, type: 'PRICE_DROP', channel: 'IN_APP', title: 'Price Drop Detected!', body: `Your ${booking.originAirport} → ${booking.destinationAirport} flight dropped by $${priceDiff.toFixed(0)} (${percentDrop.toFixed(0)}%).` });
            }
            results.push({ jobId: job.id, status: 'price_drop', bookedPrice, currentPrice, savings: priceDiff, percentDrop });
          } else {
            results.push({ jobId: job.id, status: 'no_change', bookedPrice, currentPrice });
          }

          await updateTrackingJob(job.id, { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + 4 * 3600000), runCount: { increment: 1 }, lastError: null });
        } catch (jobError) {
          const msg = (jobError as Error).message;
          await updateTrackingJob(job.id, { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + 6 * 3600000), errorCount: { increment: 1 }, lastError: msg }).catch(() => {});
          results.push({ jobId: job.id, status: 'error', error: msg });
        }
      }

      return { message: `Processed ${jobs.length} jobs`, processed: jobs.length, dropsFound: results.filter((r) => r.status === 'price_drop').length, results };
    } catch (error) {
      console.error('[PriceMonitor] Critical error:', error);
      reply.code(500).send({ error: 'Price monitoring failed' });
    }
  });
};

export default plugin;
