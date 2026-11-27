-- Preview confirmation is installation-local as well as owner-bound.
CREATE TABLE st_automation_reviews (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  review_key TEXT NOT NULL
);
