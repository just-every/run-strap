// One class's people for the front desk: booked in order, then the waitlist and
// cancellations, each with their state, the pack that pays for the spot and
// anything owed. Check in, and a no-show once class starts, are the desk's
// actions here; the owner corrects a no-show or late cancel below the row.
import { attendance, balance, eligiblePack, packName, waiverSigned } from './facts'
import { clock, dayOf, datePlain, money } from './format'
import { icon } from './icons'
import { avatar, form, h, hidden, owner, person, rows, select } from './shared'
import { staffCancel } from './booking-rules'
import { bookingActionRow, bulkCancel } from './booking-actions'
import { correctionNote, correctionRow } from './attendance'
import { deskSpot, spotLine, staffSpotRow } from './spots'
import { alertNotes } from './checkin'
import { acceptForMember, offerLine } from './waitlist'
import { deskForm, deskNote } from './desk'

// Instructors see who is in their class and their check-in alerts (waiver and
// pack), never members' balances.
function state(s: any, c: any, b: any, started: boolean) {
  const signed = (yes: string, no: string) => owner(s) ? (waiverSigned(s, b.personId) ? yes : no) : ''
  const line = (tone: string, glyph: string, title: string, sub: string) => `<div class="state ${tone}"><span class="mark">${icon(glyph)}</span><div><strong>${h(title)}</strong><span>${sub}</span></div></div>`
  if (b.cancellation === 'class_cancelled' || b.cancellation === 'waitlist_closed') return line('', 'cross', 'Class cancelled', b.refunded ? 'Credit returned' : 'Waitlist closed')
  if (['move_replaced','move_completed'].includes(b.cancellation)) return line('', 'dot', 'Move request closed', b.cancellation === 'move_completed' ? 'Moved to this class' : 'Moved elsewhere')
  if (b.cancellation === 'offer_expired') return line('', 'cross', 'Offer expired', 'Not claimed in time · No credit used')
  if (b.status === 'cancelled') return line('', 'cross', b.cancellation === 'late' ? 'Late cancel' : 'Cancelled', `${b.cancellation === 'waitlist' || (!b.refunded && b.cancellation !== 'late') ? 'No credit used' : b.refunded ? 'Credit returned' : 'Credit kept'}${owner(s) && b.feeCents ? ` · ${money(b.feeCents)} fee` : ''}${owner(s) && b.waiver ? ` · Waived: ${h(b.waiver.reason)}` : ''}`)
  if (b.status === 'offered') return line('pending', 'wait', 'Spot offered', owner(s) ? offerLine(s, b) : 'Waiting for them to claim it')
  if (b.status === 'waitlisted') {
    const pack = eligiblePack(s, b.personId, c)
    return line('pending', 'wait', 'Waitlist', !owner(s) ? 'Moves up when a spot opens' : !waiverSigned(s, b.personId) ? 'Waiver not signed' : pack ? 'Moves up when a spot opens' : 'No credit that covers this class')
  }
  if (b.attendance === 'excused') return line('', 'dot', 'Excused', 'Credit returned')
  if (b.attendance === 'no_show') return line('pending', 'cross', 'No-show', `Credit used${owner(s) && b.noShowFeeCents ? ` · ${money(b.noShowFeeCents)} fee` : ''}`)
  if (b.checkedInAt) return line('done', 'check', 'Checked in', h(clock(s, b.checkedInAt)))
  if (started) return line('pending', 'alert', 'Not checked in', signed('Waiver signed', 'Waiver not signed'))
  return line('', 'dot', 'Booked', signed('Waiver signed', 'Waiver not signed'))
}

function packChip(s: any, c: any, b: any) {
  if (!owner(s)) return ''
  const pack = rows(s, 'packs').find(p => p.id === b.packId) ?? (b.status !== 'booked' ? eligiblePack(s, b.personId, c) : null)
  if (!pack) return `<span class="chip quiet">${b.unpaid ? 'Unpaid visit' : 'No credit'}</span>`
  return `<span class="chip">${h(packName(pack))} · ${pack.remaining} left</span>`
}

