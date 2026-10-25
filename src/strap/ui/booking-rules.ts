// SCHED-006 on screen: the booking window and cancellation rule a member reads
// before booking, the exact effect shown before a cancellation, the owner's
// late-or-early choice at the desk, and the rules editor in Studio settings.
// The no-show fee (ATT-002) is disclosed with the rule and kept in its terms.
import { money, when } from './format'
import { body, cell, emptyLine, field, form, h, hidden, owner, panel, rows, select, table } from './shared'

const span = (minutes: number) => minutes % 60 ? `${minutes} min` : `${minutes / 60} hr`
const now = () => Date.now(), time = (value: unknown) => Date.parse(String(value))

/** Whether a member can book this class now, and when that changes. */
export function windowState(c: any, priority: boolean): 'open' | 'not-open' | 'closed' {
  const w = c.bookingWindow, opens = priority && w?.priorityOpensAt ? w.priorityOpensAt : w?.opensAt
  if (w && time(w.closesAt) <= now()) return 'closed'
  return opens && time(opens) > now() ? 'not-open' : 'open'
}

/** The class's rule in one sentence, shown before booking. */
export function ruleLine(s: any, c: any) {
  const w = c.bookingWindow
  if (!w) return ''
  const plan = w.plan ? `Your ${h(w.plan)} plan’s rule: ` : ''
  const opens = w.opensAt ? `Booking opens ${when(s, w.opensAt)}${w.priorityOpensAt ? ` (priority packs ${when(s, w.priorityOpensAt)})` : ''}; ` : ''
  const closes = time(w.closesAt) === time(c.start) ? 'closes when class starts.' : `closes ${when(s, w.closesAt)}.`
  const late = w.lateCancelReturnsCredit ? (w.lateCancelFeeCents ? `later the credit returns and a ${money(w.lateCancelFeeCents)} late fee is added` : '') : `later the credit is kept${w.lateCancelFeeCents ? ` and a ${money(w.lateCancelFeeCents)} late fee is added` : ''}`
  const cancel = !w.cancelCutoffHours || !late ? ' Cancel any time before class for your credit back.'
    : time(w.cutoffAt) <= now() ? ` The cancel cutoff has passed: ${late.replace(/^later /, '')}.` : ` Cancel by ${when(s, w.cutoffAt)} for your credit back; ${late}.`
  const noShow = w.noShowFeeCents ? ` Missing class without cancelling uses the credit and adds a ${money(w.noShowFeeCents)} no-show fee.${w.noShowGraceMinutes ? ` No-show marking starts ${w.noShowGraceMinutes} minutes after class start.` : ''}` : ''
  return `<small class="rule">${plan}${opens}${closes}${cancel}${noShow}</small>`
}

/** The exact effect of cancelling now, as the domain will apply it. */
export function effectText(e: any, waitlisted: boolean) {
  if (waitlisted) return 'Leaving the waitlist costs nothing.'
  if (e.unpaid) return `Cancel now: the unpaid visit is released${e.feeCents ? `, ${money(e.feeCents)} late fee added` : ''}.`
  if (e.timing === 'early') return 'Cancel now: your credit returns.'
  return `Late cancel: ${e.creditReturned ? 'credit returns' : 'credit kept'}${e.feeCents ? `, ${money(e.feeCents)} fee added` : ''}.`
}

/** A member's own cancel button with its effect beside it. */
export function memberCancel(b: any, back: string) {
  const e = b.cancelEffect, waitlisted = b.status !== 'booked'
  if (!e) return ''
  return `<small class="effect">${h(effectText(e, waitlisted))}</small>${form('booking.cancel', back, hidden('id', b.id) + hidden('terms', e.key), waitlisted ? 'Leave waitlist' : 'Cancel', 'quiet', 'small')}`
}

/** Staff records how the request arrived and an explicit notice suppression. */
export const actionChannel = (selected = 'desk') => select('channel', 'Request channel', [['desk', 'Front desk'], ['phone', 'Phone'], ['inbox', 'Inbox']], selected)
export const actionNotice = () => '<label class="check"><input name="suppressNotice" type="checkbox" value="true"> Suppress the member notice</label>'
  + field('suppressionReason', 'Suppression reason (required when suppressing)', '', 'text', 'maxlength="500"')
export const cancellationReason = (s: any) => select('cancelReason', 'Cancellation reason', [['', 'Choose a reason'], ...rows(s, 'cancellationReasons').map(reason => [reason, reason] as [unknown, unknown])])

