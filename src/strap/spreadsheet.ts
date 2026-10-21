import { strToU8, zipSync } from 'fflate'

export type Cell = string | number | boolean | null | undefined
export type Sheet = { name: string; rows: Cell[][] }
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships'
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const column = (index: number): string => index < 26 ? String.fromCharCode(65+index) : column(Math.floor(index/26)-1)+column(index%26)

/** Native numeric and boolean cells, inline text (never formulas), blank unavailable values. */
export function workbook(sheets: Sheet[]): Uint8Array {
  const files: Record<string,Uint8Array> = {}, add = (name: string,body: string) => { files[name] = strToU8(declaration+body) }
  add('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  add('_rels/.rels',`<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  add('xl/workbook.xml',`<workbook xmlns="${main}" xmlns:r="${office}"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`)
  add('xl/_rels/workbook.xml.rels',`<Relationships xmlns="${relationships}">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${office}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`)
  for (const [i,sheet] of sheets.entries()) {
    const rows = sheet.rows.map((row,r)=>`<row r="${r+1}">${row.map((value,c)=> {
      const ref = `${column(c)}${r+1}`
      if (value == null) return `<c r="${ref}"/>`
      if (typeof value === 'number' || typeof value === 'boolean') return `<c r="${ref}" t="${typeof value === 'number' ? 'n' : 'b'}"><v>${Number(value)}</v></c>`
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
    }).join('')}</row>`).join('')
    add(`xl/worksheets/sheet${i+1}.xml`,`<worksheet xmlns="${main}"><sheetData>${rows}</sheetData></worksheet>`)
  }
  return zipSync(files)
}

/** JSON-valued data cells match Strap's existing portable and cancellation CSVs. */
export function csv(rows: Cell[][]): string {
  const quote = (value: string) => '"'+value.replace(/"/g,'""')+'"'
  return rows.map((row,i)=>row.map(value=>quote(i === 0 ? String(value ?? '') : JSON.stringify(value ?? null))).join(',')).join('\r\n')+'\r\n'
}
