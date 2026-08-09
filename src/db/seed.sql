-- Deterministic DemoConf 2026 seed (UTC instants as ISO-8601 TEXT).
-- Idempotent: every INSERT is keyed by a stable id/slug with
-- ON CONFLICT ... DO NOTHING. Row order respects composite FK dependencies.
INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at,
                    website_url, organizer_contact, venue, event_type)
VALUES (
  'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  'demo-conf-2026',
  'DemoConf 2026',
  'Europe/Berlin',
  'draft',
  '2026-05-13T08:00:00.000Z',
  '2026-05-15T17:00:00.000Z',
  'https://example.test/demo-conf-2026',
  'programme@example.test',
  'DemoConf Convention Center, Berlin',
  'conference'
)
ON CONFLICT(slug) DO NOTHING;

INSERT INTO taxonomy_items (event_id, id, kind, key, label, position) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000501', 'format', 'workshop', 'Workshop', 0),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000502', 'format', 'talk', 'Talk', 1),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000505', 'room', 'main-hall', 'Main hall', 0),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000506', 'room', 'workshop-a', 'Workshop A', 1),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000503', 'track', 'workshop', 'Workshop', 0),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000504', 'track', 'talk', 'Talk', 1)
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                       opens_at, closes_at, total_cap, per_identity_limit)
VALUES (
  'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  'f0000000-0000-4000-8000-000000000001',
  'cfp',
  'published',
  'f0000000-0000-4000-8000-000000000002',
  '2026-01-01T00:00:00.000Z',
  '2026-12-31T23:59:59.000Z',
  100,
  1
)
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO cfp_form_versions (event_id, id, form_id, version, status,
                               content_hash, published_at, updated_at)
VALUES (
  'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  'f0000000-0000-4000-8000-000000000002',
  'f0000000-0000-4000-8000-000000000001',
  1,
  'published',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  '2026-01-01T09:00:00.000Z',
  '2026-01-01T09:00:00.000Z'
)
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO cfp_pages (event_id, id, version_id, position, kind, title, content) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000100',
   'f0000000-0000-4000-8000-000000000002', 0, 'welcome', 'Welcome',
   'Welcome to the DemoConf 2026 call for papers.'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000101',
   'f0000000-0000-4000-8000-000000000002', 1, 'info', 'Proposal information',
   'Tell us about your session.'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000102',
   'f0000000-0000-4000-8000-000000000002', 2, 'info', 'Participant information',
   'Help us plan the programme.'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000103',
   'f0000000-0000-4000-8000-000000000002', 3, 'submit', 'Review and submit',
   'Review your answers and submit.')
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO cfp_elements (event_id, id, version_id, page_id, position, kind,
                          field_key, label, required, max_length, question_type, options_json) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000201',
   'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000101',
   0, 'question', 'format', 'Session format', 1, NULL, 'single_choice', '["workshop","talk"]'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000202',
   'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000101',
   1, 'question', 'workshop_details', 'Workshop details', 1, 2000, 'long_text', NULL)
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO cfp_condition_rules (event_id, id, rule_id, version_id, element_id,
                                 group_index, condition_index, operator,
                                 operand_key, value_json, effect, position)
VALUES (
  'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  'f0000000-0000-4000-8000-000000000302',
  'f0000000-0000-4000-8000-000000000301',
  'f0000000-0000-4000-8000-000000000002',
  'f0000000-0000-4000-8000-000000000202',
  0, 0, 'eq', 'format', '"workshop"', 'show', 0
)
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO cfp_routing_rules (event_id, id, version_id, position,
                               condition_json, action_kind, action_target)
VALUES (
  'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  'f0000000-0000-4000-8000-000000000401',
  'f0000000-0000-4000-8000-000000000002',
  0,
  '{"groups":[{"conditions":[{"operator":"eq","operandKey":"format","value":"workshop"}]}]}',
  'assign_track',
  'workshop'
)
ON CONFLICT(event_id, id) DO NOTHING;
