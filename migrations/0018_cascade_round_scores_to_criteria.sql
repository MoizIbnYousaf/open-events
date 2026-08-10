-- Migration number: 0018 	2026-08-12T22:30:00.000Z

-- Let an organizer edit a round's scorecard after a reviewer has answered it.
--
-- `evaluation_round_scores.criterion_id` referenced `evaluation_round_criteria`
-- with no ON DELETE action. Saving a scorecard replaces its questions wholesale
-- (delete-then-reinsert), and a recorded answer points at the question row it
-- answered — so the moment the first reviewer answered anything, every later
-- save was refused with FOREIGN KEY constraint failed and the scorecard became
-- permanently uneditable. Exactly when an organizer most wants to fix a typo in
-- a question is when the product stopped letting them.
--
-- 0017 is already committed and may already be applied, so this is a FORWARD
-- migration rather than an edit to it: a database that ran 0017 must reach the
-- corrected shape, and a fresh database must reach the same place.
--
-- SQLite cannot alter a foreign key, so the table is rebuilt. Everything it
-- carried is recreated below — both indexes, both CHECKs, the composite primary
-- key and the (assignment_id, criterion_id) uniqueness that makes re-scoring an
-- edit rather than an accumulation. `DROP TABLE` takes a table's indexes and
-- triggers with it, and losing one silently would be a worse defect than the one
-- being fixed. (This table carries no trigger of its own; the round no-reopen
-- trigger belongs to `evaluation_rounds` and is untouched by this rebuild.)
--
-- Existing answers are copied column-for-column before the old table is dropped,
-- so a reviewer's recorded scores survive the upgrade.

CREATE TABLE evaluation_round_scores_new (
  event_id      TEXT NOT NULL,
  id            TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  criterion_id  TEXT NOT NULL,
  value_number  INTEGER,
  value_text    TEXT,
  created_at    TEXT NOT NULL CHECK (length(created_at) = 24),
  updated_at    TEXT NOT NULL CHECK (length(updated_at) = 24),
  PRIMARY KEY (event_id, id),
  -- One answer per criterion per assignment, so re-scoring edits rather than
  -- accumulates and reopening shows one value.
  UNIQUE (assignment_id, criterion_id),
  CHECK (
    (value_number IS NOT NULL AND value_text IS NULL) OR
    (value_number IS NULL AND value_text IS NOT NULL)
  ),
  CHECK (updated_at >= created_at),
  FOREIGN KEY (event_id, assignment_id) REFERENCES evaluation_assignments(event_id, id),
  -- The correction. Matches the pool's FK in 0017, which cascades for the same
  -- reason: a child row must not outlive, or veto the removal of, its parent.
  FOREIGN KEY (event_id, criterion_id)
    REFERENCES evaluation_round_criteria(event_id, id) ON DELETE CASCADE
);

INSERT INTO evaluation_round_scores_new (
  event_id, id, assignment_id, criterion_id, value_number, value_text, created_at, updated_at
)
SELECT
  event_id, id, assignment_id, criterion_id, value_number, value_text, created_at, updated_at
FROM evaluation_round_scores;

DROP TABLE evaluation_round_scores;

ALTER TABLE evaluation_round_scores_new RENAME TO evaluation_round_scores;

-- Recreated from 0017, verbatim.
CREATE UNIQUE INDEX idx_evaluation_round_scores_id ON evaluation_round_scores(id);
CREATE INDEX idx_evaluation_round_scores_assignment
  ON evaluation_round_scores(event_id, assignment_id);
