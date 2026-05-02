from fastapi import APIRouter, HTTPException, BackgroundTasks
from models.schemas import EventRequest, EventResponse
from services.event_handler import handle_event

router = APIRouter()


@router.post("/event", response_model=EventResponse)
async def trigger_event(req: EventRequest, background_tasks: BackgroundTasks):
    """
    Accept a booking lifecycle event and dispatch all required notifications.
    Runs delivery in background so booking flow is never blocked.
    """
    try:
        event_id, notification_ids = await handle_event(
            event_type=req.event_type,
            booking_id=req.booking_id,
            customer_email=req.customer_email,
            support_email=req.support_email,
            data=req.data,
        )
        return EventResponse(
            event_id=event_id,
            status="processing",
            notifications_queued=len(notification_ids),
            notification_ids=notification_ids,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
