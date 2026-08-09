-- Migration number: 0002 	 2026-08-08T15:53:57.612Z

-- M2 event configuration columns (nullable; validated by the application).
ALTER TABLE events ADD COLUMN website_url TEXT;
ALTER TABLE events ADD COLUMN organizer_contact TEXT;
ALTER TABLE events ADD COLUMN venue TEXT;
ALTER TABLE events ADD COLUMN event_type TEXT;

-- Global identity tables (no event_id): contacts are email-deduped across
-- events; the event-scoped subject is the session/token row.
CREATE TABLE contacts (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (email = trim(lower(email))),
  CHECK (instr(email, '@') BETWEEN 2 AND length(email) - 1),
  CHECK (email NOT LIKE '% %'),
  CHECK (length(created_at) = 24)
);

CREATE TABLE submitter_tokens (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id),
  contact_id  TEXT NOT NULL REFERENCES contacts(id),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL,
  CHECK (length(token_hash) = 64),
  CHECK (length(expires_at) = 24 AND length(created_at) = 24),
  CHECK (consumed_at IS NULL OR length(consumed_at) = 24)
);
CREATE INDEX idx_submitter_tokens_event_contact
  ON submitter_tokens(event_id, contact_id);

-- One discriminated sessions table: organizer rows carry no subject;
-- submitter rows carry the persisted contact and event scope.
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('organizer', 'submitter')),
  contact_id  TEXT,
  event_id    TEXT,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL,
  CHECK ((kind = 'organizer' AND contact_id IS NULL AND event_id IS NULL) OR
         (kind = 'submitter' AND contact_id IS NOT NULL AND event_id IS NOT NULL)),
  CHECK (length(token_hash) = 64),
  CHECK (length(expires_at) = 24 AND length(created_at) = 24),
  CHECK (consumed_at IS NULL OR length(consumed_at) = 24),
  FOREIGN KEY (contact_id) REFERENCES contacts(id),
  FOREIGN KEY (event_id)   REFERENCES events(id)
);

-- Organizer-owned vocabulary; every event-scoped parent declares
-- UNIQUE/PRIMARY KEY (event_id, id) so children can use composite FKs.
CREATE TABLE taxonomy_items (
  event_id TEXT NOT NULL,
  id       TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('format', 'track', 'room', 'level', 'language', 'tag')),
  key      TEXT NOT NULL,
  label    TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (event_id, id),
  UNIQUE (event_id, kind, key)
);

CREATE TABLE cfp_forms (
  event_id             TEXT NOT NULL,
  id                   TEXT NOT NULL,
  slug                 TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  published_version_id TEXT,
  opens_at             TEXT,
  closes_at            TEXT,
  total_cap            INTEGER,
  per_identity_limit   INTEGER,
  PRIMARY KEY (event_id, id),
  UNIQUE (event_id, slug),
  CHECK (status = 'draft' OR published_version_id IS NOT NULL),
  CHECK (total_cap IS NULL OR total_cap > 0),
  CHECK (per_identity_limit IS NULL OR per_identity_limit > 0),
  CHECK (opens_at IS NULL OR length(opens_at) = 24),
  CHECK (closes_at IS NULL OR length(closes_at) = 24),
  CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at)
);

CREATE TABLE cfp_form_versions (
  event_id     TEXT NOT NULL,
  id           TEXT NOT NULL,
  form_id      TEXT NOT NULL,
  version      INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  content_hash TEXT,
  published_at TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (event_id, id),
  UNIQUE (event_id, form_id, version),
  CHECK (version >= 1),
  CHECK (length(updated_at) = 24),
  CHECK (published_at IS NULL OR length(published_at) = 24),
  CHECK ((status = 'published' AND content_hash IS NOT NULL AND published_at IS NOT NULL) OR
         (status = 'draft' AND content_hash IS NULL AND published_at IS NULL)),
  FOREIGN KEY (event_id, form_id) REFERENCES cfp_forms(event_id, id)
);

