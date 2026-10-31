import { insist, list, now, person, record, text, type RecordData, type State } from './types'
import type { Transaction } from './store'
import { requireMemberRecord } from './member-records'
import { preferencesOf } from './preferences'

/** A response belongs to the recipient; no response is never a decline. */
export function declineIntervention(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member','member_required',403)
  insist(input.kind === 'empty-place' || input.kind === 'win-back','invalid_intervention_kind')
  const kind = input.kind === 'empty-place' ? 'emptyPlaceOffer' : 'winbackOffer'
  const offer = record(tx.state,input.id,kind)
  insist(offer.personId === tx.who.personId,'intervention_not_found',404)
  person(tx.state,offer.personId)
  const requestId = text(input.requestId,'requestId',100)
  if(offer.status === 'declined') {
    insist(offer.declinedBy === tx.who.id && offer.declineRequestId === requestId,'decline_request_changed',409)
    return offer
  }
  insist(offer.status === 'offered' && offer.expiresAt > now(),'intervention_closed',409)
  tx.future(offer.expiresAt)
  const saved = {...offer,status:'declined',declinedAt:now(),declinedBy:tx.who.id,declineRequestId:requestId}
  tx.put(kind,saved)
  return saved
}

/** Withdrawal removes old measurements permanently; later permission applies to new offers. */
export function measurementAllowed(state: State, personId: string, since?: string | null) {
  if(!state.people.some(p => p.id === personId && p.active && !p.erasedAt)) return false
  if(preferencesOf(state,personId).recoveryMeasurement === false) return false
  return !since || !list(state,'memberPreferenceEvent').some(e => e.personId === personId && e.at >= since && e.after?.recoveryMeasurement === false)
}

/** Native credits are spending evidence, never processor settlement or cash revenue. */
export function interventionCost(state: State, kind: string, offer: RecordData) {
  const chargeId = (kind === 'empty-place' ? 'empty-place-incentive:' : 'referral-reward:')+offer.id
  const charge = state.records.get(chargeId)
  const beneficiary = kind === 'empty-place' ? offer.personId : offer.referrerId
  const expected = kind === 'empty-place' ? offer.incentiveCents : offer.reservedRewardCents ?? 0
  const posted = !!offer.rewardedAt && (expected === 0 || !!charge && charge.kind === 'charge' && charge.data.personId === beneficiary && charge.data.amountCents === -expected)
  return {reservedCents:offer.reservedCents ?? offer.reservedRewardCents ?? 0,
    postedCreditCents:posted ? expected : null,postedAt:posted ? offer.rewardedAt : null,
    chargeId:posted && expected ? chargeId : null,beneficiaryId:posted && expected ? beneficiary : null,
    status:posted ? 'posted_non_cash_credit' : offer.rewardedAt ? 'source_unavailable' : 'not_posted'}
}

/** Staff opens a sign-in door; the member must make their own decision. */
export function launchIntervention(tx: Transaction, input: Record<string,unknown>) {
  const memberId = text(input.personId,'personId',100)
  requireMemberRecord(tx.state,tx.who,memberId)
  const member = person(tx.state,memberId)
  insist(member.role === 'member','member_required')
  text(input.requestId,'requestId',100)
  const saved = {id:crypto.randomUUID(),personId:member.id,status:'member_action_required',
    url:'/signin?returnTo=%2Fapp%2Foffers',createdAt:now(),createdBy:tx.who.id}
  tx.put('interventionLaunch',saved)
  return saved
}

/** Assignment precedes the owner's exact campaign approval and sends nothing. */
export function recoveryDesign(state: State, input: Record<string,unknown>, audience: {personId:string;reason:string|null;[key:string]:any}[]) {
  const design = input.measurementDesign ?? 'observational'
  insist(design === 'observational' || design === 'randomized_holdout','invalid_measurement_design')
  if(design === 'observational') return {audience,measurement:null}
  const windowDays = input.measurementDays
  insist(typeof windowDays === 'number' && Number.isInteger(windowDays) && windowDays >= 1 && windowDays <= 90,'invalid_measurement_days')
  const permitted = audience.map(row => ({...row,reason:row.reason ?? (measurementAllowed(state,row.personId) ? null : 'measurement_opt_out')}))
  const eligible = permitted.filter(row => !row.reason).map(row => ({personId:row.personId,rank:crypto.randomUUID()})).sort((a,b) => a.rank.localeCompare(b.rank))
  insist(eligible.length >= 2,'comparison_needs_two_eligible_members',409)
  const assignments = eligible.map((row,i) => ({personId:row.personId,group:i%2 === 0 ? 'intervention' : 'holdout'}))
  return {audience:permitted.map(row => assignments.some(a => a.personId === row.personId && a.group === 'holdout') ? {...row,reason:'experiment_holdout'} : row),
    measurement:{design,windowDays,assignments,preparedAt:now(),causalConclusion:'inconclusive'}}
}

export function checkRecoveryDesign(state: State, campaign: RecordData) {
  if(!campaign.measurement) return
  insist(campaign.measurement.assignments.every((row:RecordData) => measurementAllowed(state,row.personId)),'measurement_permission_changed',409)
}
