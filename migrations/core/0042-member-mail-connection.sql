-- Member delivery authority belongs to this installation and never restores.
CREATE TABLE st_member_mail_connections (
 id TEXT PRIMARY KEY CHECK(id='member-mail'),
 origin TEXT NOT NULL,
 connected_by TEXT NOT NULL,
 connected_at TEXT NOT NULL
);
-- Existing installations retain authority. Fresh restores import records after migrations.
INSERT INTO st_member_mail_connections(id,origin,connected_by,connected_at)
 SELECT id,json_extract(data,'$.origin'),json_extract(data,'$.connectedBy'),json_extract(data,'$.connectedAt')
 FROM st_records WHERE kind='mailConnection' AND id='member-mail' AND json_type(data,'$.origin')='text';
