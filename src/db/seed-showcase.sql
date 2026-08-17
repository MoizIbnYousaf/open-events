-- DemoConf 2026 showcase overlay.
--
-- Apply after seed.sql and seed-programme.sql. Every synthetic identity uses a
-- reserved non-routable domain, every id is deterministic, and every statement
-- is idempotent. No token, provider id, ciphertext, or drain-eligible delivery
-- job is present in this fixture.

UPDATE events
SET status = 'published',
    starts_at = '2026-10-14T08:00:00.000Z',
    ends_at = '2026-10-15T17:00:00.000Z',
    website_url = 'https://www.openevents.engineer/schedule/demo-conf-2026'
WHERE id = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d';

-- A real editable demonstration draft copied from the published version. The
-- published version remains frozen and every copied id is deterministic.
INSERT INTO cfp_form_versions
  (event_id, id, form_id, version, status, content_hash, published_at, updated_at)
SELECT event_id, 'showcase-form-draft', form_id, 2, 'draft', NULL, NULL,
       '2026-08-15T16:00:00.000Z'
FROM cfp_form_versions
WHERE id = 'f0000000-0000-4000-8000-000000000002'
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO cfp_pages (event_id, id, version_id, position, kind, title, content)
SELECT event_id, 'showcase-' || id, 'showcase-form-draft', position, kind, title, content
FROM cfp_pages
WHERE version_id = 'f0000000-0000-4000-8000-000000000002'
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO cfp_elements
  (event_id, id, version_id, page_id, position, kind, field_key, label,
   required, max_length, question_type, options_json, options_source)
SELECT event_id, 'showcase-' || id, 'showcase-form-draft', 'showcase-' || page_id,
       position, kind, field_key, label, required, max_length, question_type,
       options_json, options_source
FROM cfp_elements
WHERE version_id = 'f0000000-0000-4000-8000-000000000002'
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO cfp_condition_rules
  (event_id, id, rule_id, version_id, element_id, group_index, condition_index,
   operator, operand_key, value_json, effect, position)
SELECT event_id, 'showcase-' || id, 'showcase-' || rule_id, 'showcase-form-draft',
       'showcase-' || element_id, group_index, condition_index, operator,
       operand_key, value_json, effect, position
FROM cfp_condition_rules
WHERE version_id = 'f0000000-0000-4000-8000-000000000002'
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO cfp_routing_rules
  (event_id, id, version_id, position, condition_json, action_kind, action_target)
SELECT event_id, 'showcase-' || id, 'showcase-form-draft', position,
       condition_json, action_kind, action_target
FROM cfp_routing_rules
WHERE version_id = 'f0000000-0000-4000-8000-000000000002'
ON CONFLICT(event_id, id) DO NOTHING;

-- Keep the six programme sessions inside the future event window. The sixth
-- overlaps the first speaker in another room, producing one intentional
-- speaker conflict for the organizer desk to resolve.
UPDATE agenda_sessions
SET day = '2026-10-14',
    start = '2026-10-14T09:00:00.000Z',
    end = '2026-10-14T09:45:00.000Z',
    updated_at = '2026-08-15T16:00:00.000Z'
WHERE submission_id = 'd0000000-0000-4000-8000-000000000801';
UPDATE agenda_sessions
SET day = '2026-10-14',
    start = '2026-10-14T10:00:00.000Z',
    end = '2026-10-14T10:45:00.000Z',
    updated_at = '2026-08-15T16:00:00.000Z'
WHERE submission_id = 'd0000000-0000-4000-8000-000000000802';
UPDATE agenda_sessions
SET day = '2026-10-14',
    start = '2026-10-14T09:00:00.000Z',
    end = '2026-10-14T11:00:00.000Z',
    updated_at = '2026-08-15T16:00:00.000Z'
WHERE submission_id = 'd0000000-0000-4000-8000-000000000803';
UPDATE agenda_sessions
SET day = '2026-10-15',
    start = '2026-10-15T09:00:00.000Z',
    end = '2026-10-15T09:45:00.000Z',
    updated_at = '2026-08-15T16:00:00.000Z'
WHERE submission_id = 'd0000000-0000-4000-8000-000000000804';
UPDATE agenda_sessions
SET day = '2026-10-15',
    start = '2026-10-15T10:00:00.000Z',
    end = '2026-10-15T10:15:00.000Z',
    updated_at = '2026-08-15T16:00:00.000Z'
