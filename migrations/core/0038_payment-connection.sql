-- Provider execution authority is installation-local and never restored.
CREATE TABLE st_payment_connections (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  account_id TEXT NOT NULL,
  key_digest TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL
);
