// Classes: the published week by day, the class-week editor (days, times and
// instructors picked in the studio's zone, never typed as JSON), the waiver,
// and class-week drafts with their approval.
import { attendance, classRoom, classTitle, upcoming } from './facts'
import { clock, dayLong, dayOf, dayShort, length, studioToday } from './format'
import { approvalHistory, draftRecords } from './drafts'
import { body, cell, emptyLine, emptyState, field, form, h, hidden, owner, panel, person, rows, select, table, textarea } from './shared'
import { addDays, mondayOf, zoneName } from '../zone'
import { allocationDetails, availabilityPanel } from './scheduling'
import { ruleLine } from './booking-rules'
import { closuresPanel } from './closures'

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** The week by day. Members see how many spots are open; staff see who has booked. */
export function weekTable(s: any, list: any[], action: (c: any) => string = () => '') {
  const staff = s.actor.role !== 'member'
  let day = ''
  return table(['Time', 'Class', 'Instructor', 'Spots', ''], list.map(c => {
    const date = dayOf(s, c.start), a = attendance(s, c.id), full = staff ? c.occupancy.totalOpen === 0 : c.occupancy.onlineOpen === 0
    const heading = date !== day ? `<tr class="day-row"><td colspan="5">${h(dayShort(s, date))}${date === studioToday(s) ? ' · Today' : ''}</td></tr>` : ''
    day = date
    return heading + `<tr>${cell('Time', `<a href="/app?day=${date}&amp;class=${encodeURIComponent(c.id)}#class-${h(c.id)}">${h(clock(s, c.start))}</a><small>${h(length(c.start, c.end))}</small>`)}${cell('Class', `<strong>${h(classTitle(c))}</strong>${c.status === 'cancelled' ? ` <span class="pill quiet">Cancelled</span><small>${h(c.cancelReason)}</small>` : ''}${classRoom(c) ? `<small>${h(classRoom(c))}</small>` : ''}${staff ? allocationDetails(c) : ruleLine(s, c)}`, 'bare')}${cell('Instructor', h(c.instructorName ?? person(s, c.instructorId)), 'bare')}`
      + `${cell('Spots', staff ? `<span class="pill${full ? ' full' : ''}">${c.occupancy.booked} of ${c.occupancy.total}</span><small>${c.occupancy.onlineBooked} / ${c.occupancy.online} online · ${c.occupancy.heldBooked} / ${c.occupancy.held} desk-held</small>${a.waiting.length ? ` <span class="pill wait">Waitlist <b>${a.waiting.length}</b></span>` : ''}` : full ? `<span class="pill full">Full${a.waiting.length ? ` · waitlist ${a.waiting.length}` : ''}</span>` : `<span class="pill quiet">${c.occupancy.onlineOpen} open</span>`, 'bare')}${cell('', action(c), 'right')}</tr>`
  }).join(''))
}

