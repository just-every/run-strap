-- Fresh connection reviews are invalidated by a later disconnect or review.
-- This installation authority is excluded from native and portable archives.
CREATE TABLE st_payment_control (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  origin TEXT NOT NULL
);
