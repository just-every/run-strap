import { leadSales, saleEvidence } from './lead-sales'
import { localDate } from './zone'
import { studioSettings } from './domain/studio'
import { humanOwner, insist, list, now, type Actor, type State } from './domain/types'

export const leadReportDefinitions = [
  'Acquisition means the first retained inquiry for each member, ordered by creation instant then ID. Its owner-recorded source is retained with that inquiry; absent sources stay unknown. Later inquiries and their events remain linked but do not count the member or visits again.',
  'Recorded intro bookings and external membership outcomes come only from retained lead events. An intro booking is not an intro purchase. An external membership outcome is not a native membership conversion, collected payment or permission to contact.',
  'Visits are current corrected attended bookings in confirmed status, with class start at or after the first retained inquiry and at or before this report instant. Two or more visits mean repeat attendance. Future check-ins, no-shows, excused and canceled bookings do not count. Corrections can reduce these counts without deleting the recorded pipeline history.',
  'Incomplete follow-up means a current inquiry that is neither membership nor lost; overdue means its recorded due instant is before the report instant. Lost is an owner-recorded pipeline outcome, not an inferred membership lapse. Source filters use the exact recorded source after trimming.',
  'Native intro purchases are retained intro sales. Native membership conversion is a purchased visits or unlimited plan, or a personally accepted recurring agreement, after acquisition. External stage labels, prepared drafts and generic credit packs are not native conversions. An expired intro without a native conversion is a lapsed intro, with its original sale retained; expiry never invents a conversion.',
  'Campaign attribution belongs to the first inquiry and is immutable. Its intro purchase must match the campaign offer and purchase window. Subsequent native membership events follow that purchase, including after the campaign ends. One member and each original charge count once. Campaign cost is owner-recorded USD spending evidence, not an instruction to spend.',
  'Attributed revenue is gross original invoiced intro and membership service sales in USD cents, not collected cash, net revenue, tax, processor settlement or earned revenue. Recurring agreement acceptance creates no sale revenue by itself; renewal invoices, fees, refunds and unrelated credit packs are excluded from this gross acquisition measure. Original charge evidence remains linked.'
]

