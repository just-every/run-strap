import { instant, insist, list, type State } from './domain/types'

/** Accepted native agreements retain their original sale, distinct from a later renewal pack. */
export function nativeRecurringAgreements(state: State) {
  const cancellations = list(state,'contractCancellation'), packs = list(state,'pack')
  return list(state,'recurringTerms').filter(t => t.acceptedAt && t.acceptedBy).map(terms => {
    const cancellation = cancellations.find(c => c.termsId === terms.id && c.status === 'applied') ?? null
    const pending = cancellations.some(c => c.termsId === terms.id && c.status === 'scheduled')
    const withdrawn = cancellations.some(c => c.termsId === terms.id && c.status === 'withdrawn')
    const pack = packs.find(p => p.id === terms.packId)
    const currentPack = packs.find(p => p.id === (terms.currentPackId ?? terms.packId))
    // Withdrawing restores access, not invoicing. The withdrawn effective date is no longer an access end.
    const endedAt = cancellation?.effectiveAt ?? terms.accessEndedAt ?? (terms.status === 'stopped' && !pending
      ? (withdrawn ? currentPack?.expiresAt : terms.stop?.accessEndsAt) : null) ?? null
    return {terms,pack,cancellation,endedAt:endedAt as string | null}
  })
}

/** Read-only native recurring agreement losses, with an explicit opening denominator. */
export function retentionChurn(state: State, query: URLSearchParams, asOf: string) {
  const from = query.get('churnFrom'), to = query.get('churnTo')
  const end = to === null ? asOf.slice(0,10)+'T00:00:00.000Z' : instant(to,'churnTo')
  const start = from === null ? new Date(Date.parse(end)-30*86400000).toISOString() : instant(from,'churnFrom')
  insist(start < end && end <= asOf,'invalid_churn_period')
  const packs = list(state,'pack'), invoices = list(state,'recurringInvoice')
  const agreements = nativeRecurringAgreements(state).map(({terms:t,cancellation,endedAt}) => {
    // The acknowledgement preserves the accepted price; later invoice prices apply only from their due instant.
    const priorInvoices = invoices.filter(i => i.recurringTermsId === t.id && i.status !== 'void' && i.dueAt <= start).sort((a,b) => b.dueAt.localeCompare(a.dueAt))
    const openingAmount = priorInvoices[0]?.amountCents ?? t.acknowledgement?.amountCents
    const monthlyCents = Number.isSafeInteger(openingAmount) && Number.isInteger(t.intervalMonths) && t.intervalMonths > 0 ? openingAmount/t.intervalMonths : null
    return {id:t.id,personId:t.personId as string,acceptedAt:t.acceptedAt as string,endedAt:endedAt as string|null,
      opening:t.acceptedAt <= start && (!endedAt || endedAt > start),
      endedInPeriod:!!endedAt && endedAt > start && endedAt <= end,
      monthlyCents,cancellationId:cancellation?.id ?? null,reasonCode:cancellation?.reasonCode ?? null,reasonLabel:cancellation?.reasonLabel ?? cancellation?.reasonCode ?? null,
      evidenceUrl:'/app/packs?person='+encodeURIComponent(t.personId)+'#recurring-'+encodeURIComponent(t.id)}
  })
  const member = (personId: string) => {
    const own = agreements.filter(t => t.personId === personId), opening = own.filter(t => t.opening)
    const closing = own.filter(t => t.acceptedAt <= end && (!t.endedAt || t.endedAt > end))
    // A retained second plan or replacement keeps the member, even when one agreement ends.
    const otherAccess = packs.some(p => p.personId === personId && (p.termStartAt ?? p.createdAt) <= end && p.expiresAt > end)
    const lost = opening.length > 0 && closing.length === 0 && !otherAccess && opening.every(t => t.endedInPeriod)
    const known = opening.every(t => t.monthlyCents !== null)
    return {openingMember:opening.length > 0,lostMember:lost,openingAgreementIds:opening.map(t => t.id),
      endedAgreementIds:opening.filter(t => t.endedInPeriod).map(t => t.id),
      cancellationIds:opening.filter(t => t.endedInPeriod && t.cancellationId).map(t => t.cancellationId!),
      terminationReasons:opening.filter(t=>t.endedInPeriod&&t.cancellationId).map(t=>({cancellationId:t.cancellationId,code:t.reasonCode,label:t.reasonLabel})),
      openingMonthlyCents:known ? opening.reduce((n,t) => n+t.monthlyCents!,0) : null,
      lostMonthlyCents:known ? opening.filter(t => t.endedInPeriod).reduce((n,t) => n+t.monthlyCents!,0) : null,
      agreementUrls:opening.map(t => t.evidenceUrl)}
  }
  const summarize = (personIds: string[]) => {
    const members = [...new Set(personIds)].map(member)
    const openingMembers = members.filter(m => m.openingMember).length, lostMembers = members.filter(m => m.lostMember).length
    const known = members.every(m => m.openingMonthlyCents !== null)
    const openingMonthlyCents = known ? members.reduce((n,m) => n+m.openingMonthlyCents!,0) : null
    const lostMonthlyCents = known ? members.reduce((n,m) => n+m.lostMonthlyCents!,0) : null
    return {from:start,to:end,openingMembers,lostMembers,memberChurnPercent:openingMembers ? Math.round(lostMembers / openingMembers*10000)/100 : null,
      openingMonthlyCents:openingMonthlyCents === null ? null : Math.round(openingMonthlyCents),lostMonthlyCents:lostMonthlyCents === null ? null : Math.round(lostMonthlyCents),
      revenueChurnPercent:openingMonthlyCents ? Math.round(lostMonthlyCents!/openingMonthlyCents*10000)/100 : null}
  }
  return {member,summarize,period:{from:start,to:end}}
}
