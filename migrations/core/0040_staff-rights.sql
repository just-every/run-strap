-- Canonical grants retain each old door independently. Audit events remain unchanged.
WITH legacy AS (
  SELECT kind,data,
    json_extract(data,'$.personId') AS person_id,
    CASE kind WHEN 'memberRecordGrant' THEN 'member-record'
      WHEN 'appointmentBookingGrant' THEN 'appointment'
      WHEN 'attendanceBookingGrant' THEN 'attendance-plan' ELSE 'retail' END AS door
  FROM st_records
  WHERE kind IN ('memberRecordGrant','appointmentBookingGrant','attendanceBookingGrant','retailStaffGrant')
), entries AS (
  SELECT person_id,door,data,
    CASE kind WHEN 'memberRecordGrant' THEN 'member-record'
      WHEN 'retailStaffGrant' THEN 'sale' ELSE 'booking' END AS right_name,
    CASE WHEN json_extract(data,'$.enabled')=1 AND (kind!='retailStaffGrant' OR json_extract(data,'$.sale')=1) THEN 1 ELSE 0 END AS enabled
  FROM legacy
  UNION ALL
  SELECT person_id,door,data,'refund',
    CASE WHEN json_extract(data,'$.enabled')=1 AND json_extract(data,'$.refund')=1 THEN 1 ELSE 0 END
  FROM legacy WHERE kind='retailStaffGrant'
), scoped AS (
  SELECT *,json_object(
    'memberIds',json(COALESCE(json_extract(data,'$.memberIds'),'[]')),
    'locationIds',json(COALESCE(json_extract(data,'$.locationIds'),'[]')),
    'doors',json_array(door)) AS scope
  FROM entries
), permissions AS (
  SELECT person_id,right_name,
    CASE WHEN right_name='member-record' THEN json_object(
      'enabled',json(CASE WHEN max(enabled)=1 THEN 'true' ELSE 'false' END),
      'scopes',json((SELECT json_group_array(json(scope)) FROM scoped s WHERE s.person_id=p.person_id AND s.right_name=p.right_name AND s.enabled=1)),
      'canCreate',json(CASE WHEN max(CASE WHEN json_extract(data,'$.canCreate')=1 THEN 1 ELSE 0 END)=1 THEN 'true' ELSE 'false' END),
      'version',max(COALESCE(json_extract(data,'$.version'),0)))
    ELSE json_object(
      'enabled',json(CASE WHEN max(enabled)=1 THEN 'true' ELSE 'false' END),
      'scopes',json((SELECT json_group_array(json(scope)) FROM scoped s WHERE s.person_id=p.person_id AND s.right_name=p.right_name AND s.enabled=1)),
      'version',max(COALESCE(json_extract(data,'$.version'),0))) END AS permission
  FROM scoped p GROUP BY person_id,right_name
), people AS (
  SELECT person_id,max(COALESCE(json_extract(data,'$.version'),0)) AS grant_version,
    max(CASE WHEN json_extract(data,'$.enabled')=1 THEN 1 ELSE 0 END) AS enabled,
    max(json_extract(data,'$.updatedAt')) AS updated_at,
    json_group_object(door,json(data)) AS old_inputs
  FROM legacy GROUP BY person_id
)
INSERT INTO st_records(id,kind,data,version)
SELECT 'staff-access:'||p.person_id,'staffAccess',json_object(
  'id','staff-access:'||p.person_id,'personId',p.person_id,
  'role',CASE WHEN EXISTS(SELECT 1 FROM st_finance_users f WHERE f.person_id=p.person_id) THEN 'finance'
    WHEN EXISTS(SELECT 1 FROM st_managers m WHERE m.person_id=p.person_id) THEN 'manager' ELSE 'front-desk' END,
  'enabled',json(CASE WHEN p.enabled=1 THEN 'true' ELSE 'false' END),
  'version',max(1,p.grant_version),
  'rights',json((SELECT json_group_object(right_name,json(permission)) FROM permissions r WHERE r.person_id=p.person_id)),
  'legacyGrants',json(p.old_inputs),'updatedAt',p.updated_at,
  'updatedBy',(SELECT json_extract(l.data,'$.updatedBy') FROM legacy l WHERE l.person_id=p.person_id ORDER BY json_extract(l.data,'$.updatedAt') DESC LIMIT 1)
),(SELECT version+1 FROM st_meta WHERE id=1)
FROM people p;
DELETE FROM st_records WHERE kind IN ('memberRecordGrant','appointmentBookingGrant','attendanceBookingGrant','retailStaffGrant');
UPDATE st_meta SET version=version+1 WHERE id=1;
