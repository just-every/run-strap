import { dayOf, when, whenLabel } from './format'
import { body, cell, emptyLine, field, form, h, hidden, owner, panel, rows, select, statusPill, table, textarea } from './shared'

const requestIdentity = () => hidden('requestId',crypto.randomUUID())
const channel = (value = 'desk') => select('channel','Request received by',[
  ['desk','At the desk'],['phone','Phone'],['inbox','Email or inbox'],
],value)
const memberIdentity = (personId: string) => hidden('personId',personId) + requestIdentity()
const localTime = (s: any, occurrence: any) => new Intl.DateTimeFormat('en-GB',{
  timeZone:occurrence.timeZone ?? s.studio.timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit',
}).format(new Date(occurrence.start))

function occurrenceCells(s: any, occurrence: any) {
  return cell('Date',`${when(s,occurrence.start,occurrence.timeZone)}<br><small>${h(occurrence.service)}</small>`)
    + cell('Instructor',h(occurrence.instructorName))
    + cell('Room',h(occurrence.room))
    + cell('Pack',h(occurrence.packLabel ?? (occurrence.packId ? 'Session pack' : 'Not reserved')))
    + cell('Status',statusPill(occurrence.status))
}

function preview(s: any, personId: string, back: string, entry: any) {
  const saving = entry.operation === 'save'
  const title = saving ? 'Review appointment reservation' : entry.operation === 'move' ? 'Review appointment move' : 'Review appointment cancellation'
  const confirmation = entry.available === false ? alternativeForm(s,personId,back,entry) : form(saving ? 'appointment.reservation.confirm' : 'appointment.change.confirm',back,
    hidden('id',entry.id) + hidden('key',entry.key) + memberIdentity(personId) + channel(entry.channel),
    saving ? 'Confirm appointment reservation' : entry.operation === 'move' ? 'Confirm appointment move' : 'Confirm appointment cancellation')
  return `<details class="more" open data-appointment-preview="${h(entry.id)}"><summary>${title}</summary><div class="panel-body">`
    + `<div class="table-wrap">${table(['Date','Instructor','Room','Pack','Status'],entry.occurrences.map((occurrence: any) => `<tr>${occurrenceCells(s,occurrence)}</tr>`).join(''))}</div>`
    + confirmation + '</div></details>'
}

function occurrenceActions(s: any, personId: string, back: string, reservation: any, occurrence: any) {
  if (occurrence.status !== 'booked' || Date.parse(occurrence.start) <= Date.now()) return ''
  const identity = () => hidden('reservationId',reservation.id) + hidden('classId',occurrence.classId ?? occurrence.id) + memberIdentity(personId)
  const move = form('appointment.move.prepare',back,identity()
    + `<div class="row2">${field('startDate','New appointment date',dayOf(s,occurrence.start,occurrence.timeZone),'date','required')}${field('time','New local start time',localTime(s,occurrence),'time','required')}</div>`
    + channel(),'Preview appointment move','quiet','small')
  const cancel = form('appointment.cancel.prepare',back,identity()
    + select('scope','Cancellation scope',[['this','This occurrence'],['future','This and following occurrences']],'this')
    + textarea('reason','Cancellation reason','','required maxlength="500" rows="2"')
    + channel(),'Preview appointment cancellation','quiet','small')
  return `<details class="more"><summary>Move appointment</summary>${move}</details>`
    + `<details class="more"><summary>Cancel appointment</summary>${cancel}</details>`
}

function savedReservation(s: any, personId: string, back: string, reservation: any) {
  const occurrences = reservation.occurrences.map((occurrence: any) => `<tr>${occurrenceCells(s,occurrence)}${cell('Manage',occurrenceActions(s,personId,back,reservation,occurrence))}</tr>`).join('')
  const funding = (reservation.funding ?? []).map((p: any)=>`<p>${h(p.label)}: <strong>${h(p.remaining)} available</strong> · ${h(p.reserved)} reserved · ${h(p.consumed)} used</p>`).join('')
  return `<details class="more" open data-appointment-reservation="${h(reservation.id)}"><summary>Appointment reservation · ${h(reservation.status)}</summary><div class="panel-body">${funding}<div class="table-wrap">`
    + table(['Date','Instructor','Room','Pack','Status','Manage'],occurrences) + '</div></div></details>'
}

