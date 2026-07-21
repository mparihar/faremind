# DUFFEL_INTEGRATION.md

> Derived from repository source. Unconfirmed items marked **Not confirmed from repository.**

## Purpose

Document the Duffel (NDC) integration: search, order creation, payment, seat maps, ancillaries, order changes, cancellations/refunds, references, auth, and error handling.

## Overview

**There are three distinct Duffel client surfaces, and they are not consistent with each other:**

| Client | File | Used by |
|---|---|---|
| Backend service client (fullest) | [`backend/src/services/duffel.ts`](../backend/src/services/duffel.ts) | Backend orchestrator/search, `routes/book.ts`, provider-adapter (post-booking mgmt) |
| Frontend/Next lib client | [`src/lib/providers/duffel.ts`](../src/lib/providers/duffel.ts) | Next API routes: `validate-offer`, `seats/seat-map`, `ancillaries` |
| Inline client in checkout | [`src/app/api/checkout/bookings/confirm/route.ts`](../src/app/api/checkout/bookings/confirm/route.ts) L34-64 | **The real production checkout/booking** |

> **Key fact:** the production booking path (`checkout/bookings/confirm`) re-implements `duffelRequest` inline and does **not** import either shared client — so it bypasses `backend/src/services/duffel.ts::createBooking` and its retry logic.

HTTP conventions (all clients): base `DUFFEL_API_URL` (default `https://api.duffel.com`); headers `Authorization: Bearer ${DUFFEL_API_TOKEN}`, `Duffel-Version: v2`, `Accept: application/json`; request bodies wrapped as `{ data: <body> }`; responses unwrapped from `data.data`; `204` → `{}`.

## API operations

| Operation | HTTP | Endpoint | Location |
|---|---|---|---|
| Offer request (search) | POST | `/air/offer_requests?return_offers=true` | `duffel.ts:333`, `src/lib/providers/duffel.ts:347` |
| List offers (poll) | GET | `/air/offers?offer_request_id=…&limit=200&sort=total_amount` | `duffel.ts:382` |
| Get offer | GET | `/air/offers/{id}` (`?return_available_services=true` in frontend/checkout) | `duffel.ts:405`, `confirm/route.ts:557` |
| Create order | POST | `/air/orders` | `duffel.ts:485`, `confirm/route.ts:807` |
| Get order | GET | `/air/orders/{id}` | `duffel.ts:502` |
| Update order/passenger | PATCH | `/air/orders/{id}` | `duffel.ts:512`, `:651` |
| Seat maps | GET | `/air/seat_maps?offer_id=…` or `?order_id=…` | `duffel.ts:633`, `src/lib/providers/duffel.ts:652` |
| Order cancellation (quote) | POST | `/air/order_cancellations` | `duffel.ts:538`, `:607` |
| Confirm cancellation | POST | `/air/order_cancellations/{id}/actions/confirm` | `duffel.ts:545`, `:619` |
| Order change request | POST | `/air/order_change_requests` | `duffel.ts:725` (backend service only) |
| Get order change request | GET | `/air/order_change_requests/{id}` | `duffel.ts:745` |
| Create order change | POST | `/air/order_changes` | `duffel.ts:756` |
| Confirm order change | POST | `/air/order_changes/{id}/actions/confirm` | `duffel.ts:787` |
| Assistant client key | POST | `/components/client_keys` | `src/lib/duffel-assistant.ts:72` |

Ancillaries have no dedicated endpoint — they are read from the offer's `available_services` (`getOffer(...?return_available_services=true)`). Meals are `[]` for Duffel.

Not used anywhere: webhooks, `payment_intents`, `refunds`, `batch_offer_requests`. **Not confirmed from repository.**

## Search → UnifiedFlight normalization

