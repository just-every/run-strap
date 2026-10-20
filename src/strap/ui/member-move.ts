import { classTitle } from './facts'
import { clock, dayOf, dayShort } from './format'
import { form, hidden, select } from './shared'

/** Uses the same cancellation effect and eligibility fences as the staff door. */
export function memberMove(s: any, current: any, booking: any) {
  if (booking.status !== 'booked' || !booking.cancelEffect || booking.attendance || booking.checkedInAt) return ''
  const targets = s.classes.filter((c: any) => c.id !== current.id && c.status === 'published' && Date.parse(c.start) > Date.now())
  if (!targets.length) return ''
  const effect = booking.cancelEffect
  return `<details class="more"><summary>Reschedule</summary><p class="meta">Your original credit moves with you. Current late-move fee: $${(effect.feeCents / 100).toFixed(2)}. A full target keeps your original seat until you claim a vacancy.</p>`
    + form('booking.move', '/app', hidden('requestId', crypto.randomUUID()) + hidden('id', booking.id) + hidden('terms', effect.key)
      + select('classId', 'New class', targets.map((c: any) => [c.id, `${classTitle(c)} · ${dayShort(s, dayOf(s, c.start))} · ${clock(s, c.start)}`])), 'Confirm reschedule', 'quiet', 'small') + '</details>'
}
