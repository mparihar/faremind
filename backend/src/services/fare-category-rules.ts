/**
 * Fare category rules — the configurable mapping layer.
 *
 * Airline-specific classification lives in DATA, never in application code, so
 * a carrier with unusual RBDs or a new branded fare can be supported without a
 * code change and without a deploy.
 *
 * Two sources, merged:
 *
 *   config/fare-category-rules.json   checked in, reviewable, the baseline
 *   SystemConfig['FARE_CATEGORY_RULES'] live override, added by ops
 *
 * The live set is refreshed on a short TTL. `loadCategoryRules()` is
 * synchronous because classification runs per offer inside a hot path; the
 * refresh happens out of band and a stale-by-seconds rule set is harmless.
 *
 * Every field is optional except `category`. A rule matches when ALL of its
 * populated predicates match; a rule with no predicates is ignored rather than
 * matching everything.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FareCategory } from './fare-category';

export interface FareCategoryRule {
  /** Marketing carrier code, e.g. 'VY'. Omit to apply to all airlines. */
  airline?: string;
  /** Provider name, e.g. 'mystifly'. Omit to apply to all providers. */
  provider?: string;
  /** Offer-level cabin value to match exactly. */
  cabin?: string;
  /** Booking class (RBD) letter to match exactly. */
  rbd?: string;
  /** Case-insensitive regex against the airline's fare family. */
  fareFamilyPattern?: string;
  /** Case-insensitive regex against any fare basis code. */
  fareBasisPattern?: string;
  /** The FareMind UI tab this rule assigns. */
  category: FareCategory;
  /**
   * Where this rule sits in the chain. Defaults to 50 — after the structured
   * signals, before name inference. Set below 30 to override the generic RBD
   * table for a carrier whose booking classes do not follow convention.
   */
  priority?: number;
  /** 0–1. Below 0.7 the offer is placed in `other` instead. Defaults to 0.9. */
  confidence?: number;
  /** Free text for whoever reads the config later. */
  note?: string;
  /** Set false to keep a rule in the file without applying it. Defaults to true. */
  enabled?: boolean;
}

const RULES_FILE = path.resolve(process.cwd(), 'config', 'fare-category-rules.json');
const SYSTEM_CONFIG_KEY = 'FARE_CATEGORY_RULES';
const TTL_MS = 60_000;

let cached: FareCategoryRule[] = [];
let loadedAt = 0;
let fileRules: FareCategoryRule[] | null = null;

/** Reject malformed entries rather than letting one bad rule break a search. */
function sanitize(raw: unknown, source: string): FareCategoryRule[] {
  if (!Array.isArray(raw)) return [];
  const valid: FareCategoryRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const category = (r as any).category;
    if (!['economy', 'premium_economy', 'business', 'first', 'other'].includes(category)) {
      console.warn(`[fare-category] ${source}: skipping rule with invalid category ${JSON.stringify(category)}`);
      continue;
    }
    if ((r as any).enabled === false) continue;
    valid.push(r as FareCategoryRule);
  }
  return valid;
}

function readFileRules(): FareCategoryRule[] {
  if (fileRules) return fileRules;
  try {
    fileRules = sanitize(JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')), 'config file');
  } catch (err: any) {
    // Absent is normal — the built-in chain classifies almost everything.
    if (err?.code !== 'ENOENT') {
      console.warn(`[fare-category] could not read ${RULES_FILE}: ${err?.message ?? err}`);
    }
    fileRules = [];
  }
  return fileRules;
}

/**
 * Pull the live override from SystemConfig. Fire-and-forget: callers get the
 * previous set until this resolves, which keeps classification synchronous.
 */
export async function refreshCategoryRules(): Promise<FareCategoryRule[]> {
  let dbRules: FareCategoryRule[] = [];
  try {
    const { prisma } = await import('../lib/db');
    const row = await prisma.systemConfig.findUnique({ where: { key: SYSTEM_CONFIG_KEY } });
    if (row?.value) {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      dbRules = sanitize(parsed, 'SystemConfig');
    }
  } catch (err: any) {
    console.warn(`[fare-category] SystemConfig rules unavailable: ${err?.message ?? err}`);
  }
  // DB rules come last so an ops override wins a tie at equal priority.
  cached = [...readFileRules(), ...dbRules];
  loadedAt = Date.now();
  return cached;
}

/** The current rule set. Triggers a background refresh once the TTL lapses. */
export function loadCategoryRules(): FareCategoryRule[] {
  if (!loadedAt) {
    cached = readFileRules();
    loadedAt = Date.now();
    void refreshCategoryRules();
  } else if (Date.now() - loadedAt > TTL_MS) {
    loadedAt = Date.now();          // claim the slot so one refresh runs, not many
    void refreshCategoryRules();
  }
  return cached;
}

/** Test hook — drop the cache so the next load re-reads both sources. */
export function resetCategoryRulesCache(): void {
  cached = [];
  loadedAt = 0;
  fileRules = null;
}
