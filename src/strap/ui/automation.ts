import { body, cell, field, form, h, hidden, panel, person, select, table } from './shared';
import { when } from './format';

const back = '/app/studio#automation';
const request = () => hidden('requestId',crypto.randomUUID());
const audience = (s: any,rows: any[]) => table(['Member','Source','Eligibility'],rows.map(r => `<tr>${cell('Member',h(person(s,r.personId)))}${cell('Source',h(r.sourceId))}${cell('Eligibility',h(r.reason ?? 'Eligible for private review'))}</tr>`).join('') || '<tr><td colspan="3">No retained sources match.</td></tr>');
export function automationSettings(s: any) {
  const a = s.automation;if (!a) return '';
  const choices = [...(s.nurture?.sequences ?? []).map((r: any) => ['intro:'+r.id,'Intro: '+r.welcome.slice(0,60)]),...(s.renewalSequences ?? []).map((r: any) => ['renewal:'+r.id,'Renewal: '+r.name])];
  const previews = a.previews.filter((p: any) => p.status === 'preview').map((p: any) => `<article data-automation-preview="${h(p.id)}"><h3>${h(p.name)}</h3><p>${h(p.trigger)} · ${h(p.channel)} · ${p.maxTasks} lifetime tasks · ${p.intervalMinutes} minutes between scheduled evaluations</p><p>${when(s,p.startAt)} through ${when(s,p.endAt)}. Human escalation: private owner review.</p><p>Stops: ${p.stopConditions.map(h).join('; ')}.</p><div class="table-wrap">${audience(s,p.audience)}</div>${p.stale ? '<p role="status">Audience changed. Create a fresh preview.</p>' : form('automation.enable',back,hidden('id',p.id)+hidden('key',p.key),'Enable private review rule')}</article>`).join('');
  const rules = a.rules.map((r: any) => `<article data-automation-rule="${h(r.id)}"><h3>${h(r.name)}</h3><p>${h(r.trigger)} · ${h(r.channel)} · ${!r.connected ? 'Execution disconnected' : r.enabled ? 'Enabled' : 'Paused'}. ${a.tasks.filter((t: any) => t.ruleId === r.id).length} of ${r.maxTasks} lifetime tasks.</p><p>Every ${r.intervalMinutes} minutes from ${when(s,r.startAt)} through ${when(s,r.endAt)}. Stops: ${r.stopConditions.map(h).join('; ')}.</p>`
    + (r.enabled && r.connected ? form('automation.pause',back,hidden('id',r.id),'Pause private review rule','quiet') : form('automation.resume.preview',back,hidden('id',r.id),'Preview current audience','quiet'))
    + form('automation.evaluate',back,hidden('id',r.id)+request(),'Evaluate private work','quiet')+'</article>').join('');
  const resumes = a.resumes.filter((p: any) => p.status === 'preview').map((p: any) => `<article data-automation-resume="${h(p.ruleId)}"><h3>Resume reviewed rule</h3><p>Review current eligibility. Resuming preserves the original lifetime budget and all trigger identities.</p><div class="table-wrap">${audience(s,p.audience)}</div>${form('automation.resume',back,hidden('id',p.id)+hidden('key',p.key),'Confirm reviewed resumption')}</article>`).join('');
  return panel('Private automation settings',body('<p>Scheduled evaluation queues private owner-review tasks. Completing a task sends nothing. Member messages continue to require the separate approved intro or renewal review. Charges, rewards and provider execution are unavailable here.</p>'
    + (choices.length ? form('automation.prepare',back,field('name','Rule name','','text','required maxlength="100"')+select('source','Retained sequence',choices)
      + select('channel','Rule channel',[['inApp','In-app'],['email','Email permission only'],['sms','SMS permission only']])
      + '<div class="row2">'+field('startAt','Schedule starts (UTC)',new Date().toISOString().slice(0,16),'datetime-local','required')+field('endAt','Schedule ends (UTC)','','datetime-local','required')+'</div>'
      + '<div class="row2">'+field('intervalMinutes','Evaluation interval in minutes',60,'number','required min="1" max="10080"')+field('maxTasks','Lifetime private task budget',10,'number','required min="1" max="1000"')+'</div>'
      + '<div class="row2">'+field('days','Renewal horizon in days',30,'number','required min="1" max="366"')+field('lowCredits','Renewal low-credit threshold',1,'number','required min="0" max="10000"')+'</div>','Preview private review rule') : '<p>First approve an intro sequence in Lead follow-up or a renewal sequence in the Renewal worklist.</p>')
    + previews+rules+resumes),{id:'automation'});
}
export function automationHistory(s: any,trigger: string,path: string) {
  const a = s.automation;if (!a) return '';
  const rules = a.rules.filter((r: any) => r.trigger === trigger),ids = new Set(rules.map((r: any) => r.id));
  const tasks = a.tasks.filter((t: any) => ids.has(t.ruleId)).map((t: any) => `<tr data-automation-task="${h(t.id)}">${cell('Member',h(person(s,t.personId)))}${cell('Source',h(t.sourceId))}${cell('Review',h(t.status)+(t.reason ? ' · '+h(t.reason) : '')+(t.status === 'queued' ? form('automation.task.complete',path,hidden('id',t.id),'Complete private review','quiet') : ''))}</tr>`).join('');
  const history = a.runs.filter((r: any) => ids.has(r.ruleId)).slice().reverse().map((r: any) => `<li data-automation-run="${h(r.id)}">${when(s,r.at)} · ${h(rules.find((rule: any) => rule.id === r.ruleId)?.name)} · ${r.queued} queued, ${r.skipped} skipped, ${r.exceptions} exceptions${r.reason ? ' · '+h(r.reason) : ''}<ul>${a.outcomes.filter((o: any) => o.runId === r.id).map((o: any) => `<li>${h(person(s,o.personId))} · ${h(o.sourceId)} · ${h(o.status)} · ${h(o.reason)}</li>`).join('')}</ul></li>`).join('');
  return panel('Private automation review',body('<p><a href="/app/studio#automation">Automation settings</a> · Review current sources before separately approving any member message.</p><div class="table-wrap">'+table(['Member','Source','Review'],tasks || '<tr><td colspan="3">No private review work.</td></tr>')+'</div><h3>Run, skip and exception history</h3><ol>'+history+'</ol>'));
}
