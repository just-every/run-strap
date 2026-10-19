// Prepared drafts and approvals as people read them: who, what, how much and
// when, with the exact contents a draft freezes and its one approval button.
import { classRoom, classTitle } from './facts'
import { clock, dayOf, dayShort, datePlain, length, money, when } from './format'
import { icon } from './icons'
import { cell, emptyLine, form, h, hidden, owner, person, rows, statusPill, table } from './shared'
import { packExpiration } from './pack-history'
import { allocationDetails, conflictDetails, draftConflicts } from './scheduling'

const kinds: Record<string, { glyph: string; title: string; page: string; approve: string; command: string }> = {
  'booking-change': { glyph:'calendar', title:'Booking change', page:'/app/people', approve:'Approve this exact booking change', command:'booking.change.approve' },
  pack: { glyph: 'card', title: 'New class pack', page: '/app/packs', approve: 'Approve this exact pack', command: 'pack.approve' },
  reminder: { glyph: 'chat', title: 'Balance reminder', page: '/app/packs', approve: 'Approve this exact reminder', command: 'reminder.approve' },
  classes: { glyph: 'calendar', title: 'Class week', page: '/app/classes', approve: 'Approve and publish this exact week', command: 'classes.publish' },
}
export const draftPage = (d: any) => kinds[d.type]?.page ?? '/app'
export const draftGlyph = (d: any) => kinds[d.type]?.glyph ?? 'report'
export const draftTitle = (d: any) => kinds[d.type]?.title ?? 'Draft'

/** One line about what the draft would do: "Jordan Park · 10 credits · $189.00". */
export function draftLine(s: any, d: any) {
  if (d.type === 'booking-change') return `${person(s,d.personId)} · ${d.action}`
  if (d.type === 'pack') return `${person(s, d.personId)} · ${d.credits} credits · ${money(d.amountCents)}`
  if (d.type === 'reminder') return `${person(s, d.personId)} · ${money(d.balanceCents)} owed`
  if (d.type === 'classes') return `Week of ${dayShort(s, d.week)} · ${d.classes.length} ${d.classes.length === 1 ? 'class' : 'classes'}`
  return d.type
}
export const preparedBy = (s: any, d: any) => `${d.createdByRole === 'agent' ? 'Prepared by your agent' : 'Prepared by you'} · ${when(s, d.createdAt)}`

function contents(s: any, d: any) {
  if (d.type === 'booking-change') {
    const b = rows(s,'bookings').find(b => b.id === d.change.id), c = rows(s,'classes').find(c => c.id === b?.classId), target = rows(s,'classes').find(c => c.id === d.change.classId)
    const fee = d.change.mode === 'early' ? 0 : b?.cancelEffect?.feeCents ?? 0
    return `<dl class="facts"><dt>Member</dt><dd>${h(person(s,d.personId))}</dd><dt>Change</dt><dd>${h(d.action)} ${h(c?.title ?? '')}${target ? ` to ${h(target.title)} · ${when(s,target.start)}` : ''}</dd><dt>Policy choice</dt><dd>${h(d.change.mode ?? b?.cancelEffect?.timing ?? '')} · ${money(fee)} fee added; no payment collected</dd><dt>Reason</dt><dd>${h(d.change.cancelReason)}${d.change.reason ? ` · ${h(d.change.reason)}` : ''}</dd><dt>Channel</dt><dd>${h(d.change.channel ?? 'desk')}</dd><dt>Override</dt><dd>${h(d.change.override ?? 'None')}</dd><dt>Member notice</dt><dd>${d.change.suppressNotice ? `Suppressed: ${h(d.change.suppressionReason)}` : 'In-app and configured email'}</dd></dl>`
  }
  if (d.type === 'pack') return `<dl class="facts"><dt>Member</dt><dd>${h(person(s, d.personId))}</dd><dt>Credits</dt><dd>${h(d.credits)} classes</dd><dt>Price</dt><dd>${money(d.amountCents)}, owed once approved</dd><dt>Eligible services</dt><dd>${h(d.eligibleServices?.length ? d.eligibleServices.join(', ') : 'All services')}</dd><dt>Expires</dt><dd>${packExpiration(s, d.expiresAt)}</dd><dt>Priority booking</dt><dd>${d.priorityBooking ? 'Yes' : 'No'}</dd></dl>`
  if (d.type === 'reminder') return `<dl class="facts"><dt>To</dt><dd>${h(d.recipient)}</dd><dt>Subject</dt><dd>${h(d.subject)}</dd></dl><p class="letter">${h(d.body)}</p>`
  if (d.type === 'classes') return table(['Day', 'Time', 'Class', 'Instructor', '>Spots'], d.classes.map((c: any) =>
    `<tr>${cell('Day', h(dayShort(s, dayOf(s, c.start))))}${cell('Time', `${h(clock(s, c.start))} <small>${h(length(c.start, c.end))}</small>`)}${cell('Class', `<strong>${h(classTitle(c))}</strong>${classRoom(c) ? `<small>${h(classRoom(c))}</small>` : ''}${c.service && c.service !== classTitle(c) ? `<small>Service: ${h(c.service)}</small>` : ''}${allocationDetails(c)}`)}${cell('Instructor', h(c.instructorName))}${cell('Spots', `${h(c.capacity)} total · ${h(c.onlineCapacity ?? c.capacity)} online · ${h(c.capacity - (c.onlineCapacity ?? c.capacity))} desk-held`, 'right')}</tr>`).join(''))
  return ''
}

