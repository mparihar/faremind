# ADMIN_PORTAL.md

> Derived from repository source. Unconfirmed items marked **Not confirmed from repository.**

## Purpose

Document the Admin portal and the internal Agent platform: features, authentication, and RBAC.

## Overview

Two internal consoles share the codebase:
- **Admin portal** (`/admin/*`, API `/api/admin/*`) — OTP + JWT-cookie auth, 5-tier RBAC. For FareMind staff (ops, finance, support).
- **Agent platform** (`/agent/*`, API `/api/agent/*`) — reuses the **end-user** session, gated on `role === 'FAREMIND_AGENT'`. For travel agents servicing bookings.

## Admin portal

Client guard: [`src/app/admin/layout.tsx`](../src/app/admin/layout.tsx) calls `adminFetch('/api/admin/auth/me')`, redirects to `/admin/login` if unauthenticated, and enforces a 15-minute inactivity logout.

### Modules (`src/app/admin/*`)

| Module | Pages |
|---|---|
| Dashboard | `/admin/dashboard` — stats, revenue, pending work, alerts |
| Bookings | `/admin/bookings`, `/admin/bookings/[id]` (timeline, journey, passengers, tickets, seats, meals, addons, payments, payloads, notes, audit) |
| Customers | `/admin/customers` |
| Finance | `/admin/finance`, `/finance/ledger`, `/finance/payments`, `/finance/service-payments` |
| Commercial | `/admin/commercial-settings` + `benefits`, `insurance-products`, `platform-fees`, `protection-products` (CRUD) |
| Partners | `/admin/partners` |
| Providers | `/admin/providers` + `duffel`, `mystifly` (config/health/test) |
| Reports | `/admin/reports` |
| Support | `/admin/support-queue` + `[ticketId]` |
| Operations | `/admin/operations` + `provider-errors`, `ticket-queue` |
| Fare management | `/admin/fare-management` |
| System | `/admin/system/feature-flags`, `/admin/settings`, `/admin/ai-settings` (Travel DNA config) |
| Audit | `/admin/audit-logs` |
| Admin users | `/admin/admin-users` |
| Other | `/admin/email-history`, `/admin/failed-bookings`, `/admin/duffel-assistant`, `/admin/limit-orders` (+ `notifications`, `settings`) |

### Authentication

- Login: email → `send-otp` → `verify-otp`. OTP is 6-digit, SHA-256 hashed, 5-min expiry, max 5 attempts, rate-limited 3/min. A **master OTP `778899`** bypass exists ([`admin-auth.ts`](../src/lib/admin-auth.ts)).
- On verify: `jose` HS256 JWT signed with `ADMIN_JWT_SECRET` (8h), stored in **HttpOnly cookie `admin_token`**, backed by an `AdminSession` row; sliding 15-min inactivity window.
- Passwords: bcrypt (rounds 12) helpers exist, but the login path is OTP.
- Every admin API wrapped by `withAdmin(handler, minRole)` ([`admin-rbac.ts`](../src/lib/admin-rbac.ts)); cookie preferred, Bearer fallback.

### RBAC roles

Ranked (`admin-rbac.ts`): `SUPER_ADMIN`(5) > `OPS_ADMIN`(4) > `FINANCE`(3) > `SUPPORT`(2) > `READ_ONLY`(1). `hasRole` = rank ≥ required.

| Capability | Min role |
|---|---|
| Reads / dashboard / bookings list | READ_ONLY |
| Support tickets / customers / operations / email | SUPPORT |
| Booking mutations / commercial writes / providers / fare-mgmt / system-config | OPS_ADMIN |
| Finance / reports | FINANCE |
| Admin-user CRUD / deletes / feature-flag deletes / audit-log purge | SUPER_ADMIN |

`AdminUser`/`AdminOtp`/`AdminSession` models back this (see [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)).

## Agent platform

Guard: [`src/app/agent/layout.tsx`](../src/app/agent/layout.tsx) requires a `useAuthStore` user with `role === 'FAREMIND_AGENT'`. API guard `withAgent()` ([`agent-auth.ts`](../src/lib/agent-auth.ts)) validates the Bearer session against `Session`, enforces the role + `isActive` + 15-min inactivity.

Pages (`src/app/agent/*`): `dashboard`, `booking-workspace` (tabbed servicing), `new-booking`, `bookings` + `[fbr]`, `post-booking` (Mystifly void/refund/reissue), `cancellations`, `refunds` + `[bookingId]`, `customer/[id]`, `passenger-updates`, `make-payment`, `limit-orders`, `notifications`, `profile`, `support`/`support-tickets` + `[ticketId]`, `ticket-queue`, `duffel-assistant`.

Agent API (`/api/agent/*`, all via `withAgent`): `dashboard`, `bookings`, `bookings/[fbr]`, `bookings/[fbr]/provider-support/duffel-assistant`, `booking-workspace/lookup`, `customer/[id]`, `passenger-update`, `resend-itinerary`, `support-tickets`, `ticket-queue`, `mystifly-ptr/records`.

## Support & ERBUK082 tracking

ERBUK082 pendings appear in the support queue (`SupportTicket` `category:'ERBUK082'`, `queue:'TICKETING_PENDING_QUEUE'`), updated by the reconciliation worker until ISSUED or NOT_BOOKED. Cancellation/refund tickets use the `CANCELLATION_SUPPORT` / `REFUND_RECONCILIATION_QUEUE` queues. See [TICKETING_FLOW.md](./TICKETING_FLOW.md) and [PAYMENT_FLOW.md](./PAYMENT_FLOW.md).

## Provider support (Duffel Assistant)
Admin/agent can open a Duffel Assistant session (`POST /components/client_keys`) for Duffel bookings with a `providerOrderId`; gated by `DUFFEL_ASSISTANT_ENABLED` and RBAC; audit action `DUFFEL_ASSISTANT_OPENED`.

## Known issues / limitations
- Master OTP `778899` bypass exists in both admin and backend auth — **operational risk**; ensure disabled/rotated in production. **Not confirmed** whether it is gated by environment.
- Agent platform has no dedicated auth store — relies on the user session with a role check.

## Future enhancements
- Remove/environment-gate the master OTP.
- Consider a dedicated agent auth/session separate from end users.

## Related docs
[API_REFERENCE.md](./API_REFERENCE.md) · [FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md) · [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) · [TICKETING_FLOW.md](./TICKETING_FLOW.md)
