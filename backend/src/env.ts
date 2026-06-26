/**
 * Env preloader — imported before anything else in index.ts.
 *
 * Loads backend/.env first (highest priority), then root .env
 * to fill in shared vars like FLIGHT_PROVIDER_MODE.
 * dotenv won't override vars already set by the first call.
 */
import dotenv from 'dotenv';
import path from 'path';

// 1. Backend-local .env (highest priority)
dotenv.config();

// 2. Root .env (fills in shared vars not present in backend/.env)
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
