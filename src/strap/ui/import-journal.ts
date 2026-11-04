import { body, cell, h, panel, result, table, textarea } from './shared'

const states: Record<string, string> = { completed: 'Imported', applying: 'Importing', queued: 'Waiting to import', failed: 'Stopped', undone: 'Undone', rolled_back: 'Rolled back', undoing: 'Undoing', rolling_back: 'Rolling back' }
const reasons: Record<string, string> = {
  unchanged: 'Unchanged imported record removed',
  edited: 'Later edits preserved',
  dependency: 'Related studio work preserved',
  superseded: 'Later import preserved',
}

/** Kit retains and authorizes the bytes; Strap presents the UTF-8 member CSV. */
export function importJournal(notice: any) {
  const data = result(notice)
  if (!data?.job) return ''
  const job = data.job, originals = Array.isArray(data.originals) ? data.originals : []
  const facts = `<dl class="facts"><dt>State</dt><dd>${h(states[job.state] ?? job.state)}</dd><dt>Rows</dt><dd>${h(job.checkpoint)} of ${h(job.total)} applied</dd>${Array.isArray(data.batches) ? `<dt>Steps</dt><dd>${data.batches.length} recorded</dd>` : ''}</dl>`
  const sources = originals.map((o: any, i: number) => {
    const name = o.name ?? 'members.csv'
    const source = o.original?.status === 'retained'
      ? textarea(`originalCsv${i}`, `Original CSV · ${name}`, new TextDecoder('utf-8', { ignoreBOM: true }).decode(Uint8Array.from(atob(o.original.base64), c => c.charCodeAt(0))), 'readonly rows="10" spellcheck="false" class="mono"')
      : `<p>Original source unavailable: ${h(o.original?.reason ?? o.original?.status ?? 'not retained')}.</p>`
    return `<h3>${h(name)}</h3><p class="meta">${h(o.size)} UTF-8 bytes · retained original source. Select and copy the CSV below; this view does not edit it.</p>${source}`
  }).join('')
  const undo = data.undo
  const report = undo ? `<h3>Undo report</h3><p>${undo.outcome === 'pending' ? 'Reversal has not finished.' : undo.outcome === 'compensated' ? 'Reversal finished with records preserved.' : 'Reversal finished.'} Untouched imported members are removed; later edits and related work are preserved. The original CSV and journal stay retained.</p>`
    + (undo.dispositions?.length ? `<div class="table-wrap">${table(['Member / source ID', 'Outcome', 'Reason'], undo.dispositions.map((d: any) => `<tr>${cell('Member / source ID', h(d.expected?.ownedValue?.name ?? d.targetId))}${cell('Outcome', d.disposition === 'retained' ? 'Preserved' : 'Reversed')}${cell('Reason', h(reasons[d.reason] ?? d.reason))}</tr>`).join(''))}</div>` : '<p class="meta">No reversal rows recorded yet.</p>') : ''
  return panel('Import journal', body(facts + sources + report), { icon: 'report', id: 'import-journal' })
}
