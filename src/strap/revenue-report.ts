import { insist, type RecordData } from './domain/types'
import { countsCredits } from './domain/entitlements'
import { localDate } from './zone'
import { ledgerLocation, zoneOfLocation } from './location-scope'

type Row = RecordData
export const reportPlan = (pack: Row) => `${pack.entitlement?.kind ?? 'credits'}: ${pack.entitlement?.name ?? 'Unnamed'}`
const feeReasons = new Set(['late_cancel_fee','no_show_fee','late_move_fee','fee_reversal'])
const sum = (rows: Row[]) => rows.reduce((total,row) => total + row.amountCents,0)
export const revenueDefinitions = [
  'Gift card funding is a liability charge and an actual cash or external receipt. Gift redemption is a noncash payment against the retail sale; restoring a redemption returns value to that card, never a cash refund. Both retain distinct source kinds and do not inflate cash collections or gross sales.',
  'Amounts are exact USD cents. Event dates use the studio time zone with inclusive date bounds. Gross sales sum positive non-fee charges; sales credits are negative non-fee charges; net sales is their signed sum. Fees are signed attendance and late-move assessments including reversals, not processor costs. Total assessed is net sales plus fees.',
  'Collections are positive external receipts; refunds are the magnitude of negative external payments; net collections is their signed sum. A charge credit is not a cash refund. No processor collection, ACH return or provider verification is claimed. Unallocated receipts stay Unallocated when filtering by plan; they are never apportioned across packs.',
  'New plans counts packs created in the period, including explicitly accepted renewals, not people or drafts. Active members is a current snapshot of active member identities with an unexpired pack and available credits or period/unlimited entitlement; it is independent of the event date window. Booking cancellations count retained cancel action identities even after restoration, not membership churn.',
  'Outstanding balances sum positive member balances across all time and plans; member credit sums the magnitude of negative balances separately. Both are unavailable under a plan filter because receipts can be unallocated. Due dates, historical active-member trends, membership cancellations, ACH returns and processor fees are not implemented and remain unavailable. Each charge, receipt and plan belongs to one location: the one named on it, else its class, else the pack’s sale location, else the original location. A source’s date is its own location’s local date; the report’s time zone is the original location’s. Filtering by location narrows every total, balance and active-member count to that location; with no filter the report consolidates every location and lists each location’s totals. Balances are a member’s balance from that location’s rows when filtered.'
]

