-- Migration number: 0005 	 2026-08-08T17:29:49.447Z

-- Single-column FK to the globally unique cfp_forms(id) (UNIQUE index
-- idx_cfp_forms_id from 0004). Nullable: legacy dev tokens keep form_id NULL
-- and fail closed (403) at consumption; event/form equality is validated by
-- the application before consumption (a single-column FK cannot express it).
ALTER TABLE submitter_tokens ADD COLUMN form_id TEXT REFERENCES cfp_forms(id);
