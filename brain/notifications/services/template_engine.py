import os
from jinja2 import Environment, FileSystemLoader, select_autoescape
from database import fetch_one

_TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "templates")

_jinja = Environment(
    loader=FileSystemLoader(_TEMPLATE_DIR),
    autoescape=select_autoescape(["html"]),
    trim_blocks=True,
    lstrip_blocks=True,
)

# Map template_key → (html_file, text_file, default_subject)
TEMPLATE_MAP: dict[str, tuple[str, str, str]] = {
    # Customer
    "booking_confirmed_customer":  ("customer/booking_confirmed.html",  "customer/booking_confirmed.txt",  "Your FareMind flight is confirmed – {{ booking_reference }}"),
    "booking_pending_customer":    ("customer/booking_pending.html",    "customer/booking_pending.txt",    "Your booking is being processed – {{ booking_reference }}"),
    "booking_cancelled_customer":  ("customer/booking_cancelled.html",  "customer/booking_cancelled.txt",  "Your FareMind booking has been cancelled – {{ booking_reference }}"),
    "booking_updated_customer":    ("customer/booking_updated.html",    "customer/booking_updated.txt",    "Your booking has been updated – {{ booking_reference }}"),
    "payment_success_customer":    ("customer/payment_success.html",    "customer/payment_success.txt",    "Payment confirmed – {{ booking_reference }}"),
    "payment_failed_customer":     ("customer/payment_failed.html",     "customer/payment_failed.txt",     "Payment issue with your FareMind booking"),
    "price_drop_alert_customer":   ("customer/price_drop_alert.html",   "customer/price_drop_alert.txt",   "Price drop found for your tracked flight – {{ route }}"),
    "price_drop_refund_customer":  ("customer/price_drop_refund.html",  "customer/price_drop_refund.txt",  "You qualify for a price drop refund – {{ booking_reference }}"),
    "checkin_reminder_customer":   ("customer/checkin_reminder.html",   "customer/checkin_reminder.txt",   "Check-in is opening soon for your flight to {{ destination }}"),
    "upcoming_trip_customer":      ("customer/upcoming_trip.html",      "customer/upcoming_trip.txt",      "Your trip to {{ destination }} is in 3 days"),
    # Support
    "booking_confirmed_support":   ("support/booking_confirmed.html",   "support/booking_confirmed.txt",   "New Flight Booking Confirmed – {{ booking_reference }}"),
    "booking_pending_support":     ("support/booking_pending.html",     "support/booking_pending.txt",     "[URGENT] Provider Confirmation Pending – {{ booking_reference }}"),
    "booking_failed_support":      ("support/booking_failed.html",      "support/booking_failed.txt",      "[ACTION] Booking Failed – {{ booking_reference }}"),
    "booking_cancelled_support":   ("support/booking_cancelled.html",   "support/booking_cancelled.txt",   "Booking Cancelled – {{ booking_reference }}"),
    "booking_updated_support":     ("support/booking_updated.html",     "support/booking_updated.txt",     "Booking Updated – {{ booking_reference }}"),
    "payment_failed_support":      ("support/payment_failed.html",      "support/payment_failed.txt",      "[ALERT] Repeated Payment Failure – {{ customer_email }}"),
    "price_drop_refund_support":   ("support/price_drop_refund.html",   "support/price_drop_refund.txt",   "Price Drop Protection Refund Triggered – {{ booking_reference }}"),
}


async def render_template(
    template_key: str,
    data: dict,
    subject_override: str | None = None,
) -> tuple[str, str, str]:
    """Returns (subject, html_body, text_body). Checks DB first, falls back to file."""

    # 1. Check DB for active override
    db_tpl = await fetch_one(
        "SELECT subject_template, html_template, text_template FROM notification_templates "
        "WHERE template_key = $1 AND is_active = TRUE",
        template_key,
    )

    if db_tpl:
        subject_tpl = db_tpl["subject_template"]
        html_tpl    = _jinja.from_string(db_tpl["html_template"])
        text_tpl    = _jinja.from_string(db_tpl["text_template"])
    else:
        info = TEMPLATE_MAP.get(template_key)
        if not info:
            raise ValueError(f"Unknown template_key: {template_key}")
        html_file, text_file, subject_tpl = info
        html_tpl = _jinja.get_template(html_file)
        try:
            text_tpl = _jinja.get_template(text_file)
        except Exception:
            text_tpl = None  # type: ignore

    subject = subject_override or _jinja.from_string(subject_tpl).render(**data)
    html    = html_tpl.render(**data)
    text    = text_tpl.render(**data) if text_tpl else _strip_html(html)

    return subject, html, text


def _strip_html(html: str) -> str:
    import re
    text = re.sub(r"<[^>]+>", "", html)
    return re.sub(r"\n{3,}", "\n\n", text).strip()
