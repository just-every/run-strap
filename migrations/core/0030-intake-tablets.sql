-- Write-only, short-lived desk handoffs. Credentials never join native archives.
CREATE TABLE st_intake_tablets (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  paired_at TEXT,
  consumed_at TEXT
);
