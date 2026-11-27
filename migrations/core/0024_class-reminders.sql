-- MSG-003: extend source kinds, retaining every existing notice and outcome.
-- MSG-002: confirmations and member-owned email suppression; retain delivery history.
-- SCHED-014: each committed action reserves its own member notice once.
CREATE TABLE st_notice_deliveries_next (
 id TEXT PRIMARY KEY, source_kind TEXT NOT NULL CHECK(source_kind IN ('closure','booking','booking_action','confirmation','reminder')), source_id TEXT NOT NULL, person_id TEXT NOT NULL, booking_ids TEXT NOT NULL CHECK(json_valid(booking_ids)),
 recipient TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','rejected','rate_limited','uncertain','not_configured','no_address','paused','opted_out')),
 provider TEXT, provider_message_id TEXT, code TEXT, created_at INTEGER NOT NULL, attempted_at INTEGER, finished_at INTEGER,
 UNIQUE(source_kind, source_id, person_id)
);
INSERT INTO st_notice_deliveries_next(id,source_kind,source_id,person_id,booking_ids,recipient,subject,body,status,provider,provider_message_id,code,created_at,attempted_at,finished_at)
 SELECT id,source_kind,source_id,person_id,booking_ids,recipient,subject,body,status,provider,provider_message_id,code,created_at,attempted_at,finished_at FROM st_notice_deliveries;
DROP TABLE st_notice_deliveries;
ALTER TABLE st_notice_deliveries_next RENAME TO st_notice_deliveries;