function editor(s: any, count: number) {
  const instructors = rows(s, 'people').filter(p => p.active && p.role === 'instructor')
  if (!s.studio) return `<p class="meta">Set the studio’s time zone in <a href="/app/studio">Studio settings</a> before preparing classes.</p>`
  if (!instructors.length) return `<p class="meta">Add an active instructor in <a href="/app/people#add-person">People</a> before preparing classes.</p>`
  // The weeks an owner can prepare: this week (if not over) and the next nine, by their Monday.
  const monday = addDays(mondayOf(studioToday(s)), 7)
  const line = (i: number) => `<tr><td>${i + 1}</td>`
    + `<td class="wide">${field(`c${i}_title`, 'Class', '', 'text', `maxlength="120"${i ? '' : ' placeholder="Reformer Flow"'}`)}${field(`c${i}_service`, 'Service (blank = class name)', '', 'text', 'maxlength="160"')}</td>`
    + `<td>${field(`c${i}_room`, 'Room', '', 'text', `maxlength="100"${i ? '' : ' placeholder="Reformer room"'}`)}${textarea(`c${i}_equipment`, 'Equipment / reformers (one name per line)', '', 'rows="2"')}</td>`
    + `<td class="w-day">${select(`c${i}_day`, 'Day', days.map((d, n) => [String(n), d] as [unknown, unknown]), '0', '')}</td>`
    + `<td class="w-time">${field(`c${i}_time`, 'Starts', '', 'time', 'step="300"')}</td>`
    + `<td class="w-min">${field(`c${i}_minutes`, 'Minutes', '50', 'number', 'min="5" max="600" step="5"')}${field(`c${i}_bufferBeforeMinutes`, 'Prep before (min)', '0', 'number', 'min="0" max="1440"')}${field(`c${i}_bufferAfterMinutes`, 'Cleanup after (min)', '0', 'number', 'min="0" max="1440"')}</td>`
    + `<td class="w-cap">${field(`c${i}_capacity`, 'Spots', '12', 'number', 'min="1" max="1000" step="1"')}${field(`c${i}_onlineCapacity`, 'Online spots (blank = total)', '', 'number', 'min="0" max="1000" step="1"')}</td>`
    + `<td class="w-who wide">${select(`c${i}_instructorId`, 'Instructor', instructors.map(p => [p.id, p.name] as [unknown, unknown]), instructors[i % instructors.length].id, '')}</td></tr>`
  return `<p>Choose the Monday that starts the week, then add each class. Times are on the studio’s clock (${h(zoneName(s.studio.timeZone))}). Rows without a class name are skipped. Preparing makes a draft you review before it opens for booking.</p>`
    + form('classes.prepare', '/app/classes', `${select('week', 'Week starting', Array.from({ length: 10 }, (_, n) => { const d = addDays(monday, 7 * (n - 1)); return [d, dayLong(d)] as [unknown, unknown] }), monday)}${hidden('rows', count)}<table class="week-editor"><thead><tr><th>#</th><th>Class</th><th>Room</th><th>Day</th><th>Starts</th><th>Minutes</th><th>Spots</th><th>Instructor</th></tr></thead><tbody>${Array.from({ length: count }, (_, i) => line(i)).join('')}</tbody></table>`
      .replace(/<label class="field">(?:<span>)?(Class|Room|Day|Starts|Minutes|Spots|Instructor)(?:<\/span>)?</g, '<label class="field"><span class="visually-hidden">$1</span><'), 'Prepare class week')
    + `<p class="meta"><a href="/app/classes?rows=${Math.min(count + 7, 70)}#prepare-week">Add seven more rows</a></p>`
}

function waiver(s: any) {
  const current = s.waiver
  const text = current ? `<p><span class="pill done">Version ${h(current.version ?? 1)}</span></p><p class="letter">${h(current.text)}</p>` : emptyLine('No waiver published. Publish one and members acknowledge it before they book.')
  return panel('Waiver', `<div class="panel-body">${text}</div>${owner(s) ? `<details class="more"><summary>Publish a new version</summary><div class="panel-body"><p class="meta">Members acknowledge the new version before their next booking.</p>${form('waiver.publish', '/app/classes', textarea('text', 'Waiver text', '', 'required'), 'Publish new waiver version')}</div></details>` : ''}`, { icon: 'report' })
}

export function classesPage(s: any, query: URLSearchParams) {
  const list = upcoming(s), mine = s.actor.role === 'instructor'
  const count = Math.max(7, Math.min(70, Number(query.get('rows')) || 7))
  const week = list.length ? `<div class="table-wrap">${weekTable(s, list)}</div>` : emptyState('calendar', mine ? 'Nothing on your schedule' : 'No classes on the schedule', mine ? 'Classes you teach appear here once the owner publishes them.' : 'Prepare a class week below, review its exact contents and publish it to open booking.', owner(s) ? '<a class="btn" href="#prepare-week">Prepare a class week</a>' : '')
  const drafts = owner(s) ? draftRecords(s, '/app/classes', ['classes']) : null
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>${mine ? 'My classes' : 'Classes'}</h1><p>${list.length} upcoming</p></div>`
    + panel(mine ? 'My teaching schedule' : 'Upcoming classes', week, { icon: 'calendar', note: s.studio ? h(zoneName(s.studio.timeZone)) : 'Times in UTC until the studio sets its zone' })
    + (owner(s) ? panel('Prepare a class week', body(editor(s, count)), { id: 'prepare-week', icon: 'plus' }) : '')
    + (drafts ? panel('Prepared class weeks', drafts.html, { count: drafts.waiting, icon: 'clock' }) + panel('Approval history', approvalHistory(s, ['classes']), { icon: 'check' }) : '')
    + closuresPanel(s) + (owner(s) ? availabilityPanel(s) : '') + waiver(s) + `</div></div>`
}
