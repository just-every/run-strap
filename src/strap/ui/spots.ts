// SCHED-007 on screen: the spot list a member picks from when booking or moving,
// each seat's spot on the roster with the owner's move for a member, and the
// room spot editor in Studio settings. Members see free and taken spots, never
// who holds them.
import { body, cell, emptyLine, field, form, h, hidden, panel, person, rows, table, textarea } from './shared'

const option = (s: any) => `<option value="${h(s.label)}"${s.state !== 'free' ? ' disabled' : ''}>${h(s.label)}${s.state === 'free' ? '' : s.state === 'taken' ? ' (taken)' : ' (out of service)'}</option>`
const spotSelect = (spots: any[], label: string, first: string) =>
  `<label class="field">${h(label)}<select name="spot">${first ? `<option value="">${h(first)}</option>` : ''}${spots.map(s => option(s)).join('')}</select></label>`

/** The spot picker inside a booking form, when the class's room has spots. */
export const bookingSpot = (c: any) => c.spots && c.occupancy.onlineOpen > 0 ? spotSelect(c.spots, 'Spot', 'First free spot') : ''

/** The desk's spot picker: any free spot, including desk-held seats. */
export const deskSpot = (c: any) => c.occupancy.totalOpen > 0 ? spotSelect(c.spots, 'Spot', 'First free spot') : ''

/** A booked seat's spot, and a form to move to another free spot before class. */
export function ownSpot(c: any, b: any, back: string) {
  if (!b.spot) return ''
  const free = (c.spots ?? []).filter((s: any) => s.state === 'free')
  const move = Date.parse(c.start) > Date.now() && free.length ? `<details class="more"><summary>Change spot</summary>${form('booking.spot', back, hidden('id', b.id) + spotSelect(c.spots, 'New spot', ''), 'Move to this spot', 'quiet', 'small')}</details>` : ''
  return `<span class="chip">${h(b.spot)}</span>${move}`
}

/** Staff: who is on each spot, in room order. */
export function spotLine(s: any, c: any) {
  if (!c.spots) return ''
  const holder = new Map(rows(s, 'bookings').filter(b => b.classId === c.id && b.status === 'booked' && b.spot).map(b => [b.spot.toLowerCase(), b]))
  return `<p class="roster-foot"><span>Spots: ${c.spots.map((spot: any) => { const b = holder.get(spot.label.toLowerCase()); return `${h(spot.label)} ${b ? h(person(s, b.personId)) : spot.state === 'disabled' ? 'out of service' : 'free'}` }).join(' · ')}</span></p>`
}

/** The owner's move of a member's spot, in a full-width roster row. */
export function staffSpotRow(s: any, c: any, b: any, back: string) {
  if (!c.spots || b.status !== 'booked' || Date.parse(c.start) <= Date.now() || !c.spots.some((x: any) => x.state === 'free')) return ''
  const name = person(s, b.personId)
  return `<tr class="cancel-row"><td colspan="6"><details class="more"><summary>Move spot for ${h(name)}</summary><div class="panel-body">${form('booking.spot', back, hidden('id', b.id) + spotSelect(c.spots, 'New spot', '') + hidden('channel', 'desk'), 'Move spot', 'quiet', 'small')}</div></details></td></tr>`
}

export function spotsPanel(s: any) {
  const layouts = rows(s, 'spotLayouts')
  const list = layouts.length ? `<div class="table-wrap">${table(['Room', 'Spots', 'Out of service'], layouts.map(l => `<tr>${cell('Room', h(l.room))}${cell('Spots', h(l.spots.map((x: any) => x.label).join(', ')))}${cell('Out of service', h(l.spots.filter((x: any) => x.disabled).map((x: any) => x.label).join(', ') || 'None'))}</tr>`).join(''))}</div>` : emptyLine('No room has named spots yet: members book a place without choosing one.')
  const editor = form('spots.save', '/app/studio', `${field('room', 'Room (as written on its classes)', '', 'text', 'required maxlength="160" placeholder="Reformer Room"')}<div class="row2">${textarea('spots', 'Spots, one per line, in room order', '', 'rows="5" placeholder="Reformer 1"')}${textarea('disabled', 'Out of service, one per line', '', 'rows="5"')}</div>`, 'Save room spots')
  return panel('Room spots', `${list}${body(`<p class="meta">In a room with spots, members pick a free spot when they book, and a class seats no more people than the room has spots in service. Saving a room again replaces its list; a spot booked for an upcoming class must be moved before it is removed or taken out of service.</p>${editor}`)}`, { id: 'room-spots', icon: 'pin' })
}
