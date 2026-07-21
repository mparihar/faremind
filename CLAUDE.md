@AGENTS.md

# FareMind — Project Entry Point

> **Read this first.** It tells you where everything is documented. Full engineering references live in [`docs/`](./docs/). Every future session should be able to orient from this file alone. Facts here are derived from repository source; anything unverified is marked **Not confirmed from repository** in the linked doc.

## ⚠️ Before writing any code

**This is NOT the Next.js you know** (see `AGENTS.md`). Next.js 16 has breaking changes — read the relevant guide in `node_modules/next/dist/docs/` before writing App Router code. Also: `next.config.ts` sets `typescript.ignoreBuildErrors:true`, so type errors do **not** fail the build — run `tsc`/lint yourself.

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
cp .env.example .env            # fill secrets
npm run dev                     # frontend :3000
cd backend && node --import tsx src/index.ts   # backend :3001
```

- `npm run build` = `prisma generate && next build`. DB: `db:push` / `db:migrate` / `db:migrate:prod` / `db:seed` / `db:studio`.
- Point a dev machine at the prod DB only with `DISABLE_SCHEDULERS=true`.
- Build/deploy: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). Env vars: [docs/BACKEND_ARCHITECTURE.md](./docs/BACKEND_ARCHITECTURE.md#environment-variables).

## Coding standards

Conventions, folder rules, error handling, logging, and a **review checklist**: [docs/DEVELOPMENT_GUIDE.md](./docs/DEVELOPMENT_GUIDE.md). Highlights:
- Prisma PascalCase models → `snake_case` tables; `cuid()` PKs; extend enums, don't repurpose.
- Ranking edits must touch **both** `backend/src/ranking` and `src/lib/ranking` (byte-identical mirrors).
- **Never retry billable provider calls** (`retries:0` for book/ticket/cancel/refund/order).
- Persist raw provider payloads; map status via the status-mapper, not inline strings.
- Never charge the customer on provider failure — except ERBUK082 (pending, no refund).

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

## Booking flow

Offer → Stripe auth (manual capture) → provider book → capture → persist `MasterBooking` + children → async ticketing reconciliation (Mystifly). States and orchestration: [docs/BOOKING_LIFECYCLE.md](./docs/BOOKING_LIFECYCLE.md), [docs/PAYMENT_FLOW.md](./docs/PAYMENT_FLOW.md), [docs/TICKETING_FLOW.md](./docs/TICKETING_FLOW.md).

## HoldAllowed overview

`HoldAllowed=true` → OrderTicket issues the ticket. `HoldAllowed=false` (webfare) → instant purchase at BookFlight, no OrderTicket. **Do not assume a 24-hour hold** — hold duration is not provider-returned. Detail: [docs/HOLD_ALLOWED_ANALYSIS.md](./docs/HOLD_ALLOWED_ANALYSIS.md). Fare types: [docs/PUBLIC_PRIVATE_WEBFARE.md](./docs/PUBLIC_PRIVATE_WEBFARE.md).

## Ranking algorithm

Two live engines: **10-dimension** (round-trip primary, `backend/src/ranking`) and **8-dimension** (one-way primary + RT fallback, `src/lib/ai-scoring`). Dimensions/weights/precedence: [docs/FLIGHT_RANKING_ENGINE.md](./docs/FLIGHT_RANKING_ENGINE.md). Badges/selection/AI-Pick: [docs/OFFER_SELECTION_ENGINE.md](./docs/OFFER_SELECTION_ENGINE.md).

## Testing strategy

Fare/HoldAllowed/booking/refund/ticketing certification + required evidence: [docs/TESTING_GUIDE.md](./docs/TESTING_GUIDE.md). Note: no unified test runner is confirmed; ranking + a few unit tests exist under `*/tests` / `__tests__`.

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
| [FareMind-Scoring-and-Ranking-Algorithm.md](./docs/FareMind-Scoring-and-Ranking-Algorithm.md) | Older 8-dim scoring doc (superseded by FLIGHT_RANKING_ENGINE.md) |
