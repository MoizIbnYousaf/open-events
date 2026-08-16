-- Expansion phase for purpose-bound submitter links and sessions. Columns are
-- nullable for the staged rollout. The capability-aware Release A remains the
-- only rollback target once any purpose-bound write exists; the pre-0026 broad
-- reader is schema-compatible only before activation and is forbidden after
-- that point. Release A writes null CFP credentials, Release B writes purpose,
-- and only after B is at 100% is the final legacy-writer cutoff recorded.
ALTER TABLE submitter_tokens ADD COLUMN purpose TEXT
  CHECK (purpose IS NULL OR purpose IN ('cfp', 'portal', 'evaluation'));

ALTER TABLE sessions ADD COLUMN capability TEXT
  CHECK (capability IS NULL OR capability IN ('cfp', 'portal', 'evaluation'));

-- Legacy acceptance/reminder captures may contain a static `/portal` path.
-- Keep those immutable for audit, but distinguish the one access-bound
-- replacement so an upgraded Worker can issue a usable clean-browser link.
ALTER TABLE captured_messages ADD COLUMN role_access_token_id TEXT
  REFERENCES submitter_tokens(id);

DROP INDEX idx_captured_messages_submission_kind_email;
CREATE UNIQUE INDEX idx_captured_messages_legacy_submission_kind_email
  ON captured_messages(submission_id, kind, to_email)
  WHERE submission_id IS NOT NULL AND role_access_token_id IS NULL;
CREATE UNIQUE INDEX idx_captured_messages_access_submission_kind_email
  ON captured_messages(submission_id, kind, to_email)
  WHERE submission_id IS NOT NULL AND role_access_token_id IS NOT NULL;

-- A successful CFP submit consumes its CFP session and creates the portal
-- session in the same D1 batch. The raw portal secret is deterministically
-- derived from the high-entropy CFP/legacy secret and origin draft id, so a browser
-- that lost the response can reissue the exact same cookie without storing a
-- recoverable secret. This row is the authoritative, narrow retry grant.
CREATE TABLE submit_session_handoffs (
  cfp_session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  origin_draft_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  submission_id TEXT NOT NULL UNIQUE REFERENCES proposal_submissions(id),
  portal_session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_submit_session_handoffs_retry
  ON submit_session_handoffs(cfp_session_id, origin_draft_id, request_hash);

-- Transaction-local assertion sink. The submit adapter inserts 1 then deletes
-- it in the same batch; a missing handoff attempts to insert 0, making SQLite
-- abort and roll back every business write in that batch.
CREATE TABLE submit_handoff_assertions (
  id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);
