# API_REFERENCE.md

> Derived from repository source (route files + exported HTTP methods + RBAC wrappers). Unconfirmed items marked **Not confirmed from repository.**

## Purpose

A consolidated reference of all HTTP endpoints across the two API surfaces:
1. **Next.js API routes** — `src/app/api/*` (proxy to Fastify and/or talk to Prisma directly).
2. **Fastify backend routes** — `backend/src/routes/*` (prefixes from [`backend/src/index.ts`](../backend/src/index.ts) L134-158).

Many domains exist in both surfaces (auth, search, notifications, limit-orders, manage-booking): the Next.js route often proxies to Fastify.

## Fastify backend routes

| Prefix | Endpoints (method path) | Purpose |
|---|---|---|
| `/api/health` | GET `/` | DB + provider status, record counts |
| `/api/search` | GET `/` | Orchestrator search + AI scoring + cache + limit-order matching |
| `/api/book` | POST `/` | Duffel order + persist |
| `/api/bookings` | GET `/`, GET `/:id` | Booking reads |
| `/api/cancel` | POST `/` | Multi-provider cancel + ledger + notify |
| `/api/auth` | POST `/check-user`, `/send-otp`, `/register`, `/verify-otp`, `/resend-otp`; GET `/validate-session`; DELETE `/session` | OTP auth via Brevo, Turnstile, master OTP `778899` for `mparihar@gmail.com` |
| `/api/airports` | GET `/` | Airport lookup |
| `/api/notifications` | GET `/`, PATCH `/`, POST `/event`,`/send`,`/resend`; GET `/status/:id`,`/booking/:id` | Notifications (proxy helper + in-process fire) |
| `/api/price-check` | GET `/`, POST `/` | Price tracking |
| `/api/price-monitor` | POST `/` | Cron trigger (`x-cron-secret`) |
| `/api/search-history` | GET `/` | Search history |
| `/api/popular-routes` | GET `/` | Popular routes |
| `/api/flexible-search` | GET `/` | 12-month price tiles |
| `/api/fares` | GET `/options`, POST `/compute-ai-score` | Fare families + fare AI scoring |
| `/api/price-protection` | GET `/quote` | CFAR/protection quote |
| `/api/booking-session` | POST `/select-fare`,`/recalculate`,`/offer-session/start`,`/offer-session/:id/expire`,`/offer-session/:id/booked`; GET `/offer-session/:id/status` | Offer/fare hold session |
| `/api/checkout` | POST `/passengers/save`,`/passengers/lookup-by-email`,`/passengers/lookup-by-name`,`/seats/select`,`/meals/select`,`/baggage/select`,`/protection/select`,`/pricing/recalculate`,`/notifications/booking-confirm`; GET `/seats/map` | Checkout steps |
| `/api/manage-booking` | POST `/lookup`,`/lookup/send-otp`,`/lookup/verify-otp`,`/:id/cancel/quote`,`/:id/cancel/confirm`,`/:id/seats/select`,`/:id/passenger/update`,`/:id/change/search`,`/:id/change/confirm`,`/:id/change/request`,`/:id/email-itinerary`,`/:id/baggage/add`,`/admin/:id/note`; GET `/user/:userId/bookings`,`/:id`,`/:id/actions`,`/:id/seats/:sliceId`,`/:id/capabilities`,`/:id/eticket`,`/:id/timeline`,`/admin/queue`,`/admin/:id/notes`,`/admin/:id/payloads` | Post-booking servicing |
| `/api/voice` | POST `/parse-command` | GPT-4o-mini transcript → action |
| `/api/admin/notification-recipients` | GET `/`, POST `/`, PUT `/:id`, DELETE `/:id` | Notification recipient config |
| `/api/mystifly` | POST `/revalidate`,`/book`,`/order-ticket`,`/cancel`,`/ticket-status`,`/trip-details`,`/fare-rules`,`/seat-map`,`/booking-notes`,`/ancillary-services`,`/ancillary-confirm` | Mystifly proxy |
| `/api/mystifly-ptr` | POST `/void-quote`,`/void`,`/refund-quote`,`/refund`,`/reissue-quote`,`/reissue`,`/status`,`/mark-read` | Mystifly post-ticketing |
| `/api/ranking` | (plugin `backend/src/ranking/route`) | Ranking + GPT explanation. **Methods not read — Not confirmed** |
| `/api/limit-orders` | POST `/`, GET `/`, GET `/:id`, PUT `/:id`, POST `/:id/activate\|pause\|resume\|cancel\|authorize-payment\|passengers`, GET `/:id/matches\|events\|saved-travelers`, GET `/admin/stats`, GET+PUT `/admin/notification-config` | Limit orders (auto-booking) |
| `/api/admin/cancellation-queue` | GET `/`, POST `/:refundId/actions`, GET `/:refundId/checks`, GET `/stats` | Refund reconciliation queue |

