// SCHED-008 screens: the owner closes a room or the location, or cancels a
// class, from an impact preview; afterwards each affected member's notice and
// email outcome is shown exactly as recorded. Members read their notices.
import { classTitle, upcoming } from './facts'
import { clock, dayOf, dayShort, when } from './format'
import { body, emptyLine, field, form, h, hidden, owner, panel, person, rows, select, textarea } from './shared'

export const delivery = (d: any) => d ? ({
  accepted: `Email accepted by ${d.provider}; delivery not confirmed`,
  rejected: `Email refused by ${d.provider}${d.code ? ` (${d.code.replace(/_/g, ' ')})` : ''}`,
  rate_limited: `Email refused by ${d.provider} (rate limited); not retried`,
  uncertain: 'Email outcome unknown; not retried',
  sending: 'Email outcome unknown (interrupted); not retried',
  queued: 'Email reserved but not sent (interrupted)',
  not_configured: 'Email not configured; in-app notice only',
  no_address: 'No email address; in-app notice only',
  opted_out: 'Email opted out by member; in-app notice only',
  paused: 'Email paused after restore; in-app notice only until you reconnect member email',
} as Record<string, string>)[d.status] ?? d.status : ''

const at = (s: any, value: string) => `${dayShort(s, dayOf(s, value))} · ${clock(s, value)}`
const scopeText = (s: any, c: any) => c.scope === 'class' ? 'One class' : `${c.scope === 'room' ? `Room ${c.room}` : 'Whole location'}, ${at(s, c.start)} to ${at(s, c.end)}`

function impactList(s: any, c: any, deliveries: any[] = []) {
  const i = c.impact
  if (!i.classes.length) return emptyLine('No upcoming class is affected.')
  return i.classes.map((x: any) => `<p><strong>${h(classTitle(x))}</strong> · ${h(at(s, x.start))}${x.room ? ` · ${h(x.room)}` : ''}</p><ul class="impact">${x.bookings.map((b: any) => `<li>${h(person(s, b.personId))}: ${b.status === 'booked' ? b.creditReturned ? 'credit returns to their pack' : 'unpaid visit closes, no credit used' : 'waitlist spot closes, no credit used'}${c.status === 'applied' ? ` · in-app notice · ${h(delivery(deliveries.find(d => d.sourceKind === 'closure' && d.sourceId === c.id && d.personId === b.personId)))}` : ''}</li>`).join('') || '<li>No bookings.</li>'}</ul>`).join('')
}

const totals = (c: any) => `<p class="meta">${c.impact.classes.length} ${c.impact.classes.length === 1 ? 'class' : 'classes'} cancelled · ${c.impact.members} ${c.impact.members === 1 ? 'member' : 'members'} notified · ${c.impact.creditsReturned} credits returned · ${c.impact.waitlistClosed} waitlist spots closed · no money moves (card refunds arrive with billing).</p>`

export function closuresPanel(s: any) {
  if (!owner(s)) return ''
  const open = upcoming(s).filter(c => c.status === 'published' && Date.parse(c.start) > Date.now())
  const drafts = rows(s, 'closures').filter(c => c.status === 'draft').map(c => `<div class="panel-body"><p><span class="pill pending">Preview</span> ${h(scopeText(s, c))}: ${h(c.reason)}</p>${totals(c)}${impactList(s, c)}<p class="meta">Notices: an in-app notice to each member${c.email === 'configured' ? ', and one email to each member through the studio’s mail provider' : `; ${h(c.email)}`}.</p>${c.stale ? '<p class="notice error">Bookings changed since this preview. Preview the impact again before confirming.</p>' : form('closure.confirm', '/app/classes', hidden('id', c.id) + hidden('impact', c.impact.key), 'Confirm and notify members')}</div>`).join('')
  const done = rows(s, 'closures').filter(c => c.status === 'applied').sort((a, b) => b.appliedAt.localeCompare(a.appliedAt)).map(c => `<details class="more"><summary>${h(scopeText(s, c))}: ${h(c.reason)} · confirmed ${when(s, c.appliedAt)}</summary><div class="panel-body">${totals(c)}${impactList(s, c, rows(s, 'noticeDeliveries'))}</div></details>`).join('')
  const prepare = form('closure.prepare', '/app/classes', select('scope', 'What to close', [['class', 'Cancel one class'], ['room', 'Close a room'], ['location', 'Close the whole location']], 'class')
    + select('classId', 'Class (for one class)', [['', 'Choose a class'], ...open.map(c => [c.id, `${classTitle(c)} · ${at(s, c.start)}`] as [unknown, unknown])], '', '')
    + field('room', 'Room (for a room closure)', '', 'text', 'maxlength="100"')
    + `<div class="row2">${field('startDate', 'Closed from (date)', '', 'date')}${field('startTime', 'Time', '', 'time')}</div><div class="row2">${field('endDate', 'Until (date)', '', 'date')}${field('endTime', 'Time', '', 'time')}</div>`
    + textarea('reason', 'Reason members will see', '', 'required maxlength="300" rows="2"'), 'Preview the impact', 'quiet')
  return panel('Closures and cancellations', `${drafts}${body(`<p class="meta">Preview who is affected before anything changes. Confirming cancels the classes, returns each booked credit once, closes the waitlists and notifies every member once.</p>${prepare}`)}${done}`, { id: 'closures', icon: 'alert' })
}

/** Unread notices plus retained notice history when staff marked one read. */
export function noticesPanel(s: any) {
  const unread = rows(s, 'notices').filter(n => !n.dismissedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const staffRead = rows(s, 'notices').filter(n => n.dismissedByStaff).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (!unread.length && !staffRead.length) return ''
  const history = staffRead.length ? `<p class="meta">${staffRead.length} ${staffRead.length === 1 ? 'notice' : 'notices'} · Marked read by staff</p><details class="more"><summary>Read notice history</summary><div class="panel-body">${staffRead.map(n => `<div class="notice"><p><strong>${h(n.subject)}</strong></p><p>${h(n.body)}</p><p class="meta">Marked read by staff · ${when(s, n.dismissedByStaff.at)}</p></div>`).join('')}</div></details>` : ''
  return panel('Notices', body(unread.map(n => `<div class="notice" role="status"><p><strong>${h(n.subject)}</strong></p><p>${h(n.body)}</p>${form('notice.dismiss', '/app', hidden('id', n.id), 'Dismiss', 'quiet', 'small')}</div>`).join('') + history), { icon: 'alert', count: unread.length })
}