/** Owner tools live within the selected member's card. Offers remain immutable. */
export function appointmentsPanel(s: any, personId: string, back: string) {
  if ((!owner(s) && !(s.actor.role === 'front-desk' && s.appointmentGrant?.enabled)) || !personId) return ''
  const usedOffers = new Set(rows(s,'appointments').map(r=>r.offerId))
  const offers = rows(s,'appointmentSeriesOffers').filter(o=>!usedOffers.has(o.id))
  const choices: [unknown,unknown][] = [['','Choose an offered appointment series'],...offers.map(offer => {
    const first = offer.occurrences[0]
    return [offer.id,`${whenLabel(s,first.start,first.timeZone)} · ${first.service} · ${offer.occurrences.length} occurrences`] as [unknown,unknown]
  })]
  const prepare = offers.length ? form('appointment.reservation.prepare',back,
    memberIdentity(personId) + select('offerId','Offered appointment series',choices) + channel(),
    'Preview appointment reservation') : emptyLine('No appointment series have been offered.')
  const previews = rows(s,'appointmentPreviews').filter(entry => entry.personId === personId && entry.status === 'preview')
    .slice().reverse().map(entry => preview(s,personId,back,entry)).join('')
  const saved = rows(s,'appointments').filter(entry => entry.personId === personId)
    .slice().reverse().map(entry => savedReservation(s,personId,back,entry)).join('')
  return panel('Appointments',body('<p class="meta">Choose an offered series and review each date, instructor, room and funding pack before confirming.</p>'
    + composer(s,personId,back) + (owner(s) ? prepare : '') + previews + saved),{id:'appointments'})
}

function composer(s: any,personId: string,back: string) {
  const instructors = s.appointmentInstructors ?? rows(s,'people').filter(p=>p.role === 'instructor' && p.active)
  return `<details class="more"><summary>Book a private series</summary><div class="panel-body">`+form('appointment.reservation.prepare',back,
    memberIdentity(personId)+field('service','Private service','','text','required maxlength="160"')
    +select('instructorId','Instructor',instructors.map((p: any)=>[p.id,p.name]))
    +select('locationId','Location',rows(s,'locations').map(l=>[l.id,l.name]))+field('room','Room','','text','required maxlength="100"')
    +`<div class="row2">${field('startDate','First appointment date','','date','required')}${field('endDate','Last appointment date','','date','required')}</div>`
    +`<div class="row2">${field('time','Local start time','09:00','time','required')}${field('minutes','Length in minutes',50,'number','min="5" max="600" required')}</div>`
    +channel(),'Preview private series')+'</div></details>'
}
function alternativeForm(s: any,personId: string,back: string,entry: any) {
  if (!entry.source) return '<p>Resolve the conflicts in a new owner offer before saving.</p>'
  const conflicts = entry.occurrences.filter((o: any)=>!o.available).map((o: any)=>
    `<p>${when(s,o.start,o.timeZone)} · ${o.blockers.map((b: any)=>h(b.reason ?? 'Resource unavailable')).join('; ')}</p>`
    +select('alt_'+o.occurrenceDate,'Alternative for '+o.occurrenceDate,[['','Choose a checked alternative'],...o.alternatives.map((a: any)=>[a.start,whenLabel(s,a.start,o.timeZone)])])).join('')
  return form('appointment.reservation.prepare',back,memberIdentity(personId)+hidden('proposal',JSON.stringify(entry.source))+channel(entry.channel)+conflicts,'Review chosen alternatives')
}
