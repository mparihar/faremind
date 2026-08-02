/**
 * Fare category — which FareMind UI tab an offer belongs in.
 *
 * FareMind shows five tabs: Economy, Premium Economy, Business, First, Other.
 * They are UI buckets, NOT fare families. The airline keeps owning its brand
 * name; this module only decides which tab that brand appears under.
 *
 * Premium economy is a real cabin the provider names explicitly (CabinType 'S'),
 * so it gets its own tab. `other` is reserved for offers we genuinely cannot
 * place — a named cabin must never share a tab with "we don't know".
 *
 * The governing rule is that no valid provider offer may disappear. Every offer
 * lands in exactly one category, and an offer we cannot confidently place goes
 * to `other` — never dropped, never hidden, never guessed into a cabin.
 *
 * Deliberately separate from `fare-family.ts`:
 *
 *   normalizeFareTier()   BASIC | STANDARD | FLEX | PREMIUM | BUSINESS | FIRST
 *                         internal, drives ranking/filters/analytics
 *   classifyFareCategory() economy | premium_economy | business | first | other
 *                         UI grouping only, never feeds scoring
 *
 * Changing one must not change the other. Ranking, badges and checkout read the
 * tier and are untouched by anything here.
 *
 * ── Classification order ──────────────────────────────────────────────────
 *
 *   10  provider cabin      the offer-level cabin the provider decoded
 *   20  segment cabin       CabinClassCode per segment
 *   30  booking class       the RBD letter
 *   40  fare basis          the airline's fare basis code
 *   50  airline mapping     configurable per airline/provider rules
 *   60  name inference      ONLY high-confidence compound brands
 *       → other             everything else, preserved and visible
 *
 * Configured rules carry their own priority, so a carrier whose RBDs are
 * non-standard can be given a rule at priority 25 that beats the generic RBD
 * table without touching this file.
 */
import { loadCategoryRules, type FareCategoryRule } from './fare-category-rules';

export type FareCategory = 'economy' | 'premium_economy' | 'business' | 'first' | 'other';

export type ClassificationMethod =
  | 'provider_cabin'
  | 'segment_cabin'
  | 'booking_class'
  | 'fare_basis'
  | 'airline_mapping'
  | 'name_inference'
  | 'unclassified';

export interface FareCategoryInput {
  /** Offer-level cabin, already decoded by the provider adapter. */
  cabinClass?: string | null;
  /** Provider cabin code(s) per segment: 'Y' | 'S' | 'C' | 'J' | 'F' | 'P'. */
  segmentCabinCodes?: Array<string | null | undefined>;
  /** Reservation booking designator. */
  bookingClass?: string | null;
  /** Airline fare basis code(s). */
  fareBasisCodes?: Array<string | null | undefined>;
  /** The airline's own brand — used only as a last resort, and only when compound. */
  fareFamily?: string | null;
  /** Marketing carrier, for airline-specific rules. */
  airlineCode?: string | null;
  provider?: string | null;
}

export interface FareCategoryResult {
  category: FareCategory;
  method: ClassificationMethod;
  /** 0–1. Below `MIN_CONFIDENCE` the result is downgraded to `other`. */
  confidence: number;
  /** The value the decision was made on, for the diagnostics line. */
  evidence: string | null;
}

/** A classification below this is not trusted enough to name a cabin. */
const MIN_CONFIDENCE = 0.7;

// ── Cabin codes ──────────────────────────────────────────────────────────────
// The provider's CabinType enum. J is a second business code. P is omitted on
// purpose: some carriers file it as premium first and others as premium
// economy, so it falls through rather than being guessed into either.
const CABIN_CODE_TO_CATEGORY: Record<string, FareCategory> = {
  Y: 'economy',
  S: 'premium_economy',
  C: 'business',
  J: 'business',
  F: 'first',
};

/** Decoded cabin words, as the adapters emit them. */
function categoryFromCabinWord(value: string): FareCategory | null {
  const c = value.toLowerCase().replace(/[\s-]+/g, '_');
  if (!c) return null;
  // Order matters: 'premium_economy' contains 'economy' and must be tested
  // first, or it reads as plain economy.
  if (c.includes('premium')) {
    if (c.includes('econom')) return 'premium_economy';
    // A bare "premium" names no cabin — premium first and premium economy both
    // use it. Not guessed.
    return 'other';
  }
  if (c.includes('first')) return 'first';
  if (c.includes('business')) return 'business';
  if (c.includes('economy') || c === 'y') return 'economy';
  return null;
}

// ── Booking classes (RBD) ────────────────────────────────────────────────────
// Industry-conventional letters only, and only those that are near-unambiguous
// across carriers. Deliberately omitted: W, E, S, P, R — each means premium
// economy at some carriers and economy or first at others. An airline whose
// RBDs differ gets a configured rule rather than an edit here.
const RBD_TO_CATEGORY: Record<string, FareCategory> = {
  F: 'first', A: 'first',
  J: 'business', C: 'business', D: 'business', I: 'business', Z: 'business',
  Y: 'economy', B: 'economy', H: 'economy', K: 'economy', L: 'economy',
  M: 'economy', N: 'economy', Q: 'economy', T: 'economy', V: 'economy',
  X: 'economy', G: 'economy', O: 'economy', U: 'economy',
};

