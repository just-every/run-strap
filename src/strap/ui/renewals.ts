import { automationHistory } from './automation';
import type { renewalWorklist } from '../domain/renewals'
import { money, when } from './format'
import { body, cell, field, form, h, hidden, panel, select, table, textarea } from './shared'

const path = '/app/renewals'
type Report = ReturnType<typeof renewalWorklist>

/** Uses the same authoritative report and filters as the JSON and CSV doors. */
export function renewalsPage(s: any, query: URLSearchParams) {
  const report: Report = s.renewalWorklist
  const filters = new URLSearchParams({days:String(report.days),lowCredits:String(report.lowCredits)})
  const back = path+'?'+filters
  const selected = report.rows.find(row => row.packId === query.get('pack'))
  const rows = report.rows.map(row => `<tr data-pack-id="${h(row.packId)}">`
    + cell('Member / plan',`<a href="/app/people?person=${encodeURIComponent(row.personId)}#person">${h(row.member)}</a><small>${h(row.plan)} · ${h(row.kind)}</small>${row.reasonCode ? `<small>Termination code: ${h(row.reasonLabel ?? row.reasonCode)} (${h(row.reasonCode)})</small>` : ''}`)
    + cell('Expires',`${when(s,row.expiresAt)}<small>${row.reasons.map(reason => reason === 'expiring' ? 'Expiring' : reason === 'freeze-ending' ? 'Freeze ending' : 'Low credits').join(' · ')}</small>`)
    + cell('Remaining',`${row.remainingCredits === null ? 'No credit limit' : h(row.remainingCredits)+' credits'}<small>${row.remainingValueCents === null ? 'Prepaid value needs receipt allocation' : money(row.remainingValueCents)+' unused prepaid access'}</small>`)
    + cell('Last visit',row.lastVisit ? when(s,row.lastVisit) : 'No recorded visit')
    + cell('Renewal / contact',`${h(row.renewalStatus)}<small>${h(Object.entries(row.contactPermission).map(([channel,status]) => channel+': '+status).join(' · '))}</small>`)
    + cell('Follow-up',row.followup
      ? `<a href="/app/leads?lead=${encodeURIComponent(row.followup.leadId)}#lead">${h(s.leadOwners.find((owner: any) => owner.id === row.followup!.ownerId)?.name ?? 'Inactive owner')} · ${h(row.followup.stage)}</a><small>${h(row.followup.nextAction ?? 'Closed')}</small>${row.followup.dueAt ? `<small>${when(s,row.followup.dueAt)}</small>` : ''}`
      : `<a href="${h(back)}&amp;pack=${encodeURIComponent(row.packId)}#renewal-task">Assign follow-up</a>`)
    + cell('Approved sequence',sequenceEnrollment(s,row,back))
    + '</tr>').join('')
  const task = selected && !selected.followup ? panel('Assign renewal follow-up',body(`<p>${h(selected.member)} · ${h(selected.plan)} · ${h(selected.remainingCredits)} credits</p>`
    + form('renewal.followup.create',back+'&pack='+encodeURIComponent(selected.packId)+'#renewal-task',hidden('packId',selected.packId)+hidden('basis',selected.basis)+hidden('days',report.days)+hidden('lowCredits',report.lowCredits)
      + select('ownerId','Assigned owner',s.leadOwners.map((owner: any) => [owner.id,owner.name]),s.actor.id)
      + field('nextAction','Next action','Review renewal options internally','text','required maxlength="500"')
      + field('dueAt','Due at (UTC)','','datetime-local','required'),'Create assigned follow-up')
    + '<p>This creates an internal task only. It sends no message and grants no contact permission.</p>'),{id:'renewal-task'}) : ''
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Renewal worklist</h1><p>Upcoming plan endings, freeze resumptions and low credits.</p></div>`
    + panel('Worklist filters',body(`<form class="form" method="get" action="${path}"><div class="row2">`
      + field('days','Next days',report.days,'number','required min="1" max="366" step="1"')
      + field('lowCredits','Low-credit threshold',report.lowCredits,'number','required min="0" max="10000" step="1"')
      + `</div><button class="btn" type="submit">Apply worklist filters</button></form><p><a href="/api/strap/reports/renewals.csv?${h(filters.toString())}">Download worklist CSV</a> · <a href="/api/strap/reports/renewals.xlsx?${h(filters.toString())}">Download worklist XLSX</a></p>`
      + `<p>Expiring after ${when(s,report.asOf)} through ${when(s,report.through)}, or currently at or below ${h(report.lowCredits)} credits. Expired and renewed packs are excluded.</p>`))
    + task + panel('Plans needing review',`<div class="table-wrap">${table(['Member / plan','Expires','Remaining','Last visit','Renewal / contact','Follow-up','Approved sequence'],rows || '<tr><td colspan="7">No packs match these filters.</td></tr>')}</div>`)
    + automationHistory(s,'renewal',back)
    + sequencesPanel(s,back)
    + panel('Coverage',body(`<p>${h(report.coverage)}</p><p>Accepted renewals leave this list without claiming payment collection. Existing follow-ups remain in <a href="/app/leads">Lead follow-up</a>. Native renewal sequences need an exact owner approval and per-row enrollment. Queue review is explicit; SMS and email remain held without a provider transport. Provider autopay is not available. Remaining value comes from recorded prepaid receipt allocations, with the same elapsed-access calculation as cancellation previews; it does not imply marketing permission.</p>`))
    + '</div></div>'
}

function sequencesPanel(s:any,back:string) {
  const preview=(s.renewalSequencePreviews ?? []).at(-1);
  const review=preview?.status === 'preview' ? `<article data-sequence-preview="${h(preview.id)}"><h3>${h(preview.name)} · ${h(preview.channel)}</h3><p>${h(preview.text)}</p><p>${preview.audience.filter((r:any) => !r.permission).length} currently permitted rows of ${preview.audience.length}; maximum ${preview.maxMessages} enrollments. Changed facts require a new preview.</p>${form('renewal.sequence.approve',back,hidden('id',preview.id)+hidden('key',preview.key),'Approve this exact sequence')}</article>` : '';
  const rules=(s.renewalSequences ?? []).map((r:any) => `<article><h3>${h(r.name)} · ${h(r.channel)} · ${r.enabled?'Enabled':'Paused'}</h3><p>${h(r.text)}</p>${form('renewal.sequence.set',back,hidden('id',r.id)+hidden('enabled',String(!r.enabled)),r.enabled?'Pause sequence':'Resume sequence','quiet')}</article>`).join('');
  const queue=(s.marketingMessages ?? []).map((m:any) => `<li data-queued-message="${h(m.id)}">${h(s.people.find((p:any)=>p.id===m.personId)?.name ?? 'Member')} · ${h(m.channel)} · ${h(m.status)}${m.holdReason?' · '+h(m.holdReason):''}${m.suppressionReason?' · '+h(m.suppressionReason):''}</li>`).join('');
  return panel('Approved renewal sequences',body('<p>Marketing permission is required independently for each channel. Reviewing the queue may record a native in-app message once. Email and SMS are held as provider delivery unavailable, and SMS also waits out the member’s quiet hours. Nothing is sent automatically.</p>'
    + form('renewal.sequence.prepare',back,field('name','Sequence name','','text','required maxlength="100"')+select('channel','Marketing channel',[['inApp','In-app'],['email','Email (held)'],['sms','SMS (held)']])+textarea('text','Renewal message','','required maxlength="2000"')+field('maxMessages','Maximum enrollments',10,'number','required min="1" max="1000"'),'Preview renewal sequence')
    + review+rules+'<h3>Queue outcomes</h3><ul>'+queue+'</ul>'+form('renewal.queue.review',back,'','Review queue now','quiet')));
}

function sequenceEnrollment(s:any,row:any,back:string) {
  const current=row.sequenceEnrollments.map((e:any) => h(e.channel)+': '+h(e.status)).join('<br>');
  const available=(s.renewalSequences ?? []).filter((r:any) => r.enabled && !row.sequenceEnrollments.some((e:any) => e.sequenceId === r.id));
  return current+(available.length?form('renewal.sequence.enroll',back,hidden('packId',row.packId)+hidden('basis',row.basis)+select('sequenceId','Approved renewal sequence',available.map((r:any) => [r.id,r.name+' · '+r.channel])),'Enroll once'):current?'':'No approved sequence');
}
