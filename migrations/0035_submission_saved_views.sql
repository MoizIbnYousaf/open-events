PRAGMA foreign_keys = ON;

-- Event-wide organizer views. The current organizer actor has no stable user
-- identity, so ownership is deliberately the event rather than an invented
-- per-person key.
CREATE TABLE submission_saved_views (
  event_id      TEXT NOT NULL,
  id            TEXT NOT NULL,
  name          TEXT NOT NULL COLLATE NOCASE
                CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 120),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  state_json    TEXT NOT NULL
                CHECK (json_valid(state_json)
                  AND json_type(state_json) = 'object'
                  AND length(state_json) <= 8192
                  AND json_extract(state_json, '$.schemaVersion') = schema_version),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (event_id, id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE UNIQUE INDEX submission_saved_views_event_name
  ON submission_saved_views(event_id, name);
