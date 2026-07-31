-- ═══════════════════════════════════════════════════════════════════════════
-- Add MasterBooking.bookingSource  (2026-08-01)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Records which surface produced a booking. `created_by_role` only ever captured
-- agent ownership — it is written inside the agent branch of the checkout confirm
-- route — so customer and AI-assisted bookings both left it NULL and were
-- indistinguishable from each other. That is why the AI-bot markup gap could only be
-- inferred from a NULL rather than seen directly.
--
-- WHY RAW SQL RATHER THAN `prisma migrate deploy` / `db push`:
-- `prisma migrate diff` against production also emits three unrelated statements —
--     ALTER TABLE "agent_wallets"    ALTER COLUMN "updated_at" DROP DEFAULT;
--     ALTER TABLE "payment_requests" ALTER COLUMN "updated_at" DROP DEFAULT;
--     ALTER TABLE "schedule_changes" ALTER COLUMN "updated_at" DROP DEFAULT;
-- Those are pre-existing drift: production has now() defaults on those columns that
-- schema.prisma does not declare (Prisma's @updatedAt emits no DB default). Running the
-- generated migration would drop them as collateral. They are deliberately NOT included
-- here — that drift should be resolved on its own terms, not as a side effect.
--
-- Safety: both statements are additive. The new column is nullable with no default, so
-- no table rewrite and no impact on existing rows or on code that does not know about it.

BEGIN;

CREATE TYPE "BookingSource" AS ENUM (
  'CUSTOMER_WEB',
  'AGENT_PORTAL',
  'AI_ASSISTANT',
  'LIMIT_ORDER',
  'ADMIN',
  'UNKNOWN'
);

ALTER TABLE "master_bookings" ADD COLUMN "booking_source" "BookingSource";

-- Backfill what can be established from evidence. Rows with created_by_role='AGENT'
-- are unambiguous. Everything else stays UNKNOWN: a NULL created_by_role could be a
-- customer or an AI-assisted booking and there is no stored signal that separates
-- them, which is precisely the gap this column closes going forward. Guessing here
-- would manufacture data that was never recorded.
UPDATE "master_bookings"
   SET "booking_source" = 'AGENT_PORTAL'
 WHERE "created_by_role" = 'AGENT';

UPDATE "master_bookings"
   SET "booking_source" = 'UNKNOWN'
 WHERE "booking_source" IS NULL;

COMMIT;
