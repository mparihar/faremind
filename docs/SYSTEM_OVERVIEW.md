# SYSTEM_OVERVIEW.md

> The 10-minute orientation to FareMind. Derived from repository source. Unconfirmed items marked **Not confirmed from repository.**

## What FareMind is

FareMind is an AI-assisted online travel agency (OTA) for flights. It aggregates flight content from multiple providers, ranks offers with a multi-dimensional AI scoring engine, and handles the full booking lifecycle — payment, provider booking, ticketing, post-booking servicing (changes/cancellations/refunds), and support — for end customers, internal travel agents, and admin staff. It is live at `www.faremind.ai`.

## Technology stack

| Area | Choice |
|---|---|
| Frontend | Next.js 16.2.4 (App Router), React 19, Tailwind 4, Zustand, Framer Motion, MapLibre |
| Backend | Fastify gateway (Node 22, run via `tsx`) |
| Database | PostgreSQL (Railway), Prisma 7.8 + `@prisma/adapter-pg` |
| Providers | Duffel (NDC), Mystifly OnePoint (GDS aggregator), Amadeus (optional/commented) |
| Payments | Stripe (manual capture) |
| Email | Brevo (backend direct + Python FastAPI service) |
| AI/LLM | OpenAI (GPT-4o-mini, gpt-4.1-mini) |
| Aux services | Python notifications (`brain/notifications`), Python auth-service (legacy) |

## Repository structure

```
faremind/
├── src/                      Next.js frontend + API routes
│   ├── app/                  pages + /api routes (user, admin, agent, ai, checkout…)
│   ├── lib/                  ai-scoring/, ranking/ (mirror), providers/, stripe, auth…
│   ├── store/                Zustand stores
│   └── generated/prisma/     generated Prisma client (gitignored)
├── backend/                  Fastify gateway
│   └── src/
│       ├── index.ts          bootstrap + route registration + schedulers
│       ├── routes/           26 route plugins
│       ├── services/         orchestrator, normalizer, mystifly, duffel, cancellation…
│       ├── providers/mystifly/  status-mapper, search-resolver, errors, audit
│       ├── ranking/          10-dim ranking engine (+ config)
│       └── workers/          crons: limit-order, refund, ticketing reconciliation
├── brain/notifications/      Python FastAPI notification service
├── auth-service/             Python FastAPI OTP auth (legacy)
├── prisma/schema.prisma      ~90 models, DB source of truth
└── docs/                     this knowledge base
```

## How it works (one paragraph)

A search hits the Fastify `/api/search`, which fans out to Duffel and Mystifly in parallel, normalizes results into a `UnifiedFlight` model, and ranks them (10-dimension engine for round-trip, 8-dimension for one-way). The user picks a fare; the checkout wizard collects passengers/seats/meals/ancillaries, authorizes a Stripe payment (manual capture), and calls `/api/checkout/bookings/confirm`. That route books with the provider — Duffel is a single instant order (captured after), Mystifly is revalidate → capture → book → (order-ticket if `HoldAllowed`) — and persists a `MasterBooking` with journeys, segments, passengers, tickets, and raw payloads. Mystifly ticketing that isn't immediately confirmed (including ERBUK082 "pending") is queued and resolved by a 30-second reconciliation cron. Cancellations/refunds run through a provider-agnostic orchestrator with Stripe refunds and provider-reimbursement reconciliation.

## The five things to understand first

1. **`HoldAllowed`** decides the Mystifly flow (ticket now vs webfare instant). [HOLD_ALLOWED_ANALYSIS.md](./HOLD_ALLOWED_ANALYSIS.md).
2. **ERBUK082** is a *valid pending* state (demo synthetic data), not a failure — no refund, reconcile. [MYSTIFLY_BOOKING_FLOW.md](./MYSTIFLY_BOOKING_FLOW.md#erbuk082--pending-need--awaiting-carrier-response--booking-unconfirmed).
3. **Capture timing differs by provider** — Duffel after order, Mystifly before book. [PAYMENT_FLOW.md](./PAYMENT_FLOW.md).
4. **Two live ranking engines** — 10-dim (RT) and 8-dim (OW). [FLIGHT_RANKING_ENGINE.md](./FLIGHT_RANKING_ENGINE.md).
5. **`MasterBooking`** is the OTA data model; legacy `Booking` is only for price tracking. [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md).

## Business rules (headline)
- Cheapest is not always the AI Pick; quality + refundability precedence + blocking warnings matter.
- Only `providerPayableTotal` goes to providers; markup/fees/insurance are FareMind/third-party revenue.
- Provider booking failure never charges the customer (Duffel) / refunds after capture (Mystifly), except ERBUK082.
- Fare rules are snapshotted onto the booking at book time.

## Documentation index

| Doc | Topic |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System topology + request flows |
| [MYSTIFLY_BOOKING_FLOW.md](./MYSTIFLY_BOOKING_FLOW.md) | **Most important integration doc** |
| [DUFFEL_INTEGRATION.md](./DUFFEL_INTEGRATION.md) | Duffel |
| [HOLD_ALLOWED_ANALYSIS.md](./HOLD_ALLOWED_ANALYSIS.md) | HoldAllowed flows |
| [PUBLIC_PRIVATE_WEBFARE.md](./PUBLIC_PRIVATE_WEBFARE.md) | Fare types |
| [BOOKING_LIFECYCLE.md](./BOOKING_LIFECYCLE.md) | Booking states + confirm flow |
| [PAYMENT_FLOW.md](./PAYMENT_FLOW.md) | Stripe + refunds |
| [TICKETING_FLOW.md](./TICKETING_FLOW.md) | Ticketing + reconciliation |
| [FLIGHT_RANKING_ENGINE.md](./FLIGHT_RANKING_ENGINE.md) | Scoring dimensions/weights |
| [OFFER_SELECTION_ENGINE.md](./OFFER_SELECTION_ENGINE.md) | Selection/badges/precedence |
| [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md) | Schedulers |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | Prisma models + enums |
| [BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md) | Fastify gateway |
| [FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md) | Next.js + stores |
| [ADMIN_PORTAL.md](./ADMIN_PORTAL.md) | Admin + agent consoles |
| [API_REFERENCE.md](./API_REFERENCE.md) | All endpoints |
| [TESTING_GUIDE.md](./TESTING_GUIDE.md) | Test + certification |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Build + deploy |
| [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) | Conventions |
| [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) | Debt + unknowns |

## Related docs
Start with [ARCHITECTURE.md](./ARCHITECTURE.md), then [MYSTIFLY_BOOKING_FLOW.md](./MYSTIFLY_BOOKING_FLOW.md).
