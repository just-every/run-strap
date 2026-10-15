CREATE TABLE st_people (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE,
 role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','instructor')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1, erased_at INTEGER
);
CREATE UNIQUE INDEX st_people_email_normalized ON st_people(lower(email)) WHERE email IS NOT NULL;
CREATE TABLE st_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO st_meta(id,version) VALUES(1,0);
CREATE TABLE st_records (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL
);
CREATE INDEX st_records_kind ON st_records(kind);
CREATE UNIQUE INDEX st_payment_reference ON st_records(json_extract(data,'$.reference')) WHERE kind='payment';
CREATE UNIQUE INDEX st_acknowledgement ON st_records(json_extract(data,'$.personId'),json_extract(data,'$.waiverId')) WHERE kind='acknowledgement';
CREATE UNIQUE INDEX st_active_booking ON st_records(json_extract(data,'$.personId'),json_extract(data,'$.classId'))
 WHERE kind='booking' AND json_extract(data,'$.status') IN ('booked','waitlisted');
CREATE TABLE st_erasure_journal (identity_hash TEXT PRIMARY KEY, erased_at INTEGER NOT NULL);
CREATE TABLE st_assert (value INTEGER NOT NULL CHECK(value=1));
