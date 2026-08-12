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

-- Formats and tracks are the programme's own vocabulary, and the public call for
-- papers offers these exact labels as its options. Tracks used to be a copy of
-- the format list ('Workshop', 'Talk'), which made the track question meaningless
-- — a submitter picked a format twice and the programme learned nothing about
-- subject matter.
INSERT INTO taxonomy_items (event_id, id, kind, key, label, position) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000501', 'format', 'workshop', 'Workshop', 0),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000502', 'format', 'talk', 'Talk', 1),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000507', 'format', 'lightning-talk', 'Lightning talk', 2),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000505', 'room', 'main-hall', 'Main hall', 0),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000506', 'room', 'workshop-a', 'Workshop A', 1),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000503', 'track', 'platform-infra', 'Platform & Infra', 0),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000504', 'track', 'ai-engineering', 'AI Engineering', 1),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000508', 'track', 'developer-experience', 'Developer Experience', 2)
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
  3
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

-- The call itself. This used to ask for a session format and, if that format was
-- Workshop, some details — so a proposal could be submitted complete with nothing
-- but a title, and the programme committee had nothing to review. Every question
-- below is an ordinary builder element: an organizer can retitle, reorder, retype,
-- or delete any of them, and the runtime reads the definition rather than knowing
-- these keys.
--
-- Option values are the labels a submitter reads. They are what the answer stores
-- and what the organizer sees on the submission, and they match the event's own
-- format and track vocabulary above.
INSERT INTO cfp_elements (event_id, id, version_id, page_id, position, kind,
                          field_key, label, required, max_length, question_type, options_json) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000201',
   'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000101',
   0, 'question', 'format', 'Session format', 1, NULL, 'single_choice',
   '["Talk","Workshop","Lightning talk"]'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000203',
   'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000101',
   1, 'question', 'track', 'Track', 1, NULL, 'single_choice',
   '["Platform & Infra","AI Engineering","Developer Experience"]'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000204',
   'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000101',
   2, 'question', 'abstract', 'Abstract', 1, 2000, 'long_text', NULL),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000205',
   'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000101',
   3, 'question', 'audience_level', 'Audience level', 1, NULL, 'single_choice',
   '["Beginner","Intermediate","Advanced"]'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000206',
   'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000101',
   4, 'question', 'key_takeaway', 'Key takeaway', 1, 200, 'short_text', NULL),
  -- Optional on its own and made mandatory by rule when the format is Workshop.
  -- The column flag stays 0 deliberately: a required-but-hidden field blocks a
  -- Talk submission on a question the submitter was never shown.
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000202',
   'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000101',
   5, 'question', 'workshop_details', 'Workshop details', 0, 2000, 'long_text', NULL),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000207',
   'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000102',
   0, 'question', 'speaker_bio', 'Speaker bio', 1, 1000, 'long_text', NULL),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000208',
   'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000102',
   1, 'question', 'job_title', 'Job title', 0, 120, 'short_text', NULL),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'f0000000-0000-4000-8000-000000000209',
   'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000102',
   2, 'question', 'company', 'Company', 0, 120, 'short_text', NULL)
ON CONFLICT(event_id, id) DO NOTHING;

-- Two effects on one question, because "appears for a workshop" and "must be
-- answered for a workshop" are different promises and the form has to keep both.
-- Show alone leaves an optional field nobody fills; require alone makes a hidden
-- question mandatory. The value is the option label, which is what the answer
-- holds.
INSERT INTO cfp_condition_rules (event_id, id, rule_id, version_id, element_id,
                                 group_index, condition_index, operator,
                                 operand_key, value_json, effect, position)
VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'f0000000-0000-4000-8000-000000000302',
   'f0000000-0000-4000-8000-000000000301',
   'f0000000-0000-4000-8000-000000000002',
   'f0000000-0000-4000-8000-000000000202',
   0, 0, 'eq', 'format', '"Workshop"', 'show', 0),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'f0000000-0000-4000-8000-000000000304',
   'f0000000-0000-4000-8000-000000000303',
   'f0000000-0000-4000-8000-000000000002',
   'f0000000-0000-4000-8000-000000000202',
   0, 0, 'eq', 'format', '"Workshop"', 'require', 1)
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO cfp_routing_rules (event_id, id, version_id, position,
                               condition_json, action_kind, action_target)
VALUES (
  'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  'f0000000-0000-4000-8000-000000000401',
  'f0000000-0000-4000-8000-000000000002',
  0,
  -- Routing reads the submitted answer, so it matches the option label the
  -- submitter actually chose; the target is still a taxonomy KEY.
  '{"groups":[{"conditions":[{"operator":"eq","operandKey":"track","value":"Platform & Infra"}]}]}',
  'assign_track',
  'platform-infra'
)
ON CONFLICT(event_id, id) DO NOTHING;

-- The demo cast, by the names the frozen scope uses: the organizer, the two
-- speakers, and the standing review committee. Contacts are keyed by email
-- (the identity dedupe key), so anyone who later starts a session reuses the
-- seeded row instead of creating a second identity.
INSERT INTO contacts (id, email, name, created_at) VALUES
  ('c0000000-0000-4000-8000-000000000601', 'reviewer.one@example.test', 'Reviewer One', '2026-01-01T09:00:00.000Z'),
  ('c0000000-0000-4000-8000-000000000602', 'reviewer.two@example.test', 'Reviewer Two', '2026-01-01T09:00:00.000Z'),
  ('c0000000-0000-4000-8000-000000000603', 'organizer@example.test', 'Demo Organizer', '2026-01-01T09:00:00.000Z'),
  ('c0000000-0000-4000-8000-000000000604', 'speaker.ada@example.test', 'Ada Speaker', '2026-01-01T09:00:00.000Z'),
  ('c0000000-0000-4000-8000-000000000605', 'speaker.grace@example.test', 'Grace Speaker', '2026-01-01T09:00:00.000Z')
ON CONFLICT(email) DO NOTHING;

-- One default weighted criterion and one open review round: the minimum an
-- evaluator needs to record a rating on a freshly reset database.
INSERT INTO evaluation_criteria (event_id, id, name, weight, position)
VALUES (
  'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  'e0000000-0000-4000-8000-000000000701',
  'Overall fit',
  1,
  0
)
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO evaluation_rounds (event_id, id, number, name, status)
VALUES (
  'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  'e0000000-0000-4000-8000-000000000702',
  1,
  'Round 1',
  'open'
)
ON CONFLICT(event_id, id) DO NOTHING;

-- Both reviewers sit on the standing committee from the first reset. Being on
-- the committee is what makes the evaluations surface theirs: a member with an
-- empty queue is told it is empty, while a speaker never sees it at all.
INSERT INTO evaluation_committee_members (event_id, contact_id, added_at) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'c0000000-0000-4000-8000-000000000601',
   '2026-01-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'c0000000-0000-4000-8000-000000000602',
   '2026-01-01T09:00:00.000Z')
ON CONFLICT(event_id, contact_id) DO NOTHING;

