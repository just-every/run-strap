import { body, cell, emptyLine, field, form, h, hidden, owner, panel, person, personSelect, select, table } from './shared'
import { actionChannel } from './booking-rules'
import { when } from './format'
const path='/app/recognition'

function milestoneFields(m?: any) {
  return (m?hidden('id',m.id)+hidden('version',m.version):'')
    + field('threshold','Visit milestone',m?.threshold ?? 50,'number',`required min="1" max="1000000" ${m?'readonly':''}`)
    + field('label','Recognition label',m?.label ?? '50 visits','text','required maxlength="160"')
    + select('enabled','Status',[['true','Enabled'],['false','Paused']],String(m?.enabled ?? true))
}
export function recognitionPage(s: any,notice: any={}) {
  const r=s.recognition,me=r.preferences.find((p: any)=>p.personId===s.actor.personId)
  if(!owner(s)) {
    const progress=r.progress.find((p: any)=>p.personId===s.actor.personId)
    return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Visit recognition</h1><p>Your choice controls private milestone follow-up.</p></div>`
      + panel('My choice',body(`<p>When you opt in, the studio owner can receive a private task when your recorded attendance reaches a milestone. Nothing is shared publicly and no email, reward or congratulations is sent automatically. Your current recorded visits count toward milestones.</p><p>Opting out suppresses outstanding tasks immediately. Opting in again, changing a milestone label, or correcting attendance never issues the same milestone twice.</p><p class="meta">Recorded attended visits: ${h(progress?.count ?? 0)} · ${me?.optedIn?'Opted in':'Not opted in'}</p>`
      + form('recognition.preference.save',path,hidden('version',me?.version ?? 0)+select('optedIn','Private visit recognition',[['false','Do not create milestone tasks'],['true','Allow private milestone tasks']],String(me?.optedIn ?? false)),'Save recognition choice')))
      + panel('Studio milestones',body(r.milestones.filter((m: any)=>m.enabled).map((m: any)=>`<p>${h(m.label)} · ${h(m.threshold)} attended visits</p>`).join('')||emptyLine('No milestones configured.')))
      + panel('My choice history',body((me?.history ?? []).map((e: any)=>`<p class="meta">${when(s,e.at)} · ${e.optedIn?'Opted in':'Opted out'} · member account</p>`).join('')||emptyLine('No recognition choice saved.')))+'</div></div>'
  }
  const taskRows=r.recognitions.map((t: any)=>`<tr data-recognition-id="${h(t.id)}">`
    + cell('Member',`<a href="/app/people?person=${encodeURIComponent(t.personId)}#person">${h(person(s,t.personId))}</a>`)
    + cell('Milestone',`${h(t.label)} · ${h(t.threshold)} visits<small>${when(s,t.createdAt)} · rule version ${h(t.ruleVersion)}</small>`)
    + cell('Task',`${h(t.status)}${t.suppressionReason?`<small>${h(t.suppressionReason.replace(/_/g,' '))}</small>`:''}${t.status==='open'?form('recognition.complete',path,hidden('id',t.id)+hidden('version',t.version)+hidden('requestId',crypto.randomUUID()),'Complete private follow-up','quiet','small'):''}`)
    + cell('Attendance sources',`<details><summary>${h(t.sourceBookingIds.length)} attended bookings</summary><ul>${t.sourceBookingIds.map((id: string)=>{const b=s.bookings.find((b: any)=>b.id===id);return `<li><a href="/app?class=${encodeURIComponent(b?.classId ?? '')}#roster">${h(s.classes.find((c: any)=>c.id===b?.classId)?.title ?? id)}</a></li>`}).join('')}</ul></details>`)+'</tr>').join('')
  const launch=notice.result?.preferenceDoor ? notice.result : null
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Visit recognition</h1><p>Private owner follow-up from recorded attendance and the member’s own choice.</p></div>`
    + (launch?panel('Member action required',body(`<p>This sign-in door grants no access and changes no choice. Ask the member to open it on their own device and sign in as themselves.</p><a href="${h(launch.url)}">Member recognition sign-in</a>`)):'')
    + panel('Private milestone tasks',`<div class="panel-body"><p>No public sharing, messages or rewards are sent by these tasks.</p>${form('recognition.process',path,'','Refresh milestone tasks','quiet')}</div><div class="table-wrap">${table(['Member','Milestone','Task','Attendance sources'],taskRows||'<tr><td colspan="4">No milestone tasks.</td></tr>')}</div>`)
    + panel('Milestone rules',body(r.milestones.map((m: any)=>`<details><summary>${h(m.label)} · ${h(m.threshold)} visits · ${m.enabled?'Enabled':'Paused'}</summary>${form('recognition.milestone.save',path,milestoneFields(m),'Update milestone','quiet')}</details>`).join('')||emptyLine('No milestones configured.')))
    + '</div><aside class="rail">'+panel('Add a milestone',body(form('recognition.milestone.save',path,milestoneFields(),'Add milestone')))
    + panel('Member-owned choice',body(`<p>Only the member can opt in from their signed-in account. Staff can open the ordinary sign-in door for them; doing so is audited.</p>${form('recognition.launch',path,personSelect(s)+hidden('requestId',crypto.randomUUID())+actionChannel(),'Open member preferences door','quiet')}`))+'</aside></div>'
}
