import { body, cell, emptyLine, field, form, h, hidden, owner, panel, person, rows, select as baseSelect, statusPill, table } from './shared';
import { money, when } from './format';
const select=(name:string,label:string,choices:[unknown,unknown][],value:unknown='',attrs='required')=>baseSelect(name,label,choices,value,attrs+' aria-label="'+h(label)+'"');
const path = '/app/substitutions';
const rateText = (rate: any) => rate.mode === 'tiered'
  ? rate.tiers.map((tier: any) => `${tier.upTo === null ? 'Remaining attendees' : 'Through attendee '+tier.upTo}: ${money(tier.rateCents)} each`).join('; ')
  : `${money(rate.rateCents)} ${({'flat-class':'per class',hourly:'per hour','per-attendee':'per attendee','per-appointment':'per appointment'} as Record<string,string>)[rate.mode]}`;
export function substitutionsPage(s: any, _notice: any = {}) {
  const data = s.substitutions, isOwner = owner(s);
  const classes = rows(s,'classes').filter(c => c.status === 'published' && c.start > new Date().toISOString() && (isOwner || c.instructorId === s.actor.personId));
  const request = panel('Request coverage',body(form('substitution.request',path,
    select('classId','Class',[['','Choose a class'],...classes.map(c => [c.id,`${c.title} · ${when(s,c.start)} · ${c.instructorName}`])])
    + field('reason','Coverage request reason','','text','required maxlength="300"') + hidden('requestId',crypto.randomUUID()),'Request substitute')));
  const requests = data.requests.map((r: any) => {
    const c = rows(s,'classes').find(c => c.id === r.classId), candidates = data.candidates.filter((p: any) => p.requestId === r.id);
    const choices = candidates.filter((p: any) => p.available && p.qualified);
    return `<div data-substitution-request="${h(r.id)}"><h3>${h(c?.title ?? r.classTitle)} · ${when(s,c?.start ?? r.classStart)}</h3><p>${h(r.reason)} · ${statusPill(r.status)}</p>`
      + `<p class="meta">Original instructor: ${h(r.originalInstructorName)}. The assignment stays unchanged until approval.</p>`
      + (isOwner && r.status === 'requested' ? `<div class="table-wrap">${table(['Candidate','Studio qualification','Availability'],candidates.map((p: any) => '<tr>'
        + cell('Candidate',h(p.instructorName))+cell('Studio qualification',p.qualified?'Approved for this service':'Not approved for this service')
        + cell('Availability',p.available?'Available':p.conflicts.map((conflict: any) => `${h(conflict.resource.label)}: ${h(conflict.record.title ?? conflict.record.reason)} · ${when(s,conflict.occupiedStart)} – ${when(s,conflict.occupiedEnd)}`).join('<br>'))+'</tr>').join('') || '<tr><td colspan="3">No other active instructors.</td></tr>')}</div>`
        + (choices.length ? form('substitution.prepare',path,hidden('requestId',r.id)+select('instructorId','Available qualified substitute',choices.map((p: any) => [p.instructorId,p.instructorName])),'Preview substitution','quiet') : emptyLine('Approve a service qualification and resolve availability before previewing.')) : '')+'</div>';
  }).join('');
  const drafts = isOwner ? data.drafts.map((d: any) => `<div data-substitution-draft="${h(d.id)}"><h3>${h(d.before.title)} · ${statusPill(d.status)}</h3><p>${h(d.before.instructorName)} → ${h(d.after.instructorName)} · ${when(s,d.after.start)}</p>`
    + `<p>${h(d.reason)}</p><p>Credits unchanged · no money movement · ${h(d.impact.notices)} member notices</p>`
    + `<p>Substitute pay: ${d.pay.rate ? `${h(rateText(d.pay.rate))} · minimum ${money(d.pay.rate.minimumCents)} · rule version ${h(d.pay.ruleVersion)}` : 'Unavailable; configure an applicable substitute rate in Teaching pay.'}</p><p class="meta">${h(d.email)}</p>`
    + d.impact.classes.flatMap((c: any) => c.bookings.map((b: any) => `<details><summary>Notice for ${h(person(s,b.personId))}</summary><p>${h(b.subject)}</p><p>${h(b.body)}</p></details>`)).join('')
    + (d.status === 'draft' ? form('substitution.approve',path,hidden('id',d.id)+hidden('impact',d.impact.key),'Approve exact substitution') : `<p class="meta">Approved ${when(s,d.approvedAt)}. Delivery outcomes appear with the member notices.</p>`)+'</div>').join('') : '';
  const qualification = isOwner ? panel('Studio service qualifications',body(`<p>Record the studio’s approval for an instructor to cover an exact service. This is not a certification record. An instructor without recorded approval is not qualified for substitution.</p>`
    + form('substitution.qualification.save',path,select('instructorId','Instructor',rows(s,'people').filter(p => p.active && p.role === 'instructor').map(p => [p.id,p.name]))
      + field('service','Exact service name','','text','required maxlength="160"')+select('qualified','Studio approval',[['true','Approved'],['false','Not approved']])
      + hidden('requestId',crypto.randomUUID()),'Save studio qualification','quiet')
    + (data.qualifications.map((q: any) => `<p class="meta">${h(person(s,q.instructorId))} · ${h(q.service)} · ${q.qualified?'Approved':'Not approved'} · version ${h(q.version)} · ${when(s,q.createdAt)}</p>`).join('') || emptyLine('No studio qualifications configured.')))) : '';
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Instructor substitutions</h1><p>Request coverage and review the exact assignment, pay basis and member notices.</p></div>`
    + panel('Coverage requests',body(requests || emptyLine('No coverage requests.')))
    + (isOwner ? panel('Substitution previews',body(drafts || emptyLine('No substitution previews.'))) : '')
    + `</div><aside class="rail">${request}${qualification}</aside></div>`;
}