WHERE submission_id = 'd0000000-0000-4000-8000-000000000805';
UPDATE agenda_sessions
SET day = '2026-10-14',
    start = '2026-10-14T09:15:00.000Z',
    end = '2026-10-14T10:00:00.000Z',
    updated_at = '2026-08-15T16:00:00.000Z'
WHERE submission_id = 'd0000000-0000-4000-8000-000000000806';

INSERT INTO contacts (id, email, name, created_at, bio) VALUES
  ('d0000000-0000-4000-8000-000000000610', 'jon.bell@example.test', 'Jon Bell', '2026-02-03T09:00:00.000Z', 'Reliability engineer turning incident notes into safer systems.'),
  ('d0000000-0000-4000-8000-000000000611', 'omar.diallo@example.test', 'Omar Diallo', '2026-02-03T09:00:00.000Z', 'Open source maintainer focused on sustainable contributor systems.'),
  ('d0000000-0000-4000-8000-000000000612', 'theo.kim@example.test', 'Theo Kim', '2026-02-03T09:00:00.000Z', 'Staff engineer building practical AI evaluation infrastructure.'),
  ('d0000000-0000-4000-8000-000000000613', 'malik.stone@example.test', 'Malik Stone', '2026-02-03T09:00:00.000Z', 'Engineering leader studying high-trust technical teams.'),
  ('d0000000-0000-4000-8000-000000000614', 'leo.martin@example.test', 'Leo Martin', '2026-02-03T09:00:00.000Z', 'Developer tools engineer who likes boring release pipelines.'),
  ('d0000000-0000-4000-8000-000000000615', 'ben.ortiz@example.test', 'Ben Ortiz', '2026-02-03T09:00:00.000Z', 'Security engineer making threat models useful to product teams.')
ON CONFLICT(email) DO NOTHING;

INSERT INTO proposal_submissions
  (id, event_id, owner_contact_id, form_version_id, origin_draft_id, status, title,
   answers_json, content_hash, routing_json, created_at, submitted_at) VALUES
  ('d0000000-0000-4000-8000-000000000807', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000610', 'f0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000907', 'pending', 'The Incident Review That Changed Nothing', '{"format":"Talk","track":"Platform & Infra","abstract":"A practical teardown of postmortems that produce action without learning, and a structure that changes the next incident.","audience_level":"Intermediate","key_takeaway":"Turn incident evidence into one owned system change.","speaker_bio":"Reliability engineer.","job_title":"Principal SRE","company":"Keystone Cloud"}', '7777777777777777777777777777777777777777777777777777777777777777', '{"actionKind":"assign_track","actionTarget":"platform-infra"}', '2026-02-03T10:00:00.000Z', '2026-02-03T10:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000808', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000611', 'f0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000908', 'pending', 'Maintainers Are Infrastructure Too', '{"format":"Talk","track":"Developer Experience","abstract":"Software depends on people whose capacity is invisible. Model maintainer load with the same care as compute and storage.","audience_level":"Beginner","key_takeaway":"A small operating model for contributor health.","speaker_bio":"Open source maintainer.","job_title":"Staff Engineer","company":"Commons Lab"}', '8888888888888888888888888888888888888888888888888888888888888888', '{"actionKind":"assign_track","actionTarget":"developer-experience"}', '2026-02-03T11:00:00.000Z', '2026-02-03T11:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000809', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000612', 'f0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000909', 'pending', 'Evaluating Agents Without Vibes', '{"format":"Workshop","track":"AI Engineering","abstract":"Build a compact evaluation harness around real tasks, explicit graders, and failure clusters rather than a single score.","audience_level":"Advanced","key_takeaway":"A reproducible agent evaluation loop.","speaker_bio":"AI evaluation engineer.","job_title":"Staff Engineer","company":"Signal Works","workshop_details":"Bring a laptop with Python and Docker."}', '9999999999999999999999999999999999999999999999999999999999999999', '{"actionKind":"assign_track","actionTarget":"ai-engineering"}', '2026-02-03T12:00:00.000Z', '2026-02-03T12:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000810', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000613', 'f0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000910', 'pending', 'The Myth of the Ten-X Team', '{"format":"Talk","track":"Developer Experience","abstract":"High-output teams are designed around feedback and trust, not a collection of individual heroes.","audience_level":"Beginner","key_takeaway":"Three operating changes that increase team throughput.","speaker_bio":"Engineering leader.","job_title":"VP Engineering","company":"Harbor Systems"}', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{"actionKind":"assign_track","actionTarget":"developer-experience"}', '2026-02-03T13:00:00.000Z', '2026-02-03T13:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000811', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000614', 'f0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000911', 'pending', 'Release Trains Without the Ceremony', '{"format":"Lightning talk","track":"Platform & Infra","abstract":"A lightweight release rhythm that keeps ownership explicit without making every deploy a meeting.","audience_level":"Intermediate","key_takeaway":"Replace release ceremony with visible constraints.","speaker_bio":"Developer tools engineer.","job_title":"Senior Engineer","company":"Relay Labs"}', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '{"actionKind":"assign_track","actionTarget":"platform-infra"}', '2026-02-03T14:00:00.000Z', '2026-02-03T14:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000812', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000615', 'f0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000912', 'pending', 'Threat Models People Actually Use', '{"format":"Talk","track":"Platform & Infra","abstract":"Make threat modeling part of product decisions with concrete assets, trust boundaries, and owner-ready mitigations.","audience_level":"Intermediate","key_takeaway":"A 30-minute threat-model format teams will repeat.","speaker_bio":"Security engineer.","job_title":"Security Lead","company":"Northstar"}', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', '{"actionKind":"assign_track","actionTarget":"platform-infra"}', '2026-02-03T15:00:00.000Z', '2026-02-03T15:00:00.000Z')
