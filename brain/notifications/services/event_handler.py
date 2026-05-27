import json
import logging
from database import execute, fetch_one, fetch_admin_emails
from services.notification_service import send_one
from models.schemas import EventType
from config import get_settings

logger = logging.getLogger(__name__)

# Maps event_type → list of (recipient_type, template_key)
EVENT_TEMPLATE_MAP: dict[str, list[tuple[str, str]]] = {
    EventType.BOOKING_CONFIRMED:      [("customer", "booking_confirmed_customer"),
                                       ("support",  "booking_confirmed_support")],
    EventType.BOOKING_PENDING:        [("customer", "booking_pending_customer"),
                                       ("support",  "booking_pending_support")],
    EventType.BOOKING_FAILED:         [("support",  "booking_failed_support")],
    EventType.BOOKING_CANCELLED:      [("customer", "booking_cancelled_customer"),
                                       ("support",  "booking_cancelled_support")],
    EventType.BOOKING_UPDATED:        [("customer", "booking_updated_customer"),
                                       ("support",  "booking_updated_support")],
    EventType.DATE_CHANGE_SUBMITTED:  [("customer", "booking_updated_customer"),
                                       ("support",  "booking_updated_support")],
    EventType.DATE_CHANGE_APPROVED:   [("customer", "booking_updated_customer"),
                                       ("support",  "booking_updated_support")],
    EventType.DATE_CHANGE_REJECTED:   [("customer", "booking_updated_customer"),
                                       ("support",  "booking_updated_support")],
    EventType.PAYMENT_SUCCESS:        [("customer", "payment_success_customer")],
    EventType.PAYMENT_FAILED:         [("customer", "payment_failed_customer"),
                                       ("support",  "payment_failed_support")],
    EventType.PRICE_DROP_ALERT:       [("customer", "price_drop_alert_customer")],
    EventType.PRICE_DROP_REFUND:      [("customer", "price_drop_refund_customer"),
                                       ("support",  "price_drop_refund_support")],
    EventType.CHECKIN_REMINDER:       [("customer", "checkin_reminder_customer")],
    EventType.UPCOMING_TRIP:          [("customer", "upcoming_trip_customer")],
    EventType.SUPPORT_MANUAL:         [("support",  "booking_confirmed_support")],
}


async def handle_event(
    event_type: str,
    booking_id: str | None,
    customer_email: str | None,
    support_email: str | None,
    data: dict,
) -> tuple[str, list[str]]:
    """
    Creates an event record, dispatches notifications.
    Returns (event_id, [notification_ids]).
    """
    # Persist the event
    row = await fetch_one(
        """INSERT INTO notification_events
           (event_type, booking_id, customer_email, support_email, payload_json, status)
           VALUES ($1,$2,$3,$4,$5::jsonb,'processing')
           RETURNING id""",
        event_type, booking_id, customer_email, support_email, json.dumps(data),
    )
    event_id = row["id"]

    templates = EVENT_TEMPLATE_MAP.get(event_type, [])
    notification_ids: list[str] = []

    # Resolve support recipients from DB if not overridden
    settings = get_settings()
    support_emails: list[str] = []
    if support_email:
        support_emails = [support_email]
    else:
        support_emails = await fetch_admin_emails()

    # Always include the configured super-admin email (never miss it)
    if settings.support_email and settings.support_email not in support_emails:
        support_emails.append(settings.support_email)

    # Final fallback: if DB returned nothing and no config, log a warning
    if not support_emails:
        logger.warning("No support recipients found for event %s — check admin_users table and SUPPORT_EMAIL config", event_type)

    for recipient_type, template_key in templates:
        try:
            if recipient_type == "customer" and customer_email:
                nid = await send_one(
                    event_id=event_id,
                    booking_id=booking_id,
                    recipient_type="customer",
                    recipient_email=customer_email,
                    template_key=template_key,
                    data=data,
                )
                notification_ids.append(nid)

            elif recipient_type == "support":
                for s_email in support_emails:
                    nid = await send_one(
                        event_id=event_id,
                        booking_id=booking_id,
                        recipient_type="support",
                        recipient_email=s_email,
                        template_key=template_key,
                        data=data,
                    )
                    notification_ids.append(nid)

        except Exception as exc:
            logger.error(
                "Failed to dispatch %s for event %s: %s",
                template_key, event_id, exc,
            )

    status = "completed" if notification_ids else "failed"
    await execute(
        "UPDATE notification_events SET status=$2 WHERE id=$1",
        event_id, status,
    )

    return event_id, notification_ids
