// Import members: a Mindbody CSV previewed as the member rows it would add, an
// approved import, and each import's journal, undo and roll back.
import { body, cell, emptyLine, form, h, hidden, panel, result, rows, statusPill, table, textarea } from './shared'

const reasons: Record<string, string> = { erased_identity: 'This person’s data was erased; they cannot be imported again', existing_member_requires_review: 'Already in Strap: review before importing', existing_access_requires_review: 'Already has sign-in access: review before importing' }
const stateText: Record<string, string> = { completed: 'Imported', applying: 'Importing', queued: 'Waiting to import', failed: 'Stopped', undone: 'Undone', rolled_back: 'Rolled back', undoing: 'Undoing', rolling_back: 'Rolling back' }

function preview(notice: any) {
  const data = result(notice)
  if (!data?.fingerprint || !Array.isArray(data.members) || !Array.isArray(data.conflicts)) return ''
  const conflict = new Map<string, string>(data.conflicts.map((c: any) => [c.memberId, c.reason]))
  const members = `<div class="table-wrap">${table(['Mindbody ID', 'Name', 'Email', 'Review'], data.members.map((m: any) => `<tr>${cell('Mindbody ID', h(m.id))}${cell('Name', `<strong>${h(m.name)}</strong>`)}${cell('Email', h(m.email))}${cell('Review', conflict.has(m.id) ? `<span class="chip pending">${h(reasons[conflict.get(m.id)!] ?? conflict.get(m.id))}</span>` : '<span class="chip">New member</span>')}</tr>`).join(''))}</div>`
  const notes = (data.diagnostics ?? []).map((d: any) => `<p class="meta">${h(d.message)}</p>`).join('')
  const apply = data.conflicts.length ? '<p class="notice">Resolve the rows marked for review before importing.</p>' : form('import.apply', '/app/import', hidden('csv', data.csv) + hidden('fingerprint', data.fingerprint) + `<label class="check"><input type="checkbox" required>I reviewed these ${data.members.length} member rows and approve this import.</label>`, 'Import these members')
  return panel('Review the import', `<div class="panel-body"><p>${data.members.length} member rows from ${h(data.format)}. Imported people start inactive; activate each in People before inviting them.</p>${notes}</div>${members}${body(apply)}`, { icon: 'upload', id: 'review' })
}

function journal(notice: any) {
  const data = result(notice)
  if (!data?.job) return ''
  const job = data.job, originals = Array.isArray(data.originals) ? data.originals : []
  const facts = `<dl class="facts"><dt>State</dt><dd>${h(stateText[job.state] ?? job.state)}</dd><dt>Rows</dt><dd>${h(job.checkpoint)} of ${h(job.total)} applied</dd>${originals.length ? `<dt>Original file</dt><dd>${originals.map((o: any) => `${h(o.name ?? o.artifact ?? 'members.csv')}${o.size ? ` (${Number(o.size).toLocaleString('en-US')} bytes)` : ''}`).join(', ')}, kept for undo</dd>` : ''}${Array.isArray(data.batches) ? `<dt>Steps</dt><dd>${data.batches.length} recorded</dd>` : ''}${data.undo?.entries ? `<dt>Undo report</dt><dd>${data.undo.entries.length} rows checked</dd>` : ''}</dl>`
  return panel('Import journal', body(facts), { icon: 'report' })
}

export function importPage(s: any, notice: any) {
  const jobs = rows(s, 'importJobs')
  const jobRows = jobs.map((j, i) => {
    const controls = form('import.journal', '/app/import', hidden('jobId', j.id), 'View journal', 'quiet', 'small')
      + (['queued', 'applying', 'failed', 'undoing', 'rolling_back'].includes(j.state) ? form('import.resume', '/app/import', hidden('jobId', j.id), 'Resume', 'primary', 'small') : '')
    const undo = j.state === 'completed' ? `<details class="more"><summary>Undo this import</summary><div class="panel-body">${form('import.undo', '/app/import', hidden('jobId', j.id) + '<label class="check"><input type="checkbox" required>I reviewed the journal and approve undoing this completed import.</label>', 'Undo import', 'quiet')}</div></details>` : ''
    const rollback = ['queued', 'applying', 'failed'].includes(j.state) ? `<details class="more"><summary>Roll back this import</summary><div class="panel-body">${form('import.rollback', '/app/import', hidden('jobId', j.id) + '<label class="check"><input type="checkbox" required>I reviewed the journal and approve rolling back this unfinished import.</label>', 'Roll back import', 'quiet')}</div></details>` : ''
    return `<article class="record"><span class="approval-mark"><svg class="icon" aria-hidden="true"><use href="#i-upload"/></svg></span><div><h3>Import ${jobs.length - i}</h3><p>${h(j.checkpoint)} of ${h(j.total)} member rows${j.error ? ` · ${h(String(j.error).replace(/_/g, ' '))}` : ''}</p></div>${statusPill(stateText[j.state] ?? j.state)}<div class="record-body"><div class="actions">${controls}</div>${undo}${rollback}</div></article>`
  }).join('')
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Import</h1><p>From a Mindbody member CSV</p></div>${preview(notice)}${journal(notice)}`
    + panel('Preview a CSV', body(`<p>Use these exact column headers: <code>MemberId,FirstName,LastName,Email</code>. Paste 1 to 1,000 member rows (up to 1 MB). Quoted fields are fine.</p>${form('import.preview', '/app/import', textarea('csv', 'Mindbody member CSV', '', 'required spellcheck="false" class="mono"'), 'Preview members')}`), { icon: 'upload' })
    + `</div><aside class="rail">${panel('Imports', jobRows ? `<div class="records">${jobRows}</div>` : emptyLine('No imports yet. Preview your member CSV to begin.'), { icon: 'report' })}</aside></div>`
}
