-- API-003: a key created with attendance:read after outcome-level attendance shipped holds
-- its own random member-reference key, so its memberRef values are stable across rotation
-- and unlinkable between keys. A key without one (created under API-002 alone) keeps the
-- boolean-only attendance resource. The table is excluded from archives with the other key data.
ALTER TABLE st_integrations ADD COLUMN member_ref_key TEXT;
