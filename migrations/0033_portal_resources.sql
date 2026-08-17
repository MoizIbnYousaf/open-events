-- Migration number: 0033  2026-08-17T11:00:00.000Z

CREATE TABLE portal_resources (
  event_id   TEXT NOT NULL REFERENCES events(id),
  id         TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('markdown', 'link')),
  title      TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  body       TEXT,
  url        TEXT,
  position   INTEGER NOT NULL CHECK (position >= 0),
  published  INTEGER NOT NULL CHECK (published IN (0, 1)),
  created_at TEXT NOT NULL CHECK (length(created_at) = 24),
  updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
  PRIMARY KEY (event_id, id),
  CHECK (updated_at >= created_at),
  CHECK (
    (kind = 'markdown' AND body IS NOT NULL AND length(trim(body)) BETWEEN 1 AND 20000 AND url IS NULL)
    OR
    (kind = 'link' AND body IS NULL AND url IS NOT NULL AND length(url) BETWEEN 1 AND 2048)
  )
);

CREATE UNIQUE INDEX idx_portal_resources_id ON portal_resources(id);
CREATE INDEX idx_portal_resources_event_order
  ON portal_resources(event_id, published, position, id);
