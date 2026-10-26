-- Retain each expiring personal completion as an immutable receipt.
DROP INDEX st_acknowledgement;
CREATE UNIQUE INDEX st_acknowledgement ON st_records(
  json_extract(data,'$.personId'),
  json_extract(data,'$.waiverId'),
  COALESCE(json_extract(data,'$.validUntil'),'')
) WHERE kind='acknowledgement';
