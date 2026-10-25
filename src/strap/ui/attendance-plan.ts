import { body, emptyLine, field, form, h, hidden, owner, rows, select } from './shared'
import { when, whenLabel, zoneOf } from './format'

/** Uses the existing schedule and profile controls; no separate success screen. */
export function attendancePlanControls(s: any, personId: string, path: string) {
  const staff=owner(s)||s.actor.role==='front-desk',data=s.attendancePlans ?? {availability:[],offers:[]},availability=data.availability.find((a: any)=>a.personId===personId)
  if(s.actor.role==='front-desk'&&!availability)return ''
  const availabilityText=availability?.windows.length ? availability.windows.map((w: any)=>`${whenLabel(s,w.start)} to ${whenLabel(s,w.end)}`).join('; ') : 'No available times recorded.'
  const preferences=staff ? `<p>${h(availabilityText)} Only the member sets these times and locations.</p>`
    + form('attendance.availability.launch',path,hidden('personId',personId)+hidden('requestId',crypto.randomUUID()),'Start member availability','quiet')
    + '<p>Ask the member to open this door on their own device and sign in as themselves. Staff cannot choose for them.</p><a href="/signin?returnTo=%2Fapp%23attendance-plan">Member availability sign-in</a>'
    + (availability ? form('attendance.plan.prepare',path,hidden('personId',personId),'Prepare attendance options','quiet') : '')
    : form('attendance.availability.save',path,hidden('version',availability?.version ?? 0)
      + `<p>Choose one available interval on the studio clock (${h(zoneOf(s))}). Saving replaces your previous intervals. Only classes entirely inside it at your chosen location are suggested; this does not reserve a seat.</p>`
      + field('availabilityStart','Available from','','datetime-local','required')+field('availabilityEnd','Available until','','datetime-local','required')
      + select('locationId','Preferred location',rows(s,'locations').map(l=>[l.id,l.name]),'studio')
      + `<p>${h(availabilityText)}</p>`,'Save my availability','quiet')
  const offers=data.offers.filter((o: any)=>o.personId===personId).slice().reverse().map((offer: any)=>`<div data-attendance-offer="${h(offer.id)}"><h3>${offer.status==='accepted' ? 'Attendance option accepted' : 'Suggested classes'}</h3><p>${offer.visits.length} recorded attended visits informed this review. Capacity and credits are checked again when accepting. No message, plan change or freeze is automatic.</p>`
    + (offer.choices.length ? offer.choices.map((c: any)=>`<p>${h(c.title)} · ${when(s,c.start)} to ${when(s,c.end)}</p>`
      + (offer.status==='accepted' ? (offer.classId===c.classId ? '<p>Booked from this offer.</p>' : '') : c.feasible ? form(staff?'attendance.plan.accept.staff':'attendance.plan.accept',path,hidden('id',offer.id)+hidden('classId',c.classId)+(staff?hidden('requestId',crypto.randomUUID())+select('channel','Request channel',[['desk','At the desk'],['phone','Phone'],['inbox','Email or inbox']]):''),staff?'Book option for member':'Accept class option','quiet') : '<p>Unavailable now. Ask the studio for fresh options.</p>')).join('') : emptyLine('No eligible class fits your available times and location. Ask the studio to review a plan change or freeze; nothing changes automatically.')+(!staff?'<p><a href="/app/packs#plan-changes">Request a plan change</a> · <a href="/app/packs#freezes">Request a freeze</a></p>':''))+'</div>').join('')
  return `<details id="attendance-plan"><summary>Attendance options</summary>${body(preferences+offers)}</details>`
}