## Next.js API routes (`src/app/api/*`)

### Auth & user
`/auth/login` POST (password → 7-day session) · `/auth/signup` POST · `/auth/profile` GET/PUT.

### AI
`/ai/dna-search` POST (Travel-DNA LLM ranking) · `/ai/general-query` POST (FAQ chatbot) · `/ai/intent-engine` POST (intent/weight re-rank) · `/ai/search-assist` POST (NL Q&A over offers).

### Search & fares
`/search` GET · `/flexible-search` GET · `/search-history` GET · `/popular-routes` GET · `/price-check` GET+POST · `/price-monitor` POST · `/flex-prices` GET, `/flex-prices/clear` POST · `/flights/validate-offer` POST (Duffel re-validate + markup).

### Checkout & booking
`/book` POST · `/cancel` POST · `/bookings` GET · `/bookings/[id]` GET · `/booking-session/[...path]` GET/POST/PUT/PATCH/DELETE (catch-all proxy) · `/checkout/bookings/confirm` POST · `/checkout/bookings/pre-revalidate` POST · `/checkout/payment/create-intent` POST · `/checkout/payment/confirm` POST.

### Payments
`/payment-methods` GET+POST · `/payment-methods/[id]` DELETE · `/payment-methods/[id]/default` PATCH · `/payment-methods/setup-intent` POST · `/service-payments` POST+GET · `/service-payments/confirm` POST.

### Limit orders (proxies)
`/limit-orders` GET+POST · `/limit-orders/[id]` GET+PUT · `/limit-orders/[id]/[action]` GET+POST.

### Support
`/support-tickets` POST · `/support/case` POST · `/support/urgent-whatsapp-case` POST · `/user/support-tickets` GET · `/user/support-tickets/[id]` GET · `/user/refunds` GET.

### Travel DNA
`/travel-dna/me` GET · `/travel-dna/feedback` POST · `/travel-dna/recommendation-context` GET · `/dna-search-config` GET.

### Ancillaries / config / misc
`/notifications` GET+PATCH · `/airports` GET · `/ancillaries` GET · `/meals` GET · `/seats/seat-map` GET · `/seats/recommendations` POST · `/fees/compute` POST · `/benefits-config` GET · `/pricing-config` GET · `/config/ai-recommendation-limit` GET · `/config/offer-expiry` GET · `/manage-booking/email-itinerary` POST · `/health` GET.