ON CONFLICT DO NOTHING;

INSERT INTO submission_contributors (submission_id, event_id, contact_id, role, position) VALUES
  ('d0000000-0000-4000-8000-000000000807', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000610', 'primary', 0),
  ('d0000000-0000-4000-8000-000000000808', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000611', 'primary', 0),
  ('d0000000-0000-4000-8000-000000000809', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000612', 'primary', 0),
  ('d0000000-0000-4000-8000-000000000810', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000613', 'primary', 0),
  ('d0000000-0000-4000-8000-000000000811', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000614', 'primary', 0),
  ('d0000000-0000-4000-8000-000000000812', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000615', 'primary', 0)
ON CONFLICT DO NOTHING;

INSERT INTO submission_acceptances (event_id, submission_id, accepted_at) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000807', '2026-04-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000808', '2026-04-01T09:00:00.000Z')
ON CONFLICT DO NOTHING;

-- Standing decisions: eight accepted, two rejected, and two submissions with
-- no decision row yet. These ids are fixture provenance as well as stable keys.
INSERT INTO submission_decisions
  (event_id, id, submission_id, sequence, outcome, decided_by, decided_at) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-decision-801', 'd0000000-0000-4000-8000-000000000801', 1, 'accepted', 'organizer', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-decision-802', 'd0000000-0000-4000-8000-000000000802', 1, 'accepted', 'organizer', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-decision-803', 'd0000000-0000-4000-8000-000000000803', 1, 'accepted', 'organizer', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-decision-804', 'd0000000-0000-4000-8000-000000000804', 1, 'accepted', 'organizer', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-decision-805', 'd0000000-0000-4000-8000-000000000805', 1, 'accepted', 'organizer', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-decision-806', 'd0000000-0000-4000-8000-000000000806', 1, 'accepted', 'organizer', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-decision-807', 'd0000000-0000-4000-8000-000000000807', 1, 'accepted', 'organizer', '2026-04-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-decision-808', 'd0000000-0000-4000-8000-000000000808', 1, 'accepted', 'organizer', '2026-04-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-decision-809', 'd0000000-0000-4000-8000-000000000809', 1, 'rejected', 'organizer', '2026-04-01T10:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-decision-810', 'd0000000-0000-4000-8000-000000000810', 1, 'rejected', 'organizer', '2026-04-01T10:00:00.000Z')
ON CONFLICT DO NOTHING;

INSERT INTO speaker_profiles
  (event_id, contact_id, job_title, company, travel_notes, workflow_status, created_at, updated_at) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000606', 'Staff Engineer', 'Latticework Systems', 'Fixture record, no travel booking', 'confirmed', '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000607', 'Developer Advocate', 'Northwind Labs', 'Fixture record, no travel booking', 'accepted', '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000608', 'Documentation Engineer', 'Cartography Co', 'Fixture record, no travel booking', 'confirmed', '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000609', 'Principal Engineer', 'Northwind Labs', 'Fixture record, no travel booking', 'confirmed', '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'c0000000-0000-4000-8000-000000000604', 'Staff Engineer', 'Kestrel Data', 'Fixture record, no travel booking', 'accepted', '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'c0000000-0000-4000-8000-000000000605', 'Engineering Manager', 'Foxglove', 'Fixture record, no travel booking', 'confirmed', '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000610', 'Principal SRE', 'Keystone Cloud', 'Fixture record, no travel booking', 'confirmed', '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000611', 'Staff Engineer', 'Commons Lab', 'Fixture record, no travel booking', 'invited', '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z')
ON CONFLICT(event_id, contact_id) DO NOTHING;

INSERT INTO speaker_tasks
  (event_id, id, submission_id, contact_id, kind, status, position, created_at, completed_at) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-task-801-confirm', 'd0000000-0000-4000-8000-000000000801', 'd0000000-0000-4000-8000-000000000606', 'confirm_participation', 'completed', 0, '2026-04-01T09:00:00.000Z', '2026-04-02T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-task-801-bio', 'd0000000-0000-4000-8000-000000000801', 'd0000000-0000-4000-8000-000000000606', 'submit_bio', 'completed', 1, '2026-04-01T09:00:00.000Z', '2026-04-02T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-task-801-headshot', 'd0000000-0000-4000-8000-000000000801', 'd0000000-0000-4000-8000-000000000606', 'submit_headshot', 'pending', 2, '2026-04-01T09:00:00.000Z', NULL),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-task-807-confirm', 'd0000000-0000-4000-8000-000000000807', 'd0000000-0000-4000-8000-000000000610', 'confirm_participation', 'completed', 0, '2026-04-01T09:00:00.000Z', '2026-04-03T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-task-807-bio', 'd0000000-0000-4000-8000-000000000807', 'd0000000-0000-4000-8000-000000000610', 'submit_bio', 'pending', 1, '2026-04-01T09:00:00.000Z', NULL),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-task-807-headshot', 'd0000000-0000-4000-8000-000000000807', 'd0000000-0000-4000-8000-000000000610', 'submit_headshot', 'pending', 2, '2026-04-01T09:00:00.000Z', NULL),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-task-808-confirm', 'd0000000-0000-4000-8000-000000000808', 'd0000000-0000-4000-8000-000000000611', 'confirm_participation', 'pending', 0, '2026-04-01T09:00:00.000Z', NULL),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-task-808-bio', 'd0000000-0000-4000-8000-000000000808', 'd0000000-0000-4000-8000-000000000611', 'submit_bio', 'pending', 1, '2026-04-01T09:00:00.000Z', NULL),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-task-808-headshot', 'd0000000-0000-4000-8000-000000000808', 'd0000000-0000-4000-8000-000000000611', 'submit_headshot', 'pending', 2, '2026-04-01T09:00:00.000Z', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO speaker_assignments
  (id, event_id, title, due_at, kind, instructions, created_at) VALUES
  ('showcase-file-request', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'Upload the final presentation deck', '2026-10-01T17:00:00.000Z',
   'file_request', 'Upload the deck the AV team should receive.',
   '2026-04-01T09:00:00.000Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO speaker_assignment_assignees
  (assignment_id, contact_id, status, completed_at) VALUES
  ('showcase-file-request', 'd0000000-0000-4000-8000-000000000610', 'pending', NULL)
ON CONFLICT(assignment_id, contact_id) DO NOTHING;

INSERT INTO embeds
  (id, event_id, name, kind, format, enabled, brand_color, track_filter, created_at, updated_at) VALUES
  ('showcase-schedule-embed', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'DemoConf programme', 'agenda', 'html', 1, '#2563eb', '',
   '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO uploaded_files
  (id, event_id, owner_contact_id, kind, storage_key, content_type, size_bytes,
   created_at, updated_at, file_name) VALUES
  ('showcase-headshot-current', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'd0000000-0000-4000-8000-000000000610', 'headshot',
   'events/a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d/contacts/d0000000-0000-4000-8000-000000000610/headshot/showcase-current',
   'image/png', 68, '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z', NULL),
  ('showcase-document-current', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'd0000000-0000-4000-8000-000000000610', 'document',
   'events/a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d/contacts/d0000000-0000-4000-8000-000000000610/document/showcase-current',
   'application/pdf', 76, '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z',
   'incident-review-deck.pdf')
ON CONFLICT(event_id, owner_contact_id, kind) DO NOTHING;

INSERT INTO uploaded_file_versions
  (id, event_id, owner_contact_id, kind, version, storage_key, content_type,
   size_bytes, file_name, created_at) VALUES
  ('showcase-document-v1', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'd0000000-0000-4000-8000-000000000610', 'document', 1,
   'events/a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d/contacts/d0000000-0000-4000-8000-000000000610/document/showcase-v1',
   'application/pdf', 76, 'incident-review-outline.pdf', '2026-04-01T09:00:00.000Z')
ON CONFLICT(event_id, owner_contact_id, kind, version) DO NOTHING;

INSERT INTO uploaded_file_comments
  (id, event_id, owner_contact_id, kind, author_name, body, created_at) VALUES
  ('showcase-document-comment', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'd0000000-0000-4000-8000-000000000610', 'document', 'Organizer',
   'Final deck received; AV review is pending.', '2026-08-15T16:00:00.000Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO support_chats
  (id, event_id, contact_id, last_message_at, admin_viewed_at, archived_at,
   guest_token_hash, created_at, updated_at) VALUES
  ('showcase-support-chat', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'd0000000-0000-4000-8000-000000000610', '2026-08-15T16:05:00.000Z',
   '2026-08-15T16:06:00.000Z', NULL, NULL,
   '2026-08-15T16:00:00.000Z', '2026-08-15T16:06:00.000Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO support_messages
  (id, chat_id, content, sender_type, read_at, notify_after, notified_at,
   created_at, updated_at) VALUES
  ('showcase-support-question', 'showcase-support-chat',
   'Will presentation adapters be available in every room?', 'user',
   '2026-08-15T16:06:00.000Z', NULL, NULL,
   '2026-08-15T16:00:00.000Z', '2026-08-15T16:00:00.000Z'),
  ('showcase-support-answer', 'showcase-support-chat',
   'Yes. Each room has HDMI and USB-C adapters at the lectern.', 'admin',
   '2026-08-15T16:06:00.000Z', NULL, NULL,
   '2026-08-15T16:05:00.000Z', '2026-08-15T16:05:00.000Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO agenda_sessions
  (event_id, submission_id, track_id, room_id, day, start, end, position, status, assignment, created_at, updated_at) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000807', 'f0000000-0000-4000-8000-000000000503', 'f0000000-0000-4000-8000-000000000506', '2026-10-15', '2026-10-15T10:00:00.000Z', '2026-10-15T10:45:00.000Z', 0, 'published', 'scheduled', '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000808', 'f0000000-0000-4000-8000-000000000508', 'f0000000-0000-4000-8000-000000000505', '2026-10-15', '2026-10-15T11:00:00.000Z', '2026-10-15T11:45:00.000Z', 0, 'published', 'scheduled', '2026-04-01T09:00:00.000Z', '2026-08-15T16:00:00.000Z')
ON CONFLICT DO NOTHING;

INSERT INTO agenda_session_speakers (event_id, submission_id, contact_id) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000807', 'd0000000-0000-4000-8000-000000000610'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000808', 'd0000000-0000-4000-8000-000000000611')
ON CONFLICT DO NOTHING;

-- Two review rounds with a closed first pass, an open programme pass, a
-- recorded recusal, and a second reviewer assigned to the same proposal.
UPDATE evaluation_rounds
SET status = 'closed',
    weights_json = '[{"criterionId":"e0000000-0000-4000-8000-000000000701","weight":1}]',
    opens_at = '2026-02-10T09:00:00.000Z',
    closes_at = '2026-03-01T09:00:00.000Z',
    anonymize = 1
WHERE id = 'e0000000-0000-4000-8000-000000000702';

INSERT INTO evaluation_rounds
  (event_id, id, number, name, status, weights_json, opens_at, closes_at, anonymize) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-round-2', 2, 'Programme balance', 'open', NULL, '2026-03-02T09:00:00.000Z', '2026-04-15T17:00:00.000Z', 0)
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO evaluation_round_pool (event_id, round_id, contact_id, added_at) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'e0000000-0000-4000-8000-000000000702', 'c0000000-0000-4000-8000-000000000601', '2026-02-10T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'e0000000-0000-4000-8000-000000000702', 'c0000000-0000-4000-8000-000000000602', '2026-02-10T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-round-2', 'c0000000-0000-4000-8000-000000000601', '2026-03-02T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-round-2', 'c0000000-0000-4000-8000-000000000602', '2026-03-02T09:00:00.000Z')
ON CONFLICT DO NOTHING;

INSERT INTO evaluation_round_criteria
  (event_id, id, round_id, position, label, kind, weight, config_json) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-round2-fit', 'showcase-round-2', 0, 'Programme fit', 'rating', 3, '{"min":1,"max":5}'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-round2-track', 'showcase-round-2', 1, 'Best track', 'select', NULL, '{"options":["Platform & Infra","AI Engineering","Developer Experience"]}'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-round2-note', 'showcase-round-2', 2, 'Committee note', 'text', NULL, NULL)
ON CONFLICT(event_id, id) DO NOTHING;

INSERT INTO evaluation_assignments
  (event_id, id, round_id, submission_id, evaluator_contact_id, created_at, recused_at) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-assignment-recused', 'showcase-round-2', 'd0000000-0000-4000-8000-000000000811', 'c0000000-0000-4000-8000-000000000601', '2026-03-02T09:00:00.000Z', '2026-03-03T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-assignment-reassigned', 'showcase-round-2', 'd0000000-0000-4000-8000-000000000811', 'c0000000-0000-4000-8000-000000000602', '2026-03-03T09:05:00.000Z', NULL),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-assignment-reviewed', 'showcase-round-2', 'd0000000-0000-4000-8000-000000000812', 'c0000000-0000-4000-8000-000000000601', '2026-03-02T09:00:00.000Z', NULL),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-assignment-featured', 'showcase-round-2', 'd0000000-0000-4000-8000-000000000807', 'c0000000-0000-4000-8000-000000000601', '2026-03-02T09:00:00.000Z', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO evaluation_round_scores
  (event_id, id, assignment_id, criterion_id, value_number, value_text, created_at, updated_at) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-score-1', 'showcase-assignment-reassigned', 'showcase-round2-fit', 4, NULL, '2026-03-04T09:00:00.000Z', '2026-03-04T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-score-2', 'showcase-assignment-reassigned', 'showcase-round2-track', NULL, 'Platform & Infra', '2026-03-04T09:00:00.000Z', '2026-03-04T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-score-3', 'showcase-assignment-reassigned', 'showcase-round2-note', NULL, 'Strong practical fit with a clear takeaway.', '2026-03-04T09:00:00.000Z', '2026-03-04T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-featured-score-1', 'showcase-assignment-featured', 'showcase-round2-fit', 5, NULL, '2026-03-04T09:00:00.000Z', '2026-03-04T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-featured-score-2', 'showcase-assignment-featured', 'showcase-round2-track', NULL, 'Platform & Infra', '2026-03-04T09:00:00.000Z', '2026-03-04T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'showcase-featured-score-3', 'showcase-assignment-featured', 'showcase-round2-note', NULL, 'Clear evidence and an actionable operational takeaway.', '2026-03-04T09:00:00.000Z', '2026-03-04T09:00:00.000Z')
ON CONFLICT DO NOTHING;

-- Capture-only fixture history. These jobs are terminal, non-claimable, and
-- intentionally contain no raw recipient, bearer link, ciphertext, or provider evidence.
INSERT INTO captured_messages
  (id, event_id, to_email, subject, body, created_at, kind, submission_id, role_access_token_id, recipient_fingerprint) VALUES
  ('showcase-message-captured', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', '[showcase recipient redacted]', '[Demo fixture] Acceptance captured', 'Synthetic capture-only acceptance. No access link is present.', '2026-04-01T10:00:00.000Z', 'acceptance', 'd0000000-0000-4000-8000-000000000807', NULL, 'showcase-recipient-captured'),
  ('showcase-message-action', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', '[showcase recipient redacted]', '[Demo fixture] Delivery needs attention', 'Synthetic capture-only failure state for the organizer desk. No access link is present.', '2026-04-01T10:05:00.000Z', 'reminder', 'd0000000-0000-4000-8000-000000000808', NULL, 'showcase-recipient-action')
ON CONFLICT(id) DO NOTHING;

INSERT INTO email_delivery_jobs
  (id, captured_message_id, event_id, mode, status, recipient_fingerprint, key_version,
   nonce, ciphertext, payload_expires_at, attempts, next_attempt_at, lease_owner,
   lease_expires_at, provider_id, provider_status, provider_status_at,
   provider_event_id, provider_event_count, last_error_code, ambiguous_since,
   accepted_at, created_at, updated_at) VALUES
  ('showcase-job-captured', 'showcase-message-captured', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'capture', 'captured', 'showcase-recipient-captured', 'fixture', NULL, NULL, '2026-04-02T10:00:00.000Z', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:00.000Z'),
  ('showcase-job-action', 'showcase-message-action', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'capture', 'operator_action', 'showcase-recipient-action', 'fixture', NULL, NULL, '2026-04-02T10:05:00.000Z', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 'fixture_delivery_failure', NULL, NULL, '2026-04-01T10:05:00.000Z', '2026-04-01T10:05:00.000Z')
ON CONFLICT(id) DO NOTHING;
