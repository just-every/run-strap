import { sha256 } from '../../modules/import-kit/src/d1/index.ts'
import type { D1Database, D1TargetAdapter, D1UndoDependency } from '../../modules/import-kit/src/d1/index.ts'
import { ImportError } from './errors.ts'
import { destination, mappingVersion, memberFields, sql, dependencies, invitations, select, scope, target, matches } from './snapshots.ts'
export { destination, mappingVersion }

export const memberTargets: D1TargetAdapter = {
  async read(db, dest, kind, id) {
    scope(dest, kind)
    const row = await db.prepare(`${select} WHERE s.id=?`).bind(id).first()
    return row ? target(row) : undefined
  },
  matches,
  write(row) {
    scope(row.destination, row.targetKind)
    const v = row.value as Record<string, any>
    if (v.id !== row.targetId || v.role !== 'member' || v.active !== 0 || v.erased_at !== null
      || v.dependencies !== '[]' || v.invitations !== '[]') throw new ImportError('invalid_import_effect', 409)
    return [
      sql('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM st_erasure_journal WHERE identity_hash=?) THEN 1 ELSE 0 END', sha256(v.email)),
      sql("INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM oa_operators WHERE lower(email)=? AND status IN ('active','invited')) THEN 1 ELSE 0 END", v.email),
      sql(`INSERT INTO st_people (${memberFields.join(',')}) VALUES (${memberFields.map(() => '?').join(',')})`, ...memberFields.map(key => v[key])),
      sql('INSERT INTO st_import_people_revisions(person_id,revision) VALUES(?,?)', row.targetId, row.revision),
      sql('UPDATE st_meta SET version=version+1 WHERE id=1'),
    ]
  },
  remove(dest, kind, id) {
    scope(dest, kind)
    return [
      sql(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM st_people s WHERE s.id=?
        AND (${dependencies}<>'[]' OR ${invitations}<>'[]')) THEN 1 ELSE 0 END`, id),
      sql('DELETE FROM st_import_people_revisions WHERE person_id=?', id),
      sql('DELETE FROM st_people WHERE id=?', id),
      sql('UPDATE st_meta SET version=version+1 WHERE id=1'),
    ]
  },
  async list(db, dest) {
    if (dest !== destination) throw new ImportError('invalid_import_target', 409)
    return (await db.prepare(select).all()).results.map(target)
  },
  matchesCount(count, dest) {
    if (dest !== destination) throw new ImportError('invalid_import_target', 409)
    return sql('(SELECT COUNT(*) FROM st_people)=?', count)
  },
  async preparePreservedUndo(db, dest, effects) {
    // One read admits large jobs without consuming one D1 statement per person.
    const rows = await this.list!(db, dest), byId = new Map(rows.map(row => [row.targetId, row]))
    const retainedDependencies: D1UndoDependency[] = []
    for (const effect of effects) {
      const row = byId.get(effect.expected.targetId), v = row?.value as Record<string, any> | undefined
      for (const [field, table] of [['dependencies', 'st_records'], ['invitations', 'oa_operators']] as const) {
        if (v && v[field] !== '[]') retainedDependencies.push({ requiredEffectId: effect.provenance.id,
          cause: { table, recordId: row!.targetId }, evidence: { field, snapshot: v[field] } })
      }
    }
    return {
      observations: effects.map(effect => ({ effectId: effect.provenance.id,
        current: byId.get(effect.expected.targetId) ?? null, entity: { table: 'st_people', recordId: effect.expected.targetId } })),
      dependencies: retainedDependencies,
      guards: [this.matchesCount!(rows.length, dest), ...rows.map(row => matches(row, dest, 'member', row.targetId))],
    }
  },
}

export async function nativeConflicts(db: Pick<D1Database, 'prepare'>, values: Record<string, any>[]) {
  // Set reads keep a 1000-row preview bounded instead of issuing 2000 lookups.
  const [people, erased, operators] = await Promise.all([
    db.prepare('SELECT id,email FROM st_people').all(),
    db.prepare('SELECT identity_hash FROM st_erasure_journal').all(),
    db.prepare("SELECT email FROM oa_operators WHERE status IN ('active','invited')").all(),
  ])
  const ids = new Set(people.results.map(p => p.id)), emails = new Set(people.results.filter(p => typeof p.email === 'string').map(p => p.email.toLowerCase()))
  const erasedHashes = new Set(erased.results.map(p => p.identity_hash)), invited = new Set(operators.results.map(p => p.email.toLowerCase()))
  return values.flatMap(value => {
    const reason = erasedHashes.has(sha256(value.email)) ? 'erased_identity'
      : ids.has(value.id) || emails.has(value.email) ? 'existing_member_requires_review'
        : invited.has(value.email) ? 'existing_access_requires_review' : null
    return reason ? [{ memberId: value.id as string, reason }] : []
  })
}
