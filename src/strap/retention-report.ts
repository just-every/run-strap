import { countsCredits } from './domain/entitlements'
import { humanOwner, insist, list, now, type Actor, type RecordData, type State } from './domain/types'
import { studioSettings } from './domain/studio'
import { localDate } from './zone'

const day = 86_400_000
const twoDecimals = (value: number) => Math.round(value*100)/100
const offerOf = (pack: RecordData) => pack.entitlement?.name ?? 'Unnamed credit pack'
export const retentionDefinitions = [
  'Coverage is retained native finite credit packs only. Acquisition is the member’s first retained finite pack, ordered by creation instant then ID, grouped by its studio-local creation month and original offer name. This is not a claim about imported or earlier membership history.',
  'Completed terms have expiry at or before the report instant. A renewed term has a distinct successor pack linked by renewedFromPackId and an applied PLAN-005 renewal or retained native recurring invoice linking the same two packs. Accepted future renewals are scheduled, never applied or collected. Previews and failed changes are not renewals. Expiry without a linked applied renewal is not a membership cancellation.',
  'Renewal rate is renewed completed terms divided by completed terms, multiplied by 100 and rounded to two decimal places; it is unavailable when the denominator is zero. Multiple terms count separately while each member belongs to one acquisition cohort. Filters select acquisition month and initial offer, not renewal event dates.',
  'Charge IDs and signed USD cents drill to retained charge evidence. Collected renewal cents count only explicit retained receipt allocations to the positive successor renewal charge, with allocation and payment identities; unallocated receipts remain unavailable. Amounts are gross allocated collections, not net revenue or refunds. Unrelated successor fees never count. Native recurring invoices also establish linked renewals. Terminations count applied cancellations once per agreement, never scheduled, withdrawn or superseded cancellations. Freeze events count confirmed started freezes; reactivations require retained resumed status. Type names and termination codes retain their recorded values. These event counts are not member or revenue churn rates; imported continuity remains unavailable.',
  'Tenure is the member’s retained-pack span: from the first retained finite pack’s creation instant to the earlier of the report instant and the latest retained pack expiry, in whole elapsed 24-hour days, never below zero. Attended visits are the member’s current corrected attended bookings whose class started within that span, inclusive. Visits per 30 days is visits × 30 ÷ tenure days rounded half-up to two decimals, or unavailable at zero tenure days. A cohort’s mean tenure averages its members; its visits per 30 days divides its pooled visits by its pooled tenure days. Tenure is not a churn or cancellation measure.'
]

