-- Short-lived invitation requests confer no account or booking authority.
CREATE TABLE st_widget_signup_requests (
  selection_hash TEXT PRIMARY KEY REFERENCES st_widget_selections(token_hash) ON DELETE CASCADE,
  selection_token TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  person_id TEXT
);
