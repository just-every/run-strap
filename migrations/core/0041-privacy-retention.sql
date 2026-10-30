-- Restricted retained evidence is outside ordinary member and staff snapshots.
CREATE TABLE st_privacy_retained (
 id TEXT PRIMARY KEY, person_id TEXT NOT NULL, kind TEXT NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data)), reason TEXT NOT NULL,
 retain_until TEXT NOT NULL, hold_basis TEXT, release_conditions TEXT,
 recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
 released_by TEXT, released_at TEXT, release_reason TEXT,
 disposed_by TEXT, disposed_at TEXT
);
