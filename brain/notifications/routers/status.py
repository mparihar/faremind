from fastapi import APIRouter, HTTPException
from models.schemas import StatusResponse, BookingNotificationsResponse, NotificationResponse
from database import fetch_one, fetch_all

router = APIRouter()


@router.get("/status/{notification_id}", response_model=StatusResponse)
async def get_status(notification_id: str):
    row = await fetch_one(
        "SELECT * FROM notification_log WHERE id=$1", notification_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    return StatusResponse(
        notification_id=row["id"],
        status=row["status"],
        recipient_email=row["recipient_email"],
        template_key=row["template_key"],
        attempt_count=row["attempt_count"],
        sent_at=row.get("sent_at"),
        error_message=row.get("error_message"),
        provider_message_id=row.get("provider_message_id"),
    )


@router.get("/booking/{booking_id}", response_model=BookingNotificationsResponse)
async def get_booking_notifications(booking_id: str):
    rows = await fetch_all(
        "SELECT * FROM notification_log WHERE booking_id=$1 ORDER BY created_at DESC",
        booking_id,
    )
    return BookingNotificationsResponse(
        booking_id=booking_id,
        total=len(rows),
        notifications=[NotificationResponse(**r) for r in rows],
    )
