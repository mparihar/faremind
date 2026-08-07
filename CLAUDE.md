# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# FareMind — Project Entry Point

> **Read this first.** It tells you where everything is documented. Full engineering references live in [`docs/`](./docs/). Every future session should be able to orient from this file alone. Facts here are derived from repository source; anything unverified is marked **Not confirmed from repository** in the linked doc. (`README.md` is untouched `create-next-app` boilerplate — ignore it.)

## ⚠️ Before writing any code

**This is NOT the Next.js you know** (see `AGENTS.md`). Next.js 16 has breaking changes — read the relevant guide in `node_modules/next/dist/docs/` before writing App Router code.

`next.config.ts` sets `typescript.ignoreBuildErrors:true`, so type errors do **not** fail the build. But the repo does **not** typecheck or lint clean — measured at `0f8fd28`:

| Check | Command | Baseline at HEAD |
|---|---|---|
| Frontend types | `npx tsc --noEmit` | **87** errors |
| Backend types | `cd backend && npx tsc --noEmit` | **2** errors |
| Lint | `npm run lint` (= `eslint`) | **3099** errors, 1324 warnings |

So a clean run is not the gate. Scope checks to what you touched (`npx tsc --noEmit 2>&1 \| grep <your-file>`, `npx eslint <path>`) and compare against this baseline — a repo-wide run will drown your change in pre-existing noise. Root-level strays (`test.js`, `count.js`, `scratch_fees.js`, `move-script.js`) are not part of the app.

## Project overview

FareMind is an AI-assisted flight OTA (live at `www.faremind.ai`). It aggregates flight content from **Duffel** (NDC) and **Mystifly** (GDS aggregator), ranks offers with a multi-dimensional AI scoring engine, and runs the full booking lifecycle — payment, provider booking, ticketing, servicing, refunds, and support — for customers, internal agents, and admins. Full orientation: [docs/SYSTEM_OVERVIEW.md](./docs/SYSTEM_OVERVIEW.md).

## Repository structure

```
src/            Next.js 16 frontend + /api routes (user, admin, agent, ai, checkout)
  lib/          ai-scoring/, ranking/ (mirror), providers/, stripe, auth, fee-engine
  store/        Zustand stores
backend/src/    Fastify gateway: routes/, services/, providers/mystifly/, ranking/, workers/
brain/notifications/   Python FastAPI notification service (Brevo)
auth-service/   Python FastAPI OTP auth (legacy)
prisma/schema.prisma   ~90 models — DB source of truth
docs/           permanent knowledge base (this file points here)
```

Details: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), [docs/BACKEND_ARCHITECTURE.md](./docs/BACKEND_ARCHITECTURE.md), [docs/FRONTEND_ARCHITECTURE.md](./docs/FRONTEND_ARCHITECTURE.md).

## Technology stack

Next.js 16.2.4 / React 19 / Tailwind 4 / Zustand · Fastify gateway (Node 22 via `tsx`) · PostgreSQL on Railway + Prisma 7.8 (`@prisma/adapter-pg`) · Duffel + Mystifly (+ optional Amadeus) · Stripe (manual capture) · Brevo email · OpenAI (GPT-4o-mini / gpt-4.1-mini).

## How to build & run

```bash
npm ci && npm ci --prefix backend
npx prisma generate
cp .env.example .env               # fill secrets
npm run dev                        # frontend :3000
npm run dev --prefix backend       # backend :3001 — tsx watch (hot reload)
```

