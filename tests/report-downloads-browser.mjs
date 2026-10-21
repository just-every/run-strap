import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import readXlsx from 'read-excel-file/node'
import { parseCsv } from './report-downloads.mjs'

export async function downloadReport(page,label,name,width) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link',{name:label,exact:true}).click()
  const download = await downloadPromise
  assert.equal(await download.failure(),null,'RPT-006: browser receives the entire attachment')
  const path = join(process.env.STRAP_PROOF_DIR,`RPT-006-${name}-${width}.${label.includes('XLSX') ? 'xlsx' : 'csv'}`)
  await download.saveAs(path)
  return path.endsWith('.xlsx') ? (await readXlsx(path)).find(s=>s.sheet==='Sources').data : parseCsv(await readFile(path,'utf8'))
}
export async function downloadPair(page,name,width) {
  const csv = await downloadReport(page,'Download CSV',name,width)
  const xlsx = await downloadReport(page,'Download XLSX',name,width)
  // Spreadsheet readers trim trailing blank cells; retain the named columns.
  const records = rows => rows.slice(1).map(row=>rows[0].map((_,i)=>row[i] ?? null))
  assert.deepEqual(records(xlsx),records(csv),'RPT-006: the clicked browser downloads have identical records')
  return records(xlsx)
}

export async function downloadNativePair(page,name,width,csvLabel,xlsxLabel) {
  const read = async (label,format) => {
    const event = page.waitForEvent('download')
    await page.getByRole('link',{name:label,exact:true}).click()
    const download = await event
    assert.equal(await download.failure(),null)
    const path = await download.path()
    if (process.env.STRAP_PROOF_DIR) await download.saveAs(join(process.env.STRAP_PROOF_DIR,`RPT-006-${name}-${width}.${format}`))
    return format==='csv' ? parseCsv(await readFile(path,'utf8')) : (await readXlsx(path)).find(s=>s.sheet==='Sources').data
  }
  const csv = await read(csvLabel,'csv'), xlsx = await read(xlsxLabel,'xlsx')
  assert.deepEqual(xlsx[0],csv[0])
  const normalized = xlsx.slice(1).map((row,i)=>csv[0].map((_,j)=>{
    const value = row[j] ?? null, expected = csv[i+1][j]
    return expected !== null && typeof expected === 'object' ? JSON.parse(value) : value
  }))
  assert.deepEqual(normalized,csv.slice(1),'RPT-006: the clicked XLSX and CSV attachments retain every typed report value')
  return normalized.map(row=>Object.fromEntries(csv[0].map((key,i)=>[key,row[i]])))
}
