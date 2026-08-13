-- A question can take its choices from the event's own vocabulary instead of
-- keeping a private copy of it.
--
-- The Format taxonomy and the form's `format` question were two independent
-- records of one list. An organizer adding "Keynote" on the Taxonomies page
-- changed nothing on the public form, and nothing anywhere said so — the
-- submitter was simply never offered it. Same failure shape as the acceptance
-- row that disagreed with the decision row: one fact, stored twice.
--
-- NULL means the element keeps its own literal `options_json`, which is every
-- element that exists today. A kind here means the choices ARE that taxonomy,
-- resolved when the form is read.
--
-- ADDITIVE. `cfp_elements` is the target of foreign keys from the condition
-- rules and carries the version indexes, so a rebuild would take them with it —
-- the lesson 0015 wrote down and 0018 had to apply again.
--
-- ONE DELIBERATE CONSEQUENCE, stated here rather than discovered later: a
-- published version's frozen `options_json` stops being the answer for a
-- taxonomy-sourced element. Publish immutability holds for everything else and
-- is narrowly, knowingly broken here, because the whole point is that the
-- vocabulary can move after publication. What must NOT move underneath anyone
-- is a proposal already submitted: an answer that was valid when it was given
-- stays editable even after its item is withdrawn from the taxonomy.
ALTER TABLE cfp_elements ADD COLUMN options_source TEXT
  CHECK (options_source IS NULL OR options_source IN
    ('format', 'track', 'room', 'level', 'language', 'tag'));
