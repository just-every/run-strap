import { humanOwner, insist, type Actor } from './domain/types'

// Explicit custody allowlist: auth, provider configuration and work queues never enter this bundle.
const tables = [
  ['st_meta', 'id version', 'id'],
  ['st_people', 'id name email role active version erased_at', 'id'],
  ['st_records', 'id kind data version', 'id'],
  ['st_erasure_journal', 'identity_hash erased_at', 'identity_hash'],
  ['st_notice_deliveries', 'id source_kind source_id person_id booking_ids recipient subject body status provider provider_message_id code created_at attempted_at finished_at', 'id'],
  ['st_import_people_revisions', 'person_id revision', 'person_id'],
  ['ik_jobs', 'id destination namespace mapping_version principal_id fingerprint operation_key plan_json state checkpoint total fence error reversal_policy reversal_policy_hash reversal_cursor reversal_hash', 'id'],
  ['ik_original_sets', 'job_id version', 'job_id'],
  ['ik_originals', 'job_id kind original_key name sha256 size bytes', 'job_id kind original_key'],
  ['ik_d1_original_chunks', 'job_id kind original_key ordinal bytes', 'job_id kind original_key ordinal'],
  ['ik_d1_plan_chunks', 'job_id ordinal body', 'job_id ordinal'],
  ['ik_d1_creation_plans', 'job_id ordinal body released', 'job_id ordinal'],
  ['ik_sources', 'identity source_hash mapping_version effects_hash job_id', 'identity'],
  ['ik_provenance', 'id job_id ordinal effect_ordinal source_identity destination target_kind target_id reversed record_json', 'id'],
  ['ik_d1_history', 'id job_id ordinal effect_ordinal source_identity destination target_kind target_id reversed record_json successor_id', 'id'],
  ['ik_d1_entries', 'job_id ordinal source_identity owner_job_id effects_hash', 'job_id ordinal'],
  ['ik_batches', 'job_id action position end_position fence', 'job_id action position'],
  ['ik_d1_reversal_reports', 'job_id effect_id position record_json', 'job_id effect_id'],
  ['ik_d1_streams', 'id destination namespace mapping_version principal_id fingerprint operation_key total layout_hash state', 'id'],
  ['ik_d1_stream_pages', 'stream_id ordinal job_id total erased_records', 'stream_id ordinal'],
  ['ik_d1_erased_sources', 'destination identity', 'destination identity'],
  ['ik_d1_erased_targets', 'destination identity', 'destination identity'],
  ['ik_d1_retirements', 'id kind destination receipt_id retired_at', 'id kind'],
  ['ik_d1_erasure_journal', 'id destination recorded_at records_erased jobs_retired streams_retired stores_json', 'id'],
] as const

type Row = Record<string, unknown>

