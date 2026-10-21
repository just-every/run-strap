import assert from 'node:assert/strict'
import readXlsx from 'read-excel-file/node'

export const parseCsv = text => text.trimEnd().split('\r\n').map((line,i)=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m=>i ? JSON.parse(m[1].replaceAll('""','"')) : m[1].replaceAll('""','"')))
const objects = ([keys,...rows]) => rows.map(row=>Object.fromEntries(keys.map((key,i)=>[key,row[i] ?? null])))
export async function readDownload(h,path) {
  const response = await h.mf.dispatchFetch(h.origin+path,{headers:{cookie:h.owner}})
  assert.equal(response.status,200)
  assert.equal(response.headers.get('cache-control'),'no-store')
  assert.match(response.headers.get('content-disposition'),/attachment;/)
  assert.match(response.headers.get('content-type'),/spreadsheetml/)
  return readXlsx(Buffer.from(await response.arrayBuffer()))
}

export async function assertReportDownloads(h,name,queries,denied) {
  const version = (await h.state()).version
  for (const query of queries) {
    const path = '/api/strap/reports/'+name, report = (await h.send(path+'?'+query,undefined,h.owner)).value
    const csv = await h.send(path+'.csv?'+query,undefined,h.owner)
    assert.equal(csv.status,200)
    assert.match(csv.headers.get('content-type'),/text\/csv/)
    const csvRows = objects(parseCsv(csv.text)), sheets = await readDownload(h,path+'.xlsx?'+query)
    const xlsxRows = objects(sheets.find(s=>s.sheet==='Sources').data)
    assert.deepEqual(xlsxRows,csvRows,'RPT-006: spreadsheet cell types and all sources match CSV')
    const expected = name==='revenue' ? report.sources : report.rows
    assert.deepEqual(csvRows.map(r=>r.id ?? r.classId),expected.map(r=>r.id ?? r.classId),'RPT-006: filters select the dashboard source identities')
    for (const [i,row] of csvRows.entries()) for (const [key,value] of Object.entries(row)) {
      const source = expected[i]
      assert.equal(value,key==='externalReference' ? source.record.reference ?? null : source[key] ?? null,`RPT-006: ${key} retains the authoritative value`)
    }
    const totals = Object.fromEntries(sheets.find(s=>s.sheet==='Totals').data.slice(1))
    assert.deepEqual(totals,report.totals,'RPT-006: every dashboard total, including unavailable, survives the workbook')
    const context = sheets.find(s=>s.sheet==='Context').data
    assert.ok(context.some(r=>r[0]==='timeZone'&&r[1]===report.timeZone))
    if (query) assert.ok(context.some(r=>r[0]==='filters'&&r[1]===new URLSearchParams(query).toString()))
    if (name==='revenue') {
      const sum = kinds => csvRows.filter(r=>kinds.includes(r.kind)).reduce((n,r)=>n+r.amountCents,0)
      assert.equal(sum(['sale','fee']),totals.assessedCents)
      assert.equal(sum(['receipt','refund']),totals.netCollectionsCents)
    } else {
      for (const key of ['booked','waitlisted','attended','noShow','usableSeats','occupiedSeats','earlyCancelled','lateCancelled','memberCancelled','staffCancelled']) assert.equal(csvRows.reduce((n,r)=>n+r[key],0),totals[key])
    }
  }
  for (const format of ['csv','xlsx']) {
    const path = `/api/strap/reports/${name}.${format}`
    for (const cookie of denied) assert.equal((await h.send(path,undefined,cookie)).status,cookie ? 403 : 401)
    assert.equal((await h.send(path+'?from=2026-02-30',undefined,h.owner)).status,400)
    assert.equal((await h.send(path+'?from=2099-01-02&to=2099-01-01',undefined,h.owner)).status,400)
  }
  assert.equal((await h.state()).version,version,'RPT-006: downloads do not change studio records or money')
}

