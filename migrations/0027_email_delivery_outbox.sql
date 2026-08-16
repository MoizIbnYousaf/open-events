-- Additive transactional email outbox. Historical captured rows remain exactly
-- as written and are never backfilled into sendable jobs.
ALTER TABLE captured_messages ADD COLUMN recipient_fingerprint TEXT;

-- New rows dedupe on a keyed fingerprint rather than a raw address. Preserve
-- the legacy indexes only for pre-0027 rows whose fingerprint is NULL.
DROP INDEX idx_captured_messages_legacy_submission_kind_email;
DROP INDEX idx_captured_messages_access_submission_kind_email;
CREATE UNIQUE INDEX idx_captured_messages_legacy_submission_kind_email
  ON captured_messages(submission_id, kind, to_email)
  WHERE submission_id IS NOT NULL
    AND role_access_token_id IS NULL
    AND recipient_fingerprint IS NULL;
CREATE UNIQUE INDEX idx_captured_messages_access_submission_kind_email
  ON captured_messages(submission_id, kind, to_email)
  WHERE submission_id IS NOT NULL
    AND role_access_token_id IS NOT NULL
    AND recipient_fingerprint IS NULL;
CREATE UNIQUE INDEX idx_captured_messages_delivery_submission_kind_recipient
  ON captured_messages(submission_id, kind, recipient_fingerprint)
  WHERE submission_id IS NOT NULL AND recipient_fingerprint IS NOT NULL;
CREATE INDEX idx_captured_messages_recipient_fingerprint
  ON captured_messages(recipient_fingerprint)
  WHERE recipient_fingerprint IS NOT NULL;

-- The audit record is append-only. Delivery state belongs to the separate job
-- row, so no provider transition ever needs to rewrite or erase what the
-- application originally decided to communicate.
CREATE TRIGGER trg_captured_messages_immutable_update
BEFORE UPDATE ON captured_messages
BEGIN
  SELECT RAISE(ABORT, 'captured message audit rows are immutable');
END;

CREATE TRIGGER trg_captured_messages_immutable_delete
BEFORE DELETE ON captured_messages
BEGIN
  SELECT RAISE(ABORT, 'captured message audit rows are immutable');
END;

CREATE TABLE email_delivery_jobs (
  id TEXT PRIMARY KEY,
  captured_message_id TEXT NOT NULL UNIQUE REFERENCES captured_messages(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  mode TEXT NOT NULL CHECK (mode IN ('capture', 'resend-test', 'resend-live')),
  status TEXT NOT NULL CHECK (
    status IN ('captured', 'queued', 'leased', 'retry', 'accepted', 'operator_action')
  ),
  recipient_fingerprint TEXT NOT NULL,
  key_version TEXT NOT NULL,
  nonce TEXT,
  ciphertext TEXT,
  payload_expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  provider_id TEXT UNIQUE,
  last_error_code TEXT,
  ambiguous_since TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (ciphertext IS NULL AND nonce IS NULL) OR
    (ciphertext IS NOT NULL AND nonce IS NOT NULL)
  ),
  CHECK (mode != 'capture' OR status IN ('captured', 'operator_action'))
);

CREATE INDEX idx_email_delivery_jobs_claim
  ON email_delivery_jobs(status, next_attempt_at, lease_expires_at, created_at);
CREATE INDEX idx_email_delivery_jobs_event_created
  ON email_delivery_jobs(event_id, created_at DESC);
CREATE INDEX idx_email_delivery_jobs_recipient
  ON email_delivery_jobs(recipient_fingerprint, created_at);

-- Provider-mode capacity reservations. Capture jobs never consume delivery
-- capacity. The job id is the immutable one-recipient intent.
CREATE TABLE email_delivery_budget_events (
  job_id TEXT PRIMARY KEY REFERENCES email_delivery_jobs(id),
  environment_key TEXT NOT NULL,
  organizer_key TEXT,
  created_at TEXT NOT NULL CHECK (length(created_at) = 24)
);
CREATE INDEX idx_email_delivery_budget_environment_time
  ON email_delivery_budget_events(environment_key, created_at);
CREATE INDEX idx_email_delivery_budget_organizer_time
  ON email_delivery_budget_events(organizer_key, created_at)
  WHERE organizer_key IS NOT NULL;
