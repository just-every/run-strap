import { body, cell, field, form, h, hidden, panel, person, select, table, textarea } from './shared'
import { when } from './format'
const path='/app/leads'
const labels: Record<string,string>={inquiry:'Inquiry','intro-booked':'Intro booked','first-visit':'First visit',offer:'Offer',membership:'Membership',lost:'Lost'}
const stages=Object.entries(labels)
const request=()=>hidden('requestId',crypto.randomUUID())
const localUTC=(at: string|null)=>at?.slice(0,16) ?? ''
function taskFields(s: any,lead?: any) {
  return select('ownerId','Assigned owner',s.leadOwners.map((o: any)=>[o.id,o.name]),lead?.ownerId ?? s.actor.id)
    + field('nextAction','Next action',lead?.nextAction ?? 'Call about a first class','text','maxlength="300"')
    + field('dueAt','Due at (UTC)',localUTC(lead?.dueAt),'datetime-local')
}
export function leadsPage(s: any,query: URLSearchParams) {
  const r=s.pipeline,selected=r.leads.find((l: any)=>l.id===query.get('lead'))
  const stage=query.get('stage') ?? '',onlyOverdue=query.get('overdue')==='true'
  const visible=r.leads.filter((l: any)=>(!stage||l.stage===stage)&&(!onlyOverdue||l.overdue))
  const list=visible.map((l: any)=>`<tr data-lead-id="${h(l.id)}">`
    +cell('Person',`<a href="${path}?lead=${encodeURIComponent(l.id)}#lead">${h(person(s,l.personId))}</a>`)
    +cell('Stage',h(labels[l.stage]))+cell('Assigned owner',h(s.leadOwners.find((o: any)=>o.id===l.ownerId)?.name ?? 'Inactive owner'))
    +cell('Next action',`${h(l.nextAction ?? 'Closed')}${l.dueAt?`<small>${when(s,l.dueAt)}${l.overdue?' · Overdue':''}</small>`:''}`)+'</tr>').join('')
  const report=r.stages.map((row: any)=>`<tr>${cell('Stage',`<a href="${path}?stage=${h(row.stage)}">${h(labels[row.stage])}</a>`)}${cell('Leads',h(row.count))}${cell('Overdue',h(row.overdue))}</tr>`).join('')
  let detail=''
  if(selected) {
    const l=selected,back=path+'?lead='+encodeURIComponent(l.id)+'#lead'
    const bookings=s.bookings.filter((b: any)=>b.personId===l.personId)
    const history=r.events.filter((e: any)=>e.leadId===l.id).map((e: any)=>`<li>${when(s,e.at)} · ${h(e.actorId)} · ${h(e.command)}${e.after?.stage?` · ${h(labels[e.after.stage])}`:''}${e.note?`<p>${h(e.note)}</p>`:''}<details><summary>Recorded change</summary><p>From ${h(labels[e.before?.stage] ?? 'New inquiry')} to ${h(labels[e.after.stage])}. Next action: ${h(e.after.nextAction ?? 'Closed')}${e.after.dueAt?` · ${when(s,e.after.dueAt)}`:''}. Assigned owner: ${h(s.leadOwners.find((o: any)=>o.id===e.after.ownerId)?.name ?? 'Inactive owner')}.</p></details></li>`).join('')
    detail=panel(person(s,l.personId),body(`<p>Stage: ${h(labels[l.stage])}${l.lostReason?` · Lost reason: ${h(l.lostReason)}`:''}${l.externalMembershipReference?` · Owner-recorded external membership: ${h(l.externalMembershipReference)}`:''}</p>`
      +form('lead.update',back,hidden('id',l.id)+hidden('version',l.version)+request()+select('stage','Pipeline stage',stages,l.stage)+taskFields(s,l)
        +select('bookingId','Intro or attended booking',[['','No booking'],...bookings.map((b: any)=>[b.id,(s.classes.find((c: any)=>c.id===b.classId)?.title ?? b.classId)+' · '+(b.attendance ?? b.status)])],l.bookingId ?? '','')
        +field('externalMembershipReference','External membership reference',l.externalMembershipReference ?? '')+field('lostReason','Lost reason',l.lostReason ?? '')+textarea('note','Change note','','maxlength="2000"'),'Save follow-up')
      +'<p>Membership records an external outcome with your reference and note. It creates no plan, charge, payment authorization or message.</p>'
      +form('lead.note',back,hidden('id',l.id)+hidden('version',l.version)+request()+textarea('note','Conversation note','','required maxlength="2000"'),'Record conversation','quiet')
      +`<ol>${history}</ol>`),{id:'lead'})
  }
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Lead follow-up</h1><p>Assigned next actions and a retained history from inquiry to membership.</p></div>`
    +panel('Staff queue',body(`<form method="get" action="${path}" class="form">${select('stage','Filter stage',[['','All stages'],...stages],stage,'')}${select('overdue','Due filter',[['false','All leads'],['true','Overdue only']],String(onlyOverdue))}<button class="btn-quiet">Filter follow-up</button></form><p><a href="${path}?overdue=true">${h(r.overdue.length)} overdue follow-ups</a></p>`)+`<div class="table-wrap">${table(['Person','Stage','Assigned owner','Next action'],list||'<tr><td colspan="4">No leads in this view.</td></tr>')}</div>`)
    +detail+panel('Stage report',`<div class="table-wrap">${table(['Stage','Leads','Overdue'],report)}</div>`)
    +'</div><aside class="rail">'+panel('Record an inquiry',body(form('lead.create',path,request()+select('personId','Person',[['','Choose a person'],...s.people.filter((p: any)=>p.role==='member').map((p: any)=>[p.id,p.name])])+taskFields(s)+textarea('note','Inquiry note','','maxlength="2000"'),'Add inquiry')))
    +panel('Recorded conversations',body('<p>Record calls, emails or conversations that actually happened. Saving a note does not send a message. The studio owner manages this queue until staff roles ship.</p>'))+'</aside></div>'
}
