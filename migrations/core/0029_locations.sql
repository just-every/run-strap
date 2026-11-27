-- STUDIO-002: a manager is a staff identity the owner grants to an invited person for named
-- locations; it reaches the revenue and attendance reports for those locations and nothing else.
-- An integration key may name several locations; a key made before locations existed keeps its
-- single location column and reads only that one.
CREATE TABLE st_managers (
 person_id TEXT PRIMARY KEY, location_ids TEXT NOT NULL CHECK(json_valid(location_ids)), granted_by TEXT NOT NULL, granted_at INTEGER NOT NULL
);
ALTER TABLE st_integrations ADD COLUMN locations TEXT CHECK(locations IS NULL OR json_valid(locations));
