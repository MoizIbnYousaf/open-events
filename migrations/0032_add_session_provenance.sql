-- Migration number: 0032  2026-08-16T22:30:00.000Z

ALTER TABLE sessions
  ADD COLUMN provenance TEXT NOT NULL DEFAULT 'ordinary'
  CHECK (provenance IN ('ordinary', 'tour'));