/** Source and campaign acquisition projection from retained native events. */
export function leadReport(state: State, who: Actor, query: URLSearchParams) {
  humanOwner(who)
  const source = query.get('funnelSource')?.trim() || null
  insist(source === null || source.length <= 100,'invalid_lead_source')
  const campaignId = query.get('funnelCampaign')?.trim() || null
  insist(!campaignId || list(state,'leadCampaign').some(c => c.id === campaignId),'leadCampaign_not_found',404)
  const asOf = now(), leads = list(state,'lead').sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const events = list(state,'leadEvent'), bookings = list(state,'booking')
  const people = [...new Set(leads.map(lead => lead.personId))]
  const rows = people.flatMap(personId => {
    const own = leads.filter(lead => lead.personId === personId), first = own[0]
    const acquisitionSource = first.source ?? null
    if (source !== null && source !== acquisitionSource || campaignId && first.campaignId !== campaignId) return []
    if (!state.people.some(p => p.id === personId && !p.erasedAt)) return []
    const sales = leadSales(state,personId,first.createdAt,asOf)
    const campaign = first.campaignId ? state.records.get(first.campaignId)?.data : null
    const campaignIntro = campaign ? sales.intros.filter(s => s.offerId === campaign.introOfferId && s.createdAt >= campaign.startsAt && s.createdAt < campaign.endsAt) : []
    const campaignSince = campaignIntro.map(s => s.createdAt).sort()[0]
    const campaignSales = campaignSince ? leadSales(state,personId,campaignSince,asOf,campaign!.introOfferId) : null
    if (campaignSales) {
      campaignSales.intros = campaignIntro
      const packIds = new Set([...campaignIntro.map(s => s.packId),...campaignSales.conversions.filter(c => c.kind === 'fixed-term').map(c => c.packId)])
      campaignSales.charges = campaignSales.charges.filter(c => packIds.has(c.packId))
    }
    const visibleSales = campaignId ? campaignSales ?? {intros:[],conversions:[],charges:[]} : sales
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
      source:acquisitionSource,campaignId:first.campaignId ?? null,campaignName:campaign?.name ?? null,
      ...saleEvidence(visibleSales,personId,asOf),campaignEvidence:campaignSales ? saleEvidence(campaignSales,personId,asOf) : null,
      attributedRevenueCents:visibleSales.charges.reduce((sum,c) => sum+c.amountCents,0),acquiredAt:first.createdAt,acquisitionLeadId:first.id,leadIds:own.map(lead => lead.id),
      eventIds:history.map(event => event.id),introBookingEventIds:intro.map(event => event.id),
      introBookingIds:[...new Set(intro.map(event => event.after.bookingId))],externalOutcomeEventIds:external.map(event => event.id),
      attendedBookingIds:visits.map(booking => booking.id),attendedVisits:visits.length,repeatAttendance:visits.length >= 2,
      incompleteLeadIds:incomplete.map(lead => lead.id),overdueLeadIds:incomplete.filter(lead => lead.dueAt < asOf).map(lead => lead.id),
      lostLeadIds:own.filter(lead => lead.stage === 'lost').map(lead => lead.id),
      leadUrl:'/app/leads?lead='+encodeURIComponent(first.id)+'#lead',
      visitUrls:visits.map(booking => '/app?day='+localDate(state.records.get(booking.classId)!.data.start,studioSettings(state)?.timeZone ?? 'UTC')+'&class='+encodeURIComponent(booking.classId)+'#roster')}]
  })
  const summarize = (group: typeof rows) => ({members:group.length,inquiries:group.reduce((n,row) => n+row.leadIds.length,0),
    introPurchases:group.filter(row => row.introPurchases.length > 0).length,
    nativeMembershipConversions:group.filter(row => row.nativeConversions.length > 0).length,
    lapsedIntros:group.filter(row => row.lapsedIntroSaleIds.length > 0).length,
    attributedRevenueCents:group.reduce((sum,row) => sum+row.attributedRevenueCents,0),
    recordedIntroBookings:group.filter(row => row.introBookingEventIds.length > 0).length,
    firstVisits:group.filter(row => row.attendedVisits > 0).length,repeatAttendance:group.filter(row => row.repeatAttendance).length,
    externalOutcomes:group.filter(row => row.externalOutcomeEventIds.length > 0).length,
    incompleteFollowUps:group.reduce((n,row) => n+row.incompleteLeadIds.length,0),overdueFollowUps:group.reduce((n,row) => n+row.overdueLeadIds.length,0),
    lostInquiries:group.reduce((n,row) => n+row.lostLeadIds.length,0)})
  const sources = [...new Set(rows.map(row => row.source))].map(source => ({source,...summarize(rows.filter(row => row.source === source))}))
  const campaigns = list(state,'leadCampaign').filter(c => !campaignId || c.id === campaignId).map(c => {
    const members = rows.filter(r => r.campaignId === c.id), costs = list(state,'leadCampaignCost').filter(cost => cost.campaignId === c.id && cost.occurredAt <= asOf)
    return {...c,name:c.name as string,introOfferId:c.introOfferId as string,startsAt:c.startsAt as string,endsAt:c.endsAt as string,members:members.length,introPurchases:members.filter(r => r.campaignEvidence?.introPurchases.length).length,
      nativeMembershipConversions:members.filter(r => r.campaignEvidence?.nativeConversions.length).length,
      lapsedIntros:members.filter(r => r.campaignEvidence?.lapsedIntroSaleIds.length).length,
      firstVisits:members.filter(r => r.attendedVisits > 0).length,repeatAttendance:members.filter(r => r.repeatAttendance).length,
      lostInquiries:members.reduce((sum,r) => sum+r.lostLeadIds.length,0),
      costCents:costs.reduce((sum,cost) => sum+cost.amountCents,0),costs,
      attributedRevenueCents:members.reduce((sum,r) => sum+(r.campaignEvidence?.revenueEvents.reduce((n,e) => n+e.amountCents,0) ?? 0),0),
      memberIds:members.map(r => r.personId)}
  })
  return {asOf,filters:{source,campaignId},rows,sources,campaigns,totals:summarize(rows),definitions:leadReportDefinitions}
}
