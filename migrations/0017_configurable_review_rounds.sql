-- Migration number: 0017 	2026-08-12T21:00:00.000Z

-- Independent, configurable review rounds.
--
-- A round could hold a number, a name and open/closed, and nothing else. Every
-- round of an event therefore scored against ONE shared rubric, so a
-- shortlisting round and a final round could not ask different questions — and
-- a criterion could only ever be a name with a numeric weight, so a programme
-- that wanted "which track does this belong in" (a choice) or "what should we
-- tell the speaker" (prose) had nowhere to put it.
--
-- Two changes, kept deliberately apart.

-- 1. The round's own configuration. ADDITIVE COLUMNS, never a rebuild.
--
-- `evaluation_rounds` carries the `evaluation_rounds_no_reopen` trigger, and a
-- DROP TABLE takes its triggers and indexes with it — the failure migration
-- 0015 documented, where an incomplete rebuild would have silently discarded
-- four publish-immutability guards while every test still passed. ALTER TABLE
-- ADD COLUMN touches none of that.
--
-- All three are nullable or defaulted, so every round that already exists reads
-- as "no dates set, not anonymized" rather than as invalid. Backward
-- compatibility is the default path here, not a backfill step.
ALTER TABLE evaluation_rounds ADD COLUMN opens_at TEXT;
ALTER TABLE evaluation_rounds ADD COLUMN closes_at TEXT;

-- Whether reviewers see each other's identities in this round. Per-round,
-- because blind first-pass then open discussion is the ordinary shape of a
-- programme committee, and a single event-wide flag cannot express it.
ALTER TABLE evaluation_rounds ADD COLUMN anonymize INTEGER NOT NULL DEFAULT 0
  CHECK (anonymize IN (0, 1));

-- 2. The round's own scorecard: a NEW table beside the event-level rubric.
--
-- NOT a widening of `evaluation_criteria`. Scoping that table to a round means
-- dropping its `UNIQUE (event_id, name)` — two rounds may reasonably both ask
-- "Relevance" — and SQLite can only drop a table-level constraint by rebuilding
-- the table. `evaluation_scores` holds a foreign key into `evaluation_criteria`,
-- so that rebuild would disturb stored scores in order to add a feature that
-- does not need to touch them. The event-level rubric keeps its job; this table
-- is what a round asks.
--
-- `kind` is the whole point of the change:
--   'rating' — a number on a scale, the only thing the product could express
--   'select' — one of a fixed list of options
--   'text'   — prose, with no scale at all
--
-- `config_json` carries what only that kind needs: {"min":1,"max":5} for a
-- rating, {"options":["…"]} for a select, and nothing for text. It is a JSON
-- object rather than columns because a scale and an option list have no shape
-- in common, and NULL columns that are meaningless for four of five rows
-- describe the schema worse than one honest blob does.
--
-- `weight` belongs to a 'rating' and to nothing else. Prose does not average,
-- and neither does a chosen option — "AI Engineering" times three is not a
-- number. So only a rating carries weight, a weighted total is the sum over
-- exactly the criteria that have one, and there is never a stored weight the
-- arithmetic has to remember to ignore.
CREATE TABLE evaluation_round_criteria (
  event_id    TEXT NOT NULL,
  id          TEXT NOT NULL,
  round_id    TEXT NOT NULL,
  position    INTEGER NOT NULL CHECK (position >= 0),
  label       TEXT NOT NULL CHECK (length(trim(label)) > 0),
  kind        TEXT NOT NULL CHECK (kind IN ('rating', 'select', 'text')),
  weight      INTEGER CHECK (weight IS NULL OR weight >= 1),
  config_json TEXT CHECK (config_json IS NULL OR json_valid(config_json)),
  PRIMARY KEY (event_id, id),
  -- Two criteria of one round may not sit on the same rung, so a saved
  -- scorecard reloads in the order it was written rather than an arbitrary one.
  UNIQUE (event_id, round_id, position),
  -- Exactly the ratings carry weight; a chosen option and a paragraph do not.
  CHECK ((kind = 'rating' AND weight IS NOT NULL) OR (kind <> 'rating' AND weight IS NULL)),
  FOREIGN KEY (event_id, round_id) REFERENCES evaluation_rounds(event_id, id)
);

CREATE UNIQUE INDEX idx_evaluation_round_criteria_id ON evaluation_round_criteria(id);
CREATE INDEX idx_evaluation_round_criteria_round
  ON evaluation_round_criteria(event_id, round_id, position);

-- 3. What a reviewer ANSWERS on a typed scorecard.
--
-- A new table rather than a widening of `evaluation_scores`, for a reason the
-- old column makes unavoidable: `rating INTEGER NOT NULL CHECK (1..5)` cannot
-- hold "AI Engineering" or a paragraph, and its foreign key points at the
-- event-level `evaluation_criteria` rather than at a round's own criteria.
-- Widening it would mean making `rating` nullable and repointing a foreign key
-- under every score already submitted.
--
-- So the two live side by side, and which one is in play is decided by whether
-- the round HAS a typed scorecard:
--   * round with no round criteria -> the legacy single-criterion path, exactly
--     as before; every score already recorded keeps its meaning and its FK
--   * round with a scorecard       -> answers land here, one row per criterion
--
-- `value_number` carries a rating; `value_text` carries a chosen option or
-- prose. Exactly one is set, because a criterion has one answer and a row with
-- both would leave the reader to guess which the reviewer meant.
CREATE TABLE evaluation_round_scores (
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
  FOREIGN KEY (event_id, criterion_id) REFERENCES evaluation_round_criteria(event_id, id)
);

CREATE UNIQUE INDEX idx_evaluation_round_scores_id ON evaluation_round_scores(id);
CREATE INDEX idx_evaluation_round_scores_assignment
  ON evaluation_round_scores(event_id, assignment_id);

-- 4. Who reviews in THIS round.
--
-- A committee is the people an event trusts; a round's pool is which of them
-- are reading this time. Being on the committee is still the authority — the
-- seat is what grants access — so a pool row is a narrowing of that seat and
-- never a grant on its own. The foreign key says so: losing the seat takes the
-- pool membership with it, so a removed reviewer cannot linger in a round.
CREATE TABLE evaluation_round_pool (
  event_id   TEXT NOT NULL,
  round_id   TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  added_at   TEXT NOT NULL CHECK (length(added_at) = 24),
  PRIMARY KEY (event_id, round_id, contact_id),
  FOREIGN KEY (event_id, round_id) REFERENCES evaluation_rounds(event_id, id),
  FOREIGN KEY (event_id, contact_id)
    REFERENCES evaluation_committee_members(event_id, contact_id) ON DELETE CASCADE
);

CREATE INDEX idx_evaluation_round_pool_round
  ON evaluation_round_pool(event_id, round_id);