/** The drafts of these kinds still waiting for approval, each with its exact contents. */
export function draftRecords(s: any, path: string, types: string[]) {
  const items = rows(s, 'drafts').filter(d => types.includes(d.type) && d.status === 'draft').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const list = items.map(d => {
    const kind = kinds[d.type]
    const conflicts = d.type === 'classes' ? draftConflicts(s, d) : []
    const approve = owner(s) && !conflicts.length ? `<div class="actions">${form(kind.command, path, hidden('id', d.id), kind.approve)}</div>` : ''
    return `<article class="record" id="draft-${h(d.id)}"><span class="approval-mark">${icon(kind.glyph)}</span><div><h3>${h(kind.title)}</h3><p>${h(draftLine(s, d))}</p><p class="meta">${preparedBy(s, d)}</p></div>${statusPill(conflicts.length ? 'Blocked' : 'Needs approval')}<div class="record-body">${contents(s, d)}${conflictDetails(s, conflicts)}${approve}</div></article>`
  }).join('')
  return { waiting: items.length, html: list ? `<div class="records">${list}</div>` : emptyLine('Nothing is waiting. A prepared draft shows its exact contents here before anyone approves it.') }
}

/** Who approved what, and when: the latest ten, the rest one click away. */
export function approvalHistory(s: any, types: string[]) {
  const drafts = new Map(rows(s, 'drafts').map(d => [d.id, d]))
  const list = rows(s, 'approvals').filter(a => types.includes(a.type)).sort((a, b) => b.approvedAt.localeCompare(a.approvedAt))
  if (!list.length) return emptyLine('Approved class weeks, packs and reminders appear here.')
  const line = (a: any) => {
    const d = drafts.get(a.draftId)
    const file = d?.type === 'reminder' && owner(s) ? ` <a href="/api/strap/reminders/${h(d.id)}.txt">Download</a>` : ''
    return `<tr>${cell('Approved', when(s, a.approvedAt))}${cell('What', h(draftTitle(a)))}${cell('Details', (d ? h(draftLine(s, d)) : '—') + file)}</tr>`
  }
  const heads = ['Approved', 'What', 'Details']
  return `<div class="table-wrap">${table(heads, list.slice(0, 10).map(line).join(''))}</div>${list.length > 10 ? `<details class="more"><summary>Show ${list.length - 10} earlier approvals</summary><div class="table-wrap">${table(heads, list.slice(10).map(line).join(''))}</div></details>` : ''}`
}