/** RPT-003 partial: a read-only projection, never reconstructed provider or history facts. */
export function retentionReport(state: State, who: Actor, query: URLSearchParams) {
  humanOwner(who)
  const month = query.get('month'), offer = query.get('offer')
  insist(month === null || /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month),'invalid_cohort_month')
  insist(offer === null || (offer.length > 0 && offer.length <= 80),'invalid_cohort_offer')
  const asOf = now(), timeZone = studioSettings(state)?.timeZone ?? 'UTC'
  const packs = list(state,'pack').filter(countsCredits).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const changes = list(state,'planChange'), charges = list(state,'charge'), invoices = list(state,'recurringInvoice')
  const visitStarts = list(state,'booking').filter(b => b.status === 'booked' && b.attendance === 'attended')
    .flatMap(b => { const start = state.records.get(b.classId)?.data.start as string | undefined; return start && start <= asOf ? [{personId:b.personId as string,start}] : [] })
  const members = state.people.filter(p => p.role === 'member' && !p.erasedAt)
  const rows = members.flatMap(member => {
    const own = packs.filter(pack => pack.personId === member.id), first = own[0]
    if (!first) return []
    const acquisitionMonth = localDate(first.createdAt,timeZone).slice(0,7), initialOffer = offerOf(first)
    if ((month !== null && month !== acquisitionMonth) || (offer !== null && offer !== initialOffer)) return []
    const spanEnd = Math.min(Date.parse(asOf),Math.max(...own.map(pack => Date.parse(pack.expiresAt))))
    const tenureDays = Math.max(0,Math.floor((spanEnd-Date.parse(first.createdAt))/day))
    const attendedVisits = visitStarts.filter(entry => entry.personId === member.id && entry.start >= first.createdAt && Date.parse(entry.start) <= spanEnd).length
    const visitsPer30Days = tenureDays ? twoDecimals(attendedVisits*30/tenureDays) : null
    return own.map(pack => {
      const renewals = changes.filter(change => change.packId === pack.id && change.mode === 'renewal')
      const applied = renewals.find(change => change.status === 'applied' && own.some(next => next.id === change.appliedPackId && next.id !== pack.id && next.renewedFromPackId === pack.id))
      const invoice = invoices.find(i => i.previousPackId === pack.id && own.some(next => next.id === i.packId && next.renewedFromPackId === pack.id) && i.status !== 'void')
      const successorPackId = applied?.appliedPackId ?? invoice?.packId ?? null
      const renewalCharges = charges.filter(c => c.packId === successorPackId && c.amountCents > 0 && (applied ? c.planChangeId === applied.id : c.invoiceId === invoice?.id))
      const allocations = list(state,'contractPrepayment').filter(a => a.packId === successorPackId && renewalCharges.some(c => c.id === a.chargeId) && state.records.get(a.paymentId)?.kind === 'payment')
      const cancellations = list(state,'contractCancellation').filter(c => c.packId === pack.id && c.status === 'applied' && c.effectiveAt <= asOf)
      const scheduledCancellations = list(state,'contractCancellation').filter(c => c.packId === pack.id && c.status === 'scheduled')
      const freezes = list(state,'freeze').filter(f => f.packId === pack.id && f.confirmedAt && f.startAt <= asOf && ['active','resumed','ended_by_cancellation'].includes(f.status))
      const resumed = freezes.filter(f => f.status === 'resumed' && f.resumedAt <= asOf)
      const scheduled = renewals.find(change => change.status === 'accepted')
      const completed = pack.expiresAt <= asOf
      const evidence = charges.filter(charge => charge.packId === pack.id)
      return {personId:member.id,member:member.name,acquisitionMonth,initialOffer,firstPackId:first.id,acquiredAt:first.createdAt,
        tenureDays,attendedVisits,visitsPer30Days,packId:pack.id,termStartAt:pack.termStartAt ?? pack.createdAt,expiresAt:pack.expiresAt,completed,
        renewalStatus:applied || invoice ? 'applied' : scheduled ? 'scheduled' : completed ? 'expired-without-linked-renewal' : 'not-recorded',
        renewalAttemptIds:renewals.map(change => change.id),renewalChangeId:applied?.id ?? scheduled?.id ?? null,successorPackId,renewalInvoiceId:invoice?.id ?? null,
        cancellationIds:cancellations.map(c => c.id),terminationReasons:cancellations.map(c => c.reasonCode ?? 'unrecorded'),scheduledCancellationIds:scheduledCancellations.map(c => c.id),
        freezeIds:freezes.map(f => f.id),freezeTypes:freezes.map(f => f.typeName),resumedFreezeIds:resumed.map(f => f.id),
        lifecycleUrl:'/app/packs?person='+encodeURIComponent(member.id)+'#cancellations',freezeUrl:'/app/packs?person='+encodeURIComponent(member.id)+'#freezes',
        chargeIds:evidence.map(charge => charge.id),assessedCents:evidence.reduce((total,charge) => total+charge.amountCents,0),
        collectedRenewalCents:allocations.length ? allocations.reduce((n,a) => n+a.amountCents,0) : null,paymentIds:allocations.length ? [...new Set(allocations.map(a => a.paymentId))] : null,
        allocationIds:allocations.map(a => a.id),paymentUrls:[...new Set(allocations.map(a => a.paymentId))].map(paymentId => '/app/revenue?sourceId='+encodeURIComponent(paymentId)+'#source-record'),
        packUrl:'/app/packs#pack-'+encodeURIComponent(pack.id),
        renewalUrl:applied || scheduled ? '/app/packs?person='+encodeURIComponent(member.id)+'#plan-changes' : null,
        chargeUrls:evidence.map(charge => '/app/revenue?sourceId='+encodeURIComponent(charge.id)+'#source-record')}
    })
  }).sort((a,b) => a.acquisitionMonth.localeCompare(b.acquisitionMonth) || a.initialOffer.localeCompare(b.initialOffer) || a.personId.localeCompare(b.personId) || a.termStartAt.localeCompare(b.termStartAt) || a.packId.localeCompare(b.packId))
  const groups = new Map<string,typeof rows>()
  for (const row of rows) {
    const key = JSON.stringify([row.acquisitionMonth,row.initialOffer])
    const group = groups.get(key) ?? []; group.push(row); groups.set(key,group)
  }
  const cohorts = [...groups.values()].map(group => {
    const completedTerms = group.filter(row => row.completed).length
    const renewedTerms = group.filter(row => row.completed && row.renewalStatus === 'applied').length
    const people = [...new Map(group.map(row => [row.personId,row])).values()]
    const breakdown = (key: 'terminationReasons' | 'freezeTypes') => [...new Set(group.flatMap(row => row[key]))].sort().map(label => ({label,count:group.reduce((n,row) => n+row[key].filter(value => value === label).length,0)}))
    const pooledDays = people.reduce((total,row) => total+row.tenureDays,0), pooledVisits = people.reduce((total,row) => total+row.attendedVisits,0)
    return {acquisitionMonth:group[0].acquisitionMonth,initialOffer:group[0].initialOffer,members:people.length,
      meanTenureDays:twoDecimals(pooledDays/people.length),attendedVisits:pooledVisits,visitsPer30Days:pooledDays ? twoDecimals(pooledVisits*30/pooledDays) : null,
      terminatedAgreements:group.reduce((n,row) => n+row.cancellationIds.length,0),scheduledTerminations:group.reduce((n,row) => n+row.scheduledCancellationIds.length,0),
      churnByReason:breakdown('terminationReasons'),freezeByType:breakdown('freezeTypes'),freezes:group.reduce((n,row) => n+row.freezeIds.length,0),reactivations:group.reduce((n,row) => n+row.resumedFreezeIds.length,0),
      collectedRenewalCents:group.some(row => row.collectedRenewalCents !== null) ? group.reduce((n,row) => n+(row.collectedRenewalCents ?? 0),0) : null,
      terms:group.length,completedTerms,renewedTerms,scheduledRenewals:group.filter(row => row.renewalStatus === 'scheduled').length,
      expiredWithoutLinkedRenewal:group.filter(row => row.renewalStatus === 'expired-without-linked-renewal').length,
      renewalRatePercent:completedTerms ? Math.round(renewedTerms/completedTerms*10_000)/100 : null,packIds:group.map(row => row.packId)}
  })
  return {asOf,timeZone,filters:{month,offer},cohorts,rows,definitions:retentionDefinitions,
    unavailable:{memberChurn:null,revenueChurn:null,importedHistory:null}}
}

export const retentionColumns = ['personId','member','acquisitionMonth','initialOffer','firstPackId','acquiredAt','tenureDays','attendedVisits','visitsPer30Days','packId','termStartAt','expiresAt','completed','renewalStatus','renewalAttemptIds','renewalChangeId','successorPackId','chargeIds','assessedCents','collectedRenewalCents','paymentIds','packUrl','renewalUrl','chargeUrls','renewalInvoiceId','cancellationIds','terminationReasons','scheduledCancellationIds','freezeIds','freezeTypes','resumedFreezeIds','lifecycleUrl','freezeUrl','allocationIds','paymentUrls'] as const

export function retentionCsv(report: ReturnType<typeof retentionReport>) {
  const quote = (value: string) => '"'+value.replace(/"/g,'""')+'"'
  return [retentionColumns.map(quote).join(','),...report.rows.map(row => retentionColumns.map(key => quote(JSON.stringify(row[key]))).join(','))].join('\r\n')+'\r\n'
}
