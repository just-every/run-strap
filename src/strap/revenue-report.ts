import { insist, type RecordData } from './domain/types'
import { countsCredits } from './domain/entitlements'
import { localDate } from './zone'

type Row = RecordData
export const reportPlan = (pack: Row) => `${pack.entitlement?.kind ?? 'credits'}: ${pack.entitlement?.name ?? 'Unnamed'}`
const feeReasons = new Set(['late_cancel_fee','no_show_fee','late_move_fee','fee_reversal'])
const sum = (rows: Row[]) => rows.reduce((total,row) => total + row.amountCents,0)
export const revenueDefinitions = [
  'Amounts are exact USD cents. Event dates use the studio time zone with inclusive date bounds. Gross sales sum positive non-fee charges; sales credits are negative non-fee charges; net sales is their signed sum. Fees are signed attendance and late-move assessments including reversals, not processor costs. Total assessed is net sales plus fees.',
  'Collections are positive external receipts; refunds are the magnitude of negative external payments; net collections is their signed sum. A charge credit is not a cash refund. No processor collection, ACH return or provider verification is claimed. Unallocated receipts stay Unallocated when filtering by plan; they are never apportioned across packs.',
  'New plans counts packs created in the period, including explicitly accepted renewals, not people or drafts. Active members is a current snapshot of active member identities with an unexpired pack and available credits or period/unlimited entitlement; it is independent of the event date window. Booking cancellations count retained cancel action identities even after restoration, not membership churn.',
  'Outstanding balances sum positive member balances across all time and plans; member credit sums the magnitude of negative balances separately. Both are unavailable under a plan filter because receipts can be unallocated. Due dates, historical active-member trends, membership cancellations, ACH returns and processor fees are not implemented and remain unavailable. Location is the current single studio label; historical location attribution awaits STUDIO-002.'
]

/** RPT-001: all totals are projections of retained public ledger records. */
export function revenueReport(s: any, query: URLSearchParams) {
  const generatedAt = new Date().toISOString(), timeZone = s.studio?.timeZone ?? 'UTC', location = s.studio?.location ?? 'Studio'
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
  const matchesLocation = !query.get('location') || query.get('location')!.trim().toLowerCase() === location.trim().toLowerCase()
  const inPeriod = (at: string) => {
    const date = localDate(at,timeZone)
    return at <= generatedAt && (!query.get('from') || date >= query.get('from')!) && (!query.get('to') || date <= query.get('to')!)
  }
  const sources: Row[] = []
  const append = (row: Row,kind: string,at: string,amountCents: number | null,pack?: Row) => {
    if (matchesLocation && matchesPlan(pack) && inPeriod(at)) sources.push({id:row.id,kind,at,date:localDate(at,timeZone),personId:row.personId,packId:pack?.id ?? null,plan:pack ? reportPlan(pack) : 'Unallocated',amountCents,
      record:row,sourceUrl:`/app/revenue?sourceId=${encodeURIComponent(row.id)}#source-record`,memberUrl:`/app/people?person=${encodeURIComponent(row.personId)}#person`})
  }
  for (const row of s.charges) append(row,feeReasons.has(row.reason) ? 'fee' : 'sale',row.createdAt,row.amountCents,packFor(row))
  for (const row of s.payments) append(row,row.amountCents < 0 ? 'refund' : 'receipt',row.createdAt,row.amountCents,packFor(row))
  for (const row of s.packs) append(row,'new-plan',row.createdAt,null,row)
  for (const row of s.bookingActions.filter((row: Row) => row.action === 'cancel')) append(row,'booking-cancellation',row.at,null,packFor(row))
  sources.sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  const sales = sources.filter(row => row.kind === 'sale'), fees = sources.filter(row => row.kind === 'fee'), receipts = sources.filter(row => row.kind === 'receipt'), refunds = sources.filter(row => row.kind === 'refund')
  const balanceRows = matchesLocation && !query.get('plan') ? s.balances.map((row: Row) => ({...row,sourceIds:[...s.charges,...s.payments].filter((r: Row) => r.personId === row.personId).map((r: Row) => r.id)})) : []
  const activePacks = s.packs.filter((pack: Row) => matchesPlan(pack) && pack.createdAt <= generatedAt && pack.expiresAt > generatedAt && (!countsCredits(pack) || pack.remaining > 0))
  const activeMemberIds = matchesLocation ? s.people.filter((p: Row) => p.role === 'member' && p.active && activePacks.some((pack: Row) => pack.personId === p.id)).map((p: Row) => p.id) : []
  const totals = {grossSalesCents:sum(sales.filter(row => row.amountCents > 0)),salesCreditsCents:sum(sales.filter(row => row.amountCents < 0)),netSalesCents:sum(sales),feesCents:sum(fees),assessedCents:sum(sales)+sum(fees),
    collectionsCents:sum(receipts),refundsCents:0-sum(refunds),netCollectionsCents:sum(receipts)+sum(refunds),newPlans:sources.filter(row => row.kind === 'new-plan').length,bookingCancellations:sources.filter(row => row.kind === 'booking-cancellation').length,activeMembers:activeMemberIds.length,
    outstandingCents:query.get('plan') ? null : balanceRows.reduce((n: number,row: Row) => n+Math.max(0,row.balanceCents),0),memberCreditCents:query.get('plan') ? null : balanceRows.reduce((n: number,row: Row) => n+Math.max(0,-row.balanceCents),0),overdueCents:null,membershipCancellations:null,returnedAchCents:null,processorFeesCents:null}
  return {generatedAt,timeZone,location,plans:[...new Set(s.packs.map(reportPlan))].sort(),totals,activeMemberIds,balanceRows,sources,selectedSource:query.get('sourceId') ? sources.find(row => row.id === query.get('sourceId')) ?? null : null,definitions:revenueDefinitions}
}
