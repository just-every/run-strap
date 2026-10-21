import { countsCredits } from './domain/entitlements'
import { humanOwner, insist, list, now, type Actor, type RecordData, type State } from './domain/types'
import { studioSettings } from './domain/studio'
import { localDate } from './zone'

const offerOf = (pack: RecordData) => pack.entitlement?.name ?? 'Unnamed credit pack'
export const retentionDefinitions = [
  'Coverage is retained native finite credit packs only. Acquisition is the member’s first retained finite pack, ordered by creation instant then ID, grouped by its studio-local creation month and original offer name. This is not a claim about imported or earlier membership history.',
  'Completed terms have expiry at or before the report instant. A renewed term has a distinct successor pack linked by renewedFromPackId and an applied PLAN-005 renewal linking the same two packs. Accepted future renewals are scheduled, never applied or collected. Previews and failed changes are not renewals. Expiry without a linked applied renewal is not a membership cancellation.',
  'Renewal rate is renewed completed terms divided by completed terms, multiplied by 100 and rounded to two decimal places; it is unavailable when the denominator is zero. Multiple terms count separately while each member belongs to one acquisition cohort. Filters select acquisition month and initial offer, not renewal event dates.',
  'Charge IDs and signed USD cents drill to retained charge evidence. External receipts lack a pack allocation, so collected renewal revenue and payment attribution remain unavailable. Member/revenue churn, tenure, attendance frequency, imported continuity, freezes/reactivations and PLAN-011 reason/type breakdowns remain unavailable.'
]

/** RPT-003 partial: a read-only projection, never reconstructed provider/history facts. */
export function retentionReport(state: State, who: Actor, query: URLSearchParams) {
  humanOwner(who)
  const month = query.get('month'), offer = query.get('offer')
  insist(month === null || /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month),'invalid_cohort_month')
  insist(offer === null || (offer.length > 0 && offer.length <= 80),'invalid_cohort_offer')
  const asOf = now(), timeZone = studioSettings(state)?.timeZone ?? 'UTC'
  const packs = list(state,'pack').filter(countsCredits).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const changes = list(state,'planChange'), charges = list(state,'charge')
  const members = state.people.filter(p => p.role === 'member' && !p.erasedAt)
  const rows = members.flatMap(member => {
    const own = packs.filter(pack => pack.personId === member.id), first = own[0]
    if (!first) return []
    const acquisitionMonth = localDate(first.createdAt,timeZone).slice(0,7), initialOffer = offerOf(first)
    if ((month !== null && month !== acquisitionMonth) || (offer !== null && offer !== initialOffer)) return []
    return own.map(pack => {
      const renewals = changes.filter(change => change.packId === pack.id && change.mode === 'renewal')
      const applied = renewals.find(change => change.status === 'applied' && own.some(next => next.id === change.appliedPackId && next.id !== pack.id && next.renewedFromPackId === pack.id))
      const scheduled = renewals.find(change => change.status === 'accepted')
      const completed = pack.expiresAt <= asOf
      const evidence = charges.filter(charge => charge.packId === pack.id)
      return {personId:member.id,member:member.name,acquisitionMonth,initialOffer,firstPackId:first.id,acquiredAt:first.createdAt,
        packId:pack.id,termStartAt:pack.termStartAt ?? pack.createdAt,expiresAt:pack.expiresAt,completed,
        renewalStatus:applied ? 'applied' : scheduled ? 'scheduled' : completed ? 'expired-without-linked-renewal' : 'not-recorded',
        renewalAttemptIds:renewals.map(change => change.id),renewalChangeId:applied?.id ?? scheduled?.id ?? null,successorPackId:applied?.appliedPackId ?? null,
        chargeIds:evidence.map(charge => charge.id),assessedCents:evidence.reduce((total,charge) => total+charge.amountCents,0),
        collectedRenewalCents:null,paymentIds:null,
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
    return {acquisitionMonth:group[0].acquisitionMonth,initialOffer:group[0].initialOffer,members:new Set(group.map(row => row.personId)).size,
      terms:group.length,completedTerms,renewedTerms,scheduledRenewals:group.filter(row => row.renewalStatus === 'scheduled').length,
      expiredWithoutLinkedRenewal:group.filter(row => row.renewalStatus === 'expired-without-linked-renewal').length,
      renewalRatePercent:completedTerms ? Math.round(renewedTerms/completedTerms*10_000)/100 : null,packIds:group.map(row => row.packId)}
  })
  return {asOf,timeZone,filters:{month,offer},cohorts,rows,definitions:retentionDefinitions,
    unavailable:{memberChurn:null,revenueChurn:null,tenure:null,attendanceFrequency:null,freezeReactivation:null,churnByReason:null,importedHistory:null,collectedRenewalRevenue:null}}
}

export function retentionCsv(report: ReturnType<typeof retentionReport>) {
  const columns = ['personId','member','acquisitionMonth','initialOffer','firstPackId','acquiredAt','packId','termStartAt','expiresAt','completed','renewalStatus','renewalAttemptIds','renewalChangeId','successorPackId','chargeIds','assessedCents','collectedRenewalCents','paymentIds','packUrl','renewalUrl','chargeUrls'] as const
  const quote = (value: string) => '"'+value.replace(/"/g,'""')+'"'
  return [columns.map(quote).join(','),...report.rows.map(row => columns.map(key => quote(JSON.stringify(row[key]))).join(','))].join('\r\n')+'\r\n'
}
