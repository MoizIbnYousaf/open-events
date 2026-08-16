-- A published programme, layered on top of the base seed.
--
-- OPT-IN, and that is the whole point. The base seed is the minimal fixture a
-- large number of tests assert exactly — row counts, contact totals, an empty
-- submissions table — and the golden end-to-end journeys assert ABSOLUTE totals
-- that a seeded proposal would silently inflate. So this never runs by default:
-- `pnpm db:reset` is unchanged, and `pnpm db:reset:programme` adds this layer.
--
-- It exists because every public surface — the schedule, and the widgets built
-- on it — renders nothing without published sessions, so a programme is the
-- difference between demonstrating the product and demonstrating an empty page.
--
-- Deliberately NOT seeded, because each is counted absolutely somewhere:
-- proposal_drafts, captured_messages, confirmation_records, speaker_tasks,
-- uploaded_files, and every evaluation table.
--
-- Every statement is ON CONFLICT DO NOTHING so re-running is a no-op rather
-- than an error, and no string literal contains a semicolon, because the test
-- helper splits this file on semicolons to replay it statement by statement.

-- Four more people, so the programme has a cast beyond the two seeded speakers.
INSERT INTO contacts (id, email, name, created_at) VALUES
  ('d0000000-0000-4000-8000-000000000606', 'priya.raman@example.test', 'Priya Raman', '2026-02-01T09:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000607', 'marcus.okafor@example.test', 'Marcus Okafor', '2026-02-01T09:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000608', 'dana.hale@example.test', 'Dana Hale', '2026-02-01T09:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000609', 'sam.whitfield@example.test', 'Sam Whitfield', '2026-02-01T09:00:00.000Z')
ON CONFLICT(email) DO NOTHING;

-- Bios, so a speaker directory has something to show. Written onto the four new
-- contacts only: the base seed's people are asserted as they are.
UPDATE contacts SET bio = 'Platform engineer working on build systems and the long tail of CI.'
  WHERE id = 'd0000000-0000-4000-8000-000000000606';
UPDATE contacts SET bio = 'Developer advocate. Writes about the parts of a build nobody films.'
  WHERE id = 'd0000000-0000-4000-8000-000000000607';
UPDATE contacts SET bio = 'Documentation engineer. Believes reference docs should answer back.'
  WHERE id = 'd0000000-0000-4000-8000-000000000608';
UPDATE contacts SET bio = 'Works on developer tooling and the evaluation of things that sound confident.'
  WHERE id = 'd0000000-0000-4000-8000-000000000609';

-- Six proposals, never more than three per identity: the seeded call sets
-- per_identity_limit = 3, and a fixture that violates the product's own rule is
-- a fixture that proves nothing.
INSERT INTO proposal_submissions
  (id, event_id, owner_contact_id, form_version_id, origin_draft_id, status, title,
   answers_json, content_hash, routing_json, created_at, submitted_at) VALUES
  ('d0000000-0000-4000-8000-000000000801', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'd0000000-0000-4000-8000-000000000606', 'f0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000901', 'pending', 'Taming 40-Minute CI',
   '{"format":"Talk","track":"Platform & Infra","abstract":"A 40-minute pipeline became four, and only two of the six changes we made mattered. Which ones, and how to tell before you spend the quarter.","audience_level":"Intermediate","key_takeaway":"Which incremental-build investments actually pay off.","speaker_bio":"Platform engineer working on build systems.","job_title":"Staff Engineer","company":"Latticework Systems"}',
   '1111111111111111111111111111111111111111111111111111111111111111', NULL,
   '2026-02-02T09:00:00.000Z', '2026-02-02T09:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000802', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'd0000000-0000-4000-8000-000000000609', 'f0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000902', 'pending', 'Your AI Pair Programmer Is Lying to You',
   '{"format":"Talk","track":"AI Engineering","abstract":"Confident wrong answers are the failure mode nobody budgets for. A field guide to catching them before they reach a review.","audience_level":"Beginner","key_takeaway":"How to verify what a model tells you before you ship it.","speaker_bio":"Works on developer tooling and evaluation.","job_title":"Principal Engineer","company":"Northwind Labs"}',
   '2222222222222222222222222222222222222222222222222222222222222222', NULL,
   '2026-02-02T10:00:00.000Z', '2026-02-02T10:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000803', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'd0000000-0000-4000-8000-000000000608', 'f0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000903', 'pending', 'Docs That Answer Back',
   '{"format":"Workshop","track":"Developer Experience","abstract":"Turning reference documentation into something a reader can interrogate, without writing a chatbot.","audience_level":"Advanced","key_takeaway":"Documentation structure that survives being queried.","speaker_bio":"Documentation engineer.","job_title":"Docs Lead","company":"Cartography Co","workshop_details":"Laptops with Node 20 and a checkout of the sample repository."}',
   '3333333333333333333333333333333333333333333333333333333333333333', NULL,
   '2026-02-02T11:00:00.000Z', '2026-02-02T11:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000804', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'c0000000-0000-4000-8000-000000000604', 'f0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000904', 'pending', 'The Schema Migration You Cannot Undo',
   '{"format":"Talk","track":"Platform & Infra","abstract":"Some migrations are one-way doors. How to tell which, and what to do when you have already walked through one.","audience_level":"Intermediate","key_takeaway":"Recognising a one-way migration before you run it.","speaker_bio":"Works on data infrastructure.","job_title":"Staff Engineer","company":"Kestrel Data"}',
   '4444444444444444444444444444444444444444444444444444444444444444', NULL,
   '2026-02-02T12:00:00.000Z', '2026-02-02T12:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000805', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'c0000000-0000-4000-8000-000000000605', 'f0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000905', 'pending', 'Reviewing 400 Proposals Without Losing the Plot',
   '{"format":"Lightning talk","track":"Developer Experience","abstract":"What a programme committee actually does for six weeks, and the three decisions that make the difference.","audience_level":"Beginner","key_takeaway":"How to structure a review process people finish.","speaker_bio":"Programme chair and occasional speaker.","job_title":"Engineering Manager","company":"Foxglove"}',
   '5555555555555555555555555555555555555555555555555555555555555555', NULL,
   '2026-02-02T13:00:00.000Z', '2026-02-02T13:00:00.000Z'),
  ('d0000000-0000-4000-8000-000000000806', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
   'd0000000-0000-4000-8000-000000000607', 'f0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000906', 'pending', 'Observability for People Who Hate Dashboards',
   '{"format":"Talk","track":"AI Engineering","abstract":"Most dashboards answer questions nobody asked. Starting from the question instead, and what that changes about instrumentation.","audience_level":"Intermediate","key_takeaway":"Instrument the question, not the system.","speaker_bio":"Developer advocate.","job_title":"Developer Advocate","company":"Northwind Labs"}',
   '6666666666666666666666666666666666666666666666666666666666666666', NULL,
   '2026-02-02T14:00:00.000Z', '2026-02-02T14:00:00.000Z')
