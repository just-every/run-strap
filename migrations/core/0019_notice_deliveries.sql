-- SCHED-008 member emails: one reserved row per affected member per closure,
-- naming the bookings it covers; claimed once (queued -> sending) and finished
-- with the provider's own outcome.
CREATE TABLE st_notice_deliveries (
 id TEXT PRIMARY KEY, closure_id TEXT NOT NULL, person_id TEXT NOT NULL, booking_ids TEXT NOT NULL CHECK(json_valid(booking_ids)),
 recipient TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','rejected','rate_limited','uncertain','not_configured','no_address')),
 provider TEXT, provider_message_id TEXT, code TEXT, created_at INTEGER NOT NULL, attempted_at INTEGER, finished_at INTEGER,
 UNIQUE(closure_id, person_id)
);
