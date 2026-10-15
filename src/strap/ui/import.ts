import { empty, entry, exact, form, h, hidden, panel, result, rows, status, textarea } from './shared'

function preview(notice: any) {
 const data = result(notice)
 if (!data?.fingerprint || !Array.isArray(data.members) || !Array.isArray(data.conflicts)) return ''
 const { csv, ...review } = data
 return panel('Review exact import preview', `<p>Review every member row, diagnostic and conflict below. The fingerprint binds this preview to the exact source and destination state.</p>${exact(review)}${data.conflicts.length ? '<p>Resolve the listed conflicts before importing. Existing members and erased identities require review.</p>' : form('import.apply', '/app/import', hidden('csv', csv) + hidden('fingerprint', data.fingerprint) + '<label><input type="checkbox" required>I reviewed these exact member rows and approve this import.</label>', 'Apply this exact preview')}`)
}

export function movein(s: any, notice: any) {
 const data = result(notice)
 const journal = data?.job ? panel('Import result and journal', exact(data)) : ''
 const jobs = rows(s, 'importJobs').map(j => {
  const controls = form('import.journal', '/app/import', hidden('jobId', j.id), 'View journal, original source and undo report')
   + (['queued', 'applying', 'failed', 'undoing', 'rolling_back'].includes(j.state) ? form('import.resume', '/app/import', hidden('jobId', j.id), 'Resume import operation') : '')
   + (j.state === 'completed' ? form('import.undo', '/app/import', hidden('jobId', j.id) + '<label><input type="checkbox" required>I reviewed the journal and approve undoing this completed import.</label>', 'Undo completed import') : '')
   + (['queued', 'applying', 'failed'].includes(j.state) ? form('import.rollback', '/app/import', hidden('jobId', j.id) + '<label><input type="checkbox" required>I reviewed the journal and approve rolling back this unfinished import.</label>', 'Roll back unfinished import') : '')
  return entry(`Import ${j.id}`, `${status(j.state)}<p>Checkpoint: ${h(j.checkpoint)} of ${h(j.total)}</p>${exact(j)}<div class="actions">${controls}</div>`)
 }).join('')
 return `<h1>Import members</h1><p>Move members from a Mindbody CSV through a preview and an approved import. Imported people start inactive; review and activate them in People before inviting them.</p>${preview(notice)}${journal}<div class="grid">${panel('Preview a CSV', `<p>Use these exact column headers: <code>MemberId,FirstName,LastName,Email</code>. Paste 1–1000 member rows, up to 1,000,000 UTF-8 bytes. Quoted CSV fields are supported.</p>${form('import.preview', '/app/import', textarea('csv', 'Mindbody member CSV', '', 'required spellcheck="false"'), 'Preview members')}`)}${panel('Import jobs', jobs || empty('No imports yet. Preview your member CSV to begin.'))}</div>`
}
