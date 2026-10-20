import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'

// An independent RFC 4180 reader; it knows nothing about the app's exporter.
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (c === ',' && !quoted) { row.push(cell); cell = '' }
    else if (c === '\r' && text[i + 1] === '\n' && !quoted) { row.push(cell); rows.push(row); row = []; cell = ''; i++ }
    else cell += c
  }
  assert.equal(quoted, false)
  assert.equal(cell, '')
  return rows
}

export function reconstructExit(bundle, expectedCsv) {
  const receiver = new DatabaseSync(':memory:')
  try {
    for (const table of bundle.manifest.schema) {
      const [columns, ...cells] = parseCsv(bundle.csv[table.name + '.csv'])
      assert.deepEqual(columns, table.columns)
      const rows = cells.map(values => Object.fromEntries(columns.map((column, i) => [column, JSON.parse(values[i])])))
      assert.deepEqual(rows, bundle.tables[table.name], table.name + ' CSV and JSON reconstruct the same values')
      assert.equal(rows.length, table.rows)
      receiver.exec(`CREATE TABLE "${table.name}" (${columns.map(c => `"${c}"`).join(',')})`)
      const put = receiver.prepare(`INSERT INTO "${table.name}" VALUES (${columns.map(() => '?').join(',')})`)
      for (const row of rows) put.run(...columns.map(column => {
        const value = row[column]
        return value && typeof value === 'object' && value.encoding === 'hex' ? (value.storageType === 'text' ? Buffer.from(value.hex, 'hex').toString() : Buffer.from(value.hex, 'hex')) : value
      }))
      assert.equal(receiver.prepare(`SELECT count(*) AS n FROM "${table.name}"`).get().n, rows.length)
    }
    const people = new Map(bundle.tables.st_people.map(p => [p.id, p]))
    const records = bundle.tables.st_records.map(r => JSON.parse(r.data)), byId = new Map(records.map(r => [r.id, r]))
    for (const record of records) {
      for (const key of ['personId','instructorId']) if (record[key]) assert.ok(people.has(record[key]), key + ' resolves')
      for (const key of ['classId','packId','bookingId','draftId','waiverId','seriesId','seriesChangeId','closureId']) if (record[key]) assert.ok(byId.has(record[key]), key + ' resolves')
      for (const key of ['classIds','closureIds']) for (const id of record[key] ?? []) assert.ok(byId.has(id),key + ' resolves')
    }
    const money = kind => records.filter(r => bundle.tables.st_records.find(row => row.id === r.id).kind === kind).reduce((sum, r) => sum + r.amountCents, 0)
    assert.equal(money('charge'), 10000); assert.equal(money('payment'), 5000)
    const creditHistory = records.filter(r => bundle.tables.st_records.find(row => row.id === r.id).kind === 'packCreditEvent').reduce((sum,r) => sum+r.credits,0)
    assert.equal(creditHistory,3,'five purchased credits less the ordinary and recurring reservations')
    assert.equal(records.filter(r => bundle.tables.st_records.find(row => row.id === r.id).kind === 'pack').reduce((sum,r) => sum+r.remaining,0),creditHistory)
    assert.ok(records.some(r => r.text === 'Studio waiver, "current"\nKeep your own limits.'))
    assert.ok(records.some(r => r.waiverId && byId.get(r.waiverId).text.includes('Keep your own limits.')))
    const original = bundle.tables.ik_originals.find(o => o.name.endsWith('.csv'))
    assert.ok(original, 'source original has retained file metadata')
    const version = bundle.tables.ik_original_sets.find(s => s.job_id === original.job_id).version
    const chunks = bundle.tables.ik_d1_original_chunks.filter(c => c.job_id === original.job_id && c.kind === original.kind && c.original_key === original.original_key).sort((a,b) => a.ordinal - b.ordinal)
    const bytes = chunks.length ? (version === 3 ? Buffer.from(chunks.map(c => Buffer.from(c.bytes.hex, 'hex').toString()).join(''), 'base64') : Buffer.concat(chunks.map(c => Buffer.from(c.bytes.hex, 'hex')))) : Buffer.from(original.bytes.hex, 'hex')
    assert.equal(bytes.toString(), expectedCsv)
    assert.equal(bytes.length, original.size)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), original.sha256)
    assert.ok(bundle.tables.ik_provenance.every(p => people.has(p.target_id)))
    assert.equal(bundle.manifest.documents.signedWaivers.status, 'not_implemented')
    assert.deepEqual(bundle.manifest.documents.media.files, [])
    assert.deepEqual(bundle.manifest.providers.connections, [])
  } finally { receiver.close() }
}
