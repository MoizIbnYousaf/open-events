-- Acceptance-only event reset evidence. The authorization row exists only
-- inside one D1 batch and narrows the two otherwise-immutable audit ledgers to
-- the exact event being destroyed by the release operator.
CREATE TABLE acceptance_reset_authorizations (
  event_id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK (length(created_at) = 24)
);

CREATE TABLE acceptance_reset_audits (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment = 'acceptance'),
  build_revision TEXT NOT NULL,
  d1_id TEXT NOT NULL,
  r2_bucket TEXT NOT NULL,
  object_count INTEGER NOT NULL CHECK (object_count >= 0),
  created_at TEXT NOT NULL CHECK (length(created_at) = 24)
);

CREATE TRIGGER trg_acceptance_reset_audits_immutable_update
BEFORE UPDATE ON acceptance_reset_audits
BEGIN
  SELECT RAISE(ABORT, 'acceptance reset audit rows are immutable');
END;

CREATE TRIGGER trg_acceptance_reset_audits_immutable_delete
BEFORE DELETE ON acceptance_reset_audits
BEGIN
  SELECT RAISE(ABORT, 'acceptance reset audit rows are immutable');
END;

DROP TRIGGER trg_captured_messages_immutable_delete;
CREATE TRIGGER trg_captured_messages_immutable_delete
BEFORE DELETE ON captured_messages
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM acceptance_reset_authorizations a WHERE a.event_id = OLD.event_id
)
BEGIN
  SELECT RAISE(ABORT, 'captured message audit rows are immutable');
END;

DROP TRIGGER trg_resend_webhook_events_immutable_delete;
CREATE TRIGGER trg_resend_webhook_events_immutable_delete
BEFORE DELETE ON resend_webhook_events
FOR EACH ROW WHEN OLD.job_id IS NULL OR NOT EXISTS (
  SELECT 1
  FROM acceptance_reset_authorizations a
  JOIN email_delivery_jobs j ON j.event_id = a.event_id
  WHERE j.id = OLD.job_id
)
BEGIN
  SELECT RAISE(ABORT, 'resend webhook evidence is immutable');
END;

-- The reset removes an entire event and then the release script reapplies the
-- committed fixture. Preserve normal published-version immutability while the
-- same transaction carries the one-event authorization row.
DROP TRIGGER cfp_form_versions_no_delete_when_published;
CREATE TRIGGER cfp_form_versions_no_delete_when_published
BEFORE DELETE ON cfp_form_versions
FOR EACH ROW WHEN OLD.status = 'published' AND NOT EXISTS (
  SELECT 1 FROM acceptance_reset_authorizations a WHERE a.event_id = OLD.event_id
)
BEGIN
  SELECT RAISE(ABORT, 'published form version is immutable');
END;

DROP TRIGGER cfp_pages_no_delete_when_published;
CREATE TRIGGER cfp_pages_no_delete_when_published
BEFORE DELETE ON cfp_pages
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_form_versions v
  WHERE v.event_id = OLD.event_id AND v.id = OLD.version_id AND v.status = 'published'
) AND NOT EXISTS (
  SELECT 1 FROM acceptance_reset_authorizations a WHERE a.event_id = OLD.event_id
)
BEGIN
  SELECT RAISE(ABORT, 'content of a published form version is immutable');
END;

DROP TRIGGER cfp_elements_no_delete_when_published;
CREATE TRIGGER cfp_elements_no_delete_when_published
BEFORE DELETE ON cfp_elements
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_form_versions v
  WHERE v.event_id = OLD.event_id AND v.id = OLD.version_id AND v.status = 'published'
) AND NOT EXISTS (
  SELECT 1 FROM acceptance_reset_authorizations a WHERE a.event_id = OLD.event_id
)
BEGIN
  SELECT RAISE(ABORT, 'content of a published form version is immutable');
END;

DROP TRIGGER cfp_condition_rules_no_delete_when_published;
CREATE TRIGGER cfp_condition_rules_no_delete_when_published
BEFORE DELETE ON cfp_condition_rules
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_form_versions v
  WHERE v.event_id = OLD.event_id AND v.id = OLD.version_id AND v.status = 'published'
) AND NOT EXISTS (
  SELECT 1 FROM acceptance_reset_authorizations a WHERE a.event_id = OLD.event_id
)
BEGIN
  SELECT RAISE(ABORT, 'content of a published form version is immutable');
END;

DROP TRIGGER cfp_routing_rules_no_delete_when_published;
CREATE TRIGGER cfp_routing_rules_no_delete_when_published
BEFORE DELETE ON cfp_routing_rules
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_form_versions v
  WHERE v.event_id = OLD.event_id AND v.id = OLD.version_id AND v.status = 'published'
) AND NOT EXISTS (
  SELECT 1 FROM acceptance_reset_authorizations a WHERE a.event_id = OLD.event_id
)
BEGIN
  SELECT RAISE(ABORT, 'content of a published form version is immutable');
END;
