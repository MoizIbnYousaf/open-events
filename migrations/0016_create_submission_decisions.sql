-- Migration number: 0016 	2026-08-12T09:00:00.000Z

-- The programme decision, both ways round, and every time it moved. Until now
-- the only verdict the schema could hold was `submission_acceptances`, an
-- accept-only table: a proposal an organizer had declined was stored exactly
-- like one nobody had opened yet, so no surface could tell a rejection from a
-- pending review.
--
-- This is a NEW table beside the acceptance record rather than a rebuild of it.
-- `speaker_tasks` and `agenda_sessions` both carry composite foreign keys into
-- `submission_acceptances`, so widening that table would mean dropping and
-- recreating it (and every index and trigger it carries) underneath live child
-- rows. The acceptance record keeps its one job — it is what onboarding and the
-- agenda hang off — and this table is the authority on the outcome itself.
--
-- APPEND-ONLY. Changing a decision is a supported organizer action, not an edge
-- case, so one row per submission would mean that after two clicks the database
-- could no longer say a proposal had ever been accepted. Each verdict is its own
-- row, numbered per submission by `sequence`; the standing decision is the
-- highest sequence, and the rows below it are the trail of who changed their
-- mind and when. `sequence` rather than `decided_at` orders the trail because
-- two verdicts recorded inside the same millisecond would tie on the instant and
-- leave the current decision undefined.
--
-- `decided_by` records the acting role, not a person: the organizer session is
-- a single non-forgeable role marker with no contact identity behind it
-- (`OrganizerActor`), so storing anything person-shaped here would be invented.
CREATE TABLE submission_decisions (
  event_id      TEXT NOT NULL,
  id            TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  sequence      INTEGER NOT NULL CHECK (sequence >= 1),
  outcome       TEXT NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  decided_by    TEXT NOT NULL,
  decided_at    TEXT NOT NULL CHECK (length(decided_at) = 24),
  PRIMARY KEY (event_id, id),
  UNIQUE (event_id, submission_id, sequence),
  FOREIGN KEY (event_id, submission_id) REFERENCES proposal_submissions(event_id, id)
);

CREATE UNIQUE INDEX idx_submission_decisions_id ON submission_decisions(id);
CREATE INDEX idx_submission_decisions_event_submission
  ON submission_decisions(event_id, submission_id, sequence);

-- Every acceptance that already exists IS an accepted decision, and its own
-- instant is the honest one to record. Without this backfill a database that
-- accepted proposals before this migration would report them as undecided.
-- These are the first verdict on their submission, hence sequence 1.
INSERT INTO submission_decisions
  (event_id, id, submission_id, sequence, outcome, decided_by, decided_at)
SELECT event_id, 'decision-' || submission_id, submission_id, 1, 'accepted', 'organizer', accepted_at
FROM submission_acceptances;
