-- ═══════════════════════════════════════════════════════════════
-- FareMind Notification Service — DB Migration 001
-- ═══════════════════════════════════════════════════════════════

-- Notification Events (one per booking lifecycle event)
CREATE TABLE IF NOT EXISTS notification_events (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    event_type      TEXT NOT NULL,
    booking_id      TEXT,
    customer_email  TEXT,
    support_email   TEXT,
    payload_json    JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','processing','completed','failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ne_booking_id  ON notification_events(booking_id);
CREATE INDEX IF NOT EXISTS idx_ne_event_type  ON notification_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ne_status      ON notification_events(status);
CREATE INDEX IF NOT EXISTS idx_ne_created_at  ON notification_events(created_at);

-- Individual Notifications (one per recipient per event)
CREATE TABLE IF NOT EXISTS notification_log (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    event_id            TEXT REFERENCES notification_events(id) ON DELETE SET NULL,
    booking_id          TEXT,
    recipient_type      TEXT NOT NULL CHECK (recipient_type IN ('customer','support')),
    recipient_email     TEXT NOT NULL,
    channel             TEXT NOT NULL DEFAULT 'email'
                        CHECK (channel IN ('email','sms','push','whatsapp','in_app')),
    template_key        TEXT NOT NULL,
    subject             TEXT,
    html_body           TEXT,
    text_body           TEXT,
    status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','sending','sent','failed','retrying')),
    attempt_count       INT NOT NULL DEFAULT 0,
    provider            TEXT,
    provider_message_id TEXT,
    error_message       TEXT,
    sent_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nl_event_id        ON notification_log(event_id);
CREATE INDEX IF NOT EXISTS idx_nl_booking_id      ON notification_log(booking_id);
CREATE INDEX IF NOT EXISTS idx_nl_recipient_email ON notification_log(recipient_email);
CREATE INDEX IF NOT EXISTS idx_nl_status          ON notification_log(status);
CREATE INDEX IF NOT EXISTS idx_nl_created_at      ON notification_log(created_at);

-- Templates (DB-backed, overrides file-based templates when present)
CREATE TABLE IF NOT EXISTS notification_templates (
    id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    template_key     TEXT NOT NULL UNIQUE,
    channel          TEXT NOT NULL DEFAULT 'email',
    subject_template TEXT NOT NULL,
    html_template    TEXT NOT NULL,
    text_template    TEXT NOT NULL,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nt_template_key ON notification_templates(template_key);

-- Customer Notification Preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    customer_email          TEXT NOT NULL,
    booking_id              TEXT,
    email_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    sms_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
    push_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
    price_alert_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    checkin_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(customer_email, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_np_customer_email ON notification_preferences(customer_email);
