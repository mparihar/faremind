import asyncio
import logging
from datetime import datetime, timezone
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_result

from database import execute, fetch_one, fetch_all, fetch_admin_emails
from services.template_engine import render_template
from providers.factory import get_email_provider

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3


def _is_failure(result) -> bool:
    return result is False


async def _save_notification(
    event_id: str | None,
    booking_id: str | None,
    recipient_type: str,
    recipient_email: str,
    template_key: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> str:
    row = await fetch_one(
        """INSERT INTO notification_log
           (event_id, booking_id, recipient_type, recipient_email,
            template_key, subject, html_body, text_body, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued')
           RETURNING id""",
        event_id, booking_id, recipient_type, recipient_email,
        template_key, subject, html_body, text_body,
    )
    return row["id"]


async def _mark_sent(notif_id: str, message_id: str | None, provider: str):
    await execute(
        """UPDATE notification_log
           SET status='sent', sent_at=$2, provider=$3,
               provider_message_id=$4, updated_at=NOW()
           WHERE id=$1""",
        notif_id, datetime.now(timezone.utc), provider, message_id,
    )


async def _mark_failed(notif_id: str, error: str, retrying: bool = False):
    status = "retrying" if retrying else "failed"
    await execute(
        """UPDATE notification_log
           SET status=$2, error_message=$3,
               attempt_count = attempt_count + 1, updated_at=NOW()
           WHERE id=$1""",
        notif_id, status, error[:1000],
    )


async def send_one(
    *,
    event_id: str | None = None,
    booking_id: str | None = None,
    recipient_type: str,
    recipient_email: str,
    template_key: str,
    data: dict,
    subject_override: str | None = None,
) -> str:
    """Render template, store, and deliver one notification. Returns notification_id."""
    subject, html, text = await render_template(template_key, data, subject_override)

    notif_id = await _save_notification(
        event_id, booking_id, recipient_type, recipient_email,
        template_key, subject, html, text,
    )

    await _deliver_with_retry(notif_id, recipient_email, subject, html, text)
    return notif_id


async def _deliver_with_retry(
    notif_id: str,
    recipient_email: str,
    subject: str,
    html: str,
    text: str,
):
    provider = get_email_provider()

    await execute(
        "UPDATE notification_log SET status='sending', updated_at=NOW() WHERE id=$1",
        notif_id,
    )

    for attempt in range(1, MAX_ATTEMPTS + 1):
        result = await provider.send_email(
            to=recipient_email,
            subject=subject,
            html=html,
            text=text,
        )
        if result.success:
            await _mark_sent(notif_id, result.message_id, provider.name)
            logger.info("Sent %s → %s (attempt %d)", notif_id, recipient_email, attempt)
            return

        is_last = attempt == MAX_ATTEMPTS
        logger.warning(
            "Delivery failed for %s attempt %d/%d: %s",
            notif_id, attempt, MAX_ATTEMPTS, result.error,
        )
        await _mark_failed(notif_id, result.error or "unknown", retrying=not is_last)

        if not is_last:
            await asyncio.sleep(2 ** attempt)  # 2s, 4s backoff


async def resend_notification(notification_id: str) -> dict:
    row = await fetch_one(
        "SELECT * FROM notification_log WHERE id=$1", notification_id
    )
    if not row:
        raise ValueError(f"Notification {notification_id} not found")

    await execute(
        "UPDATE notification_log SET status='queued', attempt_count=0, error_message=NULL, updated_at=NOW() WHERE id=$1",
        notification_id,
    )
    await _deliver_with_retry(
        notification_id,
        row["recipient_email"],
        row["subject"],
        row["html_body"],
        row["text_body"],
    )
    return await fetch_one("SELECT * FROM notification_log WHERE id=$1", notification_id)
