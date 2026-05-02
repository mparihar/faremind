from pydantic import BaseModel, EmailStr, field_validator
from typing import Any, Literal, Optional
from enum import Enum


class EventType(str, Enum):
    BOOKING_CONFIRMED = "BOOKING_CONFIRMED"
    BOOKING_PENDING = "BOOKING_PENDING"
    BOOKING_FAILED = "BOOKING_FAILED"
    BOOKING_CANCELLED = "BOOKING_CANCELLED"
    BOOKING_UPDATED = "BOOKING_UPDATED"
    DATE_CHANGE_SUBMITTED = "DATE_CHANGE_SUBMITTED"
    DATE_CHANGE_APPROVED = "DATE_CHANGE_APPROVED"
    DATE_CHANGE_REJECTED = "DATE_CHANGE_REJECTED"
    PAYMENT_SUCCESS = "PAYMENT_SUCCESS"
    PAYMENT_FAILED = "PAYMENT_FAILED"
    PRICE_DROP_ALERT = "PRICE_DROP_ALERT"
    PRICE_DROP_REFUND = "PRICE_DROP_REFUND"
    CHECKIN_REMINDER = "CHECKIN_REMINDER"
    UPCOMING_TRIP = "UPCOMING_TRIP"
    SUPPORT_MANUAL = "SUPPORT_MANUAL"


class NotificationStatus(str, Enum):
    QUEUED = "queued"
    SENDING = "sending"
    SENT = "sent"
    FAILED = "failed"
    RETRYING = "retrying"


class Channel(str, Enum):
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"
    WHATSAPP = "whatsapp"
    IN_APP = "in_app"


class RecipientType(str, Enum):
    CUSTOMER = "customer"
    SUPPORT = "support"


# ── Request Models ────────────────────────────────────────────────────────────

class EventRequest(BaseModel):
    event_type: EventType
    booking_id: Optional[str] = None
    customer_email: Optional[str] = None
    support_email: Optional[str] = None  # overrides DB lookup if provided
    data: dict[str, Any] = {}


class SendRequest(BaseModel):
    recipient_type: RecipientType
    to: str
    template_key: str
    subject: Optional[str] = None
    data: dict[str, Any] = {}
    booking_id: Optional[str] = None


class ResendRequest(BaseModel):
    notification_id: str


# ── Response Models ───────────────────────────────────────────────────────────

class NotificationResponse(BaseModel):
    id: str
    status: str
    recipient_email: str
    template_key: str
    subject: Optional[str] = None
    sent_at: Optional[Any] = None
    error_message: Optional[str] = None
    attempt_count: int = 0
    created_at: Any


class EventResponse(BaseModel):
    event_id: str
    status: str
    notifications_queued: int
    notification_ids: list[str] = []


class StatusResponse(BaseModel):
    notification_id: str
    status: str
    recipient_email: str
    template_key: str
    attempt_count: int
    sent_at: Optional[Any] = None
    error_message: Optional[str] = None
    provider_message_id: Optional[str] = None


class BookingNotificationsResponse(BaseModel):
    booking_id: str
    total: int
    notifications: list[NotificationResponse]
