-- Connection authority stays installation-local and never enters an archive.
CREATE TABLE st_sms_connections (
  id TEXT PRIMARY KEY CHECK (id = 'twilio-test'),
  origin TEXT NOT NULL,
  account_hash TEXT NOT NULL,
  configuration_hash TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  connected_by TEXT NOT NULL
);