/** RPT-001: all totals are projections of retained public ledger records. */
export function revenueReport(s: any, query: URLSearchParams) {
  const generatedAt = new Date().toISOString(), timeZone = s.studio?.timeZone ?? 'UTC', places: Row[] = s.locations ?? []
  const wanted = query.get('location')?.trim().toLowerCase(), chosen = wanted ? places.find(l => l.id.toLowerCase() === wanted || l.name.trim().toLowerCase() === wanted) : undefined
  const unknown = !!wanted && !chosen && !(!places.length && wanted === (s.studio?.location ?? 'Studio').trim().toLowerCase())
  const location = chosen?.name ?? (unknown ? query.get('location')!.trim() : wanted ? (s.studio?.location ?? 'Studio') : places.length > 1 ? 'All locations' : places[0]?.name ?? s.studio?.location ?? 'Studio')
  const ledger = {classes:s.classes,bookings:s.bookings,packs:s.packs,charges:s.charges}, place = (row: Row) => ledgerLocation(row,ledger)
  for (const name of ['from','to']) {
    const value = query.get(name)
    insist(!value || (/^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value),'invalid_report_date')
  }
  insist(!query.get('from') || !query.get('to') || query.get('from')! <= query.get('to')!,'invalid_report_range')
  const byId = (rows: Row[], id: string) => rows.find(row => row.id === id)
  const packFor = (row: Row): Row | undefined => {
    const charge = row.chargeId ? byId(s.charges,row.chargeId) : row.reversesChargeId ? byId(s.charges,row.reversesChargeId) : row
    const packId = row.packId ?? charge?.packId ?? byId(s.bookings,row.bookingId ?? charge?.bookingId)?.packId
    return byId(s.packs,packId)
  }
  const matchesPlan = (pack?: Row) => !query.get('plan') || (pack ? reportPlan(pack) : 'Unallocated') === query.get('plan')
  const matchesLocation = (row: Row) => !unknown && (!chosen || place(row) === chosen.id)
  const inPeriod = (at: string, zone = timeZone) => {
    const date = localDate(at,zone)
    return at <= generatedAt && (!query.get('from') || date >= query.get('from')!) && (!query.get('to') || date <= query.get('to')!)
  }
  const sources: Row[] = []
  const append = (row: Row,kind: string,at: string,amountCents: number | null,pack?: Row) => {
    const locationId = kind === 'new-plan' ? row.locationId ?? 'studio' : place(row), zone = zoneOfLocation(places,locationId,timeZone)
    if (matchesLocation(row) && matchesPlan(pack) && inPeriod(at,zone)) sources.push({id:row.id,kind,at,date:localDate(at,zone),locationId,personId:row.personId,packId:pack?.id ?? null,plan:pack ? reportPlan(pack) : 'Unallocated',amountCents,
      record:row,sourceUrl:`/app/revenue?sourceId=${encodeURIComponent(row.id)}#source-record`,memberUrl:`/app/people?person=${encodeURIComponent(row.personId)}#person`})
  }
  for (const row of s.charges) append(row,row.reason==='gift_card_issue' ? 'gift-liability' : feeReasons.has(row.reason) ? 'fee' : 'sale',row.createdAt,row.amountCents,packFor(row))
  for (const row of s.payments) append(row,row.reason==='gift_card_redemption' ? 'gift-redemption' : row.amountCents < 0 ? 'refund' : 'receipt',row.createdAt,row.amountCents,packFor(row))
  for (const row of s.packs) append(row,'new-plan',row.createdAt,null,row)
  for (const row of s.bookingActions.filter((row: Row) => row.action === 'cancel')) append(row,'booking-cancellation',row.at,null,packFor(row))
  sources.sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  const sales = sources.filter(row => row.kind === 'sale'), fees = sources.filter(row => row.kind === 'fee'), receipts = sources.filter(row => row.kind === 'receipt'), refunds = sources.filter(row => row.kind === 'refund')
  const rowsHere = [...s.charges,...s.payments].filter(matchesLocation)
  const balances: Row[] = unknown ? [] : chosen ? [...new Set(rowsHere.map(r => r.personId))].sort().map(personId => ({personId,balanceCents:s.charges.filter((r: Row) => matchesLocation(r) && r.personId === personId).reduce((n: number,r: Row) => n+r.amountCents,0)-s.payments.filter((r: Row) => matchesLocation(r) && r.personId === personId).reduce((n: number,r: Row) => n+r.amountCents,0)})) : s.balances
  const balanceRows = !query.get('plan') ? balances.map((row: Row) => ({...row,sourceIds:rowsHere.filter((r: Row) => r.personId === row.personId).map((r: Row) => r.id)})) : []
  const activePacks = s.packs.filter((pack: Row) => !unknown && (!chosen || (pack.locationId ?? 'studio') === chosen.id) && matchesPlan(pack) && pack.createdAt <= generatedAt && pack.expiresAt > generatedAt && (!countsCredits(pack) || pack.remaining > 0))
  const activeMemberIds = s.people.filter((p: Row) => p.role === 'member' && p.active && activePacks.some((pack: Row) => pack.personId === p.id)).map((p: Row) => p.id)
  const totals = {grossSalesCents:sum(sales.filter(row => row.amountCents > 0)),salesCreditsCents:sum(sales.filter(row => row.amountCents < 0)),netSalesCents:sum(sales),feesCents:sum(fees),assessedCents:sum(sales)+sum(fees),
    collectionsCents:sum(receipts),refundsCents:0-sum(refunds),netCollectionsCents:sum(receipts)+sum(refunds),newPlans:sources.filter(row => row.kind === 'new-plan').length,bookingCancellations:sources.filter(row => row.kind === 'booking-cancellation').length,activeMembers:activeMemberIds.length,
    outstandingCents:query.get('plan') ? null : balanceRows.reduce((n: number,row: Row) => n+Math.max(0,row.balanceCents),0),memberCreditCents:query.get('plan') ? null : balanceRows.reduce((n: number,row: Row) => n+Math.max(0,-row.balanceCents),0),overdueCents:null,membershipCancellations:null,returnedAchCents:null,processorFeesCents:null}
  const locationTotals = (places.length > 1 && !chosen ? places : []).map(l => {
    const mine = sources.filter(row => row.locationId === l.id), kinds = (kind: string) => mine.filter(row => row.kind === kind)
    return {locationId:l.id,name:l.name,timeZone:l.timeZone,netSalesCents:sum(kinds('sale')),feesCents:sum(kinds('fee')),collectionsCents:sum(kinds('receipt')),refundsCents:0-sum(kinds('refund')),newPlans:kinds('new-plan').length}
  })
  return {generatedAt,timeZone,location,locationId:chosen?.id ?? null,locations:places.map(l => ({id:l.id,name:l.name})),locationTotals,plans:[...new Set(s.packs.map(reportPlan))].sort(),totals,activeMemberIds,balanceRows,sources,selectedSource:query.get('sourceId') ? sources.find(row => row.id === query.get('sourceId')) ?? null : null,definitions:revenueDefinitions}
}