function note(s: any, b: any) {
  if (b.alerts) return alertNotes(s, b)
  if (!owner(s)) return '<span class="note none">—</span>'
  const owed = balance(s, b.personId)
  if (owed > 0) return `<span class="note owes">Owes ${money(owed)}</span>`
  const pack = rows(s, 'packs').find(p => p.id === b.packId)
  if (pack && Date.parse(pack.expiresAt) - Date.now() < 7 * 86_400_000) return `<span class="note">Pack ends ${h(datePlain(dayOf(s, pack.expiresAt)).replace(/, \d{4}$/, ''))}</span>`
  return '<span class="note none">—</span>'
}

export function roster(s: any, c: any, back: string) {
  const { booked, waiting, cancelled } = attendance(s, c.id)
  const started = Date.parse(c.start) <= Date.now()
  const canCheckIn = owner(s) || s.actor.personId === c.instructorId
  const line = (b: any, n: string) => `<tr><td class="n">${n}</td><td class="who-cell"><div class="who">${avatar(person(s, b.personId))}${owner(s) ? `<a href="/app/people?person=${encodeURIComponent(b.personId)}#person">${h(person(s, b.personId))}</a>` : `<span>${h(person(s, b.personId))}</span>`}</div></td>`
    + `<td data-label="Status">${state(s, c, b, started)}${b.spot && b.status === 'booked' ? `<small>Spot: ${h(b.spot)}</small>` : ''}${owner(s) ? correctionNote(b) : ''}${owner(s) && b.status === 'booked' ? `<small>${b.capacityPool === 'held' ? 'Desk-held' : 'Online'} spot · ${h(b.bookingChannel ?? 'online')}${deskNote(b)}</small>` : ''}</td><td data-label="Pack">${packChip(s, c, b)}</td><td data-label="Notes">${note(s, b)}</td>`
    + `<td class="act">${owner(s) && b.status === 'offered' && !started ? acceptForMember(s, b, back) : ''}${b.status === 'booked' && !b.checkedInAt && !b.attendance && canCheckIn ? form('attendance.checkin', back, hidden('id', b.id), 'Check in', 'quiet', 'small') + (Date.parse(c.start) + (b.cancelTerms?.noShowGraceMinutes ?? 0)*60_000 <= Date.now() ? form('attendance.noshow', back, hidden('id', b.id), 'No-show', 'quiet', 'small') : '') : ''}</td></tr>${owner(s) && !started && b.status !== 'cancelled' ? staffCancel(s, person(s, b.personId), b, back) : ''}${bookingActionRow(s, c, b, back)}${owner(s) ? staffSpotRow(s, c, b, back) : ''}${correctionRow(s, person(s, b.personId), b, back)}`
  const body = [...booked.map((b, i) => line(b, String(i + 1))), ...waiting.map((b, i) => line(b, `W${i + 1}`)), ...cancelled.map(b => line(b, '—'))].join('')
  return `<div class="roster" id="roster"><table><thead><tr><th>#</th><th>Member</th><th>Status</th><th>Pack</th><th>Notes</th><th><span class="visually-hidden">Action</span></th></tr></thead><tbody>${body || `<tr><td colspan="6" class="note">No one has booked this class yet.</td></tr>`}</tbody></table>`
    + bulkCancel(s, c, booked, back)
    + spotLine(s, c)
    + `<p class="roster-foot"><span>${c.occupancy.booked - c.occupancy.offered} / ${c.occupancy.total} booked${c.occupancy.offered ? ` · ${c.occupancy.offered} held for an offer` : ''} · ${c.occupancy.onlineBooked} / ${c.occupancy.online} online · ${c.occupancy.heldBooked} / ${c.occupancy.held} desk-held</span></p>`
    + (owner(s) && !started ? deskForm(s, c, back) : '')
    + `<p class="roster-foot"><span>${booked.length} booked · ${booked.filter(b => b.checkedInAt).length} checked in · ${booked.filter(b => b.attendance === 'no_show').length} no-show · ${waiting.length} waiting · ${cancelled.length} cancelled</span></p></div>`
}
