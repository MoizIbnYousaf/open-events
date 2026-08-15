-- Migration number: 0024 	 2026-08-15T00:00:00.000Z
-- A criterion identity belongs to one evaluation round for its entire life.
-- This guard runs before INSERT conflict handling, so an id supplied from a
-- different round aborts the whole scorecard save instead of mutating that row.

CREATE TRIGGER evaluation_round_criteria_guard_round_reuse
BEFORE INSERT ON evaluation_round_criteria
WHEN EXISTS (
  SELECT 1
  FROM evaluation_round_criteria AS existing
  WHERE existing.event_id = NEW.event_id
    AND existing.id = NEW.id
    AND existing.round_id <> NEW.round_id
)
BEGIN
  SELECT RAISE(ABORT, 'criterion id belongs to another evaluation round');
END;
