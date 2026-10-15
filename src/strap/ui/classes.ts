import { approvals, drafts, empty, entry, exact, field, form, h, hidden, owner, panel, person, rows, stamp, status, textarea } from './shared'

function waiver(s: any) {
 const current = s.waiver
 const acknowledged = current && rows(s, 'acknowledgements').some(a => a.personId === s.actor.personId && a.waiverId === current.id)
 const published = current ? `${status(`Version ${current.id}`)}<p class="waiver-text">${h(current.text)}</p>${s.actor.role === 'member' ? acknowledged ? '<p>Version acknowledged. You can book a class.</p>' : form('waiver.acknowledge', '/app', hidden('id', current.id), 'I acknowledge this waiver version') : ''}` : empty('No waiver has been published. The owner can publish one to require acknowledgement before booking.')
 return panel('Current waiver', published + (owner(s) ? `<details><summary>Publish a new waiver version</summary><p>Members must acknowledge the new version before making another booking.</p>${form('waiver.publish', '/app', textarea('text', 'Waiver text', '', 'required'), 'Publish new waiver version')}</details>` : ''))
}

function classEntry(s: any, c: any) {
 const bookings = rows(s, 'bookings').filter(b => b.classId === c.id)
 const booked = bookings.filter(b => b.status === 'booked')
 const ownBooking = bookings.find(b => b.personId === s.actor.personId && b.status !== 'cancelled')
 let actions = ''
 if (s.actor.role === 'member') {
  actions = ownBooking ? `${status(ownBooking.status)}${form('booking.cancel', '/app', hidden('id', ownBooking.id), 'Cancel my booking')}` : form('booking.book', '/app', hidden('classId', c.id), 'Book class or join waitlist')
 }
 if (['instructor', 'owner'].includes(s.actor.role)) {
  actions = bookings.filter(b => b.status !== 'cancelled').map(b => entry(String(person(s, b.personId)), `${status(b.status)}${b.checkedInAt ? `<p>Checked in ${stamp(b.checkedInAt)}</p>` : b.status === 'booked' && (owner(s) || s.actor.personId === c.instructorId) ? form('attendance.checkin', '/app', hidden('id', b.id), 'Check in') : ''}`)).join('') || empty('No bookings for this class yet.')
 }
 return entry(c.title, `<p>${stamp(c.start)}<br>to ${stamp(c.end)}</p><p>Instructor: ${h(c.instructorName ?? person(s, c.instructorId))}<br>Capacity: ${h(c.capacity)}${s.actor.role !== 'member' ? ` · Booked: ${booked.length}` : ''}</p>${actions}`)
}

export function classes(s: any) {
 const title = s.actor.role === 'instructor' ? 'My teaching schedule' : 'Classes'
 const schedule = panel('Published classes', rows(s, 'classes').length ? rows(s, 'classes').map(c => classEntry(s, c)).join('') : empty(owner(s) ? 'Prepare a class week, review its exact contents and publish it to open bookings.' : 'No published classes are available yet.'))
 const preparation = owner(s) ? panel('Prepare a class week', `<p>Choose the Monday starting the week. Enter each class with title, start, end, capacity and instructorId. Start and end use ISO timestamps with a timezone. Preparation creates a draft for review.</p>${rows(s, 'people').filter(p => p.active && p.role === 'instructor').length ? `<details><summary>Instructor IDs</summary>${exact(rows(s, 'people').filter(p => p.active && p.role === 'instructor').map(p => ({ id: p.id, name: p.name })))}</details>` : '<p>Add an active instructor in <a href="/app/people">People</a> before preparing classes.</p>'}${form('classes.prepare', '/app', field('week', 'Week starting Monday', '', 'date', 'required') + textarea('classes', 'Classes (JSON array)', '', 'required spellcheck="false" aria-describedby="class-format"') + '<p class="help" id="class-format">Each object needs title, start, end, capacity (number), and instructorId. Use the exact instructor ID shown above.</p>', 'Prepare class week')}`) : ''
 const balances = s.actor.role === 'member' ? panel('My credits', rows(s, 'packs').length ? rows(s, 'packs').map(p => entry(`${p.remaining} credits remaining`, `<p>Original credits: ${h(p.credits)}<br>Expires ${stamp(p.expiresAt)}</p>`)).join('') : empty('You have no class packs. Contact your studio to arrange credits.')) : ''
 return `<h1>${h(title)}</h1><p>Class times show their stored timezone. A booking uses one eligible credit; a waitlist entry reserves no credit until promoted.</p><div class="grid">${schedule}${balances}${waiver(s)}${preparation}${owner(s) ? `<div class="full">${drafts(s, '/app', ['classes'])}${approvals(s)}</div>` : ''}</div>`
}
