import { addDays, zoneName } from '../zone';
import { schedulingConflicts } from '../domain/scheduling';
import { allocationDetails, conflictDetails } from './scheduling';
import { clock, dayOf, dayShort, studioToday, when } from './format';
import { body, cell, emptyLine, field, form, h, hidden, owner, panel, person, rows, select as controlSelect, statusPill, table, textarea } from './shared';
import { delivery } from './closures';
import { icon } from './icons';

const select = (name: string,label: string,choices: [unknown,unknown][],value: unknown = '',attrs = 'required') => controlSelect(name,label,choices,value,`${attrs} aria-label="${h(label)}"`);
const back = '/app/classes#timetable';
const scopes = [['this','This occurrence'],['future','This and following occurrences']] as [string,string][];
const whenClass = (s: any,c: any) => `${dayShort(s,dayOf(s,c.start))} · ${clock(s,c.start)}`;
function fields(s: any,c: any = {}) {
  const teachers = rows(s,'people').filter(p => p.active && p.role === 'instructor');
  return `<div class="row2">${field('title','Class name',c.title ?? '', 'text','required maxlength="160"')}${field('service','Service',c.service ?? '', 'text','maxlength="160"')}</div>`
    + `<div class="row2">${field('time','Local start time',c.start ? new Intl.DateTimeFormat('en-GB',{timeZone:c.timeZone ?? s.studio.timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date(c.start)) : '09:00','time','required')}${field('minutes','Minutes',c.start ? (Date.parse(c.end)-Date.parse(c.start))/60_000 : 50,'number','required min="5" max="600"')}</div>`
    + `<div class="row2">${select('instructorId','Instructor',teachers.map(p => [p.id,p.name]),c.instructorId ?? teachers[0]?.id)}${field('room','Room',c.room ?? '', 'text','maxlength="100"')}</div>`
    + `<div class="row2">${field('capacity','Total capacity',c.capacity ?? 12,'number','required min="1" max="1000"')}${field('onlineCapacity','Online capacity',c.onlineCapacity ?? c.capacity ?? 12,'number','required min="0" max="1000"')}</div>`
    + textarea('equipment','Equipment / reformers (one name per line)',(c.equipment ?? []).join('\n'),'rows="2"')
    + `<div class="row2">${field('bufferBeforeMinutes','Preparation minutes',c.bufferBeforeMinutes ?? 0,'number','min="0" max="1440"')}${field('bufferAfterMinutes','Cleanup minutes',c.bufferAfterMinutes ?? 0,'number','min="0" max="1440"')}</div>`;
}
function facts(s: any,c: any) {
  return `${h(c.title)} · ${h(whenClass(s,c))}<br><small>${h(c.location)} · ${h(c.room)} · ${h(c.instructorName)} · ${h(c.capacity)} total / ${h(c.onlineCapacity)} online · ${(Date.parse(c.end)-Date.parse(c.start))/60_000} min</small>${allocationDetails(c)}`;
}
function publishPreview(s: any,d: any) {
  return `<p>${h(d.rule.location)} · ${h(zoneName(d.rule.timeZone))} · every ${h(d.rule.intervalWeeks)} week(s) through ${h(d.rule.endDate)}. Local start stays ${h(d.rule.time)} across daylight saving.</p>`
    + table(['Occurrence','Class'],d.classes.map((c: any) => `<tr>${cell('Occurrence',h(c.seriesIndex+1))}${cell('Class',facts(s,c))}</tr>`).join(''));
}
function changePreview(s: any,d: any) {
  return `<p>${h(d.reason)} · ${d.scope === 'this' ? 'This occurrence' : 'This and following occurrences'}</p><p class="meta">${d.impact.classes.length} occurrences · ${d.impact.bookings} existing bookings · ${d.impact.notices} in-app notices · ${d.impact.emails} emails, one per affected booking when configured. Credits stay reserved; no money moves.</p>`
    + d.impact.classes.map((c: any) => `<div class="panel-body"><p><strong>Before:</strong> ${facts(s,c.before)}</p><p><strong>After:</strong> ${facts(s,c.after)}</p>${c.bookings.length ? `<ul class="impact">${c.bookings.map((b: any) => `<li>${h(person(s,b.personId))} · ${h(b.status)}${b.spot ? ` · spot ${h(b.previousSpot ?? 'unassigned')} → ${h(b.spot)}` : ''}<p><strong>${h(b.subject)}</strong><br>${h(b.body)}</p></li>`).join('')}</ul>` : emptyLine('No existing bookings or member notices.')}</div>`).join('');
}
function drafts(s: any) {
  return rows(s,'seriesChanges').filter(d => d.status === 'draft').map(d => {
    const excluded = new Set(d.type === 'series-change' ? d.classes.map((c: any) => c.id) : []);
    const conflicts = schedulingConflicts(d.classes,rows(s,'classes').filter(c => c.status === 'published' && !excluded.has(c.id)),rows(s,'unavailability'));
    return `<article class="record" id="series-draft-${h(d.id)}"><span class="approval-mark">${icon('calendar')}</span><div><h3>${d.type === 'series' ? 'Review repeating timetable' : 'Review timetable change'}</h3></div>${statusPill(d.stale ? 'Blocked' : 'Needs approval')}<div class="record-body">${d.type === 'series' ? publishPreview(s,d) : changePreview(s,d)}${d.email ? `<p class="meta">${h(d.email === 'configured' ? 'Member email configured; provider outcomes appear after approval.' : d.email)}</p>` : ''}${conflictDetails(s,conflicts)}${d.stale ? '<p class="notice error">Timetable or booking facts changed. Prepare a fresh preview before approving.</p>' : !conflicts.length ? form(d.type === 'series' ? 'series.publish' : 'series.change.approve',back,hidden('id',d.id)+(d.impact ? hidden('impact',d.impact.key) : ''),d.type === 'series' ? 'Approve and publish timetable' : 'Approve changes and notify members') : ''}</div></article>`;
  }).join('');
}
function cancellations(s: any) {
  return rows(s,'seriesCancellations').slice().reverse().map(d => `<details class="more"${d.status === 'draft' ? ' open' : ''}><summary>${d.status === 'draft' ? 'Review series cancellation' : 'Series cancellation applied'} · ${h(d.reason)}</summary><div class="panel-body"><p>${h(d.scope === 'this' ? 'This occurrence' : d.scope === 'future' ? 'This and following occurrences' : 'Whole series (upcoming occurrences)')}</p><p class="meta">${d.impact.classes.length} classes · ${d.impact.creditsReturned} credits returned · ${d.impact.waitlistClosed} waitlist spots closed · ${d.impact.notices} in-app notices · ${d.impact.emails} emails (one per affected member, covering all selected occurrences); no money moves.</p>${d.impact.classes.map((c: any) => `<p><strong>${h(c.title)} · ${h(whenClass(s,c))}</strong></p><ul class="impact">${c.bookings.map((b: any) => `<li>${h(person(s,b.personId))}: ${b.creditReturned ? 'credit returned to original pack' : b.status === 'booked' ? 'unpaid visit closes; no credit used' : 'waitlist closes; no credit used'}${d.status === 'applied' ? ` · ${h(delivery(rows(s,'noticeDeliveries').find(x => d.closureIds.includes(x.sourceId) && x.personId === b.personId)))}` : ''}</li>`).join('') || '<li>No bookings.</li>'}</ul>`).join('')}<p class="meta">${h(d.email === 'configured' ? 'Member email configured; provider acceptance does not confirm delivery.' : d.email)}</p>${d.status === 'draft' ? d.stale ? '<p class="notice error">Timetable or booking facts changed. Prepare a fresh cancellation preview.</p>' : form('series.cancel.confirm',back,hidden('id',d.id)+hidden('impact',d.impact.key),'Confirm scoped cancellation') : ''}</div></details>`).join('');
}
export function seriesPanel(s: any,query: URLSearchParams) {
  if (!owner(s) || !s.studio) return '';
  const open = rows(s,'classes').filter(c => c.seriesId && c.status === 'published' && c.start > new Date().toISOString()).sort((a,b) => a.start.localeCompare(b.start));
  const selected = open.find(c => c.id === query.get('seriesClass'));
  const editor = rows(s,'people').some(p => p.active && p.role === 'instructor') ? form('series.prepare',back,
    `<div class="row2">${field('startDate','First class date',addDays(studioToday(s),7),'date','required')}${field('endDate','Repeat through',addDays(studioToday(s),49),'date','required')}</div>`
    + field('intervalWeeks','Repeat every (weeks)',1,'number','required min="1" max="52"')+fields(s),'Preview repeating timetable') : emptyLine('Add an active instructor before preparing a timetable.');
  const choose = open.length ? table(['Occurrence','Class',''],open.map(c => `<tr>${cell('Occurrence',h(whenClass(s,c)))}${cell('Class',h(c.title))}${cell('',`<a class="btn-quiet" href="/app/classes?seriesClass=${encodeURIComponent(c.id)}#series-change">Edit or cancel</a>`)}</tr>`).join('')) : emptyLine('Published repeating classes appear here.');
  const edit = selected ? `<div id="series-change"><h3>${h(selected.title)} · ${h(whenClass(s,selected))}</h3>${form('series.change.prepare',back,hidden('classId',selected.id)+select('scope','Edit scope',scopes,'this')+field('startDate','New occurrence date',dayOf(s,selected.start),'date','required')+fields(s,selected)+textarea('reason','Reason members will see','','required maxlength="300" rows="2"'),'Preview timetable changes')}
    <h3>Cancel occurrences</h3>${form('series.cancel.prepare',back,hidden('classId',selected.id)+select('scope','Cancellation scope',[['','Choose the cancellation scope'],...scopes,['series','Whole series (upcoming occurrences)']],'')+textarea('reason','Cancellation reason','','required maxlength="300" rows="2"'),'Preview scoped cancellation','quiet')}</div>` : '';
  const history = rows(s,'seriesChanges').filter(d => d.status === 'approved').map(d => `<details class="more"><summary>${d.type === 'series' ? 'Published repeating timetable' : 'Approved timetable change'} · ${when(s,d.approvedAt)}</summary><div class="panel-body">${d.type === 'series' ? publishPreview(s,d) : changePreview(s,d)}<p class="meta">Approved by ${h(d.approvedBy)} · ${when(s,d.approvedAt)}</p>${rows(s,'bookingActions').filter(a => a.seriesChangeId === d.id).map(a => `<p>${h(person(s,a.personId))}: ${h(delivery(rows(s,'noticeDeliveries').find(x => x.sourceId === a.id)))}</p>`).join('')}</div></details>`).join('');
  return panel('Repeating timetable',body(`<p>Publish up to 104 occurrences on the studio’s clock (${h(zoneName(s.studio.timeZone))}), with the same local start across daylight saving. Each occurrence has its own roster.</p><details class="more"><summary>Prepare repeating classes</summary>${editor}</details>${drafts(s)}${choose}${edit}`)+cancellations(s)+history,{id:'timetable',icon:'calendar'});
}
