-- Migration number: 0001 	 2026-08-08T12:48:56.566Z

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  starts_at TEXT,
  ends_at TEXT,
  CHECK (
    (starts_at IS NULL AND ends_at IS NULL)
    OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)
  )
);
