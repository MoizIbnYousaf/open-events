-- Migration number: 0014 	2026-08-10T23:00:00.000Z

-- REQ-007 supporting documents. 0008 froze kind/content-type/size in CHECKs,
-- so the table is recreated (0011 pattern) with per-kind envelopes:
--   * headshot keeps exactly the 0008 rules (raster images, <= 2 MiB);
--   * document allows application/pdf or text/plain up to 5 MiB and carries a
--     sanitized display file_name (bounded; validated by the service — the
--     CHECK here only pins length and non-emptiness as a fail-closed floor).
-- Existing headshot rows are copied byte for byte with a NULL file_name.

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
    (kind = 'document' AND content_type IN ('application/pdf', 'text/plain') AND size_bytes <= 5242880)
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
       size_bytes, created_at, updated_at, NULL
FROM uploaded_files;

DROP TABLE uploaded_files;

ALTER TABLE uploaded_files_new RENAME TO uploaded_files;

CREATE UNIQUE INDEX idx_uploaded_files_id ON uploaded_files(id);

CREATE INDEX idx_uploaded_files_event_owner ON uploaded_files(event_id, owner_contact_id);
