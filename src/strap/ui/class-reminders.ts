import { body, cell, field, form, h, hidden, panel, person, rows, select, table } from './shared';
import { when } from './format';

function ruleFields(rule?: any) {
  return hidden('requestId',crypto.randomUUID()) + hidden('revision',rule?.revision ?? 0)
    + field('service','Service (blank for studio default)',rule?.service ?? '','text',`maxlength="200"${rule ? ' readonly' : ''}`)
    + select('enabled','Reminders',[['true','Enabled'],['false','Disabled']],String(rule?.enabled ?? true))
    + field('leadMinutes','Minutes before class',rule?.leadMinutes ?? 1440,'number','required min="1" max="10080" step="1"');
}

export function classRemindersPanel(s: any) {
  if (s.actor.role !== 'owner') return '';
  const current = rows(s,'classReminderRules').map(rule => '<tr>'
    + cell('Service',h(rule.service || 'Studio default'))
    + cell('Timing',`${h(rule.leadMinutes)} minutes before class · ${rule.enabled ? 'Enabled' : 'Disabled'} · revision ${h(rule.revision)}`)
    + cell('Edit',`<details><summary>Edit reminder rule</summary>${form('reminder.rule.save','/app/studio',ruleFields(rule),'Save reminder rule','quiet')}</details>`)
    + '</tr>').join('');
  return panel('Class reminders',body('<p>Email reminders use the current class time and member message choice. In-app reminders remain available when a member stops these emails. SMS and push reminders are not available.</p><p>A service rule overrides the studio default, including when disabled. A reminder is reserved once for each booked class and start time; a rule edit does not send it again. If a reminder runs late, it can still send until the class starts. Provider acceptance does not confirm delivery.</p>')
    + `<div class="table-wrap">${table(['Service','Timing','Edit'],current || '<tr><td colspan="3">No reminder rules configured.</td></tr>')}</div>`
    + body(`<details><summary>Add a reminder rule</summary>${form('reminder.rule.save','/app/studio',ruleFields(),'Save reminder rule')}</details>`),{id:'class-reminders'});
}

const outcome: Record<string,string> = {
  rejected:'Provider refused the email',rate_limited:'Provider rate limited the email',uncertain:'Provider outcome unknown',
  queued:'Email reserved; dispatch not confirmed',sending:'Dispatch claimed; final outcome unknown',not_configured:'Email not configured',no_address:'No usable email address',paused:'Email paused pending owner reconnection',
};

export function reminderTasksPanel(s: any) {
  if (s.actor.role !== 'owner') return '';
  const tasks = rows(s,'reminderTasks').filter(task => task.status === 'open');
  const content = tasks.map(task => '<tr>'
    + cell('Member',h(person(s,task.personId)))
    + cell('Class',`${h(rows(s,'classes').find(entry => entry.id === task.classId)?.title ?? 'Class')}<small>${when(s, task.start, task.timeZone)}</small>`)
    + cell('Outcome',`${h(outcome[task.deliveryStatus] ?? task.deliveryStatus)}${task.provider ? `<small>Provider: ${h(task.provider)}</small>` : ''}`)
    + cell('Follow-up',form('reminder.task.complete','/app/studio',hidden('id',task.id)+hidden('requestId',crypto.randomUUID())
      + field('reason','Follow-up outcome','','text','required maxlength="500"'),'Complete follow-up','quiet','small'))
    + '</tr>').join('');
  return panel('Reminder follow-up',body('<p>These tasks record an unavailable, refused or uncertain email channel. Completing a task records your follow-up; it does not retry or claim delivery.</p>')
    + `<div class="table-wrap">${table(['Member','Class','Outcome','Follow-up'],content || '<tr><td colspan="4">No open reminder follow-up tasks.</td></tr>')}</div>`,{id:'reminder-tasks'});
}
