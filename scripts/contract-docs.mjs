#!/usr/bin/env node
// Preserve Strap's existing clause IDs and acceptance while deriving its views.
import fs from 'node:fs'
import { parseContract } from '../src/base/seed-contract.mjs'

const source = fs.readFileSync('CONTRACT.md','utf8')
const lines = source.split('\n')
const start = lines.findIndex(line => line.startsWith('| Clauses | Done |'))
if (start < 0) throw Error('Contract Status summary is missing')
let end = start + 2
while (lines[end]?.startsWith('|')) end++
const without = [...lines]; without.splice(start,end-start)
const contract = parseContract(without.join('\n'))
const tally = selected => [selected.filter(c => c.status === 'done').length,selected.filter(c => c.status === 'partial').length,selected.filter(c => c.status === 'missing').length,selected.length]
lines.splice(start+2,end-start-2,
  '| Published | '+tally(contract.clauses.filter(c => c.kind === 'published')).join(' | ')+' |',
  '| Target and push further | '+tally(contract.clauses.filter(c => c.kind !== 'published')).join(' | ')+' |',
  '| All | '+tally(contract.clauses).join(' | ')+' |')
const updated = lines.join('\n')
const parsed = parseContract(updated)
const marker = '<!-- Generated from CONTRACT.md by scripts/contract-docs.mjs. Edit CONTRACT.md, then regenerate. -->'
const acceptance = [marker,'# First release and target acceptance',
  'CONTRACT.md is authoritative. This generated view preserves every clause and its complete requirement and acceptance text.',
  `Judged from the code and tests at commit \`${parsed.commit}\` (${parsed.date}).`,
  '| Done | Partial | Missing | Total |\n| ---: | ---: | ---: | ---: |\n| '+tally(parsed.clauses).join(' | ')+' |']
let area
for (const clause of [...parsed.clauses].sort((a,b) => a.line-b.line)) {
  if (clause.area !== area) {area=clause.area;acceptance.push('## '+area)}
  const cells = updated.split('\n')[clause.row-1].split(/(?<!\\)\|/).slice(1,-1).map(cell => cell.trim())
  acceptance.push(`- **${clause.id} — ${clause.title}.** **Status:** ${clause.status}. ${clause.text} **Current evidence:** ${cells[4] || 'None.'}${cells[5] ? ' **Remaining gap:** '+cells[5] : ''}`)
}
const outputs = {
  'CONTRACT.md':updated,
  'ACCEPTANCE.md':acceptance.join('\n\n')+'\n',
  'docs/CLAIMS.md':marker+'\n\n# Strap homepage claims\n\nNo homepage claims are mapped in CONTRACT.md. Capability statuses and evidence are recorded in ACCEPTANCE.md.\n'
}
const command=process.argv[2]
if (!['write','check'].includes(command)) throw Error('Use write or check')
const changed=Object.entries(outputs).filter(([file,text]) => !fs.existsSync(file) || fs.readFileSync(file,'utf8') !== text)
if (command === 'check' && changed.length) throw Error(changed.map(([file]) => file+': generated content differs').join('\n'))
if (command === 'write') for (const [file,text] of changed) fs.writeFileSync(file,text)
console.log(command === 'check' ? 'Contract documents are current.' : `Updated ${changed.length} contract documents.`)
