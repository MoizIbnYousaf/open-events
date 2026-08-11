-- Migration number: 0012 	2026-08-10T20:00:00.000Z

-- REQ-010 reminders. Captured messages gain a real kind so acceptance and
-- reminder communications for one submission can coexist in the immutable
-- log. Backfill is deterministic: every pre-0012 submission-linked row was an
-- acceptance send, and every unlinked row was a public confirmation capture,
-- so no honest information is invented.
ALTER TABLE captured_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'confirmation'
  CHECK (kind IN ('confirmation', 'acceptance', 'reminder'));

UPDATE captured_messages SET kind = 'acceptance' WHERE submission_id IS NOT NULL;

-- 0009's one-row-per-submission index is replaced by the narrow invariant the
-- product needs: exactly one row per (submission, kind, recipient). SQLite
-- treats NULLs as distinct, but the partial index keeps the intent explicit —
-- unlinked confirmation captures are not part of the send-once rule.
DROP INDEX idx_captured_messages_submission;
CREATE UNIQUE INDEX idx_captured_messages_submission_kind_email
  ON captured_messages(submission_id, kind, to_email)
  WHERE submission_id IS NOT NULL;
CREATE INDEX idx_captured_messages_submission
  ON captured_messages(submission_id) WHERE submission_id IS NOT NULL;
