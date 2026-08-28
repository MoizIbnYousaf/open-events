PRAGMA foreign_keys = ON;

-- Early local builds stored free-text search in schema-v1 views. It can contain
-- speaker names or email addresses, so remove it before the strict reader sees
-- those rows. Clean installations have no rows yet and this is a no-op.
UPDATE submission_saved_views
   SET state_json = json_remove(state_json, '$.q')
 WHERE json_type(state_json) = 'object'
   AND json_type(state_json, '$.q') IS NOT NULL;