const relationships = [
  { from: 'st_records.data.priceDisclosureId', to: 'st_records.id', kind: 'renewalDisclosure' },
  { from: 'st_records.data.currentPriceDisclosureId', to: 'st_records.id', kind: 'renewalDisclosure' },
  { from: 'st_records.data.giftCardId', to: 'st_records.id', kind: 'giftCard' },
  { from: 'st_records.data.promotionId', to: 'st_records.id', kind: 'promotion', when: 'kind=promotionUse' },
  { from: 'st_records.data.shiftId', to: 'st_records.id', kind: 'clockShift', when: 'kind=clockEvent or kind=clockCorrection or kind=clockApproval' },
  { from: 'st_records.data.approvalId', to: 'st_records.id', kind: 'clockApproval', when: 'kind=clockShift' },
  { from: 'st_records.data.approvedCorrectionId', to: 'st_records.id', kind: 'clockCorrection', when: 'kind=clockShift' },
  { from: 'st_records.data.pendingCorrectionId', to: 'st_records.id', kind: 'clockCorrection', when: 'kind=clockShift' },
  { from: 'st_records.data.skuId', to: 'st_records.id', kind: 'sku', when: 'kind=stockReceipt or kind=stockMovement or kind=retailSale or kind=retailReturn' },
  { from: 'st_records.data.supplierId', to: 'st_records.id', kind: 'supplier', when: 'kind=sku or kind=stockReceipt' },
  { from: 'st_records.data.saleId', to: 'st_records.id', kind: 'retailSale', when: 'kind=retailReturn' },
  { from: 'st_records.data.sessionId', to: 'st_records.id', kind: 'drawerSession', when: 'kind=drawerEntry or kind=drawerAdjustment or kind=retailSale or kind=retailReturn' },
  { from: 'st_records.data.retailSaleId', to: 'st_records.id', kind: 'retailSale' },
  { from: 'st_records.data.retailReturnId', to: 'st_records.id', kind: 'retailReturn' },
  { from: 'st_records.data.paymentId', to: 'st_records.id', kind: 'payment', when: 'kind=retailSale or kind=retailReturn' },
  { from: 'st_records.data.chargeId', to: 'st_records.id', kind: 'charge', when: 'kind=retailSale or kind=retailReturn' },
  { from: 'st_records.data.formId', to: 'st_records.id', kind: 'intakeForm', when: 'kind=intakeResponse' },
  { from: 'st_records.data.seriesId', to: 'st_records.id', kind: 'intakeSeries', when: 'kind=intakeForm or kind=intakeResponse' },
  { from: 'st_records.data.currentFormId', to: 'st_records.id', kind: 'intakeForm', when: 'kind=intakeSeries' },
  { from: 'st_records.data.planId', to: 'st_records.id', kind: 'familyTuition', when: 'kind=familyBillPreview or kind=familyInvoice or kind=familyTuitionWithdrawal' },
  { from: 'st_records.data.familyInvoiceId', to: 'st_records.id', kind: 'familyInvoice' },
  { from: 'st_records.data.rows[].personId', to: 'st_people.id', when: 'kind=familyTuition or kind=familyBillPreview or kind=familyInvoice' },
  { from: 'st_records.data.rows[].packId', to: 'st_records.id', kind: 'pack', when: 'kind=familyInvoice' },
  { from: 'st_records.data.rows[].chargeId', to: 'st_records.id', kind: 'charge', when: 'kind=familyInvoice' },
  { from: 'st_records.data.sourceId', to: 'st_people.id', when: 'kind=memberMerge or kind=memberMergePreview' },
  { from: 'st_records.data.targetId', to: 'st_people.id', when: 'kind=memberMerge or kind=memberMergePreview' },
  { from: 'st_records.data.memberIds[]', to: 'st_people.id', when: 'kind=memberRecordGrant' },
  { from: 'st_records.data.sequenceId', to: 'st_records.id', kind: 'renewalSequence', when: 'kind=marketingMessage or kind=memberMessage' },
  { from: 'st_records.data.marketingMessageId', to: 'st_records.id', kind: 'marketingMessage', when: 'kind=memberMessage' },
  { from: 'st_records.data.introSaleId', to: 'st_records.id', kind: 'introSale' },
  { from: 'st_records.data.introOfferId', to: 'st_records.id', kind: 'introOffer' },
  { from: 'st_records.data.offerId', to: 'st_records.id', kind: 'introOffer', when: 'kind=introPreview or kind=introSale' },
  { from: 'st_records.data.previewId', to: 'st_records.id', kind: 'introPreview', when: 'kind=introSale' },
  { from: 'st_records.data.otherPersonId', to: 'st_people.id', when: 'kind=introIdentityLink' },
  { from: 'st_records.data.recurringTermsId', to: 'st_records.id', kind: 'recurringTerms' },
  { from: 'st_records.data.invoiceId', to: 'st_records.id', kind: 'recurringInvoice', when: 'kind=pack or kind=charge' },
  { from: 'st_records.data.cancellationId', to: 'st_records.id', kind: 'contractCancellation' },
  { from: 'st_records.data.termsId', to: 'st_records.id', kind: 'recurringTerms' },
  { from: 'st_records.data.delegateId', to: 'st_people.id' },
  { from: 'st_records.data.paymentId', to: 'st_records.id', kind: 'payment', when: 'kind=contractPrepayment' },
  { from: 'st_records.data.freezeId', to: 'st_records.id', kind: 'freeze' },
  { from: 'st_records.data.freezeTypeId', to: 'st_records.id', kind: 'freezeType' },
  { from: 'st_records.data.freezeRequestId', to: 'st_records.id', kind: 'freezeRequest' },
  { from: 'st_records.data.guestPackId', to: 'st_records.id', kind: 'pack' },
  { from: 'st_records.data.sponsorId', to: 'st_people.id' },
  { from: 'st_records.data.payerId', to: 'st_people.id' },
  { from: 'st_records.data.guardianId', to: 'st_people.id' },
  { from: 'st_records.data.originalBookingId', to: 'st_records.id', kind: 'booking' },
  { from: 'st_records.data.makeupCreditId', to: 'st_records.id', kind: 'makeupCredit' },
  { from: 'st_records.data.absenceId', to: 'st_records.id', kind: 'absence' },
  { from: 'st_records.data.leadId', to: 'st_records.id', kind: 'lead', when: 'kind=renewalFollowup' },
  { from: 'st_records.data.reservationId', to: 'st_records.id', kind: 'reservation' },
  { from: 'st_records.data.outcomes[].bookingId', to: 'st_records.id', kind: 'booking', when: 'kind=reservation' },
  { from: 'st_records.data.parentActionId', to: 'st_records.id', kind: 'staffAction', when: 'kind=bookingAction' },
  { from: 'st_records.data.chargeId', to: 'st_records.id', kind: 'charge', when: 'kind=payment' },
  { from: 'st_records.data.reversesChargeId', to: 'st_records.id', kind: 'charge', when: 'kind=charge' },
  { from: 'st_records.data.packId', to: 'st_records.id', kind: 'pack', when: 'kind=planChange or kind=planChangeRequest' },
  { from: 'st_records.data.planRequestId', to: 'st_records.id', kind: 'planChangeRequest', when: 'kind=planChange' },
  { from: 'st_records.data.planChangeId', to: 'st_records.id', kind: 'planChange', when: 'kind=charge or kind=planChangeRequest' },
  { from: 'st_records.data.renewedFromPackId', to: 'st_records.id', kind: 'pack', when: 'kind=pack' },
  { from: 'st_records.data.requestId', to: 'st_records.id', kind: 'substitutionRequest', when: 'kind=substitutionDraft' },
  { from: 'st_records.data.substitution.id', to: 'st_records.id', kind: 'substitutionDraft', when: 'kind=class' },
  { from: 'st_records.data.originalInstructorId', to: 'st_people.id', when: 'kind=substitutionRequest' },
  { from: 'st_records.data.leadId', to: 'st_records.id', kind: 'lead', when: 'kind=leadEvent' },
  { from: 'st_records.data.ruleId', to: 'st_records.id', kind: 'milestone', when: 'kind=recognition or kind=milestoneRevision' },
  { from: 'st_records.data.sourceBookingIds[]', to: 'st_records.id', kind: 'booking', when: 'kind=recognition' },
  { from: 'st_records.data.ruleId', to: 'st_records.id', kind: 'payRule', when: 'kind=payAdjustment' },
  { from: 'st_records.data.attendedBookingIds[]', to: 'st_records.id', kind: 'booking', when: 'kind=payAdjustment' },
  { from: 'st_records.data.seriesId', to: 'st_records.id', kind: 'series' },
  { from: 'st_records.data.seriesChangeId', to: 'st_records.id', kind: 'draft' },
  { from: 'st_records.data.classIds[]', to: 'st_records.id', kind: 'class' },
  { from: 'st_records.data.closureId', to: 'st_records.id', kind: 'closure' },
  { from: 'st_records.data.closureIds[]', to: 'st_records.id', kind: 'closure' },
  { from: 'st_records.data.personId', to: 'st_people.id' },
  { from: 'st_records.data.instructorId', to: 'st_people.id' },
  { from: 'st_records.data.classId', to: 'st_records.id', kind: 'class' },
  { from: 'st_records.data.packId', to: 'st_records.id', kind: 'pack' },
  { from: 'st_records.data.bookingId', to: 'st_records.id', kind: 'booking' },
  { from: 'st_records.data.draftId', to: 'st_records.id', kind: 'draft' },
  { from: 'st_records.data.waiverId', to: 'st_records.id', kind: 'waiver' },
  { from: 'st_records.data.classes[].instructorId', to: 'st_people.id' },
  { from: 'st_records.data.reservations[].bookingId', to: 'st_records.id', kind: 'booking' },
  { from: 'st_import_people_revisions.person_id', to: 'st_people.id' },
  { from: 'st_notice_deliveries.person_id', to: 'st_people.id' },
  { from: 'st_records.data.ruleId', to: 'st_records.id', kind: 'classReminderRule', when: 'kind=classReminder or kind=classReminderRuleEvent' },
  { from: 'st_records.data.taskId', to: 'st_records.id', kind: 'reminderTask', when: 'kind=reminderTaskEvent' },
  { from: 'st_records.data.reminderId', to: 'st_records.id', kind: 'classReminder' },
  { from: 'st_records.data.deliveryId', to: 'st_notice_deliveries.id', when: 'kind=classReminder or kind=reminderTask' },
  { from: 'st_notice_deliveries.source_id', to: 'st_records.id', kind: 'classReminder', when: 'source_kind=reminder' },
  { from: 'st_notice_deliveries.source_id', to: 'st_records.id', kind: 'closure', when: 'source_kind=closure' },
  { from: 'st_notice_deliveries.source_id', to: 'st_records.id', kind: 'booking', when: 'source_kind=booking or source_kind=confirmation' },
  { from: 'st_notice_deliveries.source_id', to: 'st_records.id', kind: 'bookingAction', when: 'source_kind=booking_action' },
  { from: 'import tables.job_id', to: 'ik_jobs.id' },
  { from: 'ik_d1_entries.owner_job_id', to: 'ik_jobs.id' },
  { from: 'ik_d1_stream_pages.stream_id', to: 'ik_d1_streams.id' },
  { from: 'ik_provenance.target_id', to: 'st_people.id', when: "destination=strap:members and target_kind=member" },
  { from: 'ik_provenance.source_identity', to: 'ik_sources.identity', note: 'Historical or reversed sources may no longer be active.' },
  { from: 'ik_d1_history.successor_id', to: 'ik_provenance.id', note: 'Historical chain; successor may itself have moved to history.' },
  { from: 'ik_d1_retirements.receipt_id', to: 'ik_d1_erasure_journal.id' },
]

