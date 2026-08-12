-- Correct the uniqueness grain of cfp_condition_rules.
--
-- The original key was UNIQUE (version_id, element_id, group_index,
-- condition_index). It omits rule_id, so a version could hold only ONE rule per
-- element — while the domain reads several: `isElementVisible` looks at rules
-- whose effect is show/hide and `isElementRequired` at rules whose effect is
-- require, and the canonical configuration pairs both on one question ("this
-- appears for a workshop, and then it must be answered"). Saving that pair
-- failed with a UNIQUE violation, whether it came from the seed or from an
-- organizer using the condition-rule editor.
--
-- The grain that matches the model is one row per condition WITHIN a rule, so
-- rule_id replaces element_id in the key. element_id stays a column, still
-- indexed by the event/version lookup and still guarded by the same-version
-- triggers.
--
-- SQLite cannot alter a table-level UNIQUE, so the table is rebuilt. Nothing
-- references cfp_condition_rules by foreign key, so no inbound reference is
-- rewritten by the rename. Rows are copied column-for-column before the old
-- table is dropped, and every index and trigger the dropped table carried is
-- recreated below, verbatim: DROP TABLE takes a table's triggers and indexes
-- with it, and losing the publish-immutability guards would be a far worse
-- defect than the one being fixed.
--
-- The copy touches no row of the old table (INSERT ... SELECT only reads it) and
-- DROP TABLE does not fire row triggers, so the immutability guards cannot abort
-- this migration on an event whose version is already published.

CREATE TABLE cfp_condition_rules_new (
  event_id        TEXT NOT NULL,
  id              TEXT NOT NULL,
  rule_id         TEXT NOT NULL,
  version_id      TEXT NOT NULL,
  element_id      TEXT NOT NULL,
  group_index     INTEGER NOT NULL CHECK (group_index >= 0),
  condition_index INTEGER NOT NULL CHECK (condition_index >= 0),
  operator        TEXT NOT NULL CHECK (operator IN
    ('eq', 'ne', 'contains', 'gt', 'lt', 'empty', 'not-empty')),
  operand_key     TEXT NOT NULL,
  value_json      TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
  effect          TEXT NOT NULL CHECK (effect IN ('show', 'hide', 'require')),
  position        INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (event_id, id),
  UNIQUE (version_id, rule_id, group_index, condition_index),
  FOREIGN KEY (event_id, version_id) REFERENCES cfp_form_versions(event_id, id),
  FOREIGN KEY (event_id, element_id) REFERENCES cfp_elements(event_id, id)
);

INSERT INTO cfp_condition_rules_new (
  event_id, id, rule_id, version_id, element_id, group_index, condition_index,
  operator, operand_key, value_json, effect, position
)
SELECT
  event_id, id, rule_id, version_id, element_id, group_index, condition_index,
  operator, operand_key, value_json, effect, position
FROM cfp_condition_rules;

DROP TABLE cfp_condition_rules;

ALTER TABLE cfp_condition_rules_new RENAME TO cfp_condition_rules;

-- Recreated from 0003.
CREATE INDEX idx_cfp_condition_rules_event_version
  ON cfp_condition_rules(event_id, version_id);

-- Recreated from 0002.
CREATE TRIGGER cfp_condition_rules_no_update_when_published
BEFORE UPDATE ON cfp_condition_rules
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_form_versions v
   WHERE v.event_id = NEW.event_id AND v.id = NEW.version_id AND v.status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'content of a published form version is immutable');
END;

CREATE TRIGGER cfp_condition_rules_no_delete_when_published
BEFORE DELETE ON cfp_condition_rules
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_form_versions v
   WHERE v.event_id = OLD.event_id AND v.id = OLD.version_id AND v.status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'content of a published form version is immutable');
END;

-- Recreated from 0003.
CREATE TRIGGER cfp_condition_rules_element_same_version_insert
BEFORE INSERT ON cfp_condition_rules
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_elements e
   WHERE e.event_id = NEW.event_id AND e.id = NEW.element_id
     AND e.version_id <> NEW.version_id
)
BEGIN
  SELECT RAISE(ABORT, 'condition rule element must belong to the same form version');
END;

CREATE TRIGGER cfp_condition_rules_element_same_version_update
BEFORE UPDATE ON cfp_condition_rules
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_elements e
   WHERE e.event_id = NEW.event_id AND e.id = NEW.element_id
     AND e.version_id <> NEW.version_id
)
BEGIN
  SELECT RAISE(ABORT, 'condition rule element must belong to the same form version');
END;