export async function assertCancellationDownload(h,queries,denied) {
  for (const query of queries) {
    const response = await h.send('/api/strap/cancellations.csv?'+query,undefined,h.owner)
    const sheets = await readDownload(h,'/api/strap/cancellations.xlsx?'+query)
    assert.deepEqual(objects(sheets.find(s=>s.sheet==='Sources').data),objects(parseCsv(response.text)),'RPT-006 / SCHED-014: every cancellation filter and typed field agrees')
  }
  for (const cookie of denied) assert.equal((await h.send('/api/strap/cancellations.xlsx',undefined,cookie)).status,cookie ? 403 : 401)
}

// Read the workbook with an independent spreadsheet parser, including nested source facts.
export async function assertNativeDownloads(h,path,queries,denied,invalid=[]) {
  const version = (await h.state()).version
  const normalize = (rows,reference) => rows.map((row,i)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,reference[i]?.[key] !== null && typeof reference[i]?.[key] === 'object' ? JSON.parse(value) : value])))
  for (const query of queries) {
    const report = (await h.send(path+'?'+query,undefined,h.owner)).value
    const response = await h.send(path+'.csv?'+query,undefined,h.owner)
    assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store')
    const csvRows = objects(parseCsv(response.text)), sheets = await readDownload(h,path+'.xlsx?'+query)
    const xlsxRows = normalize(objects(sheets.find(s=>s.sheet==='Sources').data),csvRows)
    assert.deepEqual(xlsxRows,csvRows,'RPT-006: XLSX preserves every CSV value, including structured evidence and nulls')
    assert.equal(csvRows.length,report.rows.length)
    for (const [i,row] of csvRows.entries()) for (const [key,value] of Object.entries(row)) assert.deepEqual(value,report.rows[i][key] ?? null,`RPT-006: ${key} agrees with the filtered report`)
    const context = sheets.find(s=>s.sheet==='Context').data
    assert.ok(context.some(r=>r[0]==='timeZone'&&r[1]==='America/New_York'))
    assert.ok(context.some(r=>r[0]==='definition'&&r[1].length>0))
    const filters = JSON.parse(context.find(r=>r[0]==='filters')[1])
    for (const [key,value] of new URLSearchParams(query)) assert.equal(String(filters[key]),['from','to'].includes(key) ? new Date(value).toISOString() : value,'RPT-006: workbook retains effective filters')
    if (report.cohorts) {
      assert.deepEqual(normalize(objects(sheets.find(s=>s.sheet==='Cohorts').data),report.cohorts),report.cohorts,'RPT-006: cohort metrics and source terms survive the workbook')
      assert.deepEqual(Object.fromEntries(sheets.find(s=>s.sheet==='Unavailable').data.slice(1)),report.unavailable)
    }
    if ('configuredTotalCents' in report) {
      const totals = Object.fromEntries(sheets.find(s=>s.sheet==='Totals').data.slice(1))
      for (const [key,value] of Object.entries(totals)) assert.equal(value,report[key],'RPT-006: pay totals retain unavailable versus zero')
      assert.equal(csvRows.reduce((sum,row)=>sum+(row.totalCents ?? 0),0),totals.configuredTotalCents)
    }
  }
  const agent = await h.cmd('agent.create',{label:'Report export denied'})
  const unchanged = (await h.state()).version
  for (const format of ['csv','xlsx']) {
    for (const cookie of denied) assert.equal((await h.send(path+'.'+format,undefined,cookie)).status,cookie ? 403 : 401)
    assert.equal((await h.send(path+'.'+format,undefined,'',{authorization:`Bearer ${agent.token}`})).status,401)
    for (const query of invalid) assert.equal((await h.send(path+'.'+format+'?'+query,undefined,h.owner)).status,400)
  }
  assert.equal((await h.state()).version,unchanged,'RPT-006: refused downloads cannot change records')
  assert.equal(unchanged,version,'RPT-006: downloads and credential creation cannot change domain records')
}