CREATE TABLE cfp_pages (
  event_id   TEXT NOT NULL,
  id         TEXT NOT NULL,
  version_id TEXT NOT NULL,
  position   INTEGER NOT NULL CHECK (position >= 0),
  kind       TEXT NOT NULL CHECK (kind IN ('welcome', 'info', 'review', 'submit')),
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  PRIMARY KEY (event_id, id),
  UNIQUE (version_id, position),
  FOREIGN KEY (event_id, version_id) REFERENCES cfp_form_versions(event_id, id)
);

CREATE TABLE cfp_elements (
  event_id      TEXT NOT NULL,
  id            TEXT NOT NULL,
  version_id    TEXT NOT NULL,
  page_id       TEXT NOT NULL,
  position      INTEGER NOT NULL CHECK (position >= 0),
  kind          TEXT NOT NULL CHECK (kind IN ('field', 'question', 'richtext', 'heading', 'divider')),
  field_key     TEXT,
  label         TEXT,
  required      INTEGER NOT NULL CHECK (required IN (0, 1)),
  max_length    INTEGER CHECK (max_length IS NULL OR max_length > 0),
  question_type TEXT CHECK (question_type IS NULL OR question_type IN
    ('short_text', 'long_text', 'email', 'number', 'single_choice', 'multi_choice')),
  options_json  TEXT CHECK (options_json IS NULL OR
    (json_valid(options_json) AND json_type(options_json) = 'array')),
  PRIMARY KEY (event_id, id),
  UNIQUE (version_id, page_id, position),
  UNIQUE (version_id, field_key),
  FOREIGN KEY (event_id, version_id) REFERENCES cfp_form_versions(event_id, id),
  FOREIGN KEY (event_id, page_id)    REFERENCES cfp_pages(event_id, id)
);

-- One row per condition inside a rule group; rule_id preserves the domain
-- ElementRule id across the rule's condition rows.
CREATE TABLE cfp_condition_rules (
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
  UNIQUE (version_id, element_id, group_index, condition_index),
  FOREIGN KEY (event_id, version_id) REFERENCES cfp_form_versions(event_id, id),
  FOREIGN KEY (event_id, element_id) REFERENCES cfp_elements(event_id, id)
);

CREATE TABLE cfp_routing_rules (
  event_id       TEXT NOT NULL,
  id             TEXT NOT NULL,
  version_id     TEXT NOT NULL,
  position       INTEGER NOT NULL CHECK (position >= 0),
  condition_json TEXT NOT NULL CHECK (json_valid(condition_json)),
  action_kind    TEXT NOT NULL CHECK (action_kind IN
    ('assign_track', 'assign_tag', 'manual_review')),
  action_target  TEXT,
  PRIMARY KEY (event_id, id),
  UNIQUE (version_id, position),
  CHECK ((action_kind = 'manual_review' AND action_target IS NULL) OR
         (action_kind IN ('assign_track', 'assign_tag') AND action_target IS NOT NULL)),
  FOREIGN KEY (event_id, version_id) REFERENCES cfp_form_versions(event_id, id)
);

-- Speaker drafts and submissions. origin_draft_id is the GLOBAL idempotency
-- key (port contract); it deliberately has no FK to proposal_drafts because
-- the draft is deleted in the same submit batch.
CREATE TABLE proposal_drafts (
  id               TEXT NOT NULL,
  event_id         TEXT NOT NULL,
  owner_contact_id TEXT NOT NULL REFERENCES contacts(id),
  form_version_id  TEXT NOT NULL,
  title            TEXT NOT NULL,
  answers_json     TEXT NOT NULL CHECK (json_valid(answers_json) AND json_type(answers_json) = 'object'),
  created_at       TEXT NOT NULL CHECK (length(created_at) = 24),
  updated_at       TEXT NOT NULL CHECK (length(updated_at) = 24),
  PRIMARY KEY (event_id, id),
  CHECK (updated_at >= created_at),
  FOREIGN KEY (event_id, form_version_id) REFERENCES cfp_form_versions(event_id, id)
);
CREATE INDEX idx_drafts_event_owner ON proposal_drafts(event_id, owner_contact_id);

