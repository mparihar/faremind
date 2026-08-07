# Mystifly — open issues

Account **MCN006482**, endpoint `restapidemo.myfarebox.com`, `Target: Test`.
Everything below was reproduced live on 6–7 Aug 2026. Each item states the
request, the response, and why we believe it is provider-side rather than ours —
several things that looked like provider faults turned out to be ours, and those
are listed separately at the end so nothing here is a false report.

---

## 1. ReIssueQuote returns HTTP 500 when `reissueQuoteRequestType` is `"None"`

Reproducible 3/3 on `MF35566226` at `2026-08-05T23:37:18Z`.

**Request**
```json
POST /api/PostTicketingRequest
{
  "ptrType": "ReIssueQuote",
  "mFRef": "MF35566226",
  "RefundDetails": null,
  "reissueQuoteRequestType": "None",
  "passengers": [
    { "firstName": "Rishi",  "lastName": "Parihar", "title": "MR",   "eTicket": "TKT529623", "passengerType": "ADT" },
    { "firstName": "Ashish", "lastName": "Jain",    "title": "MSTR", "eTicket": "TKT529624", "passengerType": "CHD" },
    { "firstName": "Puja",   "lastName": "Singh",   "title": "MS",   "eTicket": "TKT529625", "passengerType": "INF" }
  ]
}
```

**Response** — HTTP 200 body carrying a 500
```json
{ "Data": null, "Success": false,
  "Message": "The remote server returned an error: (500) Internal Server Error." }
```

**Why it is not our request** — controls on the same booking with the same
passenger array:

| Variant | Response |
|---|---|
| `reissueQuoteRequestType: "None"` | **500** |
| `reissueQuoteRequestType: "OND"` + originDestinations | `"Please specify valid Origin for segment"` — validates normally |
| `passengers: []` | `"Please verify the Request."` — validates normally |
| `VoidQuote`, identical passengers | `"Voiding window expired."` — a real verdict |

The booking, credentials, e-tickets and passenger array are accepted by every
other call. Only this variant 500s.

**Question:** is `"None"` supported, and if so what does it require that `"OND"`
does not?

---

## 2. A 500 that still created a PTR, leaving the quote unreachable

`MF35566326`, `2026-08-06T03:28:40Z`.

RefundQuote returned:
```json
{ "Data": null, "Success": false,
  "Message": "The remote server returned an error: (500) Internal Server Error." }
```

No `PTRId` in the response. But **PTR 22981 had been created** —
`Search/PostTicketingRequest` confirms it:
```json
{ "PTRId": 22981, "PTRType": "RefundQuote", "MFRef": "MF35566326",
  "PTRStatus": "InProcess", "Resolution": "QuoteRequested" }
```

Every retry then answers `"RefundQuote request PTR 22981 is already in process"`,
so the quote cannot be raised again and cannot be polled, because its id was
never returned.

**Request:** either do not leave a PTR behind when the call fails, or return the
`PTRId` on the error so it can be tracked. We now recover the id by parsing it
out of the "already in process" text, which works but should not be necessary.

---

## 3. `RetrieveMFRefThroughFSC` returns "No Matching MFRef found" for bookings that exist

Five bookings, every one with a live MFRef we call TripDetails on successfully:

| Booking | MFRef | Endpoint answers |
|---|---|---|
| FME4N3CL | MF35566326 | No Matching MFRef found |
| FMJHI8HG | MF35566226 | No Matching MFRef found |
| FMP6VJN2 | MF35566126 | No Matching MFRef found |
| FM8NH1EA | MF35566026 | No Matching MFRef found |
| FM83B9T2 | MF35565926 | No Matching MFRef found |

**Why this matters more than it looks.** It is the documented way to recover a
reference when BookFlight returns **ERBUK082** without one. With no reliable
recovery, an ERBUK082 booking cannot be polled and cannot be safely refunded —
we have no way to tell "no booking was created" from "a booking exists and is
confirming". We now route every such booking to a human rather than guess.