// Every cell is a JSON value before RFC 4180 escaping: null, empty text, zero,
// booleans, embedded newlines and arbitrary structured values stay distinct.
function csv(columns: readonly string[], rows: Row[]): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
  return [columns.map(quote).join(','), ...rows.map(row => columns.map(column => {
    insist(Object.hasOwn(row, column), 'exit_export_missing_column', 500)
    return quote(JSON.stringify(row[column]))
  }).join(','))].join('\r\n') + '\r\n'
}

function select(table: string, fields: string, primaryKey: string): string {
  // SQLite JSON preserves text containing NUL through the D1 text transport.
  const entries = fields.split(' ').map(column => {
    const value = column === 'bytes'
      ? "CASE WHEN bytes IS NULL THEN NULL ELSE json_object('encoding','hex','storageType',typeof(bytes),'hex',hex(bytes)) END"
      : `"${column}"`
    return `'${column}',${value}`
  })
  const order = primaryKey.split(' ').map(column => `"${column}"`).join(',')
  return `SELECT json_object(${entries.join(',')}) AS exported_row FROM "${table}" ORDER BY ${order}`
}

/** Called only after the HTTP transport authenticates the native session.
 * This function independently rejects agents and rechecks current owner authority
 * in the same read transaction as the exported data. It performs no writes. */