`normalizeDuffelOffer` ([`normalizer.ts:20-119`](../backend/src/services/normalizer.ts#L20)), called from `orchestrator.ts:102` (`searchDuffel`):
- **Segments**: flatMap `slices[].segments[]`; airline from `marketing_carrier`; `flightNumber = iata + marketing_carrier_flight_number`; `operatingCarrier` only if different.
- **Duration**: sum of `parseDuration(slice.duration)` (ISO-8601 `PT#H#M`), fallback to arrival−departure delta.
- **Price**: `parseFloat(total_amount)`; `baseFare`/`taxAmount` from `base_amount`/`tax_amount`.
- **Stops**: `segments.length − slices.length` (clamped ≥0).
- **Cabin**: first segment `passengers[0].cabin_class`, lowercased.
- **Baggage**: carry_on/checked from segment passenger baggages, fallback offer-level; defaults carryOn=1, checked=0.
- **fareRules**: `refundable`/`changeable` from `conditions.refund_before_departure.allowed` / `change_before_departure.allowed`; fees from `penalty_amount`.
- Sets `provider:'duffel'`, `providerOfferId: offer.id`, `offerExpiresAt: offer.expires_at`, `fareClass` from `fare_brand_name`/`cabin_class_marketing_name`.

Search flow: `POST /air/offer_requests?return_offers=true`; if inline offers empty, polls `GET /air/offers` with delays `[2000,3000,5000]`ms (live airlines respond asynchronously). `searchDuffel` swallows errors into `ProviderResult.error` so one provider failing never breaks aggregation. Aggregation is append-only (no dedup).

Provider gating: `FLIGHT_PROVIDER_MODE` = `DUFFEL|MYSTIFLY|BOTH` (default BOTH); `isDuffelConfigured()` requires token present and not containing `your_token`.

## Order creation & payment (production checkout)

`confirm/route.ts` handles both providers; routes by offer-ID shape — **Duffel offer IDs start with `off_`** (L322-334). `isDuffel = !isMystifly`.

```mermaid
sequenceDiagram
    participant CR as confirm/route.ts
    participant DF as Duffel /air
    participant ST as Stripe
    CR->>DF: GET /air/offers/{id}?return_available_services=true (re-price)
    Note over CR: reject if expired (OFFER_EXPIRED); price-change guard (409)
    CR->>ST: PaymentIntent authorized (capture_method=manual) — verified requires_capture
    CR->>DF: POST /air/orders {selected_offers, passengers(pas_ IDs), type:'instant', payments:[{type:'balance', amount, currency}], services?}
    alt success
        DF-->>CR: order (booking_reference)
        CR->>ST: paymentIntents.capture()  ← AFTER order
    else failure
        CR->>ST: cancelStripeAuth (customer never charged)
        Note over CR: logBookingFailure → support ticket; 502 PROVIDER_ORDER_FAILED
    end
```

Key rules:
- Only `providerPayableTotal` (provider fare + seat fees) is sent to Duffel; markup/service-fee/insurance/protection are never sent.
- Passenger IDs must be the offer's pre-assigned `pas_...` IDs. Infant-aware count validation (`PASSENGER_COUNT_MISMATCH`); infants linked via `infant_passenger_id`.
- Phone normalized to E.164; Duffel fallback `+442080160509`.
- Order type is always `type:'instant'`, paid via `type:'balance'` (Duffel account balance).
- **Retry logic** (bespoke, L808-879): phone error → retry with fallback number → retry without services; seat-service error → retry without seats; else rethrow.
- **Capture ordering:** Duffel captures Stripe **AFTER** the order is created (contrast Mystifly, which captures before Book).

Simpler legacy path: [`src/app/api/book/route.ts`](../src/app/api/book/route.ts) calls `duffelClient.createBooking`; on failure falls back to a **mock PNR** with status PENDING.

## References

| Reference | Format | Stored as |
|---|---|---|
| Offer ID | `off_...` | `MasterBooking.providerOfferId` (also used for API routing) |
| Order ID | `ord_...` | `MasterBooking.providerOrderId` (required by Duffel Assistant) |
| Booking reference (airline PNR) | e.g. `ABC123` | `MasterBooking.masterPnr` |
| Passenger IDs | `pas_...` | must come from the offer |
| Service IDs | `ase_...` (available_services) | seat/ancillary at order creation |

## Cancellation / refund / void

Two-step everywhere: create cancellation (quote) → confirm. Duffel returns net `refund_amount` already net of penalties, so `penaltyAmount:0` and there is no separate void.
- Simple cancel: [`src/app/api/cancel/route.ts`](../src/app/api/cancel/route.ts) — for `DUFFEL` calls `cancelBooking` (both steps). On provider failure it **still cancels locally** (contrast Mystifly, which blocks).
- Admin approve flow → backend `manage-booking` `/cancel/quote` + `/cancel/confirm` via `DuffelAdapter` ([`provider-adapter.ts`](../backend/src/services/provider-adapter.ts)).
- Refund monitoring: `DuffelAdapter.getProviderRefundStatus` maps `payment_status.refund_status` → SETTLED/PENDING/PROCESSING/FAILED/REJECTED ("Duffel handles settlement internally").
- Post-booking seat selection: `supportsSeatSelection()` returns **false** — seats only at order creation. Order changes fully supported.

## Order changes

Backend service client only: `POST /air/order_change_requests` → `GET .../{id}` → `POST /air/order_changes` → confirm. Exposed via `DuffelAdapter.searchChangeOptions`/`confirmChangeOption`. `retries:0` on the paying steps.

## Auth / config / env

| Var | Purpose |
|---|---|
| `DUFFEL_API_TOKEN` | Bearer token; Test/Live detected by prefix `duffel_test_`/`duffel_live_` |
| `DUFFEL_API_URL` | Default `https://api.duffel.com` |
| `DUFFEL_ASSISTANT_ENABLED` | Feature flag for the Assistant (env-first, then `SystemConfig`) |
| `FLIGHT_PROVIDER_MODE` | `DUFFEL\|MYSTIFLY\|BOTH` |

Admin surface: `GET /api/admin/providers/duffel` (masks token, reports Test/Prod + provider mode), guarded by `withAdmin('OPS_ADMIN')`.

## Hold vs instant

**Only instant.** Every order payload hardcodes `type:'instant'` + `payments:[{type:'balance'}]`. No hold/pay-later order is created for Duffel. The offer's `payment_requirements.requires_instant_payment` is present but **never read/branched on**. See [HOLD_ALLOWED_ANALYSIS.md](./HOLD_ALLOWED_ANALYSIS.md).

## Error handling & retry

- `DuffelApiError`: `status`, `errorType`, `errors[]`, `requestId`; helpers `isRateLimit/isAuth/isNotFound/isValidation`.
- `duffelRequest` retry engine: default 2; 429 honors `retry-after`; auth/validation/not-found never retried; 5xx/network → exponential backoff. Per-call overrides: search `1`; order create/cancel-confirm/order-change `0` ("never retry a payment"); seat maps `1`.
- The checkout inline client has **no generic retry** and its own `DuffelBookingError` preserving `errors[].title/code/source.pointer` for field-level messages; failures audited via `logBookingFailure` (opens a support ticket).
- Route-level graceful degradation: `validate-offer` maps not-found→unavailable, auth→502; `seats/seat-map` returns empty maps on error; `ancillaries` returns empty arrays; `book` falls back to mock PNR.

## Known issues / limitations

- **Three divergent clients**; production booking bypasses the shared client and its retry logic.
- `createBooking` service signatures differ (backend takes wheelchair SSR `services`; frontend lib takes `{id,quantity}` selectedServices); the real checkout uses neither.
- Cancel-on-provider-failure behavior differs from Mystifly (Duffel proceeds locally; Mystifly blocks).

## Future enhancements

- Consolidate to a single Duffel client with shared retry/error handling.
- Consider reading `requires_instant_payment` to support Duffel hold orders if the product needs it.

## Related docs

[MYSTIFLY_BOOKING_FLOW.md](./MYSTIFLY_BOOKING_FLOW.md) · [BOOKING_LIFECYCLE.md](./BOOKING_LIFECYCLE.md) · [PAYMENT_FLOW.md](./PAYMENT_FLOW.md) · [HOLD_ALLOWED_ANALYSIS.md](./HOLD_ALLOWED_ANALYSIS.md)