- Backend `npm start` (`node --import tsx src/index.ts`) is the **no-watch** prod-style boot; use `npm run dev` while developing.
- The frontend reaches the gateway via **`BACKEND_URL`** (server-side, ~31 call sites) and **`NEXT_PUBLIC_BACKEND_URL`** (browser). Both must point at :3001 locally or backend-owned routes (Stripe webhook, Mystifly, ticketing, ranking) silently no-op.
- `npm run build` = `prisma generate && next build`. DB: `db:push` / `db:migrate` / `db:migrate:prod` / `db:seed` / `db:studio`.
- Prisma is one schema shared by both packages: backend scripts pass `--schema ../prisma/schema.prisma`. After editing `prisma/schema.prisma`, regenerate in **both** (`npx prisma generate` and `npm run db:generate --prefix backend`).
- Point a dev machine at the prod DB only with `DISABLE_SCHEDULERS=true`.
- Build/deploy: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). Env vars: [docs/BACKEND_ARCHITECTURE.md](./docs/BACKEND_ARCHITECTURE.md#environment-variables).

## Coding standards

Conventions, folder rules, error handling, logging, and a **review checklist**: [docs/DEVELOPMENT_GUIDE.md](./docs/DEVELOPMENT_GUIDE.md). Highlights:
- Prisma PascalCase models → `snake_case` tables; `cuid()` PKs; extend enums, don't repurpose.
- Ranking edits must touch **both** `backend/src/ranking` and `src/lib/ranking`. Every file present in both is byte-identical; the backend additionally owns `explanation/`, `index.ts`, `route.ts`, `tests/` (no frontend counterpart — don't create one). Verify with `diff -rq backend/src/ranking src/lib/ranking` — the only expected output is those four backend-only entries.
- **Never retry billable provider calls** (`retries:0` for book/ticket/cancel/refund/order).
- Persist raw provider payloads; map status via the status-mapper, not inline strings.
- Never charge the customer on provider failure — except ERBUK082 (pending, no refund).

## Flight times are wall clocks, not instants

Providers send airport local time with no zone (`"2026-12-11T18:10:00"`). `new Date()` reads that in the *machine's* zone, so the same booking becomes a different instant on every host — FMP6VJN2 stored a BCN 18:10 departure as `2026-12-12T00:10:00Z`, a day late for anyone outside US Central. Three rules, and all three are needed:

- **Parse** with `parseProviderDateTime` (`src/lib/provider-time.ts`, mirrored in `backend/src/lib/`) — pins the wall clock to UTC verbatim.
- **Read** components with `providerHour` / `providerMinute` / `flightTimeMs`, never `getHours()`/`getTime()` on a raw parse.
- **Render** with `formatFlightDate` / `formatFlightTime` / `formatFlightDateTime` — they pin `timeZone: 'UTC'`, which is what keeps 18:10 printing as 18:10 in Madrid.

An ESLint `no-restricted-syntax` guard in `eslint.config.mjs` fails the build on the four shapes that reintroduce this. **This does not apply to real instants** — `createdAt`, `issuedAt`, payment and audit times are genuine points in time and correctly render in the viewer's own zone.

Repairing rows written before the fix: `backend/scripts/backfill-flight-times.mjs` (dry run by default) re-derives from `raw_segment_payload`. It refuses any row more than 14 h out, because that is a reissue whose raw payload is stale, not a timezone misparse.

## Business rules (headline)

- Only `providerPayableTotal` (fare + seat fees) is sent to a provider; markup/service-fee/insurance/protection are FareMind/third-party revenue via Stripe.
- Cheapest is not always the AI Pick — quality, refundability precedence, and blocking warnings apply.
- Fare rules (refundable/changeable/fees) are snapshotted onto `BookingPnr` at book time.
- ERBUK082 is a **valid pending** state, not a failure.

## Design principles

- `MasterBooking` is the OTA data model; legacy `Booking` exists only for price tracking.
- Provider differences are branched in the checkout confirm route (not fully abstracted).
- GPT narrates rankings but **never re-ranks**.

## Mystifly integration

**The most important integration.** Flow: Revalidate → (FareRules) → **Stripe capture (before Book)** → BookFlight (`LccHoldBooking = HoldAllowed`) → OrderTicket (only if `HoldAllowed`) → TripDetails. Async ticketing via a 30s reconciliation cron. Full detail: [docs/MYSTIFLY_BOOKING_FLOW.md](./docs/MYSTIFLY_BOOKING_FLOW.md).

## Duffel integration

Single instant order (`POST /air/orders`, `type:'instant'`, paid from Duffel balance); **Stripe capture after** the order. Three divergent clients exist; production checkout uses an inline client. Detail: [docs/DUFFEL_INTEGRATION.md](./docs/DUFFEL_INTEGRATION.md).

## Fare families

**FareMind never renames an airline's fare.** The carrier owns the branding; we own the comparison. Mystifly returns the brand on `ItineraryReferenceList[].FareFamily` — `ECO VALUE`, `DELTA MAIN BASIC`, `INDIGO UPFRONT`, `SMART`, `BUSINESS FLEX` — and that string is displayed verbatim from search through checkout, ticket, email and servicing.

- `services/fare-family.ts` (mirrored at `src/lib/fare-family.ts`) derives an **internal** `normalizedFareTier` (`BASIC|STANDARD|FLEX|PREMIUM|BUSINESS|FIRST`) for ranking, filters and analytics. It is **never rendered**. Pattern + attribute inference only, so a brand we have never seen still tiers correctly with no code change — there are no seeded fare names.
- The fare ladder for a flight is the set of search offers sharing an `itineraryKey` (same metal, different fare). This mirrors Mystifly's own `GroupedItems`. `POST /api/fares/options` takes that set; the `GET` form is a single-offer compatibility path.
- `fare_tier_templates` still exists for admin/backward compatibility but **must not supply customer-facing names**. It previously projected 7 invented tiers (`Economy Basic`…`Business Extra`) at `priceMultiplier 1.0` onto one offer — so every tier showed the same price and booked the identical fare.
- Provider silence stays `null` ("Contact airline"), never a fabricated "no". Lounge access, miles earning and seat policy are not in Mystifly search.
- `MasterBooking.airlineFareFamily` / `normalizedFareTier` / `bookingClass` freeze the fare at book time.

## Generic "Make a Payment" (payment_purpose)

One `ServicePayment` table, discriminated by `paymentPurpose` (BOOKING_PAYMENT | AGENT_WALLET_RECHARGE | OTHER_PAYMENT), drives all three categories via one shared create path (frontend `src/lib/payments/orchestrator.ts`) and one authoritative fulfiller — the **Stripe webhook on the BACKEND** (`backend/src/routes/stripe-webhook.ts`, signature-verified raw body + `StripeWebhookEvent` dedupe). Backend `services/payment-fulfill.ts` dispatches per purpose (booking→ticket/event, wallet→direct `rechargeWallet()`, other→PaymentRequest settle) with a single-claim idempotency guard. The legacy frontend `/api/service-payments/confirm` is now a **server-verified idempotent fallback** — it re-fetches the PI (never trusts the browser) then delegates to backend `POST /api/payments/fulfill`. Stripe webhook/refund/cancellation business logic lives on the backend; PaymentIntent creation (tied to browser card forms) stays frontend-side. Money is always minor-units/Decimal (`money.ts`), never floats. UI: `account/make-payment` (Booking + Other) and `agent/make-payment` (all three) show a "Make a Payment For" selector; shared panels in `src/components/payments/`. Admin: `/admin/payments` (all purposes + PaymentRequest mgmt). Requires **`STRIPE_WEBHOOK_SECRET`** on the **backend** (webhook endpoint is the backend URL `…/api/stripe/webhook`). Agent wallet self-recharge (`/api/agent/wallet/recharge`) + auto-recharge (`auto-recharge.ts`, off-session, consent-gated, locked, config-driven via SystemConfig — never hard-coded). Wallet-disabled agents get a recharge-only session (`withAgentWalletAccess`).

## Booking flow

Offer → Stripe auth (manual capture) → provider book → capture → persist `MasterBooking` + children → async ticketing reconciliation (Mystifly). States and orchestration: [docs/BOOKING_LIFECYCLE.md](./docs/BOOKING_LIFECYCLE.md), [docs/PAYMENT_FLOW.md](./docs/PAYMENT_FLOW.md), [docs/TICKETING_FLOW.md](./docs/TICKETING_FLOW.md).

## HoldAllowed overview

`HoldAllowed=true` → OrderTicket issues the ticket. `HoldAllowed=false` (webfare) → instant purchase at BookFlight, no OrderTicket. **Do not assume a 24-hour hold** — hold duration is not provider-returned. Detail: [docs/HOLD_ALLOWED_ANALYSIS.md](./docs/HOLD_ALLOWED_ANALYSIS.md). Fare types: [docs/PUBLIC_PRIVATE_WEBFARE.md](./docs/PUBLIC_PRIVATE_WEBFARE.md).

## Ranking algorithm

Two live engines: **10-dimension** (round-trip primary, `backend/src/ranking`) and **8-dimension** (one-way primary + RT fallback, `src/lib/ai-scoring`). Dimensions/weights/precedence: [docs/FLIGHT_RANKING_ENGINE.md](./docs/FLIGHT_RANKING_ENGINE.md). Badges/selection/AI-Pick: [docs/OFFER_SELECTION_ENGINE.md](./docs/OFFER_SELECTION_ENGINE.md).

## Testing strategy

There is **no `test` script and no test framework installed** — each suite is run directly, and they don't share a runner. Verified commands:

```bash
# Ranking suites (node:test) — the only real automated tests. Run one file, or the dir.
cd backend && npx tsx --test src/ranking/tests/domestic-ranking.test.ts
cd backend && npx tsx --test src/ranking/tests/*.test.ts

# Standalone script-style test (hand-rolled asserts, no framework)
npx tsx src/lib/__tests__/duffel-assistant.test.ts

# Read-only financial invariant audit; exits non-zero on any inconsistency
PROD_DB_URL="postgres://…" node backend/scripts/reconcile-financials.mjs --recent 15

# Playwright booking walkthrough — needs the dev server on :3000; no playwright.config exists
npx tsx scripts/e2e-bookings.ts
```

Two traps: `src/lib/ai-scoring/__tests__/FlightRefundabilityUpgradeRule.test.ts` imports **`vitest`, which is not installed** — it cannot run until someone adds vitest, so treat it as a spec document, not a suite. And the ranking suites have **3 pre-existing failures at HEAD** (18 pass / 3 fail over `src/ranking/tests/*.test.ts`) — `domestic-ranking` "Test 2: Slightly more expensive domestic flight wins when it saves significant time", plus `international-ranking` "Test 6: Safer connection beats risky short connection" and "Test 7: Included checked bag ranks better when prices are close". Verify against that baseline before assuming you broke it.

Several suites are hand-rolled scripts rather than `node:test` — they assert and set `process.exitCode`, so **run them directly and check the exit code**; under `--test` the whole file counts as one passing test and individual assertion failures are invisible:

```bash
cd backend && npx tsx src/lib/provider-time.test.ts     # 21 asserts
cd backend && npx tsx src/lib/passenger-title.test.ts   # 11
cd backend && npx tsx src/services/itinerary-sync.test.ts   # 14
```

`provider-time.test.ts` must pass under **several timezones**, not just yours — that is the entire point of it:

```bash
for z in UTC America/Chicago Asia/Kolkata Europe/Madrid Pacific/Auckland; do TZ=$z npx tsx src/lib/provider-time.test.ts; done
```

Fare/HoldAllowed/booking/refund/ticketing certification + required evidence: [docs/TESTING_GUIDE.md](./docs/TESTING_GUIDE.md).

## Deployment

Frontend (Vercel/Railway) + Fastify backend (Railway via Nixpacks/Docker) + Python notifications (Railway) + Railway PostgreSQL. Production deploys from `main`. Detail: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

## Known limitations

Consolidated register (debt, unknowns, unconfirmed behavior, prioritized future work): [docs/KNOWN_LIMITATIONS.md](./docs/KNOWN_LIMITATIONS.md).

## Documentation index (docs/)

| Doc | Topic |
|---|---|
| [SYSTEM_OVERVIEW.md](./docs/SYSTEM_OVERVIEW.md) | Start here — 10-min orientation |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System topology + request flows |
| [MYSTIFLY_BOOKING_FLOW.md](./docs/MYSTIFLY_BOOKING_FLOW.md) | Mystifly (most important) |
| [DUFFEL_INTEGRATION.md](./docs/DUFFEL_INTEGRATION.md) | Duffel |
| [HOLD_ALLOWED_ANALYSIS.md](./docs/HOLD_ALLOWED_ANALYSIS.md) | HoldAllowed flows |
| [PUBLIC_PRIVATE_WEBFARE.md](./docs/PUBLIC_PRIVATE_WEBFARE.md) | Fare types |
| [BOOKING_LIFECYCLE.md](./docs/BOOKING_LIFECYCLE.md) | Booking states + confirm |
| [PAYMENT_FLOW.md](./docs/PAYMENT_FLOW.md) | Stripe + refunds |
| [TICKETING_FLOW.md](./docs/TICKETING_FLOW.md) | Ticketing + reconciliation |
| [FLIGHT_RANKING_ENGINE.md](./docs/FLIGHT_RANKING_ENGINE.md) | Scoring dimensions/weights |
| [OFFER_SELECTION_ENGINE.md](./docs/OFFER_SELECTION_ENGINE.md) | Selection/badges/precedence |
| [BACKGROUND_JOBS.md](./docs/BACKGROUND_JOBS.md) | Schedulers |
| [DATABASE_SCHEMA.md](./docs/DATABASE_SCHEMA.md) | Prisma models + enums |
| [BACKEND_ARCHITECTURE.md](./docs/BACKEND_ARCHITECTURE.md) | Fastify gateway |
| [FRONTEND_ARCHITECTURE.md](./docs/FRONTEND_ARCHITECTURE.md) | Next.js + stores |
| [ADMIN_PORTAL.md](./docs/ADMIN_PORTAL.md) | Admin + agent consoles |
| [API_REFERENCE.md](./docs/API_REFERENCE.md) | All endpoints |
| [DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Build + deploy |
| [DEVELOPMENT_GUIDE.md](./docs/DEVELOPMENT_GUIDE.md) | Conventions + checklist |
| [TESTING_GUIDE.md](./docs/TESTING_GUIDE.md) | Test + certification |
| [KNOWN_LIMITATIONS.md](./docs/KNOWN_LIMITATIONS.md) | Debt + unknowns |
| [MYSTIFLY_OPEN_ISSUES.md](./docs/MYSTIFLY_OPEN_ISSUES.md) | Live provider-side defects, with evidence — and what was ours |
| [FareMind-Scoring-and-Ranking-Algorithm.md](./docs/FareMind-Scoring-and-Ranking-Algorithm.md) | Older 8-dim scoring doc (superseded by FLIGHT_RANKING_ENGINE.md) |
