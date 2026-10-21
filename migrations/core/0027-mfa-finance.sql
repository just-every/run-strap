-- SEC-004: second factors for privileged sign-in. Authenticator-app secrets are
-- sealed under the installation's MFA_KEY (AES-GCM), never the session secret;
-- passkeys keep public keys; recovery codes keep SHA-256 hashes. Factors,
-- per-session checks and passkey challenges are credentials: they are excluded
-- from archives, so a restored installation sends every person back to
-- enrollment. The audit rows and the finance grant are ordinary records.
CREATE TABLE st_mfa_factors (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('totp','passkey')), label TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','active')),
 sealed_secret TEXT, last_step INTEGER NOT NULL DEFAULT 0,
 credential_id TEXT UNIQUE, public_key TEXT CHECK(public_key IS NULL OR json_valid(public_key)), sign_count INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, confirmed_at INTEGER,
 CHECK((kind = 'totp' AND sealed_secret IS NOT NULL) OR (kind = 'passkey' AND credential_id IS NOT NULL AND public_key IS NOT NULL))
);
CREATE INDEX st_mfa_factors_operator ON st_mfa_factors(operator_id);
CREATE TABLE st_mfa_recovery (
 operator_id TEXT NOT NULL, code_hash TEXT NOT NULL, used_at INTEGER,
 PRIMARY KEY(operator_id, code_hash)
);
CREATE TABLE st_mfa_sessions (
 session_id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, verified_at INTEGER NOT NULL, method TEXT NOT NULL
);
CREATE INDEX st_mfa_sessions_operator ON st_mfa_sessions(operator_id);
CREATE TABLE st_mfa_challenges (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, session_id TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('register','verify')), challenge TEXT NOT NULL, expires_at INTEGER NOT NULL
);
-- A finance user is a staff identity: the owner grants it to an invited person, who then
-- reaches the revenue and collections report and nothing else.
CREATE TABLE st_finance_users (
 person_id TEXT PRIMARY KEY, granted_by TEXT NOT NULL, granted_at INTEGER NOT NULL
);
CREATE TABLE st_security_audit (
 id TEXT PRIMARY KEY, at INTEGER NOT NULL, actor_id TEXT NOT NULL, actor_email TEXT NOT NULL,
 action TEXT NOT NULL, subject_id TEXT NOT NULL, subject_email TEXT, detail TEXT NOT NULL CHECK(json_valid(detail))
);
CREATE INDEX st_security_audit_at ON st_security_audit(at);
