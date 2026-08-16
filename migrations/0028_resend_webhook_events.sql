-- Signed Resend delivery evidence. The outbox job keeps the mutable projection;
-- the webhook ledger is append-only and stores no recipient, subject, body,
-- token, signature, or raw provider payload.
ALTER TABLE email_delivery_jobs ADD COLUMN provider_status TEXT CHECK (
  provider_status IS NULL OR provider_status IN (
    'accepted', 'sent', 'delayed', 'delivered', 'bounced', 'failed', 'complained'
  )
);
ALTER TABLE email_delivery_jobs ADD COLUMN provider_status_at TEXT;
ALTER TABLE email_delivery_jobs ADD COLUMN provider_event_id TEXT;
ALTER TABLE email_delivery_jobs ADD COLUMN provider_event_count INTEGER NOT NULL DEFAULT 0
  CHECK (provider_event_count >= 0);

CREATE TABLE resend_webhook_events (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES email_delivery_jobs(id),
  provider_email_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'email.sent',
      'email.delivery_delayed',
      'email.delivered',
      'email.bounced',
      'email.failed',
      'email.suppressed',
      'email.complained'
    )
  ),
  event_created_at TEXT NOT NULL CHECK (length(event_created_at) = 24),
  received_at TEXT NOT NULL CHECK (length(received_at) = 24)
);

CREATE INDEX idx_resend_webhook_events_job_order
  ON resend_webhook_events(job_id, event_created_at, id)
  WHERE job_id IS NOT NULL;
CREATE INDEX idx_resend_webhook_events_provider_email
  ON resend_webhook_events(provider_email_id, event_created_at, id);

CREATE TRIGGER trg_resend_webhook_events_immutable_update
BEFORE UPDATE ON resend_webhook_events
BEGIN
  SELECT RAISE(ABORT, 'resend webhook evidence is immutable');
END;

CREATE TRIGGER trg_resend_webhook_events_immutable_delete
BEFORE DELETE ON resend_webhook_events
BEGIN
  SELECT RAISE(ABORT, 'resend webhook evidence is immutable');
END;
