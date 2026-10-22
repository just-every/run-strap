// SCHED-014 desk controls share the existing roster and member card surfaces.
import { filteredCancellations } from '../cancellations'
import { actionChannel, actionNotice, cancellationReason, effectText } from './booking-rules'
import { classRoom, classTitle } from './facts'
import { clock, dayOf, dayShort, money, when } from './format'
import { body, cell, emptyLine, field, form, h, hidden, owner, panel, person, rows, select, table, textarea } from './shared'

const stamp = (s: any, at: string) => `${dayShort(s, dayOf(s, at))} · ${clock(s, at)}`
const future = (c: any) => c?.status === 'published' && Date.parse(c.start) > Date.now()
export const canRestore = (c: any, b: any) => future(c) && b.status === 'cancelled'
  && ['early', 'late'].includes(b.cancellation)
const overrideField = () => field('override', 'Capacity override reason (optional)', '', 'text', 'maxlength="500"')
const details = (title: string, controls: string) => `<details class="more"><summary>${h(title)}</summary><div class="panel-body">${controls}</div></details>`

function moveControl(s: any, c: any, b: any, back: string) {
  const e = b.cancelEffect
  if (b.status !== 'booked' || !e) return ''
  const targets = rows(s, 'classes').filter(target => target.id !== c.id && future(target)).sort((a, b) => a.start.localeCompare(b.start))
  if (!targets.length) return details('Move booking', emptyLine('No other published future classes.'))
  const choices: [unknown, unknown][] = [['', 'Choose a target class'], ...targets.map(target => [target.id, `${classTitle(target)} · ${stamp(s, target.start)} · ${classRoom(target)}${target.occupancy.booked >= target.occupancy.total ? ' · Full: join waitlist' : ''}`] as [unknown, unknown])]
  const mode = e.waivable
    ? select('mode', 'Source cancellation choice', [['late', `Late move: ${money(e.feeCents)} fee; credit carries`], ['early', 'Early move: credit carries, no fee']], 'late')
      + field('reason', 'Waiver reason (required for early cancel)', '', 'text', 'maxlength="500"')
    : hidden('mode', e.timing)
  return details('Move booking', `<p class="meta">Move now: ${money(e.feeCents)}${e.timing === 'late' ? ' late' : ''} fee; ${e.unpaid ? 'the unpaid visit moves with no credit used' : 'your original credit moves to the new class'}. ${e.waivable ? 'Choosing early waives the source late-cancel fee and records your waiver reason. ' : ''}If the target is full, join its waitlist and keep the original seat unless you supply a capacity override reason.</p>`
    + form('booking.move', back, hidden('id', b.id) + hidden('terms', e.key) + select('classId', 'Target class', choices) + mode + cancellationReason(s) + actionChannel()
      + field('spot', 'Target spot (blank = first free)', '', 'text', 'maxlength="80"') + overrideField(), 'Move booking', 'quiet', 'small'))
}

export function restoreControl(s: any, c: any, b: any, back: string) {
  if (!owner(s) || !canRestore(c, b)) return ''
  return details('Restore booking', '<p class="meta">Restore rechecks the member’s eligibility, available credit and capacity. A full class requires a capacity override reason.</p>'
    + form('booking.restore', back, hidden('id', b.id) + actionChannel() + field('reason', 'Restore reason', '', 'text', 'required maxlength="500"') + overrideField(), 'Restore booking', 'quiet', 'small'))
}

/** Move, restore or explicitly override a waiting member’s queue position. */
export function bookingControls(s: any, c: any, b: any, back: string) {
  if (!owner(s) || !future(c)) return ''
  const position = b.status === 'waitlisted' ? details('Change waitlist position', '<p class="meta">Changing the queue order records your override reason.</p>'
    + form('booking.waitlist.position', back, hidden('id', b.id) + field('position', 'New position', '', 'number', 'required min="1" step="1"') + field('reason', 'Position override reason', '', 'text', 'required maxlength="500"') + actionChannel(), 'Save position', 'quiet', 'small')) : ''
  return moveControl(s, c, b, back) + restoreControl(s, c, b, back) + position
}

export function bookingActionRow(s: any, c: any, b: any, back: string) {
  const controls = bookingControls(s, c, b, back)
  return controls ? `<tr class="cancel-row"><td colspan="6">${controls}</td></tr>` : ''
}

export function bulkCancel(s: any, c: any, booked: any[], back: string) {
  if (!owner(s) || !future(c) || !booked.length) return ''
  const choices = booked.filter(b => b.cancelEffect).map(b => `<label class="check"><input type="checkbox" name="b_${h(b.id)}" value="true"> ${h(person(s, b.personId))} — ${h(effectText(b.cancelEffect, false))}</label>`).join('')
  if (!choices) return ''
  return details('Cancel selected bookings early', '<p class="meta">Select the bookings to cancel. Eligible credits return and no late-cancel fees are added. Each booking is checked separately; the result shows any booking that could not be cancelled.</p>'
    + form('booking.bulk.cancel', back, hidden('mode', 'early') + choices + cancellationReason(s) + field('reason', 'Bulk early-cancel / waiver reason', '', 'text', 'required maxlength="500"') + actionChannel() + actionNotice(), 'Early cancel selected bookings', 'quiet', 'small'))
}

