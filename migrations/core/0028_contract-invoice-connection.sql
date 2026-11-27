-- Installation-local authority for member-consented recurring studio invoices.
-- Excluded from archives: restoring an agreement never resumes its charges.
CREATE TABLE st_contract_connections (
  id TEXT PRIMARY KEY CHECK (id = 'billing'),
  connection_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL
);
