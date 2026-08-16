-- Migration number: 0007 	2026-08-10T09:00:00.000Z

-- Onboarding core persistence. Acceptance is recorded as its own row rather
-- than as a mutation of proposal_submissions.status: the submission record is
-- append-only in this schema (0002 pins status to 'pending' and every child FK
-- targets it), so the acceptance record IS the accepted state and its single
-- UNIQUE(submission_id) is what makes acceptance idempotent under concurrency.
--
-- speaker_tasks holds the fixed onboarding checklist from
-- src/domain/speaker-task.ts (SPEAKER_TASK_KINDS x SPEAKER_TASK_STATUSES).
-- Ids are globally unique per the 0004 convention, composite FKs keep every
-- row inside one event, and UNIQUE (submission_id, contact_id, kind) is the
-- idempotency key a repeated acceptance conflicts against.

CREATE TABLE submission_acceptances (
  event_id      TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  accepted_at   TEXT NOT NULL CHECK (length(accepted_at) = 24),
  PRIMARY KEY (event_id, submission_id),
  UNIQUE (submission_id),
  FOREIGN KEY (event_id, submission_id) REFERENCES proposal_submissions(event_id, id)
);

CREATE TABLE speaker_tasks (
  event_id      TEXT NOT NULL,
  id            TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  contact_id    TEXT NOT NULL REFERENCES contacts(id),
  kind          TEXT NOT NULL CHECK (kind IN ('confirm_participation', 'submit_bio', 'submit_headshot')),
  status        TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  position      INTEGER NOT NULL CHECK (position >= 0),
  created_at    TEXT NOT NULL CHECK (length(created_at) = 24),
  completed_at  TEXT CHECK (completed_at IS NULL OR length(completed_at) = 24),
  PRIMARY KEY (event_id, id),
  UNIQUE (submission_id, contact_id, kind),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  FOREIGN KEY (event_id, submission_id) REFERENCES submission_acceptances(event_id, submission_id)
);

CREATE UNIQUE INDEX idx_speaker_tasks_id ON speaker_tasks(id);
CREATE INDEX idx_speaker_tasks_event_contact ON speaker_tasks(event_id, contact_id);
CREATE INDEX idx_speaker_tasks_event_submission ON speaker_tasks(event_id, submission_id);
