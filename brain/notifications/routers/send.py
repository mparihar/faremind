from fastapi import APIRouter, HTTPException
from models.schemas import SendRequest, NotificationResponse
from services.notification_service import send_one
from database import fetch_one

router = APIRouter()


@router.post("/send", response_model=NotificationResponse)
async def send_notification(req: SendRequest):
    """Send a direct notification using a specific template."""
    try:
        notif_id = await send_one(
            booking_id=req.booking_id,
            recipient_type=req.recipient_type,
            recipient_email=req.to,
            template_key=req.template_key,
            data=req.data,
            subject_override=req.subject,
        )
        row = await fetch_one("SELECT * FROM notification_log WHERE id=$1", notif_id)
        return NotificationResponse(**row)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
