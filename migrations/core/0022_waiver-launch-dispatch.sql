-- STAFF-006 launch requests are studio records; native authentication tokens,
-- delivery attempts and this dispatch fence stay installation-local.
CREATE TABLE st_waiver_launch_dispatches (
 id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('queued','sending','requested','not_sent','uncertain')),
 origin TEXT NOT NULL, attempted_at INTEGER, finished_at INTEGER, code TEXT
);
