-- ATT-001 paired check-in kiosks. Only hashes of the one-time pairing secret and
-- the device token are stored; a kiosk is never an operator and has no session.
CREATE TABLE st_kiosks (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 pair_hash TEXT UNIQUE, pair_expires_at INTEGER, token_hash TEXT UNIQUE,
 paired_at INTEGER, revoked_at INTEGER
);
