-- Migration number: 0007 	2026-08-09T00:00:00.000Z

-- Uploads slice: metadata for owner-scoped binary uploads kept in object
-- storage. The bytes live in R2 under `storage_key`; this table is the only
-- authority on who owns them. One current file per (event, owner, kind) keeps
-- replacement a single-row update instead of an append-only history, and the
-- globally unique id follows the migration 0004 convention so repository
-- lookups by id alone are safe across events. Size and content type are
-- constrained here as well as in the service so a bypassed caller still
-- fails closed.

CREATE TABLE uploaded_files (
  id               TEXT NOT NULL,
  event_id         TEXT NOT NULL,
  owner_contact_id TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('headshot')),
  storage_key      TEXT NOT NULL,
  content_type     TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes       INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  created_at       TEXT NOT NULL CHECK (length(created_at) = 24),
  updated_at       TEXT NOT NULL CHECK (length(updated_at) = 24),
  PRIMARY KEY (event_id, id),
  UNIQUE (storage_key),
  UNIQUE (event_id, owner_contact_id, kind),
  CHECK (updated_at >= created_at),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (owner_contact_id) REFERENCES contacts(id)
);

CREATE UNIQUE INDEX idx_uploaded_files_id ON uploaded_files(id);

CREATE INDEX idx_uploaded_files_event_owner ON uploaded_files(event_id, owner_contact_id);
