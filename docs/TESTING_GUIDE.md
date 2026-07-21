# TESTING_GUIDE.md

> Derived from repository source. Unconfirmed items marked **Not confirmed from repository.**

## Purpose

How to test and certify FareMind: fare certification (public/private/webfare), HoldAllowed, booking, revalidation, refund/void/ticketing, schedulers, plus required evidence.

## What test tooling exists in the repo

- **Ranking unit tests:** [`backend/src/ranking/tests/`](../backend/src/ranking/tests/) — `domestic-ranking.test.ts`, `international-ranking.test.ts`, `flexibility-context.test.ts`, `explanation-safety.test.ts`, plus fixtures (`score-cards.ts`, `score-two/four-cards.ts`).
- **AI-scoring unit test:** [`src/lib/ai-scoring/__tests__/FlightRefundabilityUpgradeRule.test.ts`](../src/lib/ai-scoring/__tests__/).
- **Duffel assistant test:** [`src/lib/__tests__/duffel-assistant.test.ts`](../src/lib/__tests__/).
- **E2E script:** [`scripts/e2e-bookings.ts`](../scripts/e2e-bookings.ts) (tsx script).
- **Playwright** is a devDependency (`@playwright/test`), but **no `playwright.config.*` or `e2e/` suite was found** — **Not confirmed from repository** that Playwright specs exist.
- **No unified `test` script** in `package.json` (only lint/build/db:*). Running the `.test.ts` files' runner is **Not confirmed** (likely `tsx`/`node --test`; verify before relying on it).

> The repo has no committed jest/vitest config discovered in this pass — **Not confirmed from repository.** Treat the `.test.ts` files as the executable spec of intended behavior even if the runner is unconfirmed.

## Environments

- **Mystifly demo/test:** `https://restapidemo.myfarebox.com` with synthetic data → frequent ERBUK082 on revalidation. `MYSTIFLY_TARGET` controls Test vs Production.
- **Duffel:** Test vs Live detected by token prefix (`duffel_test_` / `duffel_live_`).
- **Stripe:** test keys (`sk_test_`, `pk_test_`).
- **Never test against production data.** Use `DISABLE_SCHEDULERS=true` when pointing a dev machine at the prod DB so crons don't fire.

## Fare certification

### Public fare
1. Configure a `ProviderFareInventoryRule` with `fareType='public'`.
2. Search the route; confirm results carry `fareSource='public'`.
3. Book; verify Revalidate `HoldAllowed`, OrderTicket, and ticket numbers.
4. Capture `[Mystifly][FareTypeDiag]` from Railway logs.

### Private fare
Same as above with `fareType='private'`; confirm `fareSource='private'`.

### Webfare
1. Find a fare that revalidates with `HoldAllowed=false`.
2. Confirm the flow **skips OrderTicket** (`SKIPPED_WEBFARE`) and TripDetails yields ticket numbers.
3. Note: webfare has no dedicated field — see [PUBLIC_PRIVATE_WEBFARE.md](./PUBLIC_PRIVATE_WEBFARE.md).

## HoldAllowed testing
- **HoldAllowed=true:** verify OrderTicket is called; `Ticket-in Process` → `TICKETING_PENDING` → reconciliation resolves. [HOLD_ALLOWED_ANALYSIS.md](./HOLD_ALLOWED_ANALYSIS.md).
- **HoldAllowed=false:** verify no OrderTicket; status `SKIPPED_WEBFARE` → `ISSUED`.

## Booking testing
- **Duffel:** offer must be fresh (`OFFER_EXPIRED` if stale); passenger `pas_` IDs; verify Stripe capture happens **after** the order.
- **Mystifly:** verify Stripe capture **before** BookFlight; verify same-product alternate-FSC recovery only swaps within cabin/refundable/changeable/checkedBags and 2% price guard.
- Verify a failed provider booking does **not** charge the customer (Duffel) or triggers a refund (Mystifly), except ERBUK082.

## Revalidation testing
- Trigger ERBUK082 in the demo; confirm the booking becomes `TICKETING_PENDING` with a `category:'ERBUK082'` support ticket, **no refund**, and a reconciliation row.
- Confirm `RevalidationSnapshot` rows are written if audit wiring is active (**Not confirmed** — see [MYSTIFLY_BOOKING_FLOW.md](./MYSTIFLY_BOOKING_FLOW.md#known-issues--limitations)).

## Ticketing / reconciliation testing
- Insert/queue a `TicketingReconciliation` and let the 30s cron run; verify backoff (`0/15/30/60s/2/5/10m`), escalation at 7 polls, and terminal transitions (TICKETED/NOT_BOOKED). [TICKETING_FLOW.md](./TICKETING_FLOW.md).
- Verify `updateErbukTicket` posts customer-visible messages.

## Refund / void testing (post-ticketing)
- Void quote → void; Refund quote → refund; Reissue quote → reissue via `/api/mystifly-ptr/*` (Mystifly) / Duffel order changes.
- Verify `cancellation-orchestrator` financials: `net = refund − adminFee`, statuses (`REFUNDED`/`PARTIALLY_REFUNDED`/`NO_REFUND`/`VOIDED`), Stripe refund idempotency key, provider-reimbursement reconciliation ($0.01 tolerance). [PAYMENT_FLOW.md](./PAYMENT_FLOW.md).

## Scheduler testing
- Set short intervals or invoke `runTicketingReconciliation()` / `runReconciliationCycle()` / `runSchedulerCycle()` directly.
- Verify `DISABLE_SCHEDULERS=true` prevents all crons from starting.

## Ranking regression
- Run the ranking test fixtures (`score-cards.ts` etc.) for domestic/international and flexibility-context; verify weights and refundability precedence against [FLIGHT_RANKING_ENGINE.md](./FLIGHT_RANKING_ENGINE.md).

## Required evidence (per certification)
- **Screenshots:** search results with badges; fare selection; checkout confirm; PNR/ticket numbers; admin booking detail; support ticket.
- **Logs:** `[Mystifly][FareTypeDiag]`, `[Mystifly][SeatMapDiag]`, `[Mystifly][AncillaryDiag]`; provider request/response payloads (`BookingProviderPayload`); reconciliation cron tallies.
- **DB checks:** `MasterBooking` status triplet, `BookingTicket.ticketNumber`, `TicketingReconciliation` progression, `SupportTicket` category/queue, `BookingRefund` reconciliation.

## Known issues / limitations
- No unified test runner / config confirmed; Playwright specs not found.
- E2E script (`scripts/e2e-bookings.ts`) not reviewed for scope — **Not confirmed.**

## Future enhancements
- Add a `test` script + runner config; add Playwright E2E for the checkout funnel; add contract tests for provider adapters.

## Related docs
[DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) · [MYSTIFLY_BOOKING_FLOW.md](./MYSTIFLY_BOOKING_FLOW.md) · [PAYMENT_FLOW.md](./PAYMENT_FLOW.md) · [FLIGHT_RANKING_ENGINE.md](./FLIGHT_RANKING_ENGINE.md)