export async function exitExport(db: D1Database, who: Actor): Promise<Response> {
  humanOwner(who)
  const results = await db.batch<{ exported_row: string }>([
    db.prepare("SELECT id FROM oa_operators WHERE id=? AND email=? AND role='owner' AND status='active'").bind(who.id, who.email),
    ...tables.map(([table, fields, key]) => db.prepare(select(table, fields, key))),
  ])
  insist(results[0].results.length === 1, 'owner_required', 403)
  const data: Record<string, Row[]> = {}
  const csvFiles: Record<string, string> = {}
  const schema = tables.map(([name, fields, key], index) => {
    insist(results[index + 1].success, 'exit_export_read_failed', 500)
    const rows = results[index + 1].results.map(row => JSON.parse(String(row.exported_row)) as Row)
    data[name] = rows
    const columns = fields.split(' ')
    csvFiles[`${name}.csv`] = csv(columns, rows)
    return { name, columns, primaryKey: key.split(' '), rows: rows.length,
      order: 'primary key',
      jsonColumns: columns.filter(column => column === 'data' || column.endsWith('_json') || column === 'body'),
      binaryColumns: columns.filter(column => column === 'bytes') }
  })
  const kinds: Record<string, number> = {}
  for (const row of data.st_records) kinds[String(row.kind)] = (kinds[String(row.kind)] ?? 0) + 1
  const bundle = {
    manifest: {
      format: 'strap-exit', version: 1, generatedAt: new Date().toISOString(),
      product: 'studio/strap', schema, relationships, recordKinds: kinds,
      csv: { encoding: 'UTF-8', recordSeparator: 'CRLF', cellEncoding: 'JSON value inside RFC 4180 quoted field', headerEncoding: 'plain column name' },
      provenance: { jobs: 'ik_jobs', originals: 'ik_originals', originalChunks: 'ik_d1_original_chunks',
        sourceIdentities: 'ik_sources', effects: 'ik_provenance', history: 'ik_d1_history', batches: 'ik_batches' },
      actorReferences: 'Operator IDs in approval, creation, check-in and import provenance are opaque attribution only; no native auth identities are exported. Member-record grants travel as attributed studio data only and grant no authority to an independent receiver.',
      documents: { waiverTexts: 'st_records kind=waiver', acknowledgements: 'st_records kind=acknowledgement',
        signedWaivers: { status: 'not_implemented', files: [] }, media: { status: 'not_implemented', files: [] },
        acknowledgementMeaning: 'Receipt of an exact waiver version; not a signature or signed waiver.' },
      providers: { connections: [], status: 'No studio billing or message-delivery connections exist in the current schema.',
        receiver: 'Import records as data only. Configure and review any receiver billing or delivery connections separately before enabling outbound work.' },
      excluded: ['native authentication tables', 'sessions', 'sign-in links', 'agent keys', 'integration keys with their subscriptions and request logs', 'kiosk device tokens', 'secrets and provider credentials',
        'development outbox', 'import leases and transient staging/coordination tables'],
      recovery: 'Portable data for an independent receiver; native rer export/import remains a separate archive and guarded restore workflow.',
    },
    tables: data,
    csv: csvFiles,
  }
  return new Response(JSON.stringify(bundle, null, 2) + '\n', { headers: {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': 'attachment; filename="strap-exit.json"',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow',
  } })
}
