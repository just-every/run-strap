import { localDate } from './zone'
import { studioSettings } from './domain/studio'
import { humanOwner, insist, list, now, type Actor, type State } from './domain/types'

export const leadReportDefinitions = [
  'Acquisition means the first retained inquiry for each member, ordered by creation instant then ID. Its owner-recorded source is retained with that inquiry; absent sources stay unknown. Later inquiries and their events remain linked but do not count the member or visits again.',
  'Recorded intro bookings and external membership outcomes come only from retained lead events. An intro booking is not an intro purchase. An external membership outcome is not a native membership conversion, collected payment or permission to contact.',
  'Visits are current corrected attended bookings in confirmed status, with class start at or after the first retained inquiry and at or before this report instant. Two or more visits mean repeat attendance. Future check-ins, no-shows, excused and canceled bookings do not count. Corrections can reduce these counts without deleting the recorded pipeline history.',
  'Incomplete follow-up means a current inquiry that is neither membership nor lost; overdue means its recorded due instant is before the report instant. Lost is an owner-recorded pipeline outcome, not an inferred membership lapse. Source filters use the exact recorded source after trimming.',
  'Intro purchases, native membership conversions, campaigns, campaign spending and attributed revenue are unavailable. Generic pack charges and unallocated receipts do not establish campaign or conversion attribution.'
]

/** RPT-005 partial: observed inquiry and attendance facts, without inferred sales. */
export function leadReport(state: State, who: Actor, query: URLSearchParams) {
  humanOwner(who)
  const source = query.get('funnelSource')?.trim() || null
  insist(source === null || source.length <= 100,'invalid_lead_source')
  const asOf = now(), leads = list(state,'lead').sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const events = list(state,'leadEvent'), bookings = list(state,'booking')
  const people = [...new Set(leads.map(lead => lead.personId))]
  const rows = people.flatMap(personId => {
    const own = leads.filter(lead => lead.personId === personId), first = own[0]
    const acquisitionSource = first.source ?? null
    if (source !== null && source !== acquisitionSource) return []
    const history = events.filter(event => own.some(lead => lead.id === event.leadId))
    const intro = history.filter(event => event.toStage === 'intro-booked' && event.fromStage !== 'intro-booked')
    const external = history.filter(event => event.toStage === 'membership' && event.fromStage !== 'membership')
    const visits = bookings.filter(booking => {
      const start = state.records.get(booking.classId)?.data.start
      return booking.personId === personId && booking.status === 'booked' && booking.attendance === 'attended'
        && typeof start === 'string' && start >= first.createdAt && start <= asOf
    })
    const incomplete = own.filter(lead => !['membership','lost'].includes(lead.stage))
    return [{personId,member:state.people.find(person => person.id === personId)?.name ?? 'Unavailable member',
      source:acquisitionSource,acquiredAt:first.createdAt,acquisitionLeadId:first.id,leadIds:own.map(lead => lead.id),
      eventIds:history.map(event => event.id),introBookingEventIds:intro.map(event => event.id),
      introBookingIds:[...new Set(intro.map(event => event.after.bookingId))],externalOutcomeEventIds:external.map(event => event.id),
      attendedBookingIds:visits.map(booking => booking.id),attendedVisits:visits.length,repeatAttendance:visits.length >= 2,
      incompleteLeadIds:incomplete.map(lead => lead.id),overdueLeadIds:incomplete.filter(lead => lead.dueAt < asOf).map(lead => lead.id),
      lostLeadIds:own.filter(lead => lead.stage === 'lost').map(lead => lead.id),
      leadUrl:'/app/leads?lead='+encodeURIComponent(first.id)+'#lead',
      visitUrls:visits.map(booking => '/app?day='+localDate(state.records.get(booking.classId)!.data.start,studioSettings(state)?.timeZone ?? 'UTC')+'&class='+encodeURIComponent(booking.classId)+'#roster')}]
  })
  const summarize = (group: typeof rows) => ({members:group.length,inquiries:group.reduce((n,row) => n+row.leadIds.length,0),
    recordedIntroBookings:group.filter(row => row.introBookingEventIds.length > 0).length,
    firstVisits:group.filter(row => row.attendedVisits > 0).length,repeatAttendance:group.filter(row => row.repeatAttendance).length,
    externalOutcomes:group.filter(row => row.externalOutcomeEventIds.length > 0).length,
    incompleteFollowUps:group.reduce((n,row) => n+row.incompleteLeadIds.length,0),overdueFollowUps:group.reduce((n,row) => n+row.overdueLeadIds.length,0),
    lostInquiries:group.reduce((n,row) => n+row.lostLeadIds.length,0)})
  const sources = [...new Set(rows.map(row => row.source))].map(source => ({source,...summarize(rows.filter(row => row.source === source))}))
  return {asOf,filters:{source},rows,sources,totals:summarize(rows),definitions:leadReportDefinitions,
    unavailable:{introPurchases:null,nativeMembershipConversions:null,campaignCostCents:null,attributedRevenueCents:null}}
}
