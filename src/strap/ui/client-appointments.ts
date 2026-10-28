// Client invitations are sanitized copies; native owner offers stay private.
import { clock, dayOf, money, when, whenLabel } from './format'
import { body, emptyLine, field, form, h, hidden, owner, panel, rows, select, statusPill, textarea } from './shared'

const request = () => hidden('requestId', crypto.randomUUID())
const staffFields = (s: any, personId: string) => s.actor.role === 'member' ? '' : hidden('personId', personId) + select('channel', 'Request received by', [['desk', 'At the desk'], ['phone', 'Phone'], ['inbox', 'Email or inbox']], 'desk')
const identity = (s: any, personId: string) => request() + staffFields(s, personId)
const scope = () => select('scope', 'Occurrences to change', [['this', 'This occurrence'], ['future', 'This and following occurrences']], 'this')

function occurrenceTerms(s: any, o: any) {
  const terms = o.cancelTerms
  return `<p><strong>${h(o.service)}</strong><br>${when(s, o.start, o.timeZone)} – ${clock(s, o.end, o.timeZone)} · ${h(o.timeZone)}<br>${h(o.instructorName)} · ${h(o.room)}</p>`
    + `<p class="meta">Equipment: ${h(Array.isArray(o.equipment) ? o.equipment.join(', ') || 'None' : o.equipment || 'None')}. Resource buffers: ${h(o.bufferBeforeMinutes)} minutes before, ${h(o.bufferAfterMinutes)} minutes after.</p>`
    + (o.packLabel ? `<p>Funding: ${h(o.packLabel)}</p>` : '')
    + (terms ? `<p>Cancellation cutoff: ${h(terms.cutoffHours)} hours before start. Late cancellation: ${terms.lateReturnsCredit ? 'original credit returns' : 'visit stays used'}, ${money(terms.lateFeeCents)} fee. No-show fee: ${money(terms.noShowFeeCents)}.</p>` : '')
}

function delivery(s: any, personId: string, back: string) {
  if (!owner(s)) return ''
  const offers = rows(s, 'appointmentSeriesOffers')
  if (!offers.length) return emptyLine('Prepare a private appointment offer before sending an invitation.')
  return `<details class="more"><summary>Send an appointment invitation</summary><div class="panel-body"><p>The member receives an in-app copy of these appointment terms. Sending an invitation holds no resources.</p>`
    + form('appointment.client.deliver', back, hidden('personId', personId) + request()
      + select('offerId', 'Private owner offer', [['', 'Choose a prepared offer'], ...offers.map(o => [o.id, `${o.occurrences[0].service} · ${whenLabel(s, o.occurrences[0].start, o.occurrences[0].timeZone)} · ${o.occurrences.length} dates`] as [unknown, unknown])])
      + field('depositAmount', 'Deposit owed externally ($)', '0.00', 'number', 'required min="0" step="0.01"'), 'Send in-app invitation') + '</div></details>'
}

function invitation(s: any, personId: string, back: string, offer: any) {
  return `<details class="more" open data-client-appointment-offer="${h(offer.id)}"><summary>Appointment invitation · ${h(offer.status)}</summary><div class="panel-body">`
    + offer.occurrences.map((o: any) => occurrenceTerms(s, o)).join('')
    + `<p>Deposit owed externally: <strong>${money(offer.depositCents)}</strong>. Strap does not charge a payment method.</p>`
    + (offer.status === 'delivered' ? form('appointment.client.accept', back, hidden('id', offer.id) + hidden('key', offer.key) + identity(s, personId)
      + '<label class="check"><input type="checkbox" name="confirm" value="yes" required>I accept these exact appointment terms and the deposit owed externally. This does not authorize a processor charge.</label>', 'Accept exact appointment terms') : '<p>Accepted. See the saved appointment below.</p>') + '</div></details>'
}

function changeControls(s: any, personId: string, back: string, reservation: any, o: any) {
  if (o.status !== 'booked' || !o.bookingId || Date.parse(o.start) <= Date.now()) return ''
  const ids = () => hidden('reservationId', reservation.id) + hidden('classId', o.classId ?? o.id) + identity(s, personId)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: o.timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(o.start))
  return `<details class="more"><summary>Move this appointment</summary><div class="panel-body">`
    + form('appointment.client.move.prepare', back, ids() + scope() + `<div class="row2">${field('startDate', 'New appointment date', dayOf(s, o.start, o.timeZone), 'date', 'required')}${field('time', 'New local start time', time, 'time', 'required')}</div>` + `<p class="meta">Time zone: ${h(o.timeZone)}. Review policy fees before confirming.</p>`, 'Preview appointment move', 'quiet')
    + '</div></details><details class="more"><summary>Cancel this appointment</summary><div class="panel-body">'
    + form('appointment.client.cancel.prepare', back, ids() + scope() + textarea('reason', 'Cancellation reason', '', 'required maxlength="500" rows="2"'), 'Preview appointment cancellation', 'quiet') + '</div></details>'
}

