"""
FareMind – notification end-to-end test
Fires every event type and reports which emails were sent / failed.
Run from the repo root:  python test_all_notifications.py
"""

import asyncio, httpx, json, sys
from datetime import datetime

# Force UTF-8 output on Windows
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

SERVICE = "http://localhost:8001/notifications"
CUSTOMER_EMAIL = "mparihar@gmail.com"
BOOKING_ID     = "bk_NOTIFTEST01"

# ── Shared template data ───────────────────────────────────────────────────────
BASE = {
    "booking_reference":  "FMTEST99",
    "pnr":                "FMTEST99",
    "provider_booking_id": BOOKING_ID,
    "customer_name":      "Munish Parihar",
    "customer_email":     CUSTOMER_EMAIL,
    "origin":             "DFW",
    "destination":        "DEL",
    "route":              "DFW → DEL",
    "airline":            "Lufthansa",
    "flight_number":      "LH 761",
    "fare_class":         "Economy",
    "cabin":              "Economy",
    "departure_date":     "Jun 21, 2026",
    "departure_time":     "10:45 AM",
    "arrival_date":       "Jun 22, 2026",
    "arrival_time":       "08:30 AM",
    "duration":           "13h 45m",
    "passengers":         [{"name": "Munish Parihar", "type": "Adult"}],
    "total_amount":       "$2,195",
    "total_charged":      2195,
    "currency":           "USD",
    "card_last4":         "4242",
    "confirmed_at":       datetime.now().strftime("%b %d, %Y, %I:%M %p"),
    "payment_intent_id":  "pi_test_mock",
    "seat_number":        "14A",
    "meal_preference":    "Vegetarian",
    # price-drop fields
    "original_price":     2195,
    "new_price":          1850,
    "price_drop":         345,
    "refund_amount":      "$276",
    "refund_credit":      276,
    "coverage_pct":       80,
    # check-in / upcoming
    "checkin_opens":      "Jun 20, 2026 at 10:45 AM",
    "checkin_link":       "https://faremind.ai/checkin/FMTEST99",
    "days_until_trip":    7,
    "trip_date":          "Jun 21, 2026",
    # change / update
    "old_departure_date": "Jun 19, 2026",
    "new_departure_date": "Jun 21, 2026",
    "change_reason":      "Airline schedule change",
    "change_fee":         "$0",
    # cancellation
    "cancellation_reason": "Passenger request",
    "refund_policy":       "Non-refundable fare",
    "support_ticket_id":  "TKT-00123",
    # payment-failed
    "failure_reason":     "Card declined",
    "retry_link":         "https://faremind.ai/checkout/payment",
}

# ── Events to test ─────────────────────────────────────────────────────────────
EVENTS = [
    ("BOOKING_CONFIRMED",     "customer + support"),
    ("BOOKING_PENDING",       "customer + support"),
    ("BOOKING_FAILED",        "support only"),
    ("BOOKING_CANCELLED",     "customer + support"),
    ("BOOKING_UPDATED",       "customer + support"),
    ("DATE_CHANGE_SUBMITTED", "customer + support"),
    ("DATE_CHANGE_APPROVED",  "customer + support"),
    ("DATE_CHANGE_REJECTED",  "customer + support"),
    ("PAYMENT_SUCCESS",       "customer + support"),
    ("PAYMENT_FAILED",        "customer + support"),
    ("PRICE_DROP_ALERT",      "customer only"),
    ("PRICE_DROP_REFUND",     "customer + support"),
    ("CHECKIN_REMINDER",      "customer only"),
    ("UPCOMING_TRIP",         "customer only"),
    ("SUPPORT_MANUAL",        "support only"),
]

# ── Runner ─────────────────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

async def run():
    print(f"\n{BOLD}{CYAN}-------------------------------------------------------{RESET}")
    print(f"{BOLD}{CYAN}   FareMind Notification Test — {len(EVENTS)} event types{RESET}")
    print(f"{BOLD}{CYAN}-------------------------------------------------------{RESET}\n")
    print(f"  Customer email : {CUSTOMER_EMAIL}")
    print(f"  Booking ID     : {BOOKING_ID}")
    print(f"  Service        : {SERVICE}\n")

    passed = 0
    failed = 0
    results = []

    async with httpx.AsyncClient(timeout=30) as client:
        for event_type, recipients in EVENTS:
            payload = {
                "event_type":     event_type,
                "booking_id":     BOOKING_ID,
                "customer_email": CUSTOMER_EMAIL,
                "data":           BASE,
            }
            try:
                r = await client.post(f"{SERVICE}/event", json=payload)
                body = r.json()

                if r.status_code == 200 and body.get("notifications_queued", 0) > 0:
                    status = "PASS"
                    queued = body["notifications_queued"]
                    ids    = body.get("notification_ids", [])
                    detail = f"{queued} notification(s) queued  •  IDs: {', '.join(ids[:3])}{'…' if len(ids) > 3 else ''}"
                    passed += 1
                elif r.status_code == 200 and body.get("notifications_queued", 0) == 0:
                    status = "WARN"
                    detail = "Event accepted but 0 notifications queued — check recipient config"
                    failed += 1
                else:
                    status = "FAIL"
                    detail = f"HTTP {r.status_code}  {json.dumps(body)[:120]}"
                    failed += 1

            except Exception as exc:
                status = "FAIL"
                detail = str(exc)[:120]
                failed += 1

            results.append((event_type, recipients, status, detail))

            color = GREEN if status == "PASS" else (YELLOW if status == "WARN" else RED)
            mark  = "✓" if status == "PASS" else ("!" if status == "WARN" else "✗")
            print(f"  {color}{mark}{RESET}  {event_type:<28}  [{recipients:<20}]  {color}{detail}{RESET}")

    # ── Summary ────────────────────────────────────────────────────────────────
    print(f"\n{BOLD}{'-'*57}{RESET}")
    total = passed + failed
    print(f"  {GREEN if failed == 0 else RED}{BOLD}Result: {passed}/{total} passed{RESET}")

    # ── Status check per notification ──────────────────────────────────────────
    print(f"\n{BOLD}{CYAN}  Verifying delivery status via /status endpoint…{RESET}")
    async with httpx.AsyncClient(timeout=20) as client:
        # Pull all notifications for our test booking
        try:
            r = await client.get(f"{SERVICE}/booking/{BOOKING_ID}")
            if r.status_code == 200:
                notifs = r.json().get("notifications", [])
                sent    = sum(1 for n in notifs if n["status"] == "sent")
                failed_ = sum(1 for n in notifs if n["status"] == "failed")
                queued  = sum(1 for n in notifs if n["status"] in ("queued","sending","retrying"))
                print(f"\n  Total logged   : {len(notifs)}")
                print(f"  {GREEN}Sent           : {sent}{RESET}")
                print(f"  {YELLOW}Queued/Retrying: {queued}{RESET}")
                print(f"  {RED}Failed         : {failed_}{RESET}")

                if failed_ > 0:
                    print(f"\n  {RED}Failed notifications:{RESET}")
                    for n in notifs:
                        if n["status"] == "failed":
                            print(f"    • {n['template_key']:<40} → {n['recipient_email']}")
                            print(f"      Error: {n.get('error_message','(none)')}")
            else:
                print(f"  {YELLOW}Could not fetch booking notifications: HTTP {r.status_code}{RESET}")
        except Exception as exc:
            print(f"  {YELLOW}Status check skipped: {exc}{RESET}")

    print(f"\n{BOLD}{'-'*57}{RESET}\n")


if __name__ == "__main__":
    asyncio.run(run())
