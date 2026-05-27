/**
 * Prisma Client Singleton for Backend
 * Uses PrismaPg adapter for Railway PostgreSQL.
 */

import { PrismaClient } from '../../../src/generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

let prismaInstance: PrismaClient | null = null;

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[DB] ❌ DATABASE_URL is not set! Database queries will fail.');
    console.error('[DB]    Set DATABASE_URL in Railway dashboard or backend/.env');
  }

  const pool = new Pool({
    connectionString,
    // Railway PostgreSQL requires SSL in production
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    // Connection pool settings for Railway
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Log pool errors (don't crash the server)
  pool.on('error', (err) => {
    console.error('[DB] Pool error:', err.message);
  });

  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });

  // Log successful connection
  if (connectionString) {
    const host = new URL(connectionString).hostname;
    console.log(`[DB] ✅ Prisma client created — pool connected to ${host}`);
  }

  return client;
}

export function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = createPrismaClient();
  }
  return prismaInstance;
}

export const prisma = getPrisma();
export default prisma;

