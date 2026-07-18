---
name: cancellation-flow
description: FareMind ticket cancellation flow — Void Quote → Refund Quote → Confirm → Execute with idempotency, expiry checks, and support ticket escalation.
---

# Cancellation Flow Rules

## Decision Flow
1. Always attempt **Void Quote before Refund Quote**
2. Customers see one action: **Cancel Booking** — backend decides void vs refund
3. Do NOT call both Void and Refund for the same ticket

## Void Path
- Call VoidQuote PTR → if eligible → show breakdown → confirm → execute Void
- Status: VOIDED

## Refund Path (when void unavailable)
- Call RefundQuote PTR → show breakdown → confirm → execute Refund
- Customer Refund = Provider Refund Amount - FareMind Cancellation Fee
- Status: REFUND_REQUESTED → REFUNDED

## Implementation Rules
- Use idempotency locks to prevent duplicate cancellation or refund
- Revalidate the quote immediately before execution (check expiresAt)
- If the quote expires, retrieve a new quote
- Never mark a booking refunded until the provider confirms it
- On failure, create a support ticket with: booking reference, provider PNR, ticket numbers, quoteId, provider response, and failure stage

## Files
- **Provider adapter**: `backend/src/services/provider-adapter.ts` (getCancellationQuote, confirmCancellation)
- **Route**: `backend/src/routes/manage-booking.ts` (cancel/quote, cancel/confirm)
- **Mystifly PTR**: `backend/src/services/mystifly.ts` (voidQuote, executeVoid, refundQuote, executeRefund)
- **Frontend modal**: `src/components/manage-booking/CancelBookingModal.tsx`
- **Frontend store**: `src/store/useManageBookingStore.ts` (loadCancelQuote, confirmCancel)
