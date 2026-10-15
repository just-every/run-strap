import {
  planD1Import, createD1ImportJob, applyD1ImportBatches, undoD1Import, resumeD1Import,
  readD1ImportJob, readD1ImportOriginals, readD1ImportUndoReport, rollbackD1Import, d1RequestContext,
} from '../../modules/import-kit/src/d1/index.ts'
import type { D1ImportContext, D1Database as KitDatabase, ImportMapping, ImportPlan } from '../../modules/import-kit/src/d1/index.ts'
import { formatName, namespace, memberSource } from './csv.ts'
import { destination, mappingVersion, memberTargets, nativeConflicts } from './targets.ts'
import { ImportError, requiredText } from './errors.ts'
export { ImportError } from './errors.ts'
export type ImportActor = { id: string; email: string; role: string }

export function importContext(db: D1Database, actor: ImportActor): D1ImportContext {
  if (actor.role !== 'owner') throw new ImportError('owner_required', 403)
  return {
    destination, namespace, mappingVersion, storage: { database: db as unknown as KitDatabase, targets: memberTargets },
    batchSize: 10, maxBatches: 1, reversalPolicy: 'preserve-conflicts',
    authorization: { principalId: actor.id, predicate: () => ({
      sql: "EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND lower(email)=? AND role='owner' AND status='active')",
      params: [actor.id, actor.email.toLowerCase()],
    }) },
  }
}
const mapping: ImportMapping = {
  version: mappingVersion,
  map(record) {
    return { effects: [{ targetKind: 'member', targetId: record.sourceId,
      value: { ...(record.payload as Record<string, string>), role: 'member', active: 0, version: 1, erased_at: null,
        dependencies: '[]', invitations: '[]' } }] }
  },
}
const memberValues = (plan: ImportPlan) => plan.entries.flatMap(entry => entry.effects.map(effect => effect.value as Record<string, any>))

/** The transport authenticates a human session and checks request origin.
 * Current owner authority is also fenced inside every kit transaction. */
export async function importCommand(db: D1Database, actor: ImportActor, name: string, input: Record<string, unknown>): Promise<unknown> {
  const context = d1RequestContext(importContext(db, actor))
  const owner = await db.prepare("SELECT 1 FROM oa_operators WHERE id=? AND lower(email)=? AND role='owner' AND status='active'")
    .bind(actor.id, actor.email.toLowerCase()).first()
  if (!owner) throw new ImportError('owner_required', 403)
  try {
    if (name === 'import.preview' || name === 'import.apply') {
      const plan = await planD1Import(memberSource(input.csv), mapping, context)
      const members = memberValues(plan), conflicts = await nativeConflicts(db, members)
      if (name === 'import.preview') return { format: formatName, fingerprint: plan.fingerprint,
        counts: plan.counts, diagnostics: plan.diagnostics, members, conflicts }
      const reviewedFingerprint = requiredText(input.fingerprint, 'fingerprint')
      if (reviewedFingerprint !== plan.fingerprint) throw new ImportError('review_fingerprint_mismatch', 409, 'Preview this exact CSV again before applying')
      if (conflicts.some(c => c.reason === 'erased_identity')) throw new ImportError('erased_identity', 409, 'An erased member identity cannot be imported again')
      const job = await createD1ImportJob(plan, { ...context, reviewedFingerprint })
      return { job: await applyD1ImportBatches(job.id, context) }
    }
    if (!['import.rollback', 'import.undo', 'import.resume', 'import.journal'].includes(name)) throw new ImportError('unknown_import_command', 400)
    const jobId = requiredText(input.jobId, 'jobId')
    if (name === 'import.rollback') return { job: await rollbackD1Import(jobId, context) }
    if (name === 'import.undo') return { job: await undoD1Import(jobId, context) }
    if (name === 'import.resume') return { job: await resumeD1Import(jobId, context) }
    const job = await readD1ImportJob(jobId, context)
    const originals = await readD1ImportOriginals(jobId, context)
    const { results: batches } = await db.prepare('SELECT action,position,end_position,fence FROM ik_batches WHERE job_id=? ORDER BY rowid').bind(jobId).all()
    const undo = await readD1ImportUndoReport(jobId, context, { limit: 1000 })
    await readD1ImportJob(jobId, context)
    return { job, originals, batches, undo }
  } catch (error) {
    if (error instanceof ImportError) throw error
    const message = error instanceof Error ? error.message : ''
    if (message.includes('IMPORT_JOB_NOT_FOUND')) throw new ImportError('import_job_not_found', 404)
    if (/NATIVE_EDIT_CONFLICT|TARGET_REVISION_CONFLICT|SOURCE_ID_CONTENT_CONFLICT|IMPORT_ALREADY_REVERSING|IMPORT_ATOMIC_GUARD|IMPORT_FINAL_GUARD|JOB_BINDING_MISMATCH|OPERATION_KEY_CONFLICT|UNIQUE constraint|IMPORT_NOT_COMPLETED|IMPORT_NOT_COMPLETE|UNDO_REQUIRES|REVERSAL_MODE_CONFLICT/.test(message)) {
      throw new ImportError('import_conflict', 409, 'Import conflicts with current records or authority. Review the journal; later edits and dependent work are preserved.')
    }
    if (/IMPORT_D1_REQUEST_LIMIT|IMPORT_D1_TRANSPORT_LIMIT/.test(message)) throw new ImportError('import_request_limit', 409, 'Resume this import in a new request')
    throw error
  }
}
