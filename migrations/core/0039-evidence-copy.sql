-- Copy-mail review and bearer credentials stay installation-local; never archive them.
CREATE TABLE st_evidence_copy_mail (
  id TEXT PRIMARY KEY CHECK(id='mail'),
  connection_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  review_hash TEXT NOT NULL,
  provider_hash TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL
);
CREATE TABLE st_evidence_copies (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL UNIQUE,
  document_id TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  person_id TEXT NOT NULL,
  person_version INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  origin TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  delivery_status TEXT NOT NULL CHECK(delivery_status IN ('queued','sending','accepted','rejected','rate_limited','uncertain','blocked')),
  attempted_at TEXT,
  finished_at TEXT,
  provider TEXT,
  provider_message_id TEXT,
  code TEXT
);