function saved(s: any, personId: string, back: string, reservation: any) {
  const deposit = reservation.deposit
  const receipt = deposit && owner(s) && deposit.status === 'due' ? `<details class="more"><summary>Record received deposit</summary><div class="panel-body"><p>Record only money actually received through your external processor. This records a receipt; it does not charge or refund.</p>`
    + form('appointment.client.deposit.record', back, hidden('reservationId', reservation.id) + request()
      + field('depositAmount', 'Deposit received ($)', (deposit.amountCents / 100).toFixed(2), 'number', 'required readonly min="0.01" step="0.01"')
      + field('reference', 'External receipt reference', '', 'text', 'required maxlength="160"'), 'Record external deposit receipt') + '</div></details>' : ''
  return `<details class="more" open data-client-appointment="${h(reservation.id)}"><summary>Accepted appointments · ${h(reservation.status)}</summary><div class="panel-body">`
    + (deposit ? `<p>External deposit: ${money(deposit.amountCents)} · ${deposit.status === 'recorded' ? 'Receipt recorded' : deposit.status === 'not_required' ? 'No deposit required' : 'Owed externally'}${deposit.reference ? ' · ' + h(deposit.reference) : ''}</p>` : '')
    + reservation.occurrences.map((o: any) => `<article>${occurrenceTerms(s, o)}<p>${statusPill(o.status)}</p>${changeControls(s, personId, back, reservation, o)}</article>`).join('') + receipt + '</div></details>'
}

function preview(s: any, personId: string, back: string, entry: any) {
  const moving = entry.operation === 'move'
  return `<details class="more" open data-client-appointment-preview="${h(entry.id)}"><summary>Review appointment ${moving ? 'move' : 'cancellation'}</summary><div class="panel-body">`
    + entry.occurrences.map((o: any) => (o.before ? `<p>Originally: ${when(s, o.before.start, o.timeZone)}</p>` : '') + occurrenceTerms(s, o)).join('')
    + (entry.policy ?? []).map((p: any) => `<p>${when(s, entry.occurrences.find((o: any) => o.id === p.id)?.start, entry.occurrences.find((o: any) => o.id === p.id)?.timeZone)} · Policy fee: ${money(p.effect.feeCents)}. Fee owed: ${money(p.feeCents)}. ${moving ? 'Original funding allocation carries to the new time.' : p.creditReturned ? 'Original funding allocation returns.' : 'Original visit stays used; no allocation returns.'}</p>`).join('')
    + '<p>No payment is charged or refunded by this confirmation.</p>'
    + form('appointment.client.change.confirm', back, hidden('id', entry.id) + hidden('key', entry.key) + identity(s, personId), moving ? 'Confirm appointment move' : 'Confirm appointment cancellation') + '</div></details>'
}

export function clientAppointmentsPanel(s: any, personId: string, back: string) {
  const ownMember = s.actor.role === 'member' && s.actor.personId === personId
  const scopedStaff = s.appointmentGrant?.enabled && s.appointmentGrant.memberIds.includes(personId)
  if (!personId || !ownMember && !owner(s) && !scopedStaff) return ''
  const offers = rows(s, 'clientAppointmentOffers').filter(o => o.personId === personId)
  const reservations = rows(s, 'appointments').filter(r => r.personId === personId && r.clientOfferId)
  const previews = rows(s, 'clientAppointmentPreviews').filter(p => p.personId === personId && p.status === 'preview')
  return panel('My appointments', body(delivery(s, personId, back)
    + offers.map(o => invitation(s, personId, back, o)).join('')
    + previews.slice().reverse().map(p => preview(s, personId, back, p)).join('')
    + reservations.slice().reverse().map(r => saved(s, personId, back, r)).join('')
    + (!offers.length && !reservations.length ? emptyLine('No appointment invitations yet. The studio can send one here.') : '')), { id: 'client-appointments' })
}
