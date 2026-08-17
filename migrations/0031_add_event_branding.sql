-- Migration number: 0031  2026-08-16T22:10:00.000Z

ALTER TABLE events ADD COLUMN logo_storage_key TEXT;
ALTER TABLE events ADD COLUMN logo_content_type TEXT;
ALTER TABLE events ADD COLUMN logo_width INTEGER;
ALTER TABLE events ADD COLUMN logo_height INTEGER;
ALTER TABLE events ADD COLUMN logo_updated_at TEXT;
ALTER TABLE events ADD COLUMN background_storage_key TEXT;
ALTER TABLE events ADD COLUMN background_content_type TEXT;
ALTER TABLE events ADD COLUMN background_width INTEGER;
ALTER TABLE events ADD COLUMN background_height INTEGER;
ALTER TABLE events ADD COLUMN background_updated_at TEXT;