ON CONFLICT DO NOTHING;

-- Who is on each proposal. The first talk carries a co-speaker so the public
-- surfaces have a session with more than one name on it.
INSERT INTO submission_contributors (submission_id, event_id, contact_id, role, position) VALUES
  ('d0000000-0000-4000-8000-000000000801', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000606', 'primary', 0),
  ('d0000000-0000-4000-8000-000000000801', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000607', 'co-speaker', 1),
  ('d0000000-0000-4000-8000-000000000802', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000609', 'primary', 0),
  ('d0000000-0000-4000-8000-000000000803', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000608', 'primary', 0),
  ('d0000000-0000-4000-8000-000000000804', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'c0000000-0000-4000-8000-000000000604', 'primary', 0),
  ('d0000000-0000-4000-8000-000000000805', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'c0000000-0000-4000-8000-000000000605', 'primary', 0),
  ('d0000000-0000-4000-8000-000000000806', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000607', 'primary', 0)
ON CONFLICT DO NOTHING;

-- Accepted, and recorded as decisions too: the acceptance row is what the
-- checklist and the agenda hang off, and the decision row is the standing
-- verdict every other surface reads.
INSERT INTO submission_acceptances (event_id, submission_id, accepted_at) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000801', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000802', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000803', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000804', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000805', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000806', '2026-03-01T09:00:00.000Z')
ON CONFLICT DO NOTHING;

-- Two days, two rooms, three tracks. Every scheduled row carries a room AND a
-- position, which the table requires of anything not unassigned, and no two
-- share a room and slot.
INSERT INTO agenda_sessions
  (event_id, submission_id, track_id, room_id, day, start, end, position, status, assignment,
   created_at, updated_at) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000801',
   'f0000000-0000-4000-8000-000000000503', 'f0000000-0000-4000-8000-000000000505',
   '2026-05-13', '2026-05-13T09:00:00.000Z', '2026-05-13T09:45:00.000Z', 0, 'published', 'scheduled',
   '2026-03-01T09:00:00.000Z', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000802',
   'f0000000-0000-4000-8000-000000000504', 'f0000000-0000-4000-8000-000000000505',
   '2026-05-13', '2026-05-13T10:00:00.000Z', '2026-05-13T10:45:00.000Z', 0, 'published', 'scheduled',
   '2026-03-01T09:00:00.000Z', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000803',
   'f0000000-0000-4000-8000-000000000508', 'f0000000-0000-4000-8000-000000000506',
   '2026-05-13', '2026-05-13T09:00:00.000Z', '2026-05-13T11:00:00.000Z', 0, 'published', 'scheduled',
   '2026-03-01T09:00:00.000Z', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000804',
   'f0000000-0000-4000-8000-000000000503', 'f0000000-0000-4000-8000-000000000505',
   '2026-05-14', '2026-05-14T09:00:00.000Z', '2026-05-14T09:45:00.000Z', 0, 'published', 'scheduled',
   '2026-03-01T09:00:00.000Z', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000805',
   'f0000000-0000-4000-8000-000000000508', 'f0000000-0000-4000-8000-000000000505',
   '2026-05-14', '2026-05-14T10:00:00.000Z', '2026-05-14T10:15:00.000Z', 0, 'published', 'scheduled',
   '2026-03-01T09:00:00.000Z', '2026-03-01T09:00:00.000Z'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000806',
   'f0000000-0000-4000-8000-000000000504', 'f0000000-0000-4000-8000-000000000506',
   '2026-05-14', '2026-05-14T09:00:00.000Z', '2026-05-14T09:45:00.000Z', 0, 'published', 'scheduled',
   '2026-03-01T09:00:00.000Z', '2026-03-01T09:00:00.000Z')
ON CONFLICT DO NOTHING;

-- Who presents what. The co-speaker appears here too, so a session genuinely
-- carries two names rather than one name and a footnote.
INSERT INTO agenda_session_speakers (event_id, submission_id, contact_id) VALUES
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000801', 'd0000000-0000-4000-8000-000000000606'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000801', 'd0000000-0000-4000-8000-000000000607'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000802', 'd0000000-0000-4000-8000-000000000609'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000803', 'd0000000-0000-4000-8000-000000000608'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000804', 'c0000000-0000-4000-8000-000000000604'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000805', 'c0000000-0000-4000-8000-000000000605'),
  ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'd0000000-0000-4000-8000-000000000806', 'd0000000-0000-4000-8000-000000000607')
ON CONFLICT DO NOTHING;
