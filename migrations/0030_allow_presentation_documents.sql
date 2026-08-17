-- Migration number: 0030  2026-08-16T22:00:00.000Z

-- Supporting material now accepts bounded presentation containers as inert
-- downloads. Rebuild the table because SQLite cannot replace the frozen 0014
-- CHECK in place. Existing rows copy byte-for-byte.

CREATE TABLE uploaded_files_new (
  id               TEXT NOT NULL,
  event_id         TEXT NOT NULL,
  owner_contact_id TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('headshot', 'document')),
  storage_key      TEXT NOT NULL,
  content_type     TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at       TEXT NOT NULL CHECK (length(created_at) = 24),
  updated_at       TEXT NOT NULL CHECK (length(updated_at) = 24),
  file_name        TEXT,
  PRIMARY KEY (event_id, id),
  UNIQUE (storage_key),
  UNIQUE (event_id, owner_contact_id, kind),
  CHECK (updated_at >= created_at),
  CHECK (
    (kind = 'headshot' AND content_type IN ('image/jpeg', 'image/png', 'image/webp') AND size_bytes <= 2097152)
    OR
    (kind = 'document' AND content_type IN (
      'application/pdf',
      'text/plain',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.apple.keynote',
      'application/vnd.oasis.opendocument.presentation'
    ) AND size_bytes <= 20971520)
  ),
  CHECK ((kind = 'document') = (file_name IS NOT NULL)),
  CHECK (file_name IS NULL OR (length(file_name) > 0 AND length(file_name) <= 200)),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (owner_contact_id) REFERENCES contacts(id)
);

INSERT INTO uploaded_files_new
  (id, event_id, owner_contact_id, kind, storage_key, content_type, size_bytes,
   created_at, updated_at, file_name)
SELECT id, event_id, owner_contact_id, kind, storage_key, content_type,
       size_bytes, created_at, updated_at, file_name
FROM uploaded_files;

DROP TABLE uploaded_files;

ALTER TABLE uploaded_files_new RENAME TO uploaded_files;

CREATE UNIQUE INDEX idx_uploaded_files_id ON uploaded_files(id);

CREATE INDEX idx_uploaded_files_event_owner ON uploaded_files(event_id, owner_contact_id);
