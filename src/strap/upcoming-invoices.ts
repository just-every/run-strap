import { recurringInvoiceEligibility, recurringPackScope, type BillingConnection } from './domain/contract-billing'
import { humanOwner, insist, instant, list, now, type Actor, type State } from './domain/types'
import { studioSettings } from './domain/studio'
import { locations } from './domain/locations'
import { reportPlan } from './revenue-report'
import { addDays, localDate, localInstant } from './zone'
import { csv, workbook, type Cell } from './spreadsheet'

export const invoiceForecastStatuses = ['scheduled','blocked','review','reconnection_required','canceled'] as const

/** Native studio debt only. No provider readiness or collection authority is inferred. */
export function upcomingInvoices(state: State, who: Actor, connection: BillingConnection | null, origin: string, query: URLSearchParams, asOf = now()) {
  humanOwner(who)
  const timeZone = studioSettings(state)?.timeZone ?? 'UTC'
  const from = query.get('from') || localDate(asOf,timeZone)
  instant(from+'T00:00:00.000Z','from')
  const to = query.get('to') || addDays(from,6)
  instant(to+'T00:00:00.000Z','to')
  const days = (Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000+1
  insist(days > 0 && days <= 366,'invalid_forecast_range')
  const filters = {from,to,location:query.get('location')?.trim() || null,plan:query.get('plan')?.trim() || null,status:query.get('status') || null,recurringOnly:true}
  insist(!filters.status || invoiceForecastStatuses.some(status => status === filters.status),'invalid_forecast_status')
  const places = locations(state)
  const start = new Date(localInstant(from,'00:00',timeZone)).toISOString()
  const throughDate = addDays(to,1), through = new Date(localInstant(throughDate,'00:00',timeZone)).toISOString()
  const rows = list(state,'recurringTerms').filter(t => t.acceptedAt && t.acceptedBy && t.nextRenewalAt < through)
    .filter(t => state.people.some(p => p.id === t.personId && !p.erasedAt))
    .filter(t => t.nextRenewalAt >= start || t.status !== 'stopped')
    .map(t => {
      const projected = recurringInvoiceEligibility(state,t,connection,origin,asOf)
      const packId = t.currentPackId ?? t.packId
      const source = state.records.get(packId), pack = source?.kind === 'pack' ? source.data : null
      const locationId = pack ? recurringPackScope(state,t,pack).locationId : null
      return {...projected,agreementId:t.id,personId:t.personId as string,member:state.people.find(p => p.id === t.personId)!.name,
        locationId,location:places.find(p => p.id === locationId)?.name ?? 'Unavailable',plan:reportPlan(t),
        originalPackId:t.packId as string,packId:packId as string,localDate:localDate(projected.dueAt,timeZone),agreedTimeZone:t.timeZone as string,
        agreedAmountCents:t.amountCents as number,acceptedAt:t.acceptedAt as string,acceptedPriceId:projected.priceDisclosureId,
        movedByFreezeId:t.renewalMovedByFreezeId ?? null,terminationAt:t.requiresFreshAcceptance ? null : t.cancellationEffectiveAt ?? t.stop?.accessEndsAt ?? null,overdue:projected.dueAt < start,
        forecastCents:projected.status === 'scheduled' && projected.dueAt >= start ? projected.amountCents : 0,
        agreementUrl:'/app/packs?person='+encodeURIComponent(t.personId)+'#recurring-'+encodeURIComponent(t.id),
        packUrl:'/app/packs?person='+encodeURIComponent(t.personId)+'#pack-'+encodeURIComponent(packId),
        collection:'studio-balance-only',paymentReadiness:'unavailable'}
    }).sort((a,b) => a.dueAt.localeCompare(b.dueAt) || a.agreementId.localeCompare(b.agreementId))
  const selected = rows.filter(r => (!filters.location || r.locationId === filters.location) && (!filters.plan || r.plan === filters.plan) && (!filters.status || r.status === filters.status))
  const upcoming = selected.filter(r => !r.overdue), overdue = selected.filter(r => r.overdue)
  const daily = Array.from({length:days},(_,i) => {
    const date = addDays(from,i), onDate = upcoming.filter(r => r.localDate === date)
    return {date,scheduledCount:onDate.filter(r => r.status === 'scheduled').length,forecastCents:onDate.reduce((sum,r) => sum+r.forecastCents,0)}
  })
  return {asOf,timeZone,from,to,throughDate,start,through,filters,locations:places.map(p => ({id:p.id,name:p.name})),plans:[...new Set(rows.map(r => r.plan))].sort(),rows:upcoming,overdue,daily,
    totals:{scheduledCount:daily.reduce((sum,d) => sum+d.scheduledCount,0),forecastCents:daily.reduce((sum,d) => sum+d.forecastCents,0),
      excludedCount:upcoming.filter(r => r.status !== 'scheduled').length,overdueCount:overdue.length},
    coverage:'Selected studio-local dates are inclusive, from the first midnight to the midnight after the last date. The default is seven dates; select up to one year. Only the next unissued period of each personally accepted recurring agreement appears, never later hypothetical renewals, one-time packs or unaccepted proposals. Location means the recorded source pack sale location; plan means the accepted agreement terms. Forecast is native studio-balance invoice debt, not expected collections. Only currently eligible agreements count; overdue periods and blocked, review, stopped or disconnected agreements are excluded. Filters apply equally to sources, daily totals and downloads. Card expiry, ACH readiness, tax, discounts, provider schedules and collection reconciliation are unavailable. Reads issue no invoice, notice or payment. Eligibility is rechecked when invoices are issued.'}
}
function forecastTable(report: ReturnType<typeof upcomingInvoices>): Cell[][] {
  const columns = ['type','agreementId','packId','member','dueAt','localDate','status','reason','agreedAmountCents','invoiceAmountCents','forecastCents','timeZone','priceDisclosureId','originalPackId','personId','locationId','location','plan']
  const rows: Record<string,Cell>[] = [
    ...[...report.rows,...report.overdue].map(r => ({...r,type:r.overdue?'overdue':'invoice',invoiceAmountCents:r.amountCents,timeZone:report.timeZone,priceDisclosureId:r.acceptedPriceId})),
    ...report.daily.map(d => ({type:'daily-total',localDate:d.date,forecastCents:d.forecastCents,timeZone:report.timeZone})),
    {type:'period-total',forecastCents:report.totals.forecastCents,timeZone:report.timeZone},
  ]
  return [columns,...rows.map(row => columns.map(column => row[column] ?? null))]
}
export const upcomingInvoicesCsv = (report: ReturnType<typeof upcomingInvoices>) => csv(forecastTable(report))

export function upcomingInvoicesDownload(report: ReturnType<typeof upcomingInvoices>, format: 'csv' | 'xlsx'): Response {
  const data = format === 'csv' ? upcomingInvoicesCsv(report) : workbook([
    {name:'Forecast',rows:forecastTable(report)},
    {name:'Totals',rows:[['Metric','Value'],...Object.entries(report.totals)]},
    {name:'Context',rows:[['Field','Value'],['asOf',report.asOf],['timeZone',report.timeZone],['filters',JSON.stringify(report.filters)],['currency','USD'],['coverage',report.coverage]]},
  ])
  return new Response(data as BodyInit,{headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-type':format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition':`attachment; filename="strap-upcoming-invoices.${format}"`}})
}
