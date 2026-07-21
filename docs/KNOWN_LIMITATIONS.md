# KNOWN_LIMITATIONS.md

> A consolidated register of current limitations, unconfirmed behavior, technical debt, and future work. Derived from repository source. Each item links to the doc with detail. Items that could not be verified are explicitly marked **Not confirmed from repository.**

## Provider integration

| # | Limitation | Detail |
|---|---|---|
| 1 | **Three divergent Duffel clients** | Backend service, frontend lib, and inline checkout client; production booking bypasses the shared client + its retry logic. [DUFFEL_INTEGRATION.md](./DUFFEL_INTEGRATION.md) |
| 2 | **Webfare not classifiable pre-revalidation** | No dedicated field; inferred from `HoldAllowed=false`. [PUBLIC_PRIVATE_WEBFARE.md](./PUBLIC_PRIVATE_WEBFARE.md) |
| 3 | **Mystifly hold duration unknown** | No provider-returned window; local rules default 60 min. **Not confirmed.** [HOLD_ALLOWED_ANALYSIS.md](./HOLD_ALLOWED_ANALYSIS.md) |
| 4 | **No held-booking auto-ticketing job** | Reconciliation polls status only; does not issue OrderTicket before hold expiry. Whether Mystifly auto-cancels is **Not confirmed.** |
| 5 | **Mystifly audit/idempotency helpers not wired** | `acquireBookingAttempt`, `logMystiflyAudit`, `logRevalidationSnapshot` defined but no checkout call site found. **Not confirmed.** [MYSTIFLY_BOOKING_FLOW.md](./MYSTIFLY_BOOKING_FLOW.md) |
| 6 | **Seat-map route naming mismatch** | Frontend calls `/api/seats/mystifly-seat-map`; proxy exposes `/api/mystifly/seat-map`; former handler not located. **Not confirmed.** |
| 7 | **Post-booking ancillary confirm/cancel not auto-wired** | Capability exists; not integrated into checkout (comment `mystifly-booking.ts:825`). |
| 8 | **Duffel capture-after-order edge case** | Capture failure after a created order leaves an issued order uncharged (logged CRITICAL). [PAYMENT_FLOW.md](./PAYMENT_FLOW.md) |
| 9 | **Cancel-on-provider-failure differs** | Duffel proceeds locally; Mystifly blocks. [DUFFEL_INTEGRATION.md](./DUFFEL_INTEGRATION.md) |
| 10 | **Search aggregation is append-only** | No cross-provider dedup of identical itineraries. |

## Ranking

| # | Limitation | Detail |
|---|---|---|
| 11 | **Two live ranking engines** | 10-dim (round-trip) vs 8-dim (one-way) — different weights/price models/penalties. [FLIGHT_RANKING_ENGINE.md](./FLIGHT_RANKING_ENGINE.md) |
| 12 | **Mirrored ranking dirs** | `backend/src/ranking` and `src/lib/ranking` byte-identical → drift risk. |
| 13 | **Unused code paths** | `applyChangeableVsRefundableRule`, `rankRoundTripOptions`, legacy `aiRank`, 3-factor `rankFlights` appear unused. **Not confirmed** they are reachable at runtime. |
| 14 | **Existing scoring docs incomplete** | `docs/FareMind-Scoring-and-Ranking-Algorithm.md` and `scoring_algorithm.md` omit the 10-dim RT engine. Superseded by [FLIGHT_RANKING_ENGINE.md](./FLIGHT_RANKING_ENGINE.md). |
| 15 | **RT badge/precedence path unclear** | 8-dim selection (badges, precedence MOVE) may not apply to the RT primary. **Not confirmed.** [OFFER_SELECTION_ENGINE.md](./OFFER_SELECTION_ENGINE.md) |

## Infrastructure

| # | Limitation | Detail |
|---|---|---|
| 16 | **Redis documented but unused** | `REDIS_URL`/`RATE_LIMIT_REDIS_URL` never read; cache + rate limit in-memory. [BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md) |
| 17 | **Single-process assumptions** | In-memory cache/rate-limit + `setInterval` crons ⇒ horizontal scaling would double-process/split state. **Not confirmed** >1 instance runs. [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md) |
| 18 | **OVERDUE refunds not re-swept** | Refund cron only re-polls PENDING/PROCESSING. [PAYMENT_FLOW.md](./PAYMENT_FLOW.md) |
| 19 | **No env-var validation** | `backend/src/env.ts` only loads dotenv; misconfig surfaces at runtime. |
| 20 | **No committed Railway pipeline config** | Topology inferred; README is stale create-next-app. **Not confirmed.** [DEPLOYMENT.md](./DEPLOYMENT.md) |
| 21 | **Two notification implementations** | Backend direct-Brevo (live) vs Python service; production path **Not confirmed.** |
| 22 | **Two auth implementations** | Backend `/api/auth` vs Python `auth-service` (legacy, no deploy config). **Not confirmed.** |
| 23 | **Fastify version unconfirmed** | `backend/package.json` not read; health route reports `0.2.0`. **Not confirmed.** |

## Security / operational

| # | Limitation | Detail |
|---|---|---|
| 24 | **Master OTP `778899`** | Bypass in admin + backend auth. Ensure disabled/rotated in prod; environment gating **Not confirmed.** [ADMIN_PORTAL.md](./ADMIN_PORTAL.md) |
| 25 | **`typescript.ignoreBuildErrors:true`** | Type errors don't block the build. [FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md) |
| 26 | **auth-service prints OTP to stdout** | Dev convenience; must not run in prod. **Not confirmed** it's deployed. |

## Data model

| # | Limitation | Detail |
|---|---|---|
| 27 | **Two booking models** | Legacy `Booking` vs `MasterBooking`. [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) |
| 28 | **Untyped JSON columns** | `raw*` payloads/fare rules are `Json?` — shape not schema-enforced. |
| 29 | **Reconciliation dead code** | `shouldPollStatus`/`mappedTicketingStatus` unused; `MANUAL_REVIEW` queried but never written. **Not confirmed intentional.** [TICKETING_FLOW.md](./TICKETING_FLOW.md) |
| 30 | **Confirm route size** | ~2,361-line single file handling both providers. [BOOKING_LIFECYCLE.md](./BOOKING_LIFECYCLE.md) |

## Testing

| # | Limitation | Detail |
|---|---|---|
| 31 | **No unified test runner** | No `test` script; Playwright dep present but no specs/config found. **Not confirmed.** [TESTING_GUIDE.md](./TESTING_GUIDE.md) |

## Prioritized future enhancements

1. Introduce Redis + distributed scheduler lock (unblocks horizontal scale). (#16, #17)
2. Wire Mystifly idempotency/audit into checkout. (#5)
3. Consolidate Duffel clients + complete `provider-adapter` abstraction. (#1)
4. Unify or clearly delineate the two ranking engines; de-dup mirrored dirs. (#11, #12)
5. Add held-booking auto-ticketing + OVERDUE refund re-sweep. (#4, #18)
6. Environment-gate/remove the master OTP. (#24)
7. Add a test runner + Playwright E2E + provider contract tests. (#31)
8. Consolidate notification + auth implementations. (#21, #22)

## Related docs
[SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)
