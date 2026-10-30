import { clientAppointmentsPanel } from './client-appointments'
import { billingStaffControls } from './billing';
import { freezesPanel } from './freezes';
import { staffDeskPanel } from './staff-desk';
import { waiverLaunch } from './staff-actions'
import { attendancePlanControls } from './attendance-plan'
import { appointmentsPanel } from './appointments'
import { intakeAnswersPanel } from './intake'
import { preferencesPanel } from './preferences';
import { body, cell, field, form, h, hidden, panel, select, table, textarea } from './shared';
import { money, when } from './format';
import { actionChannel } from './booking-rules';
const reference=(value:unknown) => h(value).replace(/([a-zA-Z0-9]{16})/g,'$1<wbr>');
const identity = () => hidden('requestId',crypto.randomUUID())+actionChannel();
const summary = (s:any,event:any) => {
  const r=event.record;
  if(event.kind === 'charge' || event.kind === 'payment') return money(r.amountCents)+' · '+(r.reference ?? r.reason ?? event.kind);
  if(event.kind === 'booking') return [r.status,r.attendance ?? '',s.classes.find((c:any) => c.id === r.classId)?.title ?? 'Class'].filter(Boolean).join(' · ');
  if(event.kind === 'memberMessage') return (r.staffMade ? 'Studio staff' : 'Member')+': '+r.text;
  if(event.kind === 'pack') return (r.entitlement?.name ?? 'Class credits')+' · '+r.remaining+' credits remaining';
  if(event.kind === 'memberInvitation') return 'Account invitation · '+r.status;
  return r.command ?? r.action ?? r.type ?? r.status ?? event.kind;
};
export function memberHistoryPanel(s:any,p:any,back:string) {
  const history=s.memberRecords?.find((r:any) => r.personId === p.id);if(!history)return '';
  const events=history.timeline.map((e:any) => `<li data-member-event="${h(e.id)}"><p>${h(e.kind)} · ${when(s,e.at || new Date(0).toISOString())}</p><p>${h(summary(s,e))}</p><small>Source member ${reference(e.personId)} · record ${reference(e.id)}</small></li>`).join('');
  const ledger=history.ledger.map((r:any) => `<tr>${cell('Entry',h(r.kind))}${cell('Amount',money(r.amountCents))}${cell('Source',reference(r.personId)+'<br>'+reference(r.id))}</tr>`).join('');
  const owner=s.actor.role === 'owner';
  const notes=owner?`<details><summary>Restricted notes and check-in alerts</summary>${history.notes.map((n:any) => `<p>${h(n.text)}${n.alert?' · Owner check-in alert':''} · ${when(s,n.at)}</p>`).join('')}${form('member.note.add',back,hidden('personId',p.id)+identity()+textarea('text','Restricted note','','required maxlength="2000"')+select('alert','Show at owner check-in',[['false','No'],['true','Yes']]),'Add restricted note')}</details>`:'';
  const preview=s.memberMergePreviews?.filter((m:any) => m.targetId === p.id && m.status === 'preview').at(-1);
  const merges=owner?`<details><summary>Review a duplicate identity</summary><p>Only history is linked. Original identities, waivers, credits, money and consent remain separate. Confirmation retires the source sign-in. No consent or funds transfer is implied.</p>${form('member.merge.prepare',back,hidden('targetId',p.id)+identity()+select('sourceId','Duplicate source',s.people.filter((m:any) => m.role === 'member' && m.id !== p.id).map((m:any) => [m.id,m.name+' · '+m.email]))+textarea('reason','Reason for linking these identities','','required maxlength="500"'),'Review duplicate merge')}${preview?`<article data-merge-preview="${h(preview.id)}"><h3>Review ${h(preview.source.name)} → ${h(preview.target.name)}</h3><p>${h(preview.reason)}. Source email ${h(preview.source.email)}, ${preview.sourceSummary.timeline.length} history entries; target ${h(preview.target.email)}, ${preview.targetSummary.timeline.length} entries.</p>${form('member.merge.confirm',back,hidden('id',preview.id)+hidden('key',preview.key)+identity(),'Confirm history link and retire source sign-in')}</article>`:''}</details>`:'';
  return intakeAnswersPanel(s,p.id)+preferencesPanel(s,p.id,back,true)+`<details class="more"><summary>Unified member history</summary><div class="panel-body"><p>${history.sourceIdentities.length} retained source identities. Original ledger and consent identities stay intact.</p>${notes}<h3>Dated timeline</h3><ol>${events || '<li>No history recorded.</li>'}</ol>${ledger?`<h3>Financial history</h3><div class="table-wrap">${table(['Entry','Amount','Source'],ledger)}</div>`:''}${form('member.message.send.staff',back,hidden('personId',p.id)+identity()+textarea('text','Message to member','','required maxlength="2000"'),'Send in-app message')}${merges}</div></details>`;
}
export function memberRecordAccess(s:any) {
  const people=s.people.filter((p:any) => p.active && p.role === 'member');
  return panel('Member-record staff access',body('<p>Grant a front-desk identity access only to explicitly named member records. Restricted notes, duplicate merges and financial history stay owner-only. Revocation takes effect on the next request.</p>'
    + form('waiver.signing.grant','/app/people',select('personId','Signing staff identity',people.map((p:any)=>[p.id,p.name]))+select('enabled','Signing check-in right',[['true','Grant'],['false','Revoke']])+'<fieldset><legend>Signing member scope</legend>'+people.map((p:any)=>`<label><input type="checkbox" name="member_${h(p.id)}" value="true"> ${h(p.name)}</label>`).join('')+'</fieldset><fieldset><legend>Signing location scope</legend>'+s.locations.map((l:any)=>`<label><input type="checkbox" name="location_${h(l.id)}" value="true"> ${h(l.name)}</label>`).join('')+'</fieldset>','Save signing launch access')
    + form('member.record.grant','/app/people',select('personId','Staff sign-in identity',people.map((p:any) => [p.id,p.name]))+select('enabled','Member-record right',[['true','Grant'],['false','Revoke']])+select('canCreate','May create new member profiles',[['false','No'],['true','Yes']])+'<fieldset><legend>Permitted member records</legend>'+people.map((p:any) => `<label><input type="checkbox" name="member_${h(p.id)}" value="true"> ${h(p.name)} · ${h(p.email)}</label>`).join('')+'</fieldset>'+hidden('requestId',crypto.randomUUID()),'Save member-record access')));
}
export function memberRecordDesk(s:any,query:URLSearchParams) {
  const chosen=s.people.find((p:any) => p.id === query.get('person')),back='/app/people'+(chosen?'?person='+encodeURIComponent(chosen.id):'');
  const list=s.people.map((p:any) => `<li><a href="/app/people?person=${encodeURIComponent(p.id)}">${h(p.name)}</a> · ${h(p.email)}</li>`).join('');
  const profile=chosen?panel(chosen.name,body(`<p>${h(chosen.email)} · ${h(chosen.phone ?? 'No phone recorded')}</p>`
    + form('profile.save.staff',back,hidden('personId',chosen.id)+hidden('revision',chosen.profileRevision ?? 0)+identity()+field('name','Full name',chosen.name,'text','required')+field('phone','Mobile phone',chosen.phone ?? '','tel')+field('emergencyName','Contact name',chosen.emergencyContact?.name ?? '')+field('emergencyPhone','Contact phone',chosen.emergencyContact?.phone ?? '','tel')+field('emergencyRelationship','Relationship',chosen.emergencyContact?.relationship ?? ''),'Save profile for member')
    + (s.signingGrant?.enabled ? '<details class="more"><summary>Member waiver link</summary>'+waiverLaunch(s,chosen,back)+'</details>' : '')
    + form('member.record.invite',back,hidden('personId',chosen.id)+identity(),'Send account invitation')+memberHistoryPanel(s,chosen,back)+attendancePlanControls(s,chosen.id,back)+billingStaffControls(s,chosen.id,back)+staffDeskPanel(s,chosen.id,back)+(s.freezePacks?.some((p:any)=>p.personId===chosen.id)?freezesPanel(s,chosen.id,back+'#freezes'):'')+appointmentsPanel(s,chosen.id,back)+clientAppointmentsPanel(s,chosen.id,back+'#client-appointments'))):'';
  const create=s.recordGrant?.canCreate?panel('Create a member profile',body(form('member.record.create',back,identity()+field('name','Full name','','text','required maxlength="160"')+field('email','Email','','email','required')+field('phone','Mobile phone','','tel'),'Create member profile'))):'';
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Member records</h1><p>Only the member records explicitly assigned to you.</p></div>${panel('Assigned members',body('<ul>'+list+'</ul>'))}${profile}</div><aside class="rail">${create}</aside></div>`;
}
