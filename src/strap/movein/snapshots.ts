import type { D1Sql, TargetRow } from '../../modules/import-kit/src/d1/index.ts'
import { ImportError } from './errors.ts'

export const destination = 'strap:members'
export const mappingVersion = 'mindbody-members-v1'
export const memberFields = ['id', 'name', 'email', 'role', 'active', 'version', 'erased_at'] as const
export const sql = (sql: string, ...params: unknown[]): D1Sql => ({ sql, params })

// Exact JSON leaves include nested bookings, attendance, credits and billing.
// Unknown kinds additionally use a conservative substring check to preserve
// future work without mistaking a short numeric ID for a known price or date.
export const dependencies = `(SELECT json_group_array(json_object('id',d.id,'kind',d.kind,'data',d.data,'version',d.version))
  FROM (SELECT id,kind,data,version FROM st_records work WHERE
    EXISTS(SELECT 1 FROM json_tree(work.data) leaf WHERE leaf.type='text' AND leaf.value=s.id)
    OR (work.kind NOT IN ('booking','pack','charge','payment','class','draft','approval','waiver','acknowledgement')
      AND instr(work.data,s.id)>0) ORDER BY id) d)`
export const invitations = `(SELECT json_group_array(json_object('id',o.id,'email',o.email,'display_name',o.display_name,
  'role',o.role,'status',o.status,'version',o.version,'created_at',o.created_at))
  FROM (SELECT * FROM oa_operators WHERE lower(email)=lower(s.email) AND status IN ('active','invited') ORDER BY id) o)`
export const select = `SELECT s.*,r.revision AS import_revision,${dependencies} AS dependency_snapshot,
  ${invitations} AS invitation_snapshot FROM st_people s LEFT JOIN st_import_people_revisions r ON r.person_id=s.id`

export function scope(dest: string, kind: string) {
  if (dest !== destination || kind !== 'member') throw new ImportError('invalid_import_target', 409)
}
export function target(row: Record<string, any>): TargetRow {
  return { destination, targetKind: 'member', targetId: row.id, revision: row.import_revision ?? `native:${row.version}`,
    value: { ...Object.fromEntries(memberFields.map(key => [key, row[key]])),
      dependencies: row.dependency_snapshot, invitations: row.invitation_snapshot } }
}
export function matches(row: TargetRow | null, dest: string, kind: string, id: string): D1Sql {
  scope(dest, kind)
  if (!row) return sql('NOT EXISTS(SELECT 1 FROM st_people WHERE id=?) AND NOT EXISTS(SELECT 1 FROM st_import_people_revisions WHERE person_id=?)', id, id)
  const v = row.value as Record<string, any>
  return sql(`EXISTS(SELECT 1 FROM st_people s LEFT JOIN st_import_people_revisions r ON r.person_id=s.id WHERE s.id=?
    AND ${memberFields.map(key => `s.${key} IS ?`).join(' AND ')}
    AND COALESCE(r.revision,'native:'||s.version)=? AND ${dependencies} IS ? AND ${invitations} IS ?)`,
    id, ...memberFields.map(key => v[key]), row.revision, v.dependencies, v.invitations)
}
