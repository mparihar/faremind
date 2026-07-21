# FLIGHT_RANKING_ENGINE.md

> Authoritative reference for FareMind flight ranking. Derived from repository source. Supersedes/extends the older [`docs/FareMind-Scoring-and-Ranking-Algorithm.md`](./FareMind-Scoring-and-Ranking-Algorithm.md) and root `scoring_algorithm.md`, both of which document only the 8-dimension engine. Unconfirmed items marked **Not confirmed from repository.**

## Purpose

Explain how FareMind scores and orders flight offers: the dimensions, weights, journey-type detection, refundability precedence, tie-breaking, and how the final ranking + explanations are produced. Offer-selection ordering (badges, precedence MOVEs, AI-Pick) is detailed in [OFFER_SELECTION_ENGINE.md](./OFFER_SELECTION_ENGINE.md).

## There are multiple scorers — know which runs

| Engine | Location | Dims | Role |
|---|---|---|---|
| **10-dimension "V3"** | [`backend/src/ranking/*`](../backend/src/ranking/) (byte-identical mirror at [`src/lib/ranking/*`](../src/lib/ranking/)) | 10 | **Primary for ROUND-TRIP** search |
| **8-dimension "unified"** | [`src/lib/ai-scoring/*`](../src/lib/ai-scoring/) (`FlightScoringEngine`, `engine.ts::rankFlightOffers`) | 8 | **Primary for ONE-WAY**; RT fallback |
| Legacy 8-component | `ai-scoring/scorer.ts` + `weights.ts` + `engine.ts::aiRank*` | 8 | Legacy `aiRank()` path |
| Fare-family scorer | [`backend/src/services/ai-fare-scorer.ts`](../backend/src/services/ai-fare-scorer.ts) | 9 | Scores fare *brands* of one flight (used by `fare-options.ts`) — not offer ranking |
| 3-factor `rankFlights` | `backend/src/lib/flight/score.ts` + `src/lib/flight/score.ts` | 3 | Old utility, legacy |

**Production dispatch** ([`src/app/api/search/route.ts`](../src/app/api/search/route.ts)):
- **Round-trip:** `rankFlightOffersV3(...)` (10-dim, L189); on exception → fallback `rankFlightOffers(..., 'ROUND_TRIP')` (8-dim, L278).
- **One-way:** `rankFlightOffers(..., 'ONE_WAY')` (8-dim, L404). Client cabin re-rank (`search/page.tsx:421`) also 8-dim.

> The two existing docs are accurate for one-way and the RT fallback, but **do not mention the 10-dim engine** that is the RT primary. This doc covers both.

## 10-dimension engine (round-trip primary)

Weights (%, sum 100). Config: [`config/domestic-default.json`](../backend/src/ranking/config/domestic-default.json), [`config/international-default.json`](../backend/src/ranking/config/international-default.json). Combined at `rankOffers.ts:257` as `Σ(dimScore × weight/100)`.

| Dimension | Domestic | International | Scorer |
|---|---:|---:|---|
| price | 35 | 28 | `normalizePrice.ts` |
| schedule | 18 | 10 | `scoreSchedule.ts` |
| duration | 15 | 18 | `scoreDuration.ts` |
| stops | 10 | 14 | `scoreStops.ts` |
| baggage | 8 | 5 | `scoreBaggage.ts` |
| comfort | 6 | 8 | `scoreComfort.ts` |
| flexibility | 4 | 10 | `scoreFlexibility.ts` |
| brand | 2 | 3 | `scoreBrand.ts` |
| reliability | 1.5 | 2 | `scoreReliability.ts` |
| airportExperience | 0.5 | 2 | `scoreAirportExperience.ts` |

Dimension computation (summary):
- **Price** — distance-from-cheapest; focused window `min(minPrice×1.5, P90)`, min-range guard 10% of minPrice; cheapest→100, ≥cap→0.
- **Schedule** — dep + arr sub-scores blended by journey (dom 0.6/0.4, intl 0.45/0.55); peak sweet spots 95; deep midnight-3am penalty.
- **Duration** — `100 − ((offer−min)/penaltyRange)×100`; penaltyRange 360 (dom) / 720 (intl) min.
- **Stops** — 0→100, 1→80, 2→55, 3+→25; per-layover quality, connection-risk, immigration adjustments.
- **Baggage** — journey-split; carry-on+checked→100 down to personal-item→40; intl scale rewards ≥2 checked.
- **Comfort** — cabin base (first 96 … economy 60); pitch/amenity/long-haul adjustments.
- **Flexibility** — see refundability below.
- **Brand** — `brand-scores.json` lookup, default 70.
- **Reliability** — base 70 + `PROVIDER_RELIABILITY {duffel:85, amadeus:82, mystifly:78}` at 20% + optional on-time/cancel; connection penalties.
- **Airport experience** — baseline 65 + lounge/meals/wifi/family; airport/terminal change & overnight penalties; nonstop bonus.

