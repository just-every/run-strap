import { permission } from './domain/preferences'
import { humanOwner, insist, list, now, type Actor, type RecordData, type State } from './domain/types'
import { studioSettings } from './domain/studio'
import { localDate } from './zone'

const day = 86400000
export const recoveryOutcomeDefinitions = [
  'Coverage is approved native empty-place and win-back campaigns with both incentive and budget explicitly zero. Previews and campaigns with incentives are outside this report. Audience exclusions are retained, never called declines.',
  'Accepted means a retained accepted empty-place offer or purchased finite win-back offer. Unaccepted, suppressed and expired are distinct observations; no response never establishes a decline. Current in-app marketing withdrawal, inactive or erased membership and confirmed freezes exclude outcome measurement. This is a conservative use of existing preferences, not complete measurement opt-out.',
  'Each observation window begins at acceptance, or offer creation for an unaccepted offer, and ends after the selected number of elapsed days. A complete window has ended by the report instant. Excluded audience rows without an offer have no observation window. Samples count distinct members; completed visits count distinct booking identities, so overlapping offers never multiply the total.',
  'Visits require a confirmed booking, current corrected attended outcome and a published class starting after acceptance and ending by both the report instant and window end. Canceled, excused, no-show, future and frozen visits do not count. Booking, class, correction and any accepted attendance-plan source remain linked. Later visits are observations associated in time, never proof the intervention caused them.',
  'Every cohort is causally inconclusive: there is no approved experiment or control group, and small or incomplete observations cannot demonstrate an effect. Declined interventions, member feedback, incentive evaluation, failed-renewal provider outcomes and attributable collected renewal amounts are unavailable. A balance charge or finite membership purchase is not collected renewal revenue.'
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
  const days = query.get('windowDays') || '30', campaignId = query.get('campaign') || null, selectedOffer = query.get('offer') || null
  insist(/^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 90,'invalid_observation_window')
  insist(campaignId === null || campaignId.length <= 100,'invalid_campaign')
  insist(selectedOffer === null || selectedOffer.length <= 100,'invalid_offer')
  const windowDays = Number(days), asOf = now(), zone = studioSettings(state)?.timeZone ?? 'UTC'
  const allCampaigns = [...list(state,'emptyPlaceCampaign').map(c => ({...c,kind:'empty-place',zero:c.incentiveCents === 0 && c.budgetCents === 0})),
    ...list(state,'winbackCampaign').map(c => ({...c,kind:'win-back',zero:c.rewardCents === 0 && c.budgetCents === 0}))]
  const campaigns = allCampaigns.filter(c => c.status === 'approved' && c.approvedBy && c.zero && (!campaignId || c.id === campaignId))
  if(campaignId) insist(campaigns.length,'campaign_not_found',404)
  const bookings = list(state,'booking'), plans = list(state,'attendancePlan')
  const rows = campaigns.flatMap(campaign => {
    const offers = list(state,campaign.kind === 'empty-place' ? 'emptyPlaceOffer' : 'winbackOffer').filter(o => o.campaignId === campaign.id)
    return (campaign.audience as {personId:string;reason:string|null}[]).map(audience => {
      const offer = offers.find(o => o.personId === audience.personId), member = state.people.find(p => p.id === audience.personId && !p.erasedAt)
      const accepted = !!offer && ['accepted','purchased'].includes(offer.status)
      const excluded = audience.reason ?? exclusion(state,audience.personId,asOf)
      const entry = offer?.classId ? state.records.get(offer.classId)?.data : null
      const status = !offer ? 'excluded' : accepted ? 'accepted' : offer.status === 'suppressed' ? (offer.suppressionReason === 'offer_expired' ? 'expired' : 'suppressed')
        : offer.expiresAt <= asOf ? 'expired' : excluded || entry?.status === 'cancelled' ? 'suppressed' : 'unaccepted'
      const reason = audience.reason ?? offer?.suppressionReason ?? (status === 'suppressed' ? excluded ?? 'class_cancelled' : excluded)
      const start = offer ? accepted ? offer.acceptedAt ?? offer.purchasedAt : offer.createdAt : null
      const end = start ? new Date(Date.parse(start)+windowDays*day).toISOString() : null
      const observations = !accepted || excluded ? [] : bookings.filter(b => b.personId === audience.personId).flatMap(b => {
        const c = state.records.get(b.classId)?.data
        if(!c || c.start < start || c.end > asOf || c.end > end! || c.status !== 'published' || frozen(state,b.personId,c.start)) return []
        const attendancePlan = plans.find(p => p.status === 'accepted' && p.bookingId === b.id)
        return [{bookingId:b.id,classId:c.id,title:c.title,start:c.start,end:c.end,status:b.status,attendance:b.attendance ?? 'unsettled',
          counted:b.status === 'booked' && b.attendance === 'attended',corrections:b.corrections ?? [],attendancePlanId:attendancePlan?.id ?? null,
          url:'/app?day='+localDate(c.start,zone)+'&class='+encodeURIComponent(c.id)+'#roster'}]
      })
      return {campaignId:campaign.id,kind:campaign.kind,personId:audience.personId,member:member?.name ?? 'Unavailable member',
        offerId:offer?.id ?? null,status,exclusionReason:reason ?? null,measured:accepted && !excluded,
        window:{start,end,complete:end ? end <= asOf : null},observations,attendedBookingIds:observations.filter(v => v.counted).map(v => v.bookingId),
        source:{campaign:{id:campaign.id,kind:campaign.kind,text:campaign.text,approvedAt:campaign.approvedAt,approvedBy:campaign.approvedBy,audienceReason:audience.reason ?? null},
          offer:offer ? {id:offer.id,status:offer.status,createdAt:offer.createdAt,expiresAt:offer.expiresAt,acceptedAt:offer.acceptedAt ?? offer.purchasedAt ?? null,
            bookingId:offer.bookingId ?? null,packId:offer.packId ?? null,suppressionReason:offer.suppressionReason ?? null} : null},
        detailUrl:offer ? '/app/recovery-outcomes?windowDays='+windowDays+'&offer='+encodeURIComponent(offer.id)+'#outcome-source' : null,
        memberUrl:member ? '/app/people?person='+encodeURIComponent(member.id) : null,
        collectedRenewalCents:null,causalConclusion:'inconclusive'}
    })
  })
  const summarize = (group: typeof rows) => ({audienceMembers:new Set(group.map(r => r.personId)).size,offers:group.filter(r => r.offerId).length,
    accepted:group.filter(r => r.status === 'accepted').length,unaccepted:group.filter(r => r.status === 'unaccepted').length,
    suppressed:group.filter(r => r.status === 'suppressed').length,expired:group.filter(r => r.status === 'expired').length,
    excluded:group.filter(r => r.exclusionReason || r.status === 'excluded').length,
    measuredMembers:new Set(group.filter(r => r.measured).map(r => r.personId)).size,
    membersWithVisits:new Set(group.filter(r => r.attendedBookingIds.length).map(r => r.personId)).size,
    attendedVisits:new Set(group.flatMap(r => r.attendedBookingIds)).size,
    completeWindows:group.filter(r => r.window.complete === true).length,incompleteWindows:group.filter(r => r.window.complete === false).length,
    collectedRenewalCents:null,causalConclusion:'inconclusive'})
  const selected = selectedOffer ? rows.find(r => r.offerId === selectedOffer) : null
  if(selectedOffer) insist(selected,'offer_not_found',404)
  return {asOf,filters:{windowDays,campaign:campaignId},rows,selected,totals:summarize(rows),
    campaigns:campaigns.map(c => ({id:c.id,kind:c.kind,text:c.text,approvedAt:c.approvedAt,...summarize(rows.filter(r => r.campaignId === c.id))})),
    definitions:recoveryOutcomeDefinitions,unavailable:{declinedInterventions:null,memberFeedback:null,collectedRenewalCents:null,failedRenewals:null,causalEffect:null},
    outsideCoverage:allCampaigns.filter(c => c.status === 'approved' && !c.zero).length}
}
