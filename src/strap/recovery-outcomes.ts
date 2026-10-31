import { interventionCost, measurementAllowed } from './domain/recovery-measurement'
import { permission } from './domain/preferences'
import { humanOwner, insist, list, now, type Actor, type RecordData, type State } from './domain/types'
import { studioSettings } from './domain/studio'
import { localDate } from './zone'

const day = 86400000
export const recoveryOutcomeDefinitions = [
  'Coverage is approved native empty-place and win-back campaigns with retained owner approval of their audience, incentive and budget. Previews are outside this report. Reserved incentives and posted noncash studio credits remain separate from cash spending and revenue. Audience exclusions are retained, never called declines.',
  'Accepted means a retained accepted empty-place offer or purchased finite win-back offer. Member-recorded declines, unaccepted, suppressed and expired are distinct observations; no response never establishes a decline. A retained in-app permission withdrawal after the offer stays excluded even after renewed permission. Inactive or erased membership and confirmed freezes exclude outcome measurement. A separate member-owned measurement opt-out removes current and historical report rows and source details; renewed permission never revives previous measurements.',
  'Each observation window begins at acceptance, or offer creation for an unaccepted offer, and ends after the selected number of elapsed days. A complete window has ended by the report instant. Excluded audience rows without an offer have no observation window. Samples count distinct members; completed visits count distinct booking identities, so overlapping offers never multiply the total.',
  'Visits after acceptance or explicit decline require a confirmed booking, current corrected attended outcome and a published class starting after acceptance and ending by both the report instant and window end. Canceled, excused, no-show, future and frozen visits do not count. Booking, class, correction and any accepted attendance-plan source remain linked. Later visits are observations associated in time, never proof the intervention caused them.',
  'A randomized holdout campaign fixes its member assignments and observation days before exact owner approval. Holdout members receive no campaign offer; their independent bookings remain available. Both assigned groups use the same approval-time window, including members who never accept, with opt-out and eligibility exclusions still applied. Every cohort is causally inconclusive: recorded assignment and observed group differences alone do not demonstrate an effect. Small or incomplete observations, missing outcomes and opt-out attrition remain inconclusive. Member feedback, causal experiment proof, cash spending and failed-renewal provider outcomes and attributable collected renewal amounts are unavailable. A balance charge or finite membership purchase is not collected renewal revenue.'
]

function frozen(state: State, personId: string, at: string) {
  return list(state,'freeze').some(f => f.personId === personId && f.confirmedAt && !['withdrawn','declined'].includes(f.status) && f.startAt <= at && (!f.endAt || f.endAt > at))
}
function exclusion(state: State, personId: string, at: string) {
  const member = state.people.find(p => p.id === personId && !p.erasedAt)
  return !member ? 'member_unavailable' : !member.active ? 'member_inactive' : permission(state,personId,'inApp') ?? (frozen(state,personId,at) ? 'membership_frozen' : null)
}