### Admin API (`/api/admin/*`, all via `withAdmin`; min-role in parens)
- **Auth:** `auth/send-otp` POST, `auth/verify-otp` POST, `auth/resend-otp` POST, `auth/logout` POST, `auth/me` GET, `check-access` GET (public).
- **Core:** `dashboard` GET(READ_ONLY); `audit-logs` GET(SUPPORT)+DELETE(SUPER_ADMIN); `cleanup-stale-pending` POST(OPS_ADMIN).
- **Bookings:** `bookings` GET(READ_ONLY); `bookings/[id]` GET(READ_ONLY)+PATCH+DELETE(OPS_ADMIN); `bookings/[id]/full-details` GET; `.../cancel-action` POST; `.../notes` POST(SUPPORT) + `notes/[noteId]` PATCH+DELETE(SUPPORT); `.../references` POST + `[refId]` DELETE(OPS_ADMIN); `.../passengers/[paxId]`, `.../seats/[seatId]`, `.../meals/[mealId]` PATCH+DELETE(OPS_ADMIN); `.../addons/[addonId]`, `.../payloads/[payloadId]` DELETE(OPS_ADMIN); `.../audit-logs` GET(SUPPORT); `.../provider-support/duffel-assistant` POST(SUPPORT).
- **Customers:** `customers` GET(SUPPORT); `customers/[userId]` GET(SUPPORT)+PATCH(OPS_ADMIN)+DELETE(SUPER_ADMIN).
- **Finance:** `finance`, `finance/ledger`, `finance/payments` GET(FINANCE); `service-payments` GET(SUPPORT).
- **Commercial:** `commercial/insurance-products`, `platform-fees`, `protection-products` — GET(READ_ONLY)+POST(OPS_ADMIN); `[id]` GET(READ_ONLY)+PUT(OPS_ADMIN)+DELETE(SUPER_ADMIN).
- **Partners/Reports:** `partners` GET(READ_ONLY)+POST(OPS_ADMIN); `reports` GET(FINANCE).
- **Providers:** `providers/duffel`, `providers/mystifly` GET(OPS_ADMIN); `providers/mystifly/test` POST(OPS_ADMIN); `providers/health` GET(SUPPORT).
- **Operations:** `operations/stats`, `operations/provider-errors` GET(SUPPORT); `operations/ticket-queue` GET+POST(SUPPORT) + `/retry`,`/resolve` POST(SUPPORT).
- **Config/system:** `fare-management` GET(SUPPORT)+POST(OPS_ADMIN) + `[id]` PUT+DELETE(OPS_ADMIN); `system-config` GET+PUT(OPS_ADMIN); `system/feature-flags` GET+POST+PATCH(OPS_ADMIN)/DELETE+create(SUPER_ADMIN); `travel-dna/config` GET+PUT(OPS_ADMIN).
- **Users/support:** `users` GET+POST(SUPER_ADMIN) + `[adminId]` GET+PATCH+DELETE(SUPER_ADMIN); `notification-recipients` GET+POST + `[id]` PUT+DELETE (proxy); `support-tickets` GET+POST(SUPPORT)+DELETE(SUPER_ADMIN) + `[id]` GET+PATCH(SUPPORT)+DELETE(SUPER_ADMIN) + `[id]/messages` POST(SUPPORT); `email-history` GET(SUPPORT)+DELETE(SUPER_ADMIN) + `[id]` DELETE(SUPER_ADMIN); `failed-bookings` GET(SUPPORT) + `[id]` PATCH(SUPPORT)+DELETE(SUPER_ADMIN).

### Agent API (`/api/agent/*`, all via `withAgent`)
`dashboard` GET · `bookings` GET · `bookings/[fbr]` GET · `bookings/[fbr]/provider-support/duffel-assistant` POST · `booking-workspace/lookup` GET · `customer/[id]` GET · `passenger-update` POST · `resend-itinerary` POST · `support-tickets` GET · `ticket-queue` GET · `mystifly-ptr/records` GET.

## Conventions
- Auth: end-user Bearer session token; admin `admin_token` HttpOnly cookie (JWT); agent user Bearer + role check.
- Rate limiting applied by URL-prefix category (see [BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md#rate-limiting-librate-limitts)).
- Errors: JSON `{ success:false, code, error }`.

## Known issues / limitations
- `/api/ranking` methods not read — **Not confirmed from repository.**
- Admin/agent Next.js route purposes are derived from path + method + RBAC (methods/roles confirmed via grep; a subset read directly).
- Duplicate surfaces (Next.js vs Fastify) can drift.

## Related docs
[BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md) · [ADMIN_PORTAL.md](./ADMIN_PORTAL.md) · [FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md)
