-- Explicit scheduling authority belongs to this installation and never restores.
CREATE TABLE st_disclosure_connections (
  id TEXT PRIMARY KEY CHECK (id = 'disclosures'),
  connection_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL
);