/** The HTTP action response carries one result per selected booking. */
export function bulkResult(notice: any) {
  const outcomes = notice.result?.bulk?.outcomes
  if (!Array.isArray(outcomes)) return ''
  return `<div class="notice" role="status"><p>Bulk cancellation results</p><ul>${outcomes.map((item: any) => `<li>${h(item.id)}: ${item.ok ? 'Cancelled' : `Not cancelled — ${h(item.error)}`}</li>`).join('')}</ul></div>`
}

export function cancellationReasonsPanel(s: any) {
  if (!owner(s)) return ''
  return panel('Cancellation reasons', body(form('cancellationReasons.save', '/app/people#cancellations', textarea('reasons', 'One reason per line', rows(s, 'cancellationReasons').join('\n'), 'required rows="4"'), 'Save cancellation reasons', 'quiet')), { icon: 'clock' })
}

/** Historical cancellation events remain visible after a booking is restored. */
export function cancellationsPanel(s: any, query: URLSearchParams) {
  if (!owner(s)) return ''
  const events = rows(s, 'bookingActions').filter(action => action.action === 'cancel')
  const filters = new URLSearchParams()
  for (const key of ['date', 'classId', 'staffId', 'type']) if (query.get(key)) filters.set(key, query.get(key)!)
  const filtered = filteredCancellations(events, s.studio?.timeZone ?? 'UTC', filters)
  const classIds = new Set(events.map(action => action.classId)), staffIds = [...new Set(events.map(action => action.actorId))]
  const controls = field('date', 'Cancellation date', query.get('date'), 'date')
    + select('classId', 'Class', [['', 'All classes'], ...rows(s, 'classes').filter(c => classIds.has(c.id)).map(c => [c.id, `${classTitle(c)} · ${stamp(s, c.start)}`] as [unknown, unknown])], query.get('classId') ?? '', '')
    + select('staffId', 'Actor', [['', 'All actors'], ...staffIds.map(id => [id, `${id} (${events.find(action => action.actorId === id)?.actorRole})`] as [unknown, unknown])], query.get('staffId') ?? '', '')
    + select('type', 'Cancellation type', [['', 'All types'], ['early', 'Early'], ['late', 'Late'], ['waitlist', 'Waitlist'], ['class_cancelled', 'Class cancelled'], ['waitlist_closed', 'Waitlist closed'], ['offer_expired', 'Offer expired']], query.get('type') ?? '', '')
  const preserved = ['q', 'person'].filter(key => query.has(key)).map(key => hidden(key, query.get(key))).join('')
  const search = `<form class="form" method="get" action="/app/people#cancellations">${preserved}<div class="row2">${controls}</div><button class="btn-quiet" type="submit">Filter cancellations</button></form>`
  const back = `/app/people${query.size ? `?${query.toString()}` : ''}#cancellations`
  const list = filtered.map(action => {
    const c = rows(s, 'classes').find(c => c.id === action.classId), b = rows(s, 'bookings').find(b => b.id === action.bookingId)
    const lastCancel = events.filter(item => item.bookingId === action.bookingId).sort((a, b) => b.at.localeCompare(a.at))[0]
    const restore = action.restoredAt ? `<small>Restored ${when(s, action.restoredAt)}</small>` : b && lastCancel.id === action.id ? restoreControl(s, c, b, back) : ''
    const notice = action.notice?.status === 'suppressed' ? 'Suppressed' : action.notice?.status === 'in_app' ? 'In-app notice' : '—'
    const restoreRow = restore.startsWith('<details') ? `<tr><td colspan="3">${restore}</td></tr>` : ''
    return `<tr>${cell('Member / class', `<strong>${h(person(s, action.personId))}</strong><small>${h(c ? classTitle(c) : action.classId)}${c ? ` · ${when(s, c.start, c.timeZone)}` : ''}</small><small>Cancelled ${when(s, action.at)}</small>`)}${cell('Action', `${h(action.type)} · ${money(action.feeCents)} fee<small>${action.creditReturned ? 'Credit returned' : 'No credit returned'}</small><small>${h(action.reason)}</small>${action.waiver?.reason ? `<small>Waiver: ${h(action.waiver.reason)}</small>` : ''}<small>${h(action.actorRole)} · ${h(action.actorId)} · ${h(action.channel)}</small>`)}${cell('Notice / restore', `${notice}${action.notice?.suppressionReason ? `<small>Suppression reason: ${h(action.notice.suppressionReason)}</small>` : ''}${action.notice?.mailStatus ? `<small>Mail: ${h(action.notice.mailStatus)}</small>` : ''}${restoreRow ? '' : restore}`)}</tr>${restoreRow}`
  }).join('')
  const exportLink = `/api/strap/cancellations.csv${filters.size ? `?${filters.toString()}` : ''}`
  return panel('Cancellations', body(`${search}<p class="meta">${filtered.length} cancellations · ${filtered.filter(action => action.type === 'late').length} late · <a href="${h(exportLink)}">Download filtered CSV</a> · <a href="${h(exportLink.replace('.csv','.xlsx'))}">Download filtered XLSX</a></p>`)
    + (list ? `<div class="table-wrap">${table(['Member / class', 'Action', 'Notice / restore'], list)}</div>` : emptyLine('No cancellations match these filters.')), { id: 'cancellations', icon: 'clock' })
}
