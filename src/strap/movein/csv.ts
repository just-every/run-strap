import { Buffer } from 'node:buffer'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index.ts'
import type { SourceBundle, SourceRecord } from '../../modules/import-kit/src/types.ts'
import { ImportError, requiredText } from './errors.ts'

export const namespace = 'strap.mindbody.csv.v1'
export const formatName = 'Mindbody member CSV v1'
const columns = ['MemberId', 'FirstName', 'LastName', 'Email']

/** RFC 4180 quoting; diagnostic rows name the physical starting line. */
function parse(text: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = []
  let cells: string[] = [], cell = '', state: 'plain' | 'quoted' | 'closed' = 'plain', line = 1, start = 1
  const push = () => { cells.push(cell); rows.push({ cells, line: start }); cells = []; cell = ''; state = 'plain' }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (state === 'quoted') {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else state = 'closed' }
      else { cell += ch; if (ch === '\n') line++ }
      continue
    }
    if (ch === '"') {
      if (state !== 'plain' || cell) throw new ImportError('invalid_csv', 422, `Unexpected quote at line ${line}`)
      state = 'quoted'; continue
    }
    if (ch === ',') { cells.push(cell); cell = ''; state = 'plain'; continue }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      push(); line++; start = line; continue
    }
    if (state === 'closed') throw new ImportError('invalid_csv', 422, `Unexpected text after a quote at line ${line}`)
    cell += ch
  }
  if (state === 'quoted') throw new ImportError('invalid_csv', 422, 'Unclosed CSV quote')
  if (cell || cells.length || state === 'closed') push()
  return rows
}

export function memberSource(value: unknown): SourceBundle {
  const csv = requiredText(value, 'csv'), bytes = Buffer.from(csv, 'utf8')
  if (bytes.length > 1_000_000) throw new ImportError('csv_too_large', 413, 'Member CSV is limited to 1,000,000 UTF-8 bytes')
  if (csv.includes('\0')) throw new ImportError('invalid_csv', 422)
  const rows = parse(csv.replace(/^\uFEFF/, ''))
  if (!rows.length || rows[0].cells.length !== columns.length || rows[0].cells.some((v, i) => v !== columns[i])) {
    throw new ImportError('invalid_csv_headers', 422, `Use these exact headers: ${columns.join(',')}`)
  }
  const body = rows.slice(1)
  if (!body.length || body.length > 1000) throw new ImportError('invalid_member_count', 422, 'Import between 1 and 1000 member rows')
  const ids = new Set<string>(), emails = new Set<string>(), artifactHash = sha256(bytes)
  const records: SourceRecord[] = body.map(({ cells, line }) => {
    if (cells.length !== 4) throw new ImportError('invalid_csv_row', 422, `Line ${line} must have four cells`)
    const [id, firstName, lastName, rawEmail] = cells.map(v => v.trim())
    const name = [firstName, lastName].filter(Boolean).join(' '), email = rawEmail.toLowerCase()
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)
      || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ImportError('invalid_member_row', 422, `Invalid member fields at line ${line}`)
    }
    if (ids.has(id) || emails.has(email)) throw new ImportError('duplicate_member', 422, `Duplicate member ID or email at line ${line}`)
    ids.add(id); emails.add(email)
    const payload = { id, name, email }
    return { namespace, kind: 'member', sourceId: id, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash,
      location: { artifact: 'members.csv', row: line } }
  })
  return { records, diagnostics: [], artifacts: [{ name: 'members.csv', sha256: artifactHash, size: bytes.length,
    original: { status: 'available', base64: bytes.toString('base64') } }] }
}
