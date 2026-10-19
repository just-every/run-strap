// ATT-003 on the roster: the owner (manager until STAFF-001) corrects a no-show
// or a late cancel with a reason, sees what the correction returns and reverses
// first, and may record a refund of a fee the member already paid.
import { balance } from './facts'
import { money } from './format'
import { field, form, h, hidden, owner, rows, select } from './shared'

const openFee = (s: any, b: any) => rows(s, 'charges').filter(c => c.bookingId === b.id && ['late_cancel_fee', 'no_show_fee'].includes(c.reason) && !rows(s, 'charges').some(r => r.reversesChargeId === c.id)).reduce((sum, c) => sum + c.amountCents, 0)

/** The latest correction, as a line under the booking's state. */
export function correctionNote(b: any) {
  const last = (b.corrections ?? []).at(-1)
  if (!last) return ''
  const from = last.from === 'no_show' ? 'no-show' : 'late cancel'
  return `<div><small class="corrected">Corrected from ${from}: ${h(last.reason)}${last.creditRestored ? ' · credit returned' : ''}${last.feeReversedCents ? ` · ${money(last.feeReversedCents)} fee reversed` : ''}${last.refundId ? ' · refund recorded' : ''}</small></div>`
}

/** A full-width roster row with the owner's correction form, or nothing. */
export function correctionRow(s: any, name: string, b: any, back: string) {
  if (!owner(s)) return ''
  const noShow = b.attendance === 'no_show', late = b.status === 'cancelled' && b.cancellation === 'late'
  if (!noShow && !late) return ''
  const fee = openFee(s, b), owed = balance(s, b.personId), paid = fee > 0 && owed - fee <= -fee
  const outcomes: [unknown, unknown][] = noShow ? [['excused', 'Excused: return the credit'], ['attended', 'Attended: they were here']] : [['early_cancel', 'Early cancel: return the credit']]
  const effect = `${noShow ? 'Excused returns the spent credit; attended keeps it spent.' : b.refunded ? 'The credit was already returned.' : 'The kept credit returns.'}${fee ? ` The ${money(fee)} fee is reversed.` : ''}`
  const refund = paid ? field('refundReference', `Refund reference (optional: the ${money(fee)} fee was paid; record it as paid back outside Strap)`, '', 'text', 'maxlength="160"') : ''
  const body = hidden('id', b.id) + select('outcome', 'Correct to', outcomes, outcomes[0][0]) + field('reason', 'Reason', '', 'text', 'required maxlength="500"') + refund
  return `<tr class="cancel-row"><td colspan="6"><details class="more"><summary>Correct ${noShow ? 'no-show' : 'late cancel'} for ${h(name)}</summary><div class="panel-body"><p class="meta">${h(effect)} The original ${noShow ? 'no-show' : 'late cancel'} stays in the booking’s history.</p>${form('attendance.correct', back, body, 'Save correction', 'quiet', 'small')}</div></details></td></tr>`
}
