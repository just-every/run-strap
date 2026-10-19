-- MSG-004 waitlist offer and promotion emails share SCHED-008's delivery rows:
-- each row names its source record (a closure, or the booking an offer or
-- promotion is about), still one reservation per source per member. 'paused'
-- is an email reserved on a restored installation before its owner reconnects
-- member email (MOVE-011).
CREATE TABLE st_notice_deliveries_next (
 id TEXT PRIMARY KEY, source_kind TEXT NOT NULL CHECK(source_kind IN ('closure','booking')), source_id TEXT NOT NULL, person_id TEXT NOT NULL, booking_ids TEXT NOT NULL CHECK(json_valid(booking_ids)),
 recipient TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','rejected','rate_limited','uncertain','not_configured','no_address','paused')),
 provider TEXT, provider_message_id TEXT, code TEXT, created_at INTEGER NOT NULL, attempted_at INTEGER, finished_at INTEGER,
 UNIQUE(source_id, person_id)
);
INSERT INTO st_notice_deliveries_next(id,source_kind,source_id,person_id,booking_ids,recipient,subject,body,status,provider,provider_message_id,code,created_at,attempted_at,finished_at)
 SELECT id,'closure',closure_id,person_id,booking_ids,recipient,subject,body,status,provider,provider_message_id,code,created_at,attempted_at,finished_at FROM st_notice_deliveries;
DROP TABLE st_notice_deliveries;
ALTER TABLE st_notice_deliveries_next RENAME TO st_notice_deliveries;