**Traveler-profile multipliers** (`rankOffers.ts:70`, re-normalized to 100): business (schedule/flex/reliability↑, price↓), budget (price↑, comfort/brand↓), family (baggage/schedule/stops↑), elderly (comfort/stops/schedule↑), default (none).

## 8-dimension engine (one-way primary, RT fallback)

Weights (fractions, sum 1.0). Config: [`FlightScoringConfig.ts`](../src/lib/ai-scoring/FlightScoringConfig.ts).

| Dimension | Dom OW | Dom RT | Intl OW | Intl RT |
|---|---:|---:|---:|---:|
| effectivePriceScore | 0.36 | 0.34 | 0.35 | 0.35 |
| durationScore | 0.23 | 0.21 | 0.21 | 0.19 |
| stopsScore | 0.15 | 0.14 | 0.10 | 0.10 |
| baggageValueScore | 0.10 | 0.11 | 0.12 | 0.13 |
| layoverScore | 0.07 | 0.08 | 0.10 | 0.10 |
| scheduleScore | 0.04 | 0.05 | 0.04 | 0.05 |
| fareFlexibilityScore | 0.03 | 0.04 | 0.05 | 0.05 |
| providerReliabilityScore | 0.02 | 0.03 | 0.03 | 0.03 |

- **Effective price** — `clippedNorm(price, p5, p95)×100`, cheapest→100; guardrails ≤3%→floor 93, ≤5%→floor 88, 10-20%→−10, >20%→−25. Effective price adds estimated bag cost when bags not included (`ESTIMATED_BAG_COSTS` dom $35 / intl $75 × pax × legs).
- **Stops** — 0→100,1→85,2→72,3→58,4→45,5+→30.
- **Baggage value** — ≥2 checked+carry-on→100 … none→42 intl/50 dom.
- **Layover / Schedule / Duration** — percentile-normalized + red-eye/tight-connection/overnight/self-transfer penalties.
- **Fare flexibility** — refundable+changeable→100, changeable→75, refundable→80, neither→40, unknown→60.
- **Provider reliability** — `PROVIDER_BASE_SCORES {duffel:95, mystifly:90}`, default 80; dynamic health when present.

**Mode multipliers** `MODE_ADJUSTMENTS` (AI_PICK, BEST_VALUE, CHEAPEST, FASTEST, FEWEST_STOPS, COMFORT, FAMILY, ELDERLY, FLEXIBLE_FARE) applied then re-normalized (`getAdjustedWeights`).

## Refundability precedence / changeability

### 10-dim (context-aware flexibility, `scoreFlexibility.ts`)
`FLEXIBILITY_BENEFIT_SCORES`: nonChangeable/nonRefundable 20 … fullyRefundable 100. Score blends `benefit×0.5 + valueScore×0.5`. `applyChangeableVsRefundableRule` exists (changeable-vs-refundable gap logic) but is **not called inside `rankOffers`**.

### 8-dim (Refundability Premium Rule, `FlightRefundabilityRule.ts`)
- Premium bands (refundable vs comparable changeable): ≤5%→+15, ≤10%→+12, ≤15%→+8, ≤20%→+5; overpriced → −3/−5/−8.
- Comparability factors (same cabin/currency, stop & duration closeness) scale the adjustment: `adjustment = round(premiumBand × comparabilityFactor)`.
- Applied at pipeline step 6.5. Comparator chosen by `FlightComparableFareMatcher`.
- Post-scoring ordering (priority validator + pairwise MOVE) is in [OFFER_SELECTION_ENGINE.md](./OFFER_SELECTION_ENGINE.md).

### Price precedence guards (8-dim, `FlightScoringConfig.ts:366`)
- `MIN_PRICE_WEIGHT_FRACTION = 0.30` — after mode adjustment, price weight floored at 0.30 (deficit redistributed).
- `PRICE_PRECEDENCE_PENALTY = {thresholdPct:0.15, rate:50, cap:25}` — if `pctAboveCheapest > 0.15`, subtract `min((pct−0.15)×50, 25)` from base; cannot be overcome by other dimensions. (The 10-dim engine has **no** equivalent — it uses distance-from-cheapest normalization instead.)

## Journey-type detection (domestic vs international)

