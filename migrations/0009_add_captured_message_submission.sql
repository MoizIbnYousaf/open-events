-- Migration number: 0007 	2026-08-10T00:00:00.000Z

-- REQ-010 acceptance communications. Captured messages stay the single
-- immutable outbound-message log (rows are only ever inserted, never updated
-- or deleted); acceptance messages additionally carry the submission they
-- belong to so the organizer send history is scoped per submission.
--
-- Nullable: every pre-existing row (start-link deliveries) keeps NULL and the
-- column is meaningless for them. SQLite ALTER TABLE ADD COLUMN can only carry
-- a single-column REFERENCES clause, and proposal_submissions is keyed by the
-- composite (event_id, id), so — as with the 0005 precedent — the event/
-- submission pairing is validated by the application before the insert.
ALTER TABLE captured_messages ADD COLUMN submission_id TEXT;

-- One acceptance message per submission: the UNIQUE index makes the "send
-- exactly once" rule a storage invariant, not just a service check (SQLite
-- treats NULLs as distinct, so start-link rows are unaffected).
CREATE UNIQUE INDEX idx_captured_messages_submission
  ON captured_messages(submission_id);
