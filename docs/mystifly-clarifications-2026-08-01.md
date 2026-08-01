# Mystifly — API clarifications

**To:** Mystifly API Support
**From:** FareMind Engineering
**Account:** MCN006482 · user `FareMind_API`
**Environment:** `https://restapidemo.myfarebox.com` · `Target: Test`
**Date:** 1 August 2026

Hello,

We are completing integration certification and have six items where we need
your confirmation. Two are blocking; the rest are contract questions where we
are currently relying on observed behaviour.

---

## 1. `AncillaryServiceRequest` returns a server error for every request — BLOCKING

`POST /api/AncillaryServiceRequest` returns HTTP 200 with:

```json
{ "Data": null, "Success": false,
  "Message": "Invalid URI: The format of the URI could not be determined." }
```

We get the identical message for **every** input, including a deliberately
invalid and an empty `MFRef`:

| Request | Response |
|---|---|
| `{"MFRef":"MF35532626","isBaggage":true,"isMeal":true,"isSeatMap":false}` | Invalid URI |
| `{"MFRef":"MF35532626","isBaggage":true}` | Invalid URI |
| `{"MFRef":"MF00000000","isBaggage":true}` | Invalid URI |
| `{"MFRef":"","isBaggage":true}` | Invalid URI |
| all flags `false` | Invalid URI |

Because an empty and an invalid `MFRef` fail identically to a valid one, the
request does not appear to reach validation. `GET /api/TripDetails/MF35532626`
succeeds in the same session, so the booking, session and credentials are fine.

**Impact:** paid add-on baggage and post-booking seat selection are unavailable.

**Please confirm:** whether this endpoint is enabled for our account on the demo
environment, and whether the payload above matches what you expect.

---

## 2. `SeatMap/Flight` returns no seat map — BLOCKING for seat selection

With a **search** `FareSourceCode` we get:

```
ERBUK018  FareSourceCode is either expired or does not exist
ERSEM014  API version mismatch - Invalid FareSourceCode.
```

With a **revalidated** `FareSourceCode` the errors disappear and we get a clean:

```json
{ "Success": false, "Message": "No Result for Seat Map", "Errors": [], "SeatMaps": [] }
```

We now revalidate before every seat-map call, which we believe is correct.

**Please confirm:** (a) that a revalidated FSC is the required input, and
(b) whether seat maps are simply unavailable for these fares on the demo
environment, or whether something else is needed. We have not been able to
obtain a populated `SeatMaps[]` for any fare or carrier we tried.

---

## 3. `AirlinePNR` and `ETicketNumber` return the same value

For booking `MF35532626`:

```
ReservationItems[].AirlinePNR             = "EMBV6D7"
PassengerInfos[].ETickets[].ETicketNumber = "EMBV6D7"
ETickets[].ETicketType                    = "Ticketed"
ReservationItems[].ETicketNumber          = ""   (empty)
```

We treat `ReservationItems[].AirlinePNR` as the airline record locator shown to
the customer for check-in, and keep it distinct from your `MFRef`.

**Please confirm:** that this is correct, and whether a genuine e-ticket document
number (e.g. `312-1234567890`) is returned anywhere — we have not seen one on any
booking, so we currently have no ticket number to store per passenger.

---

## 4. TripDetails response is not described in the API documentation

`https://restapidemo.myfarebox.com/api/docs/v1/swagger.json` declares every
TripDetails response as `200: Success` with no schema. Across the whole
specification, **1 of 221 responses defines a response schema**, and there is no
`TravelItinerary` or `ReservationItems` model.

Our parsing of TripDetails is therefore based on observed payloads rather than
your published contract.

**Please share** a response schema or sample for `GET /api/TripDetails/{MFRef}`,
so we can rely on documented field names instead of inference.

---

## 5. `PenaltiesInfoList` is largely unpopulated in search, and contradicts TripDetails

On DEL–BOM (20 Nov / 5 Dec 2026, 1 ADT, `RequestOptions: Thousand`,
`PricingSourceType: All`), 1000 itineraries resolved to three penalty records:

| Ref | RefundAllowed | RefundPenaltyAmount | ChangeAllowed | Currency | Itineraries |
|---|---|---|---|---|---|
| 0 | true | 5000 | true | INR | 50 |
| 1 | **false** | `""` | **false** | `""` | **900** |
| 2 | true | 3500 | true | INR | 50 |

Record 1 carries no fees and no currency. For a fare pointing at it
(`6E6318` + `6E2156`, `ROUNDTRIP FARE`), TripDetails after ticketing reports:

```
AirRefundCharges.IsRefundableBeforeDeparture   = "Yes",  charge 72.65 USD
AirExchangeCharges.IsExchangeableBeforeDeparture = "Yes", charge 62.27 USD
```

So search says non-refundable while TripDetails says refundable with a real fee.
We now treat an empty record as **unknown** rather than as a restriction.

**Please confirm:** whether an empty `PenaltiesInfoList` record means "not
permitted" or "not available at search time", and whether penalties in search can
be relied upon for customer-facing refund/change display.

---

## 6. `TripDetailsPTC_FareBreakdowns` appears only after ticketing

Immediately after `BookFlight`, TripDetails returns no `TripDetailsPTC_FareBreakdowns`,
so the airline's refund and exchange terms are unavailable at the moment we
confirm the booking. They appear once the ticket is issued.

**Please confirm** this is expected, so we can rely on re-reading after ticketing
rather than treating the initial absence as an error.

---

## Reference

Bookings available for inspection on our account:

| MFRef | Airline PNR | Route | Status |
|---|---|---|---|
| MF35532626 | EMBV6D7 | DEL–BOM 20 Nov / 5 Dec 2026 | Ticketed |
| MF35531926 | 2E0YLBL | DEL–BOM 18 Nov / 2 Dec 2026 | Ticketed |
| MF35472426 | DQIECN | — | Ticketed |

Happy to supply full request/response captures for any of the above.

Many thanks,

FareMind Engineering