CREATE TABLE proposal_submissions (
  id               TEXT NOT NULL,
  event_id         TEXT NOT NULL,
  owner_contact_id TEXT NOT NULL REFERENCES contacts(id),
  form_version_id  TEXT NOT NULL,
  origin_draft_id  TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL CHECK (status IN ('pending')),
  title            TEXT NOT NULL,
  answers_json     TEXT NOT NULL CHECK (json_valid(answers_json) AND json_type(answers_json) = 'object'),
  content_hash     TEXT NOT NULL CHECK (length(content_hash) = 64),
  routing_json     TEXT CHECK (routing_json IS NULL OR json_valid(routing_json)),
  created_at       TEXT NOT NULL CHECK (length(created_at) = 24),
  submitted_at     TEXT NOT NULL CHECK (length(submitted_at) = 24),
  PRIMARY KEY (event_id, id),
  CHECK (submitted_at >= created_at),
  FOREIGN KEY (event_id, form_version_id) REFERENCES cfp_form_versions(event_id, id)
);
CREATE INDEX idx_submissions_event_version_owner
  ON proposal_submissions(event_id, form_version_id, owner_contact_id);

CREATE TABLE submission_contributors (
  event_id      TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  contact_id    TEXT NOT NULL REFERENCES contacts(id),
  role          TEXT NOT NULL CHECK (role IN ('primary', 'co-speaker')),
  position      INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (submission_id, contact_id),
  FOREIGN KEY (event_id, submission_id) REFERENCES proposal_submissions(event_id, id)
);
CREATE INDEX idx_contributors_event_submission
  ON submission_contributors(event_id, submission_id);

CREATE TABLE captured_messages (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id),
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK (length(created_at) = 24)
);
CREATE INDEX idx_captured_messages_email ON captured_messages(to_email);

CREATE TABLE confirmation_records (
  id                  TEXT PRIMARY KEY,
  event_id            TEXT NOT NULL,
  submission_id       TEXT NOT NULL UNIQUE,
  captured_message_id TEXT NOT NULL REFERENCES captured_messages(id),
  created_at          TEXT NOT NULL CHECK (length(created_at) = 24),
  FOREIGN KEY (event_id, submission_id) REFERENCES proposal_submissions(event_id, id)
);

-- Published-version immutability: RAISE(ABORT) rolls back the whole batch.
CREATE TRIGGER cfp_form_versions_no_update_when_published
BEFORE UPDATE ON cfp_form_versions
FOR EACH ROW WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published form version is immutable');
END;

CREATE TRIGGER cfp_form_versions_no_delete_when_published
BEFORE DELETE ON cfp_form_versions
FOR EACH ROW WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published form version is immutable');
END;

CREATE TRIGGER cfp_pages_no_update_when_published
BEFORE UPDATE ON cfp_pages
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_form_versions v
   WHERE v.event_id = NEW.event_id AND v.id = NEW.version_id AND v.status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'content of a published form version is immutable');
END;

CREATE TRIGGER cfp_pages_no_delete_when_published
BEFORE DELETE ON cfp_pages
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_form_versions v
   WHERE v.event_id = OLD.event_id AND v.id = OLD.version_id AND v.status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'content of a published form version is immutable');
END;

CREATE TRIGGER cfp_elements_no_update_when_published
BEFORE UPDATE ON cfp_elements
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_form_versions v
   WHERE v.event_id = NEW.event_id AND v.id = NEW.version_id AND v.status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'content of a published form version is immutable');
END;

CREATE TRIGGER cfp_elements_no_delete_when_published
BEFORE DELETE ON cfp_elements
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_form_versions v
   WHERE v.event_id = OLD.event_id AND v.id = OLD.version_id AND v.status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'content of a published form version is immutable');
END;

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

CREATE TRIGGER cfp_routing_rules_no_update_when_published
BEFORE UPDATE ON cfp_routing_rules
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_form_versions v
   WHERE v.event_id = NEW.event_id AND v.id = NEW.version_id AND v.status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'content of a published form version is immutable');
END;

CREATE TRIGGER cfp_routing_rules_no_delete_when_published
BEFORE DELETE ON cfp_routing_rules
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_form_versions v
   WHERE v.event_id = OLD.event_id AND v.id = OLD.version_id AND v.status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'content of a published form version is immutable');
END;
