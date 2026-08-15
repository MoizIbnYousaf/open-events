-- Migration number: 0023 	 2026-08-15T00:00:00.000Z
-- Organizer-configurable submit confirmation copy (REQ-005).

CREATE TABLE event_email_templates (
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('confirmation')),
  subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  PRIMARY KEY (event_id, kind),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