/** Pure owner report: never sweeps, records outcomes, sends or settles money. */
export function recoveryOutcomes(state: State, who: Actor, query: URLSearchParams) {
  humanOwner(who)
  const days = query.get('windowDays') || '30', campaignId = query.get('campaign') || null, selectedOffer = query.get('offer') || null, selectedPerson = query.get('person') || null
  insist(/^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 90,'invalid_observation_window')
  insist(campaignId === null || campaignId.length <= 100,'invalid_campaign')
  insist(selectedOffer === null || selectedOffer.length <= 100,'invalid_offer')
  insist(selectedPerson === null || !!campaignId && selectedPerson.length <= 100,'invalid_outcome_member')
  const windowDays = Number(days), asOf = now(), zone = studioSettings(state)?.timeZone ?? 'UTC'
  const allCampaigns: (RecordData & {kind:string})[] = [...list(state,'emptyPlaceCampaign').map(c => ({...c,kind:'empty-place'})),
    ...list(state,'winbackCampaign').map(c => ({...c,kind:'win-back'}))]
  const campaigns = allCampaigns.filter(c => c.status === 'approved' && c.approvedBy && (!campaignId || c.id === campaignId))
  if(campaignId) insist(campaigns.length,'campaign_not_found',404)
  const bookings = list(state,'booking'), plans = list(state,'attendancePlan')
  const rows = campaigns.flatMap(campaign => {
    const offers = list(state,campaign.kind === 'empty-place' ? 'emptyPlaceOffer' : 'winbackOffer').filter(o => o.campaignId === campaign.id)
    return (campaign.audience as {personId:string;reason:string|null}[]).filter(audience => measurementAllowed(state,audience.personId,offers.find(o => o.personId === audience.personId)?.createdAt ?? campaign.createdAt)).map(audience => {
      const assignment = campaign.measurement?.assignments.find((a:RecordData) => a.personId === audience.personId), randomized = !!assignment
      const offer = offers.find(o => o.personId === audience.personId), member = state.people.find(p => p.id === audience.personId && !p.erasedAt)
      const accepted = !!offer && ['accepted','purchased'].includes(offer.status), declined = offer?.status === 'declined'
      const since = offer?.createdAt ?? campaign.approvedAt
      const withdrawal = list(state,'memberPreferenceEvent').filter(e => e.personId === audience.personId && e.at >= since && e.after?.marketing?.inApp === 'denied').sort((a,b) => a.at.localeCompare(b.at))[0] ?? null
      const excluded = (audience.reason === 'experiment_holdout' ? null : audience.reason) ?? (withdrawal ? 'permission_withdrawn_since_offer' : null) ?? exclusion(state,audience.personId,asOf)
      const entry = offer?.classId ? state.records.get(offer.classId)?.data : null
      const status = !offer ? (assignment?.group === 'holdout' ? 'holdout' : 'excluded') : accepted ? 'accepted' : declined ? 'declined' : offer.status === 'suppressed' ? (offer.suppressionReason === 'offer_expired' ? 'expired' : 'suppressed')
        : withdrawal && withdrawal.at <= offer.expiresAt ? 'suppressed' : offer.expiresAt <= asOf ? 'expired' : excluded || entry?.status === 'cancelled' ? 'suppressed' : 'unaccepted'
      const reason = audience.reason ?? offer?.suppressionReason ?? (status === 'suppressed' ? excluded ?? 'class_cancelled' : excluded)
      const start = randomized ? campaign.approvedAt : offer ? accepted ? offer.acceptedAt ?? offer.purchasedAt : declined ? offer.declinedAt : offer.createdAt : null
      const end = start ? new Date(Date.parse(start)+(campaign.measurement?.windowDays ?? windowDays)*day).toISOString() : null
      const observations = (!accepted && !declined && !randomized) || excluded ? [] : bookings.filter(b => b.personId === audience.personId).flatMap(b => {
        const c = state.records.get(b.classId)?.data
        if(!c || c.start < start || c.end > asOf || c.end > end! || c.status !== 'published' || frozen(state,b.personId,c.start)) return []
        const attendancePlan = plans.find(p => p.status === 'accepted' && p.bookingId === b.id)
        return [{bookingId:b.id,classId:c.id,title:c.title,start:c.start,end:c.end,status:b.status,attendance:b.attendance ?? 'unsettled',
          counted:b.status === 'booked' && b.attendance === 'attended',corrections:b.corrections ?? [],attendancePlanId:attendancePlan?.id ?? null,
          url:'/app?day='+localDate(c.start,zone)+'&class='+encodeURIComponent(c.id)+'#roster'}]
      })
      return {campaignId:campaign.id,kind:campaign.kind,personId:audience.personId,member:member?.name ?? 'Unavailable member',
        offerId:offer?.id ?? null,status,exclusionReason:reason ?? null,measured:(accepted || declined || randomized) && !excluded,group:assignment?.group ?? 'observational',cost:offer ? interventionCost(state,campaign.kind,offer) : null,
        window:{start,end,days:campaign.measurement?.windowDays ?? windowDays,complete:end ? end <= asOf : null},observations,attendedBookingIds:observations.filter(v => v.counted).map(v => v.bookingId),
        source:{withdrawalEventId:withdrawal?.id ?? null,campaign:{id:campaign.id,kind:campaign.kind,text:campaign.text,approvedAt:campaign.approvedAt,approvedBy:campaign.approvedBy,audienceReason:audience.reason ?? null},
          offer:offer ? {id:offer.id,status:offer.status,createdAt:offer.createdAt,expiresAt:offer.expiresAt,acceptedAt:offer.acceptedAt ?? offer.purchasedAt ?? null,declinedAt:offer.declinedAt ?? null,declinedBy:offer.declinedBy ?? null,
            bookingId:offer.bookingId ?? null,packId:offer.packId ?? null,suppressionReason:offer.suppressionReason ?? null} : null},
        detailUrl:'/app/recovery-outcomes?windowDays='+windowDays+'&campaign='+encodeURIComponent(campaign.id)+'&person='+encodeURIComponent(audience.personId)+'#outcome-source',
        memberUrl:member ? '/app/people?person='+encodeURIComponent(member.id) : null,
        collectedRenewalCents:null,causalConclusion:'inconclusive'}
    })
  })
  const summarize = (group: typeof rows) => ({audienceMembers:new Set(group.map(r => r.personId)).size,offers:group.filter(r => r.offerId).length,
    accepted:group.filter(r => r.status === 'accepted').length,declined:group.filter(r => r.status === 'declined').length,unaccepted:group.filter(r => r.status === 'unaccepted').length,
    suppressed:group.filter(r => r.status === 'suppressed').length,expired:group.filter(r => r.status === 'expired').length,
    excluded:group.filter(r => r.exclusionReason || r.status === 'excluded').length,
    measuredMembers:new Set(group.filter(r => r.measured).map(r => r.personId)).size,
    membersWithVisits:new Set(group.filter(r => r.attendedBookingIds.length).map(r => r.personId)).size,
    attendedVisits:new Set(group.flatMap(r => r.attendedBookingIds)).size,
    completeWindows:group.filter(r => r.window.complete === true).length,incompleteWindows:group.filter(r => r.window.complete === false).length,
    acceptedVisits:new Set(group.filter(r => r.status === 'accepted').flatMap(r => r.attendedBookingIds)).size,
    declinedVisits:new Set(group.filter(r => r.status === 'declined').flatMap(r => r.attendedBookingIds)).size,
    reservedIncentiveCents:group.reduce((sum,r) => sum+(r.cost?.reservedCents ?? 0),0),
    postedCreditCents:group.some(r => r.cost?.status === 'source_unavailable') ? null : group.reduce((sum,r) => sum+(r.cost?.postedCreditCents ?? 0),0),
    collectedRenewalCents:null,causalConclusion:'inconclusive'})
  const groups = (groupRows: typeof rows) => ['intervention','holdout'].map(group => ({group,...summarize(groupRows.filter(r => r.group === group))}))
  const selected = selectedOffer ? rows.find(r => r.offerId === selectedOffer) : selectedPerson ? rows.find(r => r.personId === selectedPerson) : null
  if(selectedOffer || selectedPerson) insist(selected,'offer_not_found',404)
  return {asOf,filters:{windowDays,campaign:campaignId},rows,selected,totals:summarize(rows),groups:groups(rows),
    campaigns:campaigns.map(c => ({id:c.id,kind:c.kind,text:c.text,approvedAt:c.approvedAt,approvedBy:c.approvedBy,budgetCents:c.budgetCents,incentiveCents:c.incentiveCents ?? c.rewardCents,design:c.measurement?.design ?? 'observational',windowDays:c.measurement?.windowDays ?? windowDays,groups:groups(rows.filter(r => r.campaignId === c.id)),...summarize(rows.filter(r => r.campaignId === c.id))})),
    definitions:recoveryOutcomeDefinitions,unavailable:{memberFeedback:null,collectedRenewalCents:null,failedRenewals:null,causalEffect:null},
    outsideCoverage:allCampaigns.filter(c => c.status !== 'approved').length}
}
