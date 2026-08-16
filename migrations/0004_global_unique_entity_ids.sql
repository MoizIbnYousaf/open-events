-- Migration number: 0004 	 2026-08-08T16:28:16.357Z

-- Repository findById reads drafts and forms by global id alone, so the same
-- id must never be legal across events. 0003 created these as non-unique;
-- drop and recreate them as globally unique (same index names).
DROP INDEX idx_proposal_drafts_id;
DROP INDEX idx_cfp_forms_id;
CREATE UNIQUE INDEX idx_proposal_drafts_id ON proposal_drafts(id);
CREATE UNIQUE INDEX idx_cfp_forms_id ON cfp_forms(id);
