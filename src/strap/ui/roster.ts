// One class's people for the front desk: booked in order, then the waitlist and
// cancellations, each with their state, the pack that pays for the spot and
// anything owed. Check in is the desk's one action here.
import { attendance, balance, eligiblePack, packName, waiverSigned } from './facts'
import { clock, dayOf, datePlain, money } from './format'
import { icon } from './icons'
import { avatar, form, h, hidden, owner, person, rows, select } from './shared'
import { staffCancel } from './booking-rules'

// Instructors see who is in their class, not members' packs, balances or waivers.
function state(s: any, c: any, b: any, started: boolean) {
  const signed = (yes: string, no: string) => owner(s) ? (waiverSigned(s, b.personId) ? yes : no) : ''
  const line = (tone: string, glyph: string, title: string, sub: string) => `<div class="state ${tone}"><span class="mark">${icon(glyph)}</span><div><strong>${h(title)}</strong><span>${sub}</span></div></div>`
  if (b.status === 'cancelled') return line('', 'cross', b.cancellation === 'late' ? 'Late cancel' : 'Cancelled', `${b.cancellation === 'waitlist' || (!b.refunded && b.cancellation !== 'late') ? 'No credit used' : b.refunded ? 'Credit returned' : 'Credit kept'}${owner(s) && b.feeCents ? ` · ${money(b.feeCents)} fee` : ''}${owner(s) && b.waiver ? ` · Waived: ${h(b.waiver.reason)}` : ''}`)
  if (b.status === 'waitlisted') {
    const pack = eligiblePack(s, b.personId, c)
    return line('pending', 'wait', 'Waitlist', !owner(s) ? 'Moves up when a spot opens' : !waiverSigned(s, b.personId) ? 'Waiver not signed' : pack ? 'Moves up when a spot opens' : 'No credit that covers this class')
  }
  if (b.checkedInAt) return line('done', 'check', 'Checked in', h(clock(s, b.checkedInAt)))
  if (started) return line('pending', 'alert', 'Not checked in', signed('Waiver signed', 'Waiver not signed'))
  return line('', 'dot', 'Booked', signed('Waiver signed', 'Waiver not signed'))
}

function packChip(s: any, c: any, b: any) {
  if (!owner(s)) return ''
  const pack = rows(s, 'packs').find(p => p.id === b.packId) ?? (b.status === 'waitlisted' ? eligiblePack(s, b.personId, c) : null)
  if (!pack) return '<span class="chip quiet">No credit</span>'
  return `<span class="chip">${h(packName(pack))} · ${pack.remaining} left</span>`
}

function note(s: any, b: any) {
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
    + `<td data-label="Status">${state(s, c, b, started)}${owner(s) && b.status === 'booked' ? `<small>${b.capacityPool === 'held' ? 'Desk-held' : 'Online'} spot · ${h(b.bookingChannel ?? 'online')}</small>` : ''}</td><td data-label="Pack">${packChip(s, c, b)}</td><td data-label="Notes">${note(s, b)}</td>`
    + `<td class="act">${b.status === 'booked' && !b.checkedInAt && canCheckIn ? form('attendance.checkin', back, hidden('id', b.id), 'Check in', 'quiet', 'small') : ''}</td></tr>${owner(s) && !started && b.status !== 'cancelled' ? staffCancel(person(s, b.personId), b, back) : ''}`
  const body = [...booked.map((b, i) => line(b, String(i + 1))), ...waiting.map((b, i) => line(b, `W${i + 1}`)), ...cancelled.map(b => line(b, '—'))].join('')
  return `<div class="roster" id="roster"><table><thead><tr><th>#</th><th>Member</th><th>Status</th><th>Pack</th><th>Notes</th><th><span class="visually-hidden">Action</span></th></tr></thead><tbody>${body || `<tr><td colspan="6" class="note">No one has booked this class yet.</td></tr>`}</tbody></table>`
    + `<p class="roster-foot"><span>${c.occupancy.booked} / ${c.occupancy.total} booked · ${c.occupancy.onlineBooked} / ${c.occupancy.online} online · ${c.occupancy.heldBooked} / ${c.occupancy.held} desk-held</span></p>`
    + (owner(s) && !started ? `<div class="panel-body">${form('booking.desk', back, hidden('classId', c.id) + select('personId', 'Member or walk-in profile', rows(s, 'people').filter(p => p.active && p.role === 'member').map(p => [p.id, p.name]), '') + select('channel', 'Request channel', [['desk', 'At the desk'], ['phone', 'Phone'], ['inbox', 'Inbox']], 'desk'), 'Book at desk')}<p class="meta">Walk-ins need an active profile, an eligible pack and their own current waiver acknowledgment. <a href="/app/people#add-person">Add a profile</a>. Held spots are available only at the desk.</p></div>` : '')
    + `<p class="roster-foot"><span>${booked.length} booked · ${booked.filter(b => b.checkedInAt).length} checked in · ${waiting.length} waiting · ${cancelled.length} cancelled</span></p></div>`
}