- **10-dim** (`detectJourneyType.ts`): explicit override wins; else `AIRPORT_COUNTRY` map (~350 IATA→ISO); same country→domestic; **unknown→international** (safer).
- **8-dim** (`FlightScoringUtils.ts::isInternationalRoute`): country from shared `@/data/airports` dataset (DEL↔BOM, LHR↔EDI correctly domestic); `DOMESTIC_US_FALLBACK` when unknown → US↔US domestic else international.

Journey type flips weights (intl favors duration/stops/flexibility/comfort), layover thresholds, baggage floors, schedule penalties, and tie-break priority.

## Tie-breaking

- **10-dim** (`rankOffers.ts:302`): finalScore (tol 0.01) → `profile.tieBreakOrder` (dom: price-first; intl: duration-first) → `offerId.localeCompare` (stable).
- **8-dim** (`FlightTieBreaker.ts`): finalScore (tol 2) → fewer CRITICAL/MAJOR warnings → lower effective price → better baggage → shorter duration → fewer stops → better flexibility → higher reliability → earlier departure. Intl flips duration-before-stops.

## Pipeline (10-dim `rankFlightOffers`)

`detectJourneyType → loadProfile → adjustWeightsForTraveler → computeAllScores (features, set-level price+duration normalization, 10 scores, weighted raw) → applyContextRules → adjustedScore=clamp(raw+adj) → tieBreakSort → computeConfidence → generateMachineReasons → RankedOffer[] + RankingAudit`.

**Context rules** (`applyContextRules.ts`, additive): A Dominance −2, B Small-Premium-Big-Value +≤6, C Expensive-Feature −3/−6/−8, D Risky-Connection −5/−8/−12, E Long-Haul-Comfort (intl), F Family, G Business, H Budget.

## Explanations

[`explanation/explainRanking.ts`](../backend/src/ranking/explanation/explainRanking.ts): GPT (`gpt-4.1-mini`, temp 0.3, max 300 tokens) turns machine reasons into headline + bullets + tradeoff. **GPT never re-ranks** — it only narrates. Falls back to machine reasons on error. Exposed via `POST /api/ranking` and `/api/ranking/explain`. In production search, badges/tags are built by the route, not the engine.

## Config values

- **`brand-scores.json`** (default 70): SQ 93, QR 92, EK 90, NH 90, JL 88, CX 88, EY 87, QF 86, TK 85, LH 84, BA 83, AF/KL/DL 82, AS/AC 80, WN/UA 78, AA 77, ET 73, 6E 72, AI 68, FR 58, W6 57, NK 55.
- **domestic-default.json:** `durationPenaltyRange 360`; layover {highRisk 35, good 45-120}; tieBreak price-first; 7 rules.
- **international-default.json:** `durationPenaltyRange 720`; layover {highRisk 60, good 90-240}; tieBreak duration-first; 8 rules (adds long_haul_comfort).
- Constants: `AI_PICK_MIN_SCORE 85`, `MIN_PRICE_WEIGHT_FRACTION 0.30`, `ESTIMATED_BAG_COSTS` dom $35 / intl $75, `DEFAULT_AI_RECOMMENDATION_LIMIT 51`, `RANKING_VERSION 'faremind-ranking-v1.0.0'`.

## Business rules
- Cheapest always scores 100 on price; being >15% above cheapest incurs an uncapped-by-other-dims penalty (8-dim).
- International routing weights flexibility, duration, and stops more heavily than domestic.
- Refundable fares can be *upgraded* above a comparable changeable fare within a small premium — but not across large price/quality gaps.
- Provider reliability nudges Duffel above Mystifly, all else equal.

## Known issues / limitations
- **Two live engines** (10-dim RT, 8-dim OW) with different weight scales, price models, and penalty logic — a round-trip and a one-way are not scored by the same algorithm.
- `backend/src/ranking` and `src/lib/ranking` are duplicated (byte-identical) so the frontend route can call it in-process — drift risk if edited in one place only.
- `applyChangeableVsRefundableRule` (10-dim) and `rankRoundTripOptions` (legacy) appear unused. **Not confirmed** whether RT fallback / `aiRank` are ever reached at runtime.
- Existing docs are incomplete (missing 10-dim engine).

## Future enhancements
- Unify to one engine or clearly delineate OW vs RT algorithms.
- De-duplicate the mirrored ranking directories (shared package).

## Related docs
[OFFER_SELECTION_ENGINE.md](./OFFER_SELECTION_ENGINE.md) · [FareMind-Scoring-and-Ranking-Algorithm.md](./FareMind-Scoring-and-Ranking-Algorithm.md) · [SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md)
