-- Migration number: 0011 	2026-08-10T18:00:00.000Z

-- REQ-011 form-backed onboarding tasks. 0007 pinned the checklist kinds in a
-- CHECK constraint, which SQLite cannot alter in place, so speaker_tasks is
-- recreated with:
--   * a new 'complete_form' kind;
--   * form_id / form_version_id pinning the task to a real published form
--     version (both set exactly when kind = 'complete_form');
--   * response holding the validated answer payload, set exactly when a form
--     task is completed;
--   * the 0007 UNIQUE (submission_id, contact_id, kind) narrowed to checklist
--     rows, plus a partial unique index keyed by form so one speaker can hold
--     several distinct form tasks while re-assignment of the same form stays
--     idempotent.
-- Nothing references speaker_tasks by foreign key, so the copy is safe.

CREATE TABLE speaker_tasks_new (
  event_id        TEXT NOT NULL,
  id              TEXT NOT NULL,
  submission_id   TEXT NOT NULL,
  contact_id      TEXT NOT NULL REFERENCES contacts(id),
  kind            TEXT NOT NULL CHECK (kind IN ('confirm_participation', 'submit_bio', 'submit_headshot', 'complete_form')),
  status          TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  position        INTEGER NOT NULL CHECK (position >= 0),
  created_at      TEXT NOT NULL CHECK (length(created_at) = 24),
  completed_at    TEXT CHECK (completed_at IS NULL OR length(completed_at) = 24),
  form_id         TEXT REFERENCES cfp_forms(id),
  form_version_id TEXT REFERENCES cfp_form_versions(id),
  response        TEXT,
  PRIMARY KEY (event_id, id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK ((kind = 'complete_form') = (form_id IS NOT NULL)),
  CHECK ((kind = 'complete_form') = (form_version_id IS NOT NULL)),
  CHECK (response IS NULL OR (kind = 'complete_form' AND status = 'completed')),
  FOREIGN KEY (event_id, submission_id) REFERENCES submission_acceptances(event_id, submission_id)
);

INSERT INTO speaker_tasks_new
  (event_id, id, submission_id, contact_id, kind, status, position, created_at,
   completed_at, form_id, form_version_id, response)
SELECT event_id, id, submission_id, contact_id, kind, status, position,
       created_at, completed_at, NULL, NULL, NULL
FROM speaker_tasks;

DROP TABLE speaker_tasks;

ALTER TABLE speaker_tasks_new RENAME TO speaker_tasks;

CREATE UNIQUE INDEX idx_speaker_tasks_id ON speaker_tasks(id);
CREATE UNIQUE INDEX speaker_tasks_submission_contact_kind
  ON speaker_tasks(submission_id, contact_id, kind) WHERE form_id IS NULL;
CREATE UNIQUE INDEX speaker_tasks_submission_contact_form
  ON speaker_tasks(submission_id, contact_id, form_id) WHERE form_id IS NOT NULL;
CREATE INDEX idx_speaker_tasks_event_contact ON speaker_tasks(event_id, contact_id);
CREATE INDEX idx_speaker_tasks_event_submission ON speaker_tasks(event_id, submission_id);
