import { list, type RecordData, type State } from './domain/types'

/** Project retained sources, never today's authority or drawer balance. */
export function studioAudit(state: State): RecordData[] {
  const requests = list(state,'retailAction')
  return [
    ...list(state,'staffAccessEvent').map(event => ({
      ...event, sourceKind:'staffAccessEvent', sourceId:event.id,
      action:'staff.access.change', command:event.command ?? 'staff.access.change',
      actorRole:event.actorRole ?? null, right:'access', channel:event.channel ?? null,
      reason:event.reason ?? null,
    })),
    ...list(state,'drawerAdjustment').map(event => {
      // Old count adjustments retained their exact result identity. Old reopens
      // did not: absent facts stay unavailable rather than inferred by time.
      const request = requests.find(row => row.actorId === event.actorId &&
        (row.sourceKind === 'drawerAdjustment' && row.sourceId === event.id ||
          row.action === 'drawer.adjust' && row.result?.id === event.id))
      const command = event.action === 'reopen' ? 'drawer.reopen' : 'drawer.adjust'
      return {...event, sourceKind:'drawerAdjustment', sourceId:event.id,
        at:event.createdAt, personId:null, command, action:command,
        actorRole:event.actorRole ?? request?.role ?? null, version:event.version ?? null,
        right:'drawer', channel:event.channel ?? null, after:event.after ?? null}
    }),
    ...list(state,'booking').flatMap(booking => (booking.corrections ?? []).map((change: RecordData,index: number) => ({
      id:change.id ?? `${booking.id}:correction:${index}`, sourceKind:'attendanceCorrection',
      sourceId:change.id ?? `${booking.id}:correction:${index}`, personId:booking.personId,
      actorId:change.by ?? null, actorRole:change.byRole ?? null, at:change.at,
      command:'attendance.correct', action:'attendance.correct', right:'check-in',
      version:change.version ?? null, channel:change.channel ?? null,
      reason:booking.erased ? null : change.reason ?? null, erased:!!booking.erased,
      before:booking.erased ? null : change.before ?? null,
      after:booking.erased ? null : {bookingId:booking.id,from:change.from,to:change.to,
        creditRestored:change.creditRestored,feeReversedCents:change.feeReversedCents,refundId:change.refundId},
    }))),
    ...list(state,'packCreditEvent').filter(event => event.type === 'adjust').map(event => ({
      id:event.id, sourceKind:'packCreditEvent', sourceId:event.id, personId:event.personId,
      actorId:event.actorId ?? null, actorRole:event.actorRole ?? null, at:event.createdAt,
      command:'pack.adjust', action:'pack.adjust', right:'entitlements', version:event.revision,
      channel:event.channel ?? null, reason:event.erased ? null : event.reason ?? null, erased:!!event.erased,
      before:event.erased ? null : {packId:event.packId,remaining:event.remainingAfter-event.credits,expiresAt:event.expiresAtBefore},
      after:event.erased ? null : {packId:event.packId,remaining:event.remainingAfter,expiresAt:event.expiresAtAfter,creditsDelta:event.credits},
    })),
    ...list(state,'recurringInvoice').map(event => ({
      id:event.id, sourceKind:'recurringInvoice', sourceId:event.id, personId:event.personId,
      actorId:event.actorId ?? null, actorRole:event.actorRole ?? null, at:event.createdAt,
      command:'plan.recurring.invoice', action:'plan.recurring.invoice', right:'collection',
      version:event.version ?? null, channel:null, reason:null, erased:!!event.erased, before:null,
      after:{invoiceId:event.id,previousPackId:event.previousPackId,packId:event.packId,
        recurringTermsId:event.recurringTermsId,dueAt:event.dueAt,termEndAt:event.termEndAt,
        amountCents:event.amountCents,chargeId:event.chargeId,collection:event.collection},
    })),
    ...list(state,'payment').filter(event => event.kind === 'refund').map(event => ({
      id:event.id, sourceKind:'payment', sourceId:event.id, personId:event.personId,
      actorId:event.recordedBy ?? null, actorRole:event.actorRole ?? null, at:event.createdAt,
      command:'payment.refund.recorded', action:'payment.refund.recorded', right:'refund',
      version:event.version ?? null, channel:event.channel ?? null, reason:null, erased:!!event.erased, before:null,
      after:{paymentId:event.id,bookingId:event.bookingId ?? null,amountCents:event.amountCents,collection:'external-record-only'},
    })),
  ]
}