**Question:** what is the correct way to recover an MFRef after an ERBUK082 that
returns no reference? Does this endpoint expect the pre- or post-revalidation
FareSourceCode, and is there a time window?

---

## 4. `AncillaryServiceRequest` returns "Invalid URI" for every booking

Tried 7 Aug 2026 on three ticketed bookings spanning two fare types:

```
POST /api/AncillaryServiceRequest
{ "MFRef": "…", "isBaggage": true, "isMeal": true,
  "isSeatMap": false, "isConfirmed": false, "isCancel": false }
```

| Booking | Fare | Response |
|---|---|---|
| MF35578826 | Scoot, WebFare | `"Invalid URI: The format of the URI could not be determined."` |
| MF35579026 | Vueling, WebFare | same |
| MF35591426 | American, Public | same |

The request carries only an MFRef and boolean flags — no URI of ours — so the
URI in question is internal to the service.

**Effect:** post-booking baggage is disabled on our side entirely. Paid bags
bought *before* ticketing work fine via `ExtraServices1_1` on the Book request.

---

## 5. Undocumented field formats

Three requirements that are real but not discoverable from the Swagger:

**`TravelerInfo.CountryCode` must be the numeric dialling code.** The Swagger
says only:
```json
"CountryCode": { "type": "string", "nullable": true },
"AreaCode":    { "type": "string", "nullable": true }
```
No pattern, no example, no description, not required. We were sending `"US"`,
which the contract permits as readily as `"1"`. Now corrected to `1` / `91` etc.

**`AreaCode`** has no guidance at all. We now send the national destination code
from the numbering plan — `972` for a Dallas number, `22` for a Mumbai landline,
`20` for London — with `CountryCode + AreaCode + PhoneNumber` always
reconstructing the full number. **Please confirm this is what you expect**, and
whether `PhoneNumber` should be the subscriber number only, as we now send, or
include the dialling code as it did before.

**`RefundDetails` is required on `RefundQuote`** but is not marked required.
Omitting it returns:
```
"Refund quote request cannot be processed as the refund details are missing from the request."
```
which names no field. Proven on `MF35565926`: the identical request without the
array fails and with it returns `PTRId 22982`.

**Request:** add `pattern` / `example` to these fields, and mark `RefundDetails`
required for RefundQuote. `Passport.Country` already carries `^([A-Z][A-Z])$`,
so the schema is capable of expressing this.

---

## 6. Name correction — two PNRs ticketed with the wrong title

Passenger **Puja Singh**, female infant, was ticketed as `MSTR`:

| FareMind ref | MFRef | Airline PNR |
|---|---|---|
| FMHHAZTL | MF35578826 | LAPU20P |
| FM50EC9D | MF35566326 | CSNZVZ |

This one was **our fault** — a form defect sent the wrong gender, since fixed —
but the PNRs need correcting at the airline. Please advise the process.

---

## Carrier behaviour, for reference — not a fault

An infant sent as `Miss` is stored differently depending on the carrier. Same
code, same input, same day:

| Carrier | Sent | Stored |
|---|---|---|
| Vueling | `Miss` | `MISS` |
| IndiGo | `Miss` | `MISS` |
| Air India | `Miss` | **`MS`** |

Noted so it is not mistaken for a data problem on either side.

---

## Reported and withdrawn — these were ours

Listed so the record is accurate:

- **"Refund quote cannot be processed — refund details missing"** — ours. We were
  not sending `RefundDetails`. See item 5.
- **"Eticket number is wrong"** on reissue — ours. E-tickets were assigned to
  passengers positionally, so every passenger held someone else's coupon; 34 of
  47 rows were wrong and have been repaired.
- **"Passenger details are not matching for ticket number …"** — ours. We sent a
  derived title rather than the one the coupon was ticketed under. Air India
  rewrites `Miss` to `MS`, so our derived value stopped matching after ticketing.
- **`CountryCode: "US"`** — ours, as you reported. See item 5.