// ── Name inference ───────────────────────────────────────────────────────────
// Last resort, and only for COMPOUND brands that name a cabin outright.
// "Business Flex" is business. A bare "Flex", "Classic", "Saver", "Value",
// "Standard" or "Plus" names no cabin and must not be inferred — those exist in
// every cabin, and guessing is exactly what puts a business fare under Economy.
const NAME_FIRST = /\b(first\s*class|first)\b/;
const NAME_BUSINESS = /\b(business|executive)\b/;
// "Premium Economy Flex" names a cabin and is classified; a bare "Premium" does
// not — premium first and premium economy both use it — so it stays unplaced.
const NAME_PREMIUM_ECONOMY = /\bpremium\s*(economy|eco)\b/;
const NAME_PREMIUM = /\bpremium\b/;
const NAME_ECONOMY = /\b(economy|coach)\b/;

function canonical(name: string): string {
  return name.toLowerCase().replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function categoryFromName(fareFamily: string): { category: FareCategory; evidence: string } | null {
  const name = canonical(fareFamily);
  if (!name) return null;
  // Premium first, so "Premium Economy Flex" never matches the plain economy
  // test below. A bare "Premium" names no cabin and stays unclassified.
  if (NAME_PREMIUM_ECONOMY.test(name)) return { category: 'premium_economy', evidence: fareFamily };
  if (NAME_PREMIUM.test(name)) return { category: 'other', evidence: fareFamily };
  if (NAME_FIRST.test(name)) return { category: 'first', evidence: fareFamily };
  if (NAME_BUSINESS.test(name)) return { category: 'business', evidence: fareFamily };
  if (NAME_ECONOMY.test(name)) return { category: 'economy', evidence: fareFamily };
  return null;
}

// ── Configured rules ─────────────────────────────────────────────────────────

function ruleMatches(rule: FareCategoryRule, input: FareCategoryInput): string | null {
  const eq = (a?: string | null, b?: string | null) =>
    !a || String(a).toUpperCase() === String(b ?? '').toUpperCase();

  if (!eq(rule.airline, input.airlineCode)) return null;
  if (!eq(rule.provider, input.provider)) return null;
  if (!eq(rule.cabin, input.cabinClass)) return null;
  if (!eq(rule.rbd, input.bookingClass)) return null;

  if (rule.fareFamilyPattern) {
    try {
      if (!new RegExp(rule.fareFamilyPattern, 'i').test(String(input.fareFamily ?? ''))) return null;
    } catch { return null; }   // a bad pattern must never break classification
  }
  if (rule.fareBasisPattern) {
    const codes = (input.fareBasisCodes ?? []).filter(Boolean) as string[];
    try {
      const re = new RegExp(rule.fareBasisPattern, 'i');
      if (!codes.some((c) => re.test(c))) return null;
    } catch { return null; }
  }

  // A rule with no predicate at all would match everything — reject it.
  const hasPredicate = !!(rule.airline || rule.provider || rule.cabin || rule.rbd
    || rule.fareFamilyPattern || rule.fareBasisPattern);
  if (!hasPredicate) return null;

  return [rule.airline, rule.cabin, rule.rbd, rule.fareFamilyPattern, rule.fareBasisPattern]
    .filter(Boolean).join(' ') || 'rule';
}

// ── The chain ────────────────────────────────────────────────────────────────

interface Step {
  priority: number;
  run(input: FareCategoryInput): Omit<FareCategoryResult, 'category'> & { category: FareCategory } | null;
}

function builtinSteps(): Step[] {
  return [
    // 10 — the provider's own cabin classification. Authoritative.
    {
      priority: 10,
      run: (i) => {
        const raw = String(i.cabinClass ?? '').trim();
        if (!raw) return null;
        const byCode = CABIN_CODE_TO_CATEGORY[raw.toUpperCase()];
        const category = byCode ?? categoryFromCabinWord(raw);
        if (!category) return null;
        return { category, method: 'provider_cabin', confidence: 1, evidence: raw };
      },
    },
    // 20 — per-segment cabin. Only when EVERY segment agrees: a mixed-cabin
    // itinerary is not an economy trip and not a business trip, so it goes to
    // `other` rather than being labelled by whichever segment came first.
    {
      priority: 20,
      run: (i) => {
        const codes = (i.segmentCabinCodes ?? []).map((c) => String(c ?? '').trim().toUpperCase()).filter(Boolean);
        if (!codes.length) return null;
        const cats = codes.map((c) => CABIN_CODE_TO_CATEGORY[c] ?? categoryFromCabinWord(c));
        if (cats.some((c) => !c)) return null;
        const distinct = [...new Set(cats as FareCategory[])];
        if (distinct.length > 1) {
          return { category: 'other', method: 'segment_cabin', confidence: 1, evidence: `mixed: ${codes.join(',')}` };
        }
        return { category: distinct[0], method: 'segment_cabin', confidence: 0.95, evidence: codes.join(',') };
      },
    },
    // 30 — the RBD letter.
    {
      priority: 30,
      run: (i) => {
        const rbd = String(i.bookingClass ?? '').trim().toUpperCase();
        if (rbd.length !== 1) return null;
        const category = RBD_TO_CATEGORY[rbd];
        if (!category) return null;
        return { category, method: 'booking_class', confidence: 0.8, evidence: rbd };
      },
    },
    // 40 — fare basis. The leading letter is conventionally the RBD, so read it
    // the same way, and only when every code agrees.
    {
      priority: 40,
      run: (i) => {
        const codes = (i.fareBasisCodes ?? []).map((c) => String(c ?? '').trim().toUpperCase()).filter(Boolean);
        if (!codes.length) return null;
        const cats = codes.map((c) => RBD_TO_CATEGORY[c[0]]);
        if (cats.some((c) => !c)) return null;
        const distinct = [...new Set(cats as FareCategory[])];
        if (distinct.length > 1) return null;
        return { category: distinct[0], method: 'fare_basis', confidence: 0.75, evidence: codes.join(',') };
      },
    },
    // 60 — high-confidence name inference. Configured rules sit at 50 and are
    // merged in by classifyFareCategory.
    {
      priority: 60,
      run: (i) => {
        const hit = categoryFromName(String(i.fareFamily ?? ''));
        if (!hit) return null;
        return { category: hit.category, method: 'name_inference', confidence: 0.75, evidence: hit.evidence };
      },
    },
  ];
}

/**
 * Place one offer in a FareMind UI category.
 *
 * Never throws and never returns null — an offer that matches nothing is
 * `other`, which is a visible tab, not a bin.
 */
export function classifyFareCategory(input: FareCategoryInput): FareCategoryResult {
  const configured: Step[] = loadCategoryRules().map((rule) => ({
    priority: rule.priority ?? 50,
    run: (i: FareCategoryInput) => {
      const evidence = ruleMatches(rule, i);
      if (!evidence) return null;
      return {
        category: rule.category,
        method: 'airline_mapping' as ClassificationMethod,
        confidence: rule.confidence ?? 0.9,
        evidence,
      };
    },
  }));

  const steps = [...builtinSteps(), ...configured].sort((a, b) => a.priority - b.priority);

  for (const step of steps) {
    let hit: ReturnType<Step['run']> = null;
    try { hit = step.run(input); } catch { hit = null; }   // a bad rule must not lose the offer
    if (!hit) continue;
    if (hit.confidence < MIN_CONFIDENCE) {
      return { category: 'other', method: hit.method, confidence: hit.confidence, evidence: hit.evidence };
    }
    return hit;
  }

  return { category: 'other', method: 'unclassified', confidence: 0, evidence: null };
}

/** Tab order and labels. `other` sits last and only appears when populated. */
export const FARE_CATEGORY_ORDER: FareCategory[] =
  ['economy', 'premium_economy', 'business', 'first', 'other'];

export const FARE_CATEGORY_LABELS: Record<FareCategory, string> = {
  economy: 'Economy',
  premium_economy: 'Premium Economy',
  business: 'Business',
  first: 'First',
  other: 'Other',
};

// ── Diagnostics ──────────────────────────────────────────────────────────────

export interface ClassificationDiagnostics {
  totalOffers: number;
  /** Provider duplicates a customer could not tell apart, collapsed before display. */
  collapsedDuplicates?: number;
  byCategory: Record<FareCategory, number>;
  byMethod: Record<ClassificationMethod, number>;
  discarded: number;
}

export function emptyDiagnostics(): ClassificationDiagnostics {
  return {
    totalOffers: 0,
    byCategory: { economy: 0, premium_economy: 0, business: 0, first: 0, other: 0 },
    byMethod: {
      provider_cabin: 0, segment_cabin: 0, booking_class: 0, fare_basis: 0,
      airline_mapping: 0, name_inference: 0, unclassified: 0,
    },
    discarded: 0,
  };
}

export function recordClassification(d: ClassificationDiagnostics, r: FareCategoryResult): void {
  d.totalOffers += 1;
  d.byCategory[r.category] += 1;
  d.byMethod[r.method] += 1;
}

/**
 * One line per search. `discarded` must be 0 — a non-zero value means an offer
 * the provider returned never reached the customer, which is the failure this
 * whole module exists to prevent.
 */
export function formatDiagnostics(d: ClassificationDiagnostics): string {
  const c = d.byCategory, m = d.byMethod;
  return [
    `offers=${d.totalOffers}`,
    `economy=${c.economy} premiumEconomy=${c.premium_economy} business=${c.business}`
      + ` first=${c.first} other=${c.other}`,
    `via cabin=${m.provider_cabin} segment=${m.segment_cabin} rbd=${m.booking_class}`
      + ` fareBasis=${m.fare_basis} mapping=${m.airline_mapping} name=${m.name_inference}`
      + ` unclassified=${m.unclassified}`,
    `collapsedDuplicates=${d.collapsedDuplicates ?? 0}`,
    `discarded=${d.discarded}`,
  ].join(' · ');
}
