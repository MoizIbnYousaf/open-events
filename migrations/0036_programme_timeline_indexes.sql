-- Read-only programme timeline projection. These indexes support bounded,
-- independently prepared source reads; no generic activity table is created.

CREATE INDEX idx_proposal_submissions_event_submitted
  ON proposal_submissions(event_id, submitted_at DESC, id);

CREATE INDEX idx_evaluation_assignments_event_created
  ON evaluation_assignments(event_id, created_at DESC, id);
CREATE INDEX idx_evaluation_assignments_event_recused
  ON evaluation_assignments(event_id, recused_at DESC, id)
  WHERE recused_at IS NOT NULL;

CREATE INDEX idx_evaluation_scores_event_updated
  ON evaluation_scores(event_id, updated_at DESC, assignment_id);
CREATE INDEX idx_evaluation_round_scores_event_updated
  ON evaluation_round_scores(event_id, updated_at DESC, assignment_id);

CREATE INDEX idx_submission_decisions_event_decided
  ON submission_decisions(event_id, decided_at DESC, id);

CREATE INDEX idx_speaker_tasks_event_created
  ON speaker_tasks(event_id, created_at DESC, id);
CREATE INDEX idx_speaker_tasks_event_completed
  ON speaker_tasks(event_id, completed_at DESC, id)
  WHERE completed_at IS NOT NULL;

CREATE INDEX idx_captured_messages_event_created
  ON captured_messages(event_id, created_at DESC, id);

CREATE INDEX idx_agenda_sessions_event_updated
  ON agenda_sessions(event_id, updated_at DESC, submission_id)
  WHERE assignment = 'scheduled';
