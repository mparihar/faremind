# FRONTEND_ARCHITECTURE.md

> Derived from repository source. Unconfirmed items marked **Not confirmed from repository.**

## Purpose

Document the Next.js 16 App Router frontend: route map, state management (Zustand), the checkout wizard, and how the frontend talks to the backend.

## Overview

- **Framework:** Next.js `16.2.4` (App Router), React `19.2.4`, Tailwind CSS 4, Framer Motion, MapLibre/react-map-gl. `next.config.ts` sets `reactStrictMode:false` and `typescript.ignoreBuildErrors:true`.
- **Backend calls:** [`src/lib/api-client.ts`](../src/lib/api-client.ts) `apiUrl()` uses `NEXT_PUBLIC_API_URL` to reach Fastify; `apiFetch` auto-logs-out on 401. Without `NEXT_PUBLIC_API_URL`, calls fall back to Next.js API routes (many routes exist in both surfaces).
- **Root layout:** [`src/app/layout.tsx`](../src/app/layout.tsx) wraps the app in `ClientShell`.
- **AGENTS.md rule:** this Next.js version "is NOT the Next.js you know" — read `node_modules/next/dist/docs/` before writing App Router code.

## Route map (user-facing)

Public / funnel:
- `/` — AI flight-search hero (SearchForm, smart-preferences, live route prices).
- `/auth/login`, `/auth/signup` — passwordless email + 6-box OTP.
- `/search` — results (flight/round-trip cards, filters, map, AI scoring, Travel DNA ranking).
- `/fare-selection` — cabin/fare cards, AI recommendation chips, price-protection quotes.
- `/booking` — legacy single-page booking flow (Stripe).
- `/dashboard` — user dashboard (upcoming bookings, price tracking, alerts, stats).
- `/travel-dna` — redirect → `/account/travel-dna`.
- `/support` — FAQ, contact, WhatsApp urgent support.
- `/manage-booking`, `/manage-booking/[bookingId]` — guest lookup (ref + email/OTP) + management.

Checkout wizard ([`src/app/checkout/*`](../src/app/checkout/)):
`itinerary` (step 0, offer-expiry timer, builds `alternateFares`) → `passengers` → `seats` → `meals` → `addons` (baggage/insurance/CFAR/ancillaries) → `review` → `payment` (Stripe, Mystifly pre-revalidate) → `confirm` (success/PNR).

Account area ([`src/app/account/*`](../src/app/account/), guarded by `account/layout.tsx`): `/account` hub, `profile`, `bookings` + `[ref]`, `alerts`, `limit-orders` (+ `create`, `[id]`), `make-payment`, `manage-booking`, `notifications`, `payment-methods`, `refunds` (+ `[bookingId]`), `support` (+ `[ticketId]`), `travel-dna`, `admin/notifications` (admin-only).

Admin (`/admin/*`) and Agent (`/agent/*`) areas — see [ADMIN_PORTAL.md](./ADMIN_PORTAL.md).

## State management (Zustand, `src/store/*`)

| Store | Purpose | Persistence |
|---|---|---|
| `useAdminStore` | Admin user + `adminFetch()` (cookie auth, 401→`/admin/login`) | `persist` (`faremind-admin`, only `user`) |
| `useAuthStore` | End-user OTP session (`user`, `sessionToken`); verify/logout/loadSession | manual `localStorage faremind_session` |
| `useAiBookingStore` | Multi-step AI booking (flight, fare, passengers, seats/meals, addons, pricing); `hydrateCheckoutStore()` | no |
| `useBookingStore` | Legacy single-pax booking flow | no |
| `useCheckoutStore` | Full checkout state (passengers, seatSelections, meals, ancillaries, pricing, paymentIntentId, confirmation); `initFromStores` reads `sessionStorage fm_fare_context` | no |
| `useFareStore` | Fare-selection page (payload, selectedFareId, activeCabin, protectionQuote) | no |
| `useManageBookingStore` | Manage-booking: lookup/OTP, list/detail, cancel quotes, seat maps, timeline, e-tickets, changes | no |
| `useOfferSessionStore` | Offer/fare-hold expiry countdown (IDLE/ACTIVE/WARNING/EXPIRED) | manual `sessionStorage faremind_offer_session` |
| `usePreferencesStore` | Smart-search prefs (budget, maxDuration, stops, departureWindow, sort, aiIntelligence, dnaSearchActive); `toQueryParams()` | no |
| `useSearchStore` | Search query/results, filters, sort; `getFilteredResults()` | no |
| `useTravelDnaStore` | Travel DNA profile + feedback | no |
| `useVoiceStore` | Voice-assistant → SearchForm bridge | no |

Only `useAdminStore` uses `persist`; auth/offer do manual browser storage.

## Checkout data flow

The `alternateFares` array (fareSourceCode, cabin, refundable, changeable, totalPrice, checkedBags) is built on the itinerary page from sibling fare options and threaded through `useCheckoutStore` to the payment page, which sends it to `/api/checkout/bookings/confirm` for Mystifly same-product ERBUK082 recovery. See [MYSTIFLY_BOOKING_FLOW.md](./MYSTIFLY_BOOKING_FLOW.md#alternate-fsc-recovery-same-product-matching).

## Authentication (frontend)

- **End user:** OTP (check-user → send-otp → verify-otp) yields a 32-byte DB session token in `localStorage faremind_session`, sent as `Bearer`. A password login also exists (`/api/auth/login`, 7-day session). 15-min inactivity timeout; `apiFetch` auto-logout on 401.
- **Admin:** OTP → `jose` HS256 JWT in HttpOnly `admin_token` cookie (8h), sliding 15-min inactivity.
- **Agent:** reuses the user session; guarded by `role === 'FAREMIND_AGENT'`.

Details in [ADMIN_PORTAL.md](./ADMIN_PORTAL.md#authentication).

## AI-assisted features (frontend-facing)
- Travel-DNA search (`/api/ai/dna-search`), general chatbot (`/api/ai/general-query`), intent engine (`/api/ai/intent-engine`), search-assist (`/api/ai/search-assist`), voice command (`/api/voice/parse-command`). All are LLM-backed (OpenAI); ranking uses GPT only for explanations, never re-ranking.

## Known issues / limitations
- `typescript.ignoreBuildErrors:true` — type errors don't block the build (runtime-safe but hides regressions).
- Duplicate API surfaces (Next.js routes vs Fastify) for auth/search/notifications/limit-orders/manage-booking.
- Legacy `/booking` flow coexists with the newer `/checkout` wizard.

## Future enhancements
- Remove type-error suppression once the build is clean.
- Deprecate the legacy `/booking` flow in favor of `/checkout`.

## Related docs
[ADMIN_PORTAL.md](./ADMIN_PORTAL.md) · [API_REFERENCE.md](./API_REFERENCE.md) · [BOOKING_LIFECYCLE.md](./BOOKING_LIFECYCLE.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)
