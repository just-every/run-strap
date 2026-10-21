-- API-002 integration keys: owner-created, read-only application credentials with a fixed
-- scope catalogue. Only SHA-256 hashes of secrets are stored. A rotated secret keeps its
-- row (revoked) so a later attempt with it is refused and logged against its key.
CREATE TABLE st_integrations (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES oa_operators(id), owner_version INTEGER NOT NULL,
 label TEXT NOT NULL, scopes TEXT NOT NULL CHECK(json_valid(scopes)), location TEXT NOT NULL,
 events TEXT NOT NULL CHECK(json_valid(events)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE st_integration_secrets (
 token_hash TEXT PRIMARY KEY, integration_id TEXT NOT NULL REFERENCES st_integrations(id),
 created_at INTEGER NOT NULL, revoked_at INTEGER
);
-- The owner's usage and failure log: the newest 100 requests per key. It holds the key,
-- method, path, status and refusal code only, never a query string or member data.
CREATE TABLE st_integration_requests (
 seq INTEGER PRIMARY KEY, integration_id TEXT NOT NULL REFERENCES st_integrations(id),
 at INTEGER NOT NULL, method TEXT NOT NULL, route TEXT NOT NULL, status INTEGER NOT NULL, code TEXT
);
CREATE INDEX st_integration_requests_key ON st_integration_requests(integration_id, seq);
-- Counted requests of the last rolling 60 seconds, per key, for the rate limit.
CREATE TABLE st_integration_rate (integration_id TEXT NOT NULL REFERENCES st_integrations(id), at INTEGER NOT NULL);
CREATE INDEX st_integration_rate_key ON st_integration_rate(integration_id, at);
