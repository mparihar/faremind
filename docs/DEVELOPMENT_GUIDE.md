# DEVELOPMENT_GUIDE.md

> Derived from repository source + conventions observed in code. Unconfirmed items marked **Not confirmed from repository.**

## Purpose

Conventions for working in FareMind: adding APIs, folder structure, naming, error handling, logging, and a review checklist.

## Golden rule (from AGENTS.md / CLAUDE.md)

> **This is NOT the Next.js you know.** Next.js 16 has breaking changes. **Read the relevant guide in `node_modules/next/dist/docs/` before writing App Router code.** Heed deprecation notices.

## Setup

```bash
npm ci && npm ci --prefix backend
npx prisma generate
cp .env.example .env    # fill in secrets
npm run dev             # frontend :3000
cd backend && node --import tsx src/index.ts   # backend :3001
```

Point a dev machine at the prod DB only with `DISABLE_SCHEDULERS=true`.

## Folder structure & where things go

| Need | Location |
|---|---|
| A user-facing page | `src/app/<route>/page.tsx` |
| A Next.js API route | `src/app/api/<domain>/route.ts` (export `GET`/`POST`/…) |
| A backend gateway route | `backend/src/routes/<domain>.ts`, register in `backend/src/index.ts` |
| Provider logic | `backend/src/services/<provider>.ts` + `backend/src/providers/<provider>/` |
| Ranking change | `backend/src/ranking/*` **and** mirror `src/lib/ranking/*` (kept byte-identical) |
| AI scoring change | `src/lib/ai-scoring/*` |
| DB change | `prisma/schema.prisma` → `npx prisma migrate dev` |
| Shared client state | `src/store/use*Store.ts` (Zustand) |
| A scheduled job | `backend/src/workers/*-cron.ts` + register in `index.ts` (guard with `DISABLE_SCHEDULERS`) |

## Adding a new backend API (Fastify)

1. Create `backend/src/routes/<name>.ts` exporting a Fastify plugin.
2. Register it in `backend/src/index.ts` with a `/api/<name>` prefix.
3. Add a rate-limit category in `lib/rate-limit.ts` `ROUTE_RULES` if it's sensitive.
4. Use `prisma` from `lib/db.ts`; never instantiate a second client.
5. Return `{ success, ... }` on success and `{ success:false, code, error }` on failure.

## Adding a new Next.js API route

1. Create `src/app/api/<domain>/route.ts`; export the HTTP method handlers.
2. Prefer proxying to the Fastify backend via `apiUrl()` unless it's a pure DB/read concern.
3. For admin routes, wrap with `withAdmin(handler, minRole)`; for agent routes, `withAgent`.

## Adding a provider call

- Put the HTTP call in the provider service (`mystifly.ts` / `duffel.ts`) through the shared request helper (`mystiflyRequest` / `duffelRequest`).
- **Never retry billable/mutating calls** (`retries:0` for book/ticket/cancel/refund/order).
- Persist raw request/response as `BookingProviderPayload`.
- Map provider status via the status-mapper; don't hardcode strings in routes.

## Naming conventions

- Prisma: PascalCase models, `@@map` to `snake_case` tables, `@map` snake_case columns; `cuid()` PKs.
- Enums: SCREAMING_SNAKE members; `Mb*` prefix for MasterBooking-pipeline enums.
- Files: kebab-case for routes/services (`ticketing-reconciliation.ts`); PascalCase for ai-scoring classes (`FlightScoringEngine.ts`).
- Diagnostic logs: `[Mystifly][XxxDiag]` prefix.

## Error handling

- Provider errors: throw typed errors (`MystiflyApiError`, `DuffelApiError`, structured `mystifly.errors.ts` classes) and translate to customer-facing messages + `errorCode` at the route.
- Booking failures: call `logBookingFailure` (creates `BookingFailureAudit` + support ticket).
- Never charge the customer on provider failure; cancel the Stripe auth (Duffel) or refund after capture (Mystifly) — except ERBUK082 (pending, no refund).
- Swallow non-critical errors (audit/notify) with a warn; don't fail the booking on them.

## Logging

- Backend uses pino (`pino-pretty` in dev). Use the Fastify logger, not `console.*`, in backend routes where possible. **Not strictly enforced — Not confirmed.**
- Keep provider FSC/PII out of logs; the Mystifly path hashes FSC (`hashFsc`) for traceability.

## Money & fees

- Only `providerPayableTotal` goes to providers. Markup/service-fee/insurance/protection are computed in the fee engine and retained via Stripe.
- Validate FE totals against BE totals (`validateCheckoutPricing`) before booking.

## Review checklist

- [ ] Read the Next 16 doc if touching App Router APIs.
- [ ] DB change has a migration; enums extended, not repurposed.
- [ ] Ranking edits applied to **both** mirrored dirs (or de-duplicated intentionally).
- [ ] Billable provider calls are `retries:0`.
- [ ] Provider raw payloads persisted; status mapped via status-mapper.
- [ ] Customer never charged on failure; ERBUK082 treated as pending (no refund).
- [ ] New scheduler guarded by `DISABLE_SCHEDULERS` and stopped on shutdown.
- [ ] RBAC wrapper on admin/agent routes with correct min role.
- [ ] Rate-limit category set for sensitive routes.
- [ ] No secrets/PII in logs.
- [ ] Docs updated (`docs/` + `CLAUDE.md` links) for material changes.

## Known issues / limitations
- `typescript.ignoreBuildErrors:true` — TS errors won't fail the build; run `tsc`/lint manually.
- Duplicated engines/routes create drift risk.
- No enforced test runner (see [TESTING_GUIDE.md](./TESTING_GUIDE.md)).

## Related docs
[TESTING_GUIDE.md](./TESTING_GUIDE.md) · [BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md) · [DEPLOYMENT.md](./DEPLOYMENT.md) · [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)
