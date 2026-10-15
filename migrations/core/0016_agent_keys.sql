CREATE TABLE st_agent_keys (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES oa_operators(id),
 owner_version INTEGER NOT NULL, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
);
