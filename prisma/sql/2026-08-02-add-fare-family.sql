-- Fare family: store the airline's own brand, never a FareMind-invented name.
--
-- airline_fare_family  — provider value verbatim ("ECO VALUE", "DELTA MAIN
--                        BASIC", "INDIGO UPFRONT"). Customer-facing.
-- normalized_fare_tier — internal tier (BASIC|STANDARD|FLEX|PREMIUM|BUSINESS|
--                        FIRST) for filters/analytics. Never displayed.
-- booking_class        — RBD at time of booking.
--
-- All nullable and additive: existing rows keep working, and bookings taken
-- before this deploy simply have no family recorded.

ALTER TABLE "master_bookings"
  ADD COLUMN IF NOT EXISTS "airline_fare_family"  TEXT,
  ADD COLUMN IF NOT EXISTS "normalized_fare_tier" TEXT,
  ADD COLUMN IF NOT EXISTS "booking_class"        TEXT;

-- Analytics and filters query by tier, not by brand.
CREATE INDEX IF NOT EXISTS "master_bookings_normalized_fare_tier_idx"
  ON "master_bookings" ("normalized_fare_tier");
