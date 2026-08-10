-- Migration number: 0006 	2026-08-09T00:00:00.000Z

-- R4 agenda slice D1 — persistence for the accepted agenda domain contract
-- (src/domain/agenda.ts). Grounded ONLY in committed vocabulary: taxonomy
-- track/room ids (composite FKs to taxonomy_items), submission ids (composite
-- FK to proposal_submissions), event ids, UTC instants, and the agenda
-- day/status/assignment CHECKs. Slots are the embedded (day, start, end)
-- triple of the domain; no slot-id table is created (the domain defines no
-- slot identifier). Positions are scoped per room+slot via the UNIQUE
-- (event_id, room_id, day, start, end, position) constraint; unassigned rows
-- keep NULL room/position and never collide (SQLite UNIQUE treats NULLs as
-- distinct).

CREATE TABLE agenda_sessions (
  event_id      TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  track_id      TEXT,
  room_id       TEXT,
  day           TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start         TEXT NOT NULL CHECK (length(start) = 24),
  end           TEXT NOT NULL CHECK (length(end) = 24),
  position      INTEGER CHECK (position IS NULL OR position >= 0),
  status        TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  assignment    TEXT NOT NULL CHECK (assignment IN ('unassigned', 'scheduled')),
  created_at    TEXT NOT NULL CHECK (length(created_at) = 24),
  updated_at    TEXT NOT NULL CHECK (length(updated_at) = 24),
  PRIMARY KEY (event_id, submission_id),
  UNIQUE (submission_id),
  UNIQUE (event_id, room_id, day, start, end, position),
  CHECK (end > start),
  CHECK (updated_at >= created_at),
  CHECK (assignment = 'unassigned' OR (position IS NOT NULL AND room_id IS NOT NULL)),
  FOREIGN KEY (event_id, submission_id) REFERENCES proposal_submissions(event_id, id),
  FOREIGN KEY (event_id, track_id) REFERENCES taxonomy_items(event_id, id),
  FOREIGN KEY (event_id, room_id) REFERENCES taxonomy_items(event_id, id)
);

CREATE INDEX idx_agenda_sessions_event_day ON agenda_sessions(event_id, day);

CREATE TABLE agenda_session_speakers (
  event_id      TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  contact_id    TEXT NOT NULL REFERENCES contacts(id),
  PRIMARY KEY (event_id, submission_id, contact_id),
  UNIQUE (submission_id, contact_id),
  FOREIGN KEY (event_id, submission_id) REFERENCES agenda_sessions(event_id, submission_id)
);

CREATE INDEX idx_agenda_session_speakers_event_submission
  ON agenda_session_speakers(event_id, submission_id);
