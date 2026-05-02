from fastapi import APIRouter, HTTPException
from models.schemas import ResendRequest, NotificationResponse
from services.notification_service import resend_notification

router = APIRouter()


@router.post("/resend", response_model=NotificationResponse)
async def resend(req: ResendRequest):
    """Resend an existing notification by ID."""
    try:
        row = await resend_notification(req.notification_id)
        return NotificationResponse(**row)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
