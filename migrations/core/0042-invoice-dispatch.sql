-- Dispatch authority belongs to this installation and never travels in an archive.
CREATE TABLE st_invoice_dispatches (
 id TEXT PRIMARY KEY,
 origin TEXT NOT NULL,
 authority_hash TEXT NOT NULL,
 person_id TEXT NOT NULL,
 person_version INTEGER NOT NULL,
 recipient TEXT NOT NULL,
 document_hash TEXT NOT NULL,
 status TEXT NOT NULL,
 provider_message_id TEXT
);
CREATE TABLE st_invoice_mail_review (
 id TEXT PRIMARY KEY,
 origin TEXT NOT NULL,
 authority_hash TEXT NOT NULL
);
