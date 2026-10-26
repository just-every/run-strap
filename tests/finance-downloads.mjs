import assert from 'node:assert/strict'
import readXlsx from 'read-excel-file/node'
import { parseCsv } from './report-downloads.mjs'

/** Compare every retained recognition row, including unavailable fields and original terms. */
export async function assertFinanceDownloads(h, owner, report) {
  const path='/api/strap/reports/finance',query='?financeMonth='+report.month
  const csv=await h.send(path+'.csv'+query,undefined,owner)
  assert.equal(csv.status,200)
  const [columns,...records]=parseCsv(csv.text)
  const objects=records.map(row=>Object.fromEntries(columns.map((key,i)=>[key,row[i]??null])))
  const response=await h.mf.dispatchFetch(h.origin+path+'.xlsx'+query,{headers:{cookie:owner}})
  assert.equal(response.status,200)
  const sheets=await readXlsx(Buffer.from(await response.arrayBuffer()))
  const [headers,...values]=sheets.find(s=>s.sheet==='Recognition').data
  const excel=values.map(row=>Object.fromEntries(headers.map((key,i)=>[key,row[i]??null])))
  const fromCsv=objects.filter(r=>r.kind==='recognition').map(({kind,id,at,inPeriod,openingCents,periodCents,closingCents,definition,...r})=>({...r,id,consumedBookingIds:JSON.parse(r.consumedBookingIds)}))
  const fromExcel=excel.map(({chargeId,...r})=>({...r,id:chargeId,consumedBookingIds:JSON.parse(r.consumedBookingIds)}))
  assert.ok(report.rows.length>0,'populated report supplies recognition comparisons')
  assert.deepEqual(fromCsv,report.rows,'CSV retains every recognition field and row, including signed unclassified value, pack identity, consumed bookings and original terms')
  assert.deepEqual(fromExcel,report.rows,'XLSX retains every recognition field and row')
  const metrics=objects.filter(r=>r.kind==='metric')
  assert.equal(metrics.length,Object.keys(report.closing).length)
  for(const row of metrics)assert.deepEqual([row.openingCents,row.periodCents,row.closingCents],[report.opening[row.id],report.period[row.id],report.closing[row.id]])
  for(const [metric,opening,period,closing] of sheets.find(s=>s.sheet==='Reconciliation').data.slice(1))assert.deepEqual([opening,period,closing],[report.opening[metric],report.period[metric],report.closing[metric]])
  const sourceRows=objects.filter(r=>!['recognition','metric','policy'].includes(r.kind))
  assert.deepEqual(sourceRows.map(({id,kind,at,amountCents,inPeriod,sourceUrl})=>({id,kind,at,amountCents,inPeriod,sourceUrl})),report.sources.map(({record,...s})=>s),'CSV ledger sources retain exact signed amounts and links')
  const [ledgerHeaders,...ledgerValues]=sheets.find(s=>s.sheet==='Ledger').data
  assert.deepEqual(ledgerValues.map(row=>Object.fromEntries(ledgerHeaders.map((key,i)=>[key,row[i]??null]))),report.sources.map(({record,...s})=>s),'XLSX ledger sources retain exact signed amounts and links')
  for(const source of report.sources){
    const detail=await h.send(source.sourceUrl,undefined,owner)
    assert.equal(detail.status,200);assert.ok(detail.text.includes(source.id))
  }
}
