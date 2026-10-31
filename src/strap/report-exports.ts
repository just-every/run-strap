import { retentionReport, retentionCsv, retentionColumns } from './retention-report'
import { renewalWorklist, renewalCsv, renewalColumns } from './domain/renewals'
import { teachingPay } from './domain/teaching-pay'
import { studioSettings } from './domain/studio'
import { humanOwner, type Actor, type State } from './domain/types'
import { attendanceReport } from './attendance-report'
import { revenueReport } from './revenue-report'
import { cancellationTable } from './cancellations'
import { csv, workbook, type Cell, type Sheet } from './spreadsheet'

type Row = Record<string, any>
const table = (columns: string[], rows: Row[]): Cell[][] => [columns,...rows.map(row=>columns.map(key=>row[key]))]

/** RPT-006 downloads use the same report projection and filters as the screen. */
export function reportDownload(s: any, name: string, format: string, query: URLSearchParams): Response {
  let rows: Cell[][], totals: Row | undefined, definitions: string[] = [], timeZone = s.studio?.timeZone ?? 'UTC'
  if (name === 'revenue') {
    const report = revenueReport(s,query)
    rows = table(['id','kind','at','date','locationId','timeZone','personId','packId','agreementId','cancellationId','sourceId','plan','amountCents','externalReference','sourceUrl'],report.sources.map(row=>({...row,externalReference:row.record.reference ?? null})))
    totals = report.totals; definitions = report.definitions; timeZone = report.timeZone
  } else if (name === 'attendance') {
    const report = attendanceReport(s,query)
    rows = table(['classId','title','start','date','time','instructorId','room','service','location','status','booked','waitlisted','attended','noShow','uniqueVisitors','earlyCancelled','lateCancelled','memberCancelled','staffCancelled','memberEarlyCancelled','memberLateCancelled','staffEarlyCancelled','staffLateCancelled','systemCancelled','configuredSeats','disabledSpots','usableSeats','occupiedSeats','onlineSeats','heldSeats','offeredSeats','occupancyPercent','rosterUrl','cancellationsUrl'],report.rows)
    totals = report.totals; definitions = [report.definitions]; timeZone = report.timeZone
  } else {
    rows = cancellationTable(s,query)
    definitions = ['Cancellation filters and retained action identities match the cancellation list and CSV. Cents are USD; creditReturned is a boolean.']
  }
  const context: Cell[][] = [['Field','Value'],['timeZone',timeZone],['filters',query.toString()],['currency','USD'],['unavailable','Blank XLSX cells / JSON null in CSV mean unavailable, never zero.'],['csv','Data cells contain JSON values, as in the portable exit; text remains literal, not a spreadsheet formula.'],...definitions.map(value=>['definition',value])]
  const sheets: Sheet[] = [{name:'Sources',rows},...(totals ? [{name:'Totals',rows:[['Metric','Value'],...Object.entries(totals)] as Cell[][]}] : []),{name:'Context',rows:context}]
  return downloadResponse(name,format,sheets)
}

function downloadResponse(name: string, format: string, sheets: Sheet[], csvContent?: string): Response {
  const headers = {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-disposition':`attachment; filename="strap-${name}.${format}"`}
  // Nested source identities and audit facts stay structured JSON in a literal text cell.
  const literalSheets = sheets.map(sheet => ({...sheet,rows:sheet.rows.map(row => row.map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value))}))
  return format === 'csv' ? new Response(csvContent ?? csv(sheets[0].rows),{headers:{...headers,'content-type':'text/csv; charset=utf-8'}})
    : new Response(workbook(literalSheets) as BodyInit,{headers:{...headers,'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}})
}

/** Current native projections only; each export retains the report's own filters and authority. */
export function nativeReportDownload(state: State, who: Actor, name: string, format: string, query: URLSearchParams): Response {
  humanOwner(who)
  let rows: Cell[][], asOf: string, filters: unknown, definitions: string[], csvContent: string | undefined
  let extra: Sheet[] = []
  if (name === 'retention') {
    const report = retentionReport(state,who,query)
    rows = table([...retentionColumns],report.rows); asOf = report.asOf; filters = report.filters; definitions = report.definitions
    csvContent = retentionCsv(report)
    const columns = ['acquisitionMonth','initialOffer','members','meanTenureDays','attendedVisits','visitsPer30Days','terms','completedTerms','renewedTerms','scheduledRenewals','expiredWithoutLinkedRenewal','renewalRatePercent','packIds','terminatedAgreements','scheduledTerminations','churnByReason','freezeByType','freezes','reactivations','collectedRenewalCents','churn']
    extra = [{name:'Cohorts',rows:table(columns,report.cohorts)},{name:'Unavailable',rows:[['Metric','Value'],...Object.entries(report.unavailable)]}]
  } else if (name === 'renewals') {
    const report = renewalWorklist(state,who,query)
    rows = table([...renewalColumns],report.rows); asOf = report.asOf; filters = {days:report.days,lowCredits:report.lowCredits,through:report.through}
    definitions = [report.coverage,'Expiry window is (asOf, through], or currently low credits. Accepted/applied renewals and expired packs are excluded. Last visit uses corrected attended classes that have started. Follow-up is an internal task, never permission to contact.']
    csvContent = renewalCsv(report)
  } else {
    const report = teachingPay(state,query.get('instructorId') ?? undefined,query.get('from') ?? undefined,query.get('to') ?? undefined)
    const columns = ['classId','title','service','instructorId','instructorName','start','end','classStatus','cancelledAt','status','unconfiguredReason','attendees','bookingIds','attendedBookingIds','ruleId','ruleVersion','rule','substitute','substitution','calculation','baseCents','adjustments','adjustmentCents','totalCents']
    rows = table(columns,report.rows); asOf = report.asOf; filters = {instructorId:report.instructorId,from:report.from,to:report.to}
    definitions = ['Only ended or canceled classes appear. Start bounds are inclusive exact instants; corrected attendance, immutable pay rules and reasoned adjustments retain their source identities. Unconfigured pay has an unavailable total, distinct from the configured subtotal. This is teaching compensation, not payroll or a funds transfer.']
    extra = [{name:'Totals',rows:[['Metric','Value'],['complete',report.complete],['totalCents',report.totalCents],['configuredTotalCents',report.configuredTotalCents],['adjustmentTotalCents',report.adjustmentTotalCents]]}]
  }
  const context: Cell[][] = [['Field','Value'],['asOf',asOf],['timeZone',studioSettings(state)?.timeZone ?? 'UTC'],['filters',JSON.stringify(filters)],['currency','USD'],['unavailable','Blank XLSX cells / JSON null in CSV mean unavailable, never zero.'],['structuredCells','Nested identities, calculation and audit records are JSON text in XLSX; CSV data cells are JSON values.'],...definitions.map(value => ['definition',value])]
  return downloadResponse(name,format,[{name:'Sources',rows},...extra,{name:'Context',rows:context}],csvContent)
}
