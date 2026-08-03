# Email — RefundQuote returns no priced quote

Ready to send. Account MCN006482, demo endpoint.

---

**Subject:** RefundQuote accepted but never priced — cannot complete Refund — account MCN006482

Hello Mystifly Support,

We are unable to complete a refund through the API. Every `RefundQuote` we raise
is accepted and a PTR is created, but no priced quote is ever returned — so there
is no amount to accept and we cannot proceed to `Refund`.

**Environment:** `restapidemo.myfarebox.com`, `Target=Test`, Account `MCN006482`

**Request**

```json
POST /api/PostTicketingRequest
{
  "ptrType": "RefundQuote",
  "mFRef": "MF35498426",
  "passengers": [
    { "firstName": "Rishi", "lastName": "Parihar", "title": "Mr",
      "eTicket": "TKT528645", "passengerType": "ADT" }
  ]
}
```

**Response** — accepted, but `RefundQuotes[]` is empty:

```json
{ "PTRId": 22897, "PTRType": "RefundQuote", "MFRef": "MF35498426",
  "BookingStatus": "Ticketed", "PTRStatus": "InProcess",
  "Resolution": "QuoteRequested", "RefundQuotes": [] }
```

PTR 22897 has remained `InProcess / QuoteRequested` for over 24 hours.

**This is every refund quote on the account, not one booking**

| MFRef | Airline PNR | PTR | Outcome |
|---|---|---|---|
| MF35498426 | EGVHKM | 22897 | `InProcess` / `QuoteRequested`, no rows |
| MF35498526 | EGWZ85 | — | `InProcess`, no rows |
| MF35472726 | E7MZOA | 22796, 22753, 22752, 22751 | `Completed` / **`RefundQuoteRejected`** |

A `VoidQuote` on the same account, by contrast, returns a priced result in the
same response:

```json
{ "PassengerType": "ADT", "ETicket": "TKT528650", "Currency": "USD",
  "TotalVoidingFee": "0.00", "AdminCharges": "0.00" }
```

We also cannot read the quote back once raised. A targeted search for the same
PTR returns nothing, although it appears in the PTR list:

```json
POST /api/Search/PostTicketingRequest
{ "ptrType": "Refund", "MFRef": "MF35498426", "PTRId": 22897 }

→ { "Data": null, "Success": false, "Message": "No records found." }
```

**Could you please confirm:**

1. Is `RefundQuote` priced asynchronously on this account — and if so, what is
   the expected turnaround? We notice `ReIssueQuote` PTRs carry
   `"ProcessingMethod": "Auto"` and reach `QuoteUpdated`, while `RefundQuote`
   PTRs carry no `ProcessingMethod` at all.
2. Once a refund quote is priced, where do the amounts appear? If
   `Search/PostTicketingRequest` is not the route, must the `RefundQuote` be
   raised again? We would rather not create a second PTR for the same booking
   merely to read a number.
3. Why is `RefundQuoteRejected` returned for `MF35472726`? `TripDetails` for that
   booking reports `IsRefundableBeforeDeparture: "Yes"` with a USD 51.89 charge,
   so the ticket appears refundable.

We are holding these cancellations rather than refunding on an unconfirmed
amount, so a steer on the expected behaviour would help us a great deal.

Full request and response captures are available for any of the references above.

Many thanks,

FareMind Engineering