/** The same recorded policy effect appears before either desk choice. */
export function staffCancelControls(s: any, b: any, back: string) {
  const e = b.cancelEffect
  if (!owner(s) || !e) return ''
  const waitlisted = b.status !== 'booked'
  const fields = hidden('id', b.id) + hidden('terms', e.key) + cancellationReason(s) + actionChannel()
  const choice = !e.waivable ? form('booking.cancel', back, fields + (e.timing === 'early' ? actionNotice() : ''), waitlisted ? 'Remove from waitlist' : 'Cancel booking', 'quiet', 'small')
    : form('booking.cancel', back, fields + hidden('mode', 'late'), 'Late cancel', 'quiet', 'small')
      + form('booking.cancel', back, fields + hidden('mode', 'early') + actionNotice() + field('reason', 'Waiver reason (early cancel)', '', 'text', 'required maxlength="500"'), 'Early cancel: credit back, no fee', 'quiet', 'small')
  return `<p class="meta">${h(effectText(e, waitlisted))}${e.waivable ? ' Or waive it: an early cancel returns the credit with no fee and records your reason.' : ''}</p>${choice}`
}

/** Front desk, in a full-width roster row. */
export function staffCancel(s: any, name: string, b: any, back: string) {
  const controls = staffCancelControls(s, b, back)
  return controls ? `<tr class="cancel-row"><td colspan="6"><details class="more"><summary>Cancel for ${h(name)}</summary><div class="panel-body">${controls}</div></details></td></tr>` : ''
}

const ruleRow = (r: any) => `<tr>${cell('Applies to', h(r.plan ? `Plan: ${r.plan}` : r.service ?? 'All services (studio rule)'))}${cell('Booking opens', r.opensHoursBefore ? `${r.opensHoursBefore} hr before${r.priorityOpensHoursBefore ? `<small>Priority packs ${r.priorityOpensHoursBefore} hr before</small>` : ''}` : 'Any time')}${cell('Closes', r.closesMinutesBefore ? `${span(r.closesMinutesBefore)} before` : 'At start')}`
  + `${cell('Cancel cutoff', r.cancelCutoffHours ? `${r.cancelCutoffHours} hr before` : 'None')}${cell('Late cancel', `${r.lateCancelReturnsCredit ? 'Credit returns' : 'Credit kept'}${r.lateCancelFeeCents ? ` · ${money(r.lateCancelFeeCents)} fee` : ''}`)}${cell('No-show', (r.noShowFeeCents ? `${money(r.noShowFeeCents)} fee` : 'No fee') + ` · ${r.noShowGraceMinutes ?? 0} min grace`)}${cell('', form('bookingRule.remove', '/app/studio', hidden('id', r.id), 'Remove', 'quiet', 'small'), 'right')}</tr>`

export function rulesPanel(s: any) {
  const order = (r: any) => r.plan ? `2${r.plan}` : r.service === null ? '0' : `1${r.service}`
  const rules = rows(s, 'bookingRules').sort((a, b) => order(a).localeCompare(order(b)))
  const list = rules.length ? `<div class="table-wrap">${table(['Applies to', 'Booking opens', 'Closes', 'Cancel cutoff', 'Late cancel', 'No-show', ''], rules.map(ruleRow).join(''))}</div>` : emptyLine('No rules yet: booking stays open until class starts and every cancellation before class returns the credit.')
  const editor = form('bookingRule.save', '/app/studio', `<div class="row2">${field('service', 'Service (blank = all services)', '', 'text', 'maxlength="160" placeholder="Reformer"')}${field('plan', 'Or a plan name (PLAN-002)', '', 'text', 'maxlength="80" placeholder="Off-peak unlimited"')}</div><div class="row2">${field('opensHoursBefore', 'Booking opens (hours before; blank = any time)', '', 'number', 'min="1" max="8760" step="1"')}${field('priorityOpensHoursBefore', 'Priority packs open (hours before; blank = none)', '', 'number', 'min="1" max="8760" step="1"')}</div>`
    + `<div class="row2">${field('closesMinutesBefore', 'Booking closes (minutes before)', '0', 'number', 'required min="0" max="10080" step="1"')}${field('cancelCutoffHours', 'Cancel cutoff (hours before)', '0', 'number', 'required min="0" max="720" step="1"')}</div>`
    + `<div class="row2">${select('lateCancelReturnsCredit', 'After the cutoff', [['false', 'Credit is kept'], ['true', 'Credit returns']], 'false')}${field('lateFee', 'Late-cancel fee', '0.00', 'text', 'required inputmode="decimal"')}</div>`
    + `<div class="row2">${field('noShowFee', 'No-show fee', '0.00', 'text', 'required inputmode="decimal"')}${field('noShowGraceMinutes', 'No-show grace (minutes after start)', '0', 'number', 'required min="0" max="600" step="1"')}</div>`, 'Save booking rule')
  return panel('Booking and cancellation rules', `${list}${body(`<p class="meta">A plan’s rule replaces the service and studio rules for the bookings that plan pays for; a service’s rule replaces the studio rule for that service. Hours count back from the class start, so a daylight-saving change moves the clock time. A booking keeps the cancellation rule in force when it was made.</p>${editor}`)}`, { id: 'booking-rules', icon: 'clock' })
}
