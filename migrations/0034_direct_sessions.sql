-- Migration number: 0034  2026-08-17T12:00:00.000Z

ALTER TABLE cfp_forms
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'public'
  CHECK (purpose IN ('public', 'direct'));

ALTER TABLE proposal_submissions
  ADD COLUMN source TEXT NOT NULL DEFAULT 'cfp'
  CHECK (source IN ('cfp', 'direct'));

CREATE INDEX idx_cfp_forms_event_purpose ON cfp_forms(event_id, purpose, slug);
CREATE INDEX idx_proposal_submissions_event_source
  ON proposal_submissions(event_id, source, submitted_at);
