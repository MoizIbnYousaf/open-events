-- Migration number: 0003 	 2026-08-08T16:17:52.091Z

-- Evidence-backed lookup indexes for repository reads (findById by global id,
-- form-scoped version reads, and form-content loads by event + version).
CREATE INDEX idx_cfp_form_versions_form_version
  ON cfp_form_versions(form_id, version);
CREATE UNIQUE INDEX idx_cfp_form_versions_id ON cfp_form_versions(id);

CREATE UNIQUE INDEX idx_proposal_submissions_id ON proposal_submissions(id);

CREATE INDEX idx_proposal_drafts_id ON proposal_drafts(id);
CREATE INDEX idx_cfp_forms_id ON cfp_forms(id);

CREATE INDEX idx_cfp_pages_event_version ON cfp_pages(event_id, version_id);
CREATE INDEX idx_cfp_elements_event_version ON cfp_elements(event_id, version_id);
CREATE INDEX idx_cfp_condition_rules_event_version
  ON cfp_condition_rules(event_id, version_id);
CREATE INDEX idx_cfp_routing_rules_event_version
  ON cfp_routing_rules(event_id, version_id);

-- Same-version membership integrity: content cross-references must stay inside
-- one form version. The composite FKs only prove existence; these triggers
-- prove version membership. Deliberately NO trigger on cfp_forms
-- (published_version_id) so publishing a later draft version stays possible.
CREATE TRIGGER cfp_elements_page_same_version_insert
BEFORE INSERT ON cfp_elements
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_pages p
   WHERE p.event_id = NEW.event_id AND p.id = NEW.page_id
     AND p.version_id <> NEW.version_id
)
BEGIN
  SELECT RAISE(ABORT, 'element page must belong to the same form version');
END;

CREATE TRIGGER cfp_elements_page_same_version_update
BEFORE UPDATE ON cfp_elements
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM cfp_pages p
   WHERE p.event_id = NEW.event_id AND p.id = NEW.page_id
     AND p.version_id <> NEW.version_id
)
BEGIN
  SELECT RAISE(ABORT, 'element page must belong to the same form version');
END;

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
