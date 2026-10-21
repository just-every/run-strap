import type { renewalWorklist } from '../domain/renewals'
import { when } from './format'
import { body, cell, field, form, h, hidden, panel, select, table } from './shared'

const path = '/app/renewals'
type Report = ReturnType<typeof renewalWorklist>

/** Uses the same authoritative report and filters as the JSON and CSV doors. */
export function renewalsPage(s: any, query: URLSearchParams) {
  const report: Report = s.renewalWorklist
  const filters = new URLSearchParams({days:String(report.days),lowCredits:String(report.lowCredits)})
  const back = path+'?'+filters
  const selected = report.rows.find(row => row.packId === query.get('pack'))
  const rows = report.rows.map(row => `<tr data-pack-id="${h(row.packId)}">`
    + cell('Member / plan',`<a href="/app/people?person=${encodeURIComponent(row.personId)}#person">${h(row.member)}</a><small>${h(row.plan)}</small>`)
    + cell('Expires',`${when(s,row.expiresAt)}<small>${row.reasons.map(reason => reason === 'expiring' ? 'Expiring' : 'Low credits').join(' · ')}</small>`)
    + cell('Remaining',`${h(row.remainingCredits)} credits<small>Monetary value unavailable</small>`)
    + cell('Last visit',row.lastVisit ? when(s,row.lastVisit) : 'No recorded visit')
    + cell('Renewal / contact','No renewal recorded<small>Marketing permission unavailable</small>')
    + cell('Follow-up',row.followup
      ? `<a href="/app/leads?lead=${encodeURIComponent(row.followup.leadId)}#lead">${h(s.leadOwners.find((owner: any) => owner.id === row.followup!.ownerId)?.name ?? 'Inactive owner')} · ${h(row.followup.stage)}</a><small>${h(row.followup.nextAction ?? 'Closed')}</small>${row.followup.dueAt ? `<small>${when(s,row.followup.dueAt)}</small>` : ''}`
      : `<a href="${h(back)}&amp;pack=${encodeURIComponent(row.packId)}#renewal-task">Assign follow-up</a>`)
    + '</tr>').join('')
  const task = selected && !selected.followup ? panel('Assign renewal follow-up',body(`<p>${h(selected.member)} · ${h(selected.plan)} · ${h(selected.remainingCredits)} credits</p>`
    + form('renewal.followup.create',back,hidden('packId',selected.packId)+hidden('basis',selected.basis)+hidden('days',report.days)+hidden('lowCredits',report.lowCredits)
      + select('ownerId','Assigned owner',s.leadOwners.map((owner: any) => [owner.id,owner.name]),s.actor.id)
      + field('nextAction','Next action','Review renewal options internally','text','required maxlength="500"')
      + field('dueAt','Due at (UTC)','','datetime-local','required'),'Create assigned follow-up')
    + '<p>This creates an internal task only. It sends no message and grants no contact permission.</p>'),{id:'renewal-task'}) : ''
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Renewal worklist</h1><p>Finite credit packs needing review.</p></div>`
    + panel('Worklist filters',body(`<form class="form" method="get" action="${path}"><div class="row2">`
      + field('days','Next days',report.days,'number','required min="1" max="366" step="1"')
      + field('lowCredits','Low-credit threshold',report.lowCredits,'number','required min="0" max="10000" step="1"')
      + `</div><button class="btn" type="submit">Apply worklist filters</button></form><p><a href="/api/strap/reports/renewals.csv?${h(filters.toString())}">Download worklist CSV</a></p>`
      + `<p>Expiring after ${when(s,report.asOf)} through ${when(s,report.through)}, or currently at or below ${h(report.lowCredits)} credits. Expired and renewed packs are excluded.</p>`))
    + task + panel('Packs needing review',`<div class="table-wrap">${table(['Member / plan','Expires','Remaining','Last visit','Renewal / contact','Follow-up'],rows || '<tr><td colspan="6">No packs match these filters.</td></tr>')}</div>`)
    + panel('Coverage',body(`<p>${h(report.coverage)}</p><p>Accepted renewals leave this list without claiming payment collection. Existing follow-ups remain in <a href="/app/leads">Lead follow-up</a>. Fixed-term memberships, canceling auto-renewals, scheduled terminations, freezes, intro offers and approved renewal sequences are not available.</p>`))
    + '</div></div>'
}
