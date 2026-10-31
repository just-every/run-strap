import { recurringInvoiceEligibility, type BillingConnection } from './domain/contract-billing'
import { humanOwner, instant, list, now, type Actor, type State } from './domain/types'
import { studioSettings } from './domain/studio'
import { addDays, localDate, localInstant } from './zone'
import { csv } from './spreadsheet'

/** Native studio debt only. No provider readiness or collection authority is inferred. */
export function upcomingInvoices(state: State, who: Actor, connection: BillingConnection | null, origin: string, query: URLSearchParams, asOf = now()) {
  humanOwner(who)
  const timeZone = studioSettings(state)?.timeZone ?? 'UTC'
  const from = query.get('from') || localDate(asOf,timeZone)
  instant(from+'T00:00:00.000Z','from')
  const start = new Date(localInstant(from,'00:00',timeZone)).toISOString()
  const throughDate = addDays(from,7), through = new Date(localInstant(throughDate,'00:00',timeZone)).toISOString()
  const rows = list(state,'recurringTerms').filter(t => t.acceptedAt && t.acceptedBy && t.nextRenewalAt < through)
    .filter(t => state.people.some(p => p.id === t.personId && !p.erasedAt))
    .filter(t => t.nextRenewalAt >= start || t.status !== 'stopped')
    .map(t => {
      const projected = recurringInvoiceEligibility(state,t,connection,origin,asOf)
      const packId = t.currentPackId ?? t.packId
      return {...projected,agreementId:t.id,personId:t.personId as string,member:state.people.find(p => p.id === t.personId)!.name,
        originalPackId:t.packId as string,packId:packId as string,localDate:localDate(projected.dueAt,timeZone),agreedTimeZone:t.timeZone as string,
        agreedAmountCents:t.amountCents as number,acceptedAt:t.acceptedAt as string,acceptedPriceId:projected.priceDisclosureId,
        movedByFreezeId:t.renewalMovedByFreezeId ?? null,terminationAt:t.cancellationEffectiveAt ?? t.stop?.accessEndsAt ?? null,overdue:projected.dueAt < start,
        forecastCents:projected.status === 'scheduled' && projected.dueAt >= start ? projected.amountCents : 0,
        agreementUrl:'/app/packs?person='+encodeURIComponent(t.personId)+'#recurring-'+encodeURIComponent(t.id),
        packUrl:'/app/packs?person='+encodeURIComponent(t.personId)+'#pack-'+encodeURIComponent(packId),
        collection:'studio-balance-only',paymentReadiness:'unavailable'}
    }).sort((a,b) => a.dueAt.localeCompare(b.dueAt) || a.agreementId.localeCompare(b.agreementId))
  const upcoming = rows.filter(r => !r.overdue), overdue = rows.filter(r => r.overdue)
  const daily = Array.from({length:7},(_,i) => {
    const date = addDays(from,i), onDate = upcoming.filter(r => r.localDate === date)
    return {date,scheduledCount:onDate.filter(r => r.status === 'scheduled').length,forecastCents:onDate.reduce((sum,r) => sum+r.forecastCents,0)}
  })
  return {asOf,timeZone,from,throughDate,start,through,rows:upcoming,overdue,daily,
    totals:{scheduledCount:daily.reduce((sum,d) => sum+d.scheduledCount,0),forecastCents:daily.reduce((sum,d) => sum+d.forecastCents,0),
      excludedCount:upcoming.filter(r => r.status !== 'scheduled').length,overdueCount:overdue.length},
    coverage:'Seven studio-local dates, from midnight inclusive to the next midnight exclusive. Forecast is native studio-balance invoice debt, not expected collections. Only currently eligible agreements count; overdue periods and blocked, review, stopped or disconnected agreements are excluded. Card expiry, ACH readiness, tax, discounts, provider schedules and collection reconciliation are unavailable. Reads issue no invoice, notice or payment. Eligibility is rechecked when invoices are issued.'}
}
export function upcomingInvoicesCsv(report: ReturnType<typeof upcomingInvoices>) {
  return csv([
    ['type','agreementId','packId','member','dueAt','localDate','status','reason','agreedAmountCents','invoiceAmountCents','forecastCents','timeZone','priceDisclosureId'],
    ...[...report.rows,...report.overdue].map(r => [r.overdue?'overdue':'invoice',r.agreementId,r.packId,r.member,r.dueAt,r.localDate,r.status,r.reason,r.agreedAmountCents,r.amountCents,r.forecastCents,report.timeZone,r.acceptedPriceId]),
    ...report.daily.map(d => ['daily-total',null,null,null,null,d.date,null,null,null,null,d.forecastCents,report.timeZone,null]),
    ['period-total',null,null,null,null,null,null,null,null,null,report.totals.forecastCents,report.timeZone,null],
  ])
}
