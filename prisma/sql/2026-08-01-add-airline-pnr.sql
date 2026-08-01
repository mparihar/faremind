-- Airline PNR — the AIRLINE's own record locator, kept separate from Mystifly's.
--
-- Three identifiers, three purposes, never interchangeable:
--   master_booking_reference  FM9IPA4E     FareMind support + internal lookup
--   master_pnr / mystifly_mf_ref  MF35532626  Mystifly servicing APIs
--   airline_pnr               EMBV6D7      airline check-in, airline support
--
-- The platform was showing master_pnr under the "Airline PNR" label, which
-- sends customers to the airline with a code the airline does not recognise.
-- The real value sits in TripDetails at ReservationItems[].AirlinePNR and was
-- not stored anywhere.
--
-- booking_pnrs.airline_pnr is per-row so multi-airline and codeshare bookings
-- keep each carrier's locator instead of one overwriting another.
--
-- Both columns are nullable and additive. Bookings with no airline PNR
-- available must render "Not Available" — never fall back to the Mystifly ref.

ALTER TABLE "master_bookings"
  ADD COLUMN IF NOT EXISTS "airline_pnr" TEXT;

ALTER TABLE "booking_pnrs"
  ADD COLUMN IF NOT EXISTS "airline_pnr" TEXT;

-- Agents and support look bookings up by the locator a customer reads out.
CREATE INDEX IF NOT EXISTS "master_bookings_airline_pnr_idx"
  ON "master_bookings" ("airline_pnr");
