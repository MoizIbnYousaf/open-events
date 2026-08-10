-- Migration number: 0010 	2026-08-10T12:00:00.000Z

-- Committee evaluation persistence. An organizer defines weighted criteria and
-- numbered review rounds for an event, assigns committee evaluators to
-- submissions, and reads the weighted totals of the ratings those evaluators
-- record.
--
-- Ids are globally unique per the 0004 convention, so a repository can look a
-- row up by id alone and still be safe across events; every child reaches its
-- parent through a composite (event_id, ...) foreign key, so no row can ever
-- straddle two events.

CREATE TABLE evaluation_criteria (
  event_id TEXT NOT NULL,
  id       TEXT NOT NULL,
  name     TEXT NOT NULL,
  weight   INTEGER NOT NULL CHECK (weight >= 1),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (event_id, id),
  UNIQUE (event_id, name),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE UNIQUE INDEX idx_evaluation_criteria_id ON evaluation_criteria(id);

-- `weights_json` is the rubric the round concluded under, written when the
-- round closes: a JSON array of {"criterionId","weight"}. Criteria weights are
-- event-level and the organizer retunes them between rounds, so joining them
-- at read time would silently rewrite a result the committee already
-- published. NULL while the round is open, because an open round is still
-- being decided and follows the live weights.
CREATE TABLE evaluation_rounds (
  event_id     TEXT NOT NULL,
  id           TEXT NOT NULL,
  number       INTEGER NOT NULL CHECK (number >= 1),
  name         TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  weights_json TEXT,
  PRIMARY KEY (event_id, id),
  UNIQUE (event_id, number),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE UNIQUE INDEX idx_evaluation_rounds_id ON evaluation_rounds(id);

-- A round only ever moves open -> closed. Reopening one inserts and deletes
-- nothing yet changes which round is live, and therefore rewrites weighted
-- totals the organizer has already read out — so the one-way rule is a storage
-- invariant here, as the published-version state machine is in 0002.
CREATE TRIGGER evaluation_rounds_no_reopen
BEFORE UPDATE ON evaluation_rounds
FOR EACH ROW WHEN OLD.status = 'closed' AND NEW.status = 'open'
BEGIN
  SELECT RAISE(ABORT, 'a closed review round cannot be reopened');
END;

-- One committee member reviewing one submission in one round. This row IS the
-- scoping rule: an evaluator can only read or write scores through it, so a
-- submission they were never assigned is invisible rather than merely denied.
CREATE TABLE evaluation_assignments (
  event_id             TEXT NOT NULL,
  id                   TEXT NOT NULL,
  round_id             TEXT NOT NULL,
  submission_id        TEXT NOT NULL,
  evaluator_contact_id TEXT NOT NULL REFERENCES contacts(id),
  created_at           TEXT NOT NULL CHECK (length(created_at) = 24),
  PRIMARY KEY (event_id, id),
  UNIQUE (round_id, submission_id, evaluator_contact_id),
  FOREIGN KEY (event_id, round_id) REFERENCES evaluation_rounds(event_id, id),
  FOREIGN KEY (event_id, submission_id) REFERENCES proposal_submissions(event_id, id)
);

CREATE UNIQUE INDEX idx_evaluation_assignments_id ON evaluation_assignments(id);
CREATE INDEX idx_evaluation_assignments_event_evaluator
  ON evaluation_assignments(event_id, evaluator_contact_id);
CREATE INDEX idx_evaluation_assignments_event_submission
  ON evaluation_assignments(event_id, submission_id);

-- One rating on one criterion of one assignment. Because an assignment belongs
-- to exactly one round, UNIQUE (assignment_id, criterion_id) is also the
-- per-round uniqueness rule: re-scoring updates the single existing row instead
-- of appending a second opinion, which is what makes the evaluator upsert
-- idempotent at the storage level rather than only in the service.
CREATE TABLE evaluation_scores (
  event_id      TEXT NOT NULL,
  id            TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  criterion_id  TEXT NOT NULL,
  rating        INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment       TEXT,
  created_at    TEXT NOT NULL CHECK (length(created_at) = 24),
  updated_at    TEXT NOT NULL CHECK (length(updated_at) = 24),
  PRIMARY KEY (event_id, id),
  UNIQUE (assignment_id, criterion_id),
  CHECK (updated_at >= created_at),
  FOREIGN KEY (event_id, assignment_id) REFERENCES evaluation_assignments(event_id, id),
  FOREIGN KEY (event_id, criterion_id) REFERENCES evaluation_criteria(event_id, id)
);

CREATE UNIQUE INDEX idx_evaluation_scores_id ON evaluation_scores(id);
CREATE INDEX idx_evaluation_scores_event_assignment
  ON evaluation_scores(event_id, assignment_id);

-- Who sits on an event's review committee. Assignments say what a member has
-- been given to read; this says that they are a member at all, which is the
-- difference between an evaluator whose queue is merely empty and a speaker
-- who was never on the committee. Without it the two are indistinguishable and
-- an empty queue has to be reported as a refusal.
--
-- No surface id: a membership is fully identified by (event, contact), so the
-- 0004 global-id convention has nothing to apply to.
CREATE TABLE evaluation_committee_members (
  event_id   TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  added_at   TEXT NOT NULL CHECK (length(added_at) = 24),
  PRIMARY KEY (event_id, contact_id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX idx_evaluation_committee_members_event
  ON evaluation_committee_members(event_id);
