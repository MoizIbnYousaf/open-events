-- Organizer-managed speaker records (can exist without a proposal).
CREATE TABLE IF NOT EXISTS speaker_profiles (
  event_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  job_title TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  travel_notes TEXT NOT NULL DEFAULT '',
  workflow_status TEXT NOT NULL DEFAULT 'invited'
    CHECK (workflow_status IN ('invited', 'confirmed', 'accepted', 'declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, contact_id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

-- Saved embeddable widgets.
CREATE TABLE IF NOT EXISTS embeds (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sessions', 'speakers', 'agenda', 'itinerary', 'gallery')),
  format TEXT NOT NULL CHECK (format IN ('html', 'json', 'xml', 'ical')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  brand_color TEXT NOT NULL DEFAULT '',
  track_filter TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_embeds_event ON embeds(event_id);

-- History of every upload; the current row in uploaded_files is the latest.
CREATE TABLE IF NOT EXISTS uploaded_file_versions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  owner_contact_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  file_name TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (event_id, owner_contact_id, kind, version),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (owner_contact_id) REFERENCES contacts(id)
);

CREATE TABLE IF NOT EXISTS uploaded_file_comments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  owner_contact_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Session title/abstract history for restore.
CREATE TABLE IF NOT EXISTS content_revisions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  editor_name TEXT NOT NULL,
  title TEXT NOT NULL,
  abstract TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Public-output approval. Missing row means approved (existing programmes stay visible).
CREATE TABLE IF NOT EXISTS session_content_status (
  event_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('draft', 'approved')),
  PRIMARY KEY (event_id, submission_id)
);

-- Organizer-created general or file-request assignments (not the fixed onboarding kinds).
CREATE TABLE IF NOT EXISTS speaker_assignments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at TEXT,
  kind TEXT NOT NULL DEFAULT 'general' CHECK (kind IN ('general', 'file_request')),
  instructions TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS speaker_assignment_assignees (
  assignment_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  completed_at TEXT,
  PRIMARY KEY (assignment_id, contact_id),
  FOREIGN KEY (assignment_id) REFERENCES speaker_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);
