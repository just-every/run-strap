-- Public publication history travels; installation-local handoffs and authority do not.
CREATE TABLE st_widget_connections (
  id INTEGER PRIMARY KEY CHECK(id=1),
  publication_id TEXT NOT NULL
);
CREATE TABLE st_widget_selections (
  token_hash TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  class_basis TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX st_widget_selection_expiry ON st_widget_selections(expires_at);
