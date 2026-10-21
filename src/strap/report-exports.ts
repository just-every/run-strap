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
    rows = table(['id','kind','at','date','personId','packId','plan','amountCents','externalReference','sourceUrl'],report.sources.map(row=>({...row,externalReference:row.record.reference ?? null})))
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
  const headers = {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-disposition':`attachment; filename="strap-${name}.${format}"`}
  return format === 'csv' ? new Response(csv(rows),{headers:{...headers,'content-type':'text/csv; charset=utf-8'}})
    : new Response(workbook(sheets) as BodyInit,{headers:{...headers,'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}})
}
