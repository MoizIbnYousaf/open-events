-- Migration number: 0013 	2026-08-10T22:00:00.000Z

-- REQ-006 speaker profile. The speaker-editable bio lives on the contact row
-- it describes. Nullable and additive: every pre-0013 contact simply has no
-- bio yet, and 0002's constraints are untouched.
ALTER TABLE contacts ADD COLUMN bio TEXT;
