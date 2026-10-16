import { approvals, drafts, empty, emptyMat, exact, field, form, h, hidden, initials, matPanel, owner, panel, person, row, rows, stamp, status, textarea } from './shared'

function waiver(s: any) {
 const current = s.waiver
 const acknowledged = current && rows(s, 'acknowledgements').some(a => a.personId === s.actor.personId && a.waiverId === current.id)
 const published = current ? `${status(`Version ${current.version ?? current.id}`)}<p class="waiver-text">${h(current.text)}</p>${s.actor.role === 'member' ? acknowledged ? '<p class="meta">Version acknowledged. You can book a class.</p>' : form('waiver.acknowledge', '/app', hidden('id', current.id), 'I acknowledge this waiver version') : ''}` : empty('No waiver has been published. The owner can publish one to require acknowledgement before booking.')
 return panel('Current waiver', published + (owner(s) ? `<details><summary>Publish a new waiver version</summary><p class="meta">Members must acknowledge the new version before making another booking.</p>${form('waiver.publish', '/app', textarea('text', 'Waiver text', '', 'required'), 'Publish new waiver version')}</details>` : ''))
}

// The class's people for its instructor or the owner: who is booked or waiting, and Check in.
function attendees(s: any, c: any, bookings: any[]) {
 return bookings.filter(b => b.status !== 'cancelled').map(b => row({
  lead: initials(person(s, b.personId)),
  title: String(person(s, b.personId)),
  meta: status(b.status),
  actions: b.checkedInAt ? `<span class="meta">Checked in ${stamp(b.checkedInAt)}</span>` : b.status === 'booked' && (owner(s) || s.actor.personId === c.instructorId) ? form('attendance.checkin', '/app', hidden('id', b.id), 'Check in') : '',
 })).join('') || empty('No bookings for this class yet.')
}

function classEntry(s: any, c: any, current: boolean) {
 const bookings = rows(s, 'bookings').filter(b => b.classId === c.id)
 const booked = bookings.filter(b => b.status === 'booked')
 const when = `${stamp(c.start)} to ${stamp(c.end)}`
 const instructor = `Instructor: ${h(c.instructorName ?? person(s, c.instructorId))}`
 const capacity = `Capacity: ${h(c.capacity)}${s.actor.role !== 'member' ? ` · Booked: ${booked.length}` : ''}`
 if (s.actor.role === 'member') {
  const own = bookings.find(b => b.personId === s.actor.personId && b.status !== 'cancelled')
  return row({ title: c.title, sub: `${when}<br>${instructor}<br>${capacity}`, actions: own ? `${status(own.status)}${form('booking.cancel', '/app', hidden('id', own.id), 'Cancel my booking', 'secondary')}` : form('booking.book', '/app', hidden('classId', c.id), 'Book class or join waitlist') })
 }
 if (s.actor.role === 'instructor') return `<article class="class-block"><h3>${h(c.title)}</h3><p class="row-sub">${when}<br>${instructor}<br>${capacity}</p><div class="attendees">${attendees(s, c, bookings)}</div></article>`
 return row({ title: c.title, sub: when, meta: `${instructor}<br>${capacity}`, current, more: `<details><summary>Bookings · ${bookings.filter(b => b.status !== 'cancelled').length}</summary>${attendees(s, c, bookings)}</details>` })
}

export function classes(s: any) {
 const title = s.actor.role === 'instructor' ? 'My teaching schedule' : 'Classes'
 const list = rows(s, 'classes')
 const next = list.find(c => Date.parse(c.end) > Date.now())
 const schedule = list.length
  ? matPanel('Published classes', list.map(c => classEntry(s, c, c === next)).join(''))
  : emptyMat(owner(s) ? 'Prepare a class week, review its exact contents and publish it to open bookings.' : 'No published classes are available yet.', owner(s) ? '<a class="btn" href="#prepare-week">Prepare class week</a>' : '')
 const instructors = rows(s, 'people').filter(p => p.active && p.role === 'instructor')
 const preparation = owner(s) ? panel('Prepare a class week', `<p class="meta">Choose the Monday starting the week. Enter each class with title, start, end, capacity and instructorId. Start and end use ISO timestamps with a timezone. Preparation creates a draft for review.</p>${instructors.length ? `<details><summary>Instructor IDs</summary>${exact(instructors.map(p => ({ id: p.id, name: p.name })))}</details>` : '<p class="meta">Add an active instructor in <a href="/app/people">People</a> before preparing classes.</p>'}${form('classes.prepare', '/app', field('week', 'Week starting Monday', '', 'date', 'required') + textarea('classes', 'Classes (JSON array)', '', 'required spellcheck="false" aria-describedby="class-format"') + '<p class="help" id="class-format">Each object needs title, start, end, capacity (number), and instructorId. Use the exact instructor ID shown above.</p>', 'Prepare class week')}`, 'prepare-week') : ''
 const credits = s.actor.role === 'member' ? panel('My credits', rows(s, 'packs').length ? rows(s, 'packs').map(p => `<article class="credits"><p class="credits-count"><strong>${h(p.remaining)}</strong> credits remaining</p><p class="meta">Original credits: ${h(p.credits)}<br>Expires ${stamp(p.expiresAt)}</p></article>`).join('') : empty('You have no class packs. Contact your studio to arrange credits.')) : ''
 const aside = `${credits}${waiver(s)}${preparation}`
 const main = list.length ? `<div class="columns"><div class="col-main">${schedule}</div><div class="col-aside">${aside}</div></div>` : `${schedule}<div class="grid">${aside}</div>`
 return `<h1>${h(title)}</h1><p class="lede">Class times show their stored timezone. A booking uses one eligible credit; a waitlist entry reserves no credit until promoted.</p>${main}${owner(s) ? `<div class="full">${drafts(s, '/app', ['classes'])}${approvals(s)}</div>` : ''}`
}
