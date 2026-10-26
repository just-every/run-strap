-- Provider execution authority stays local; restored records require owner reconnection.
CREATE TABLE st_tax_connections (
  id TEXT PRIMARY KEY,
  connection_hash TEXT NOT NULL,
  connected_by TEXT NOT NULL,
  connected_at TEXT NOT NULL
);
