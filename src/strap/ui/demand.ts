import { dayOf, when } from './format'
import { cell, h, hidden, person, select, table } from './shared'

export function recommendationControls(d: any) {
  if (!d.recommendation) return ''
  return select('notification', 'Member notification', [[d.recommendation.notification,
    d.impact.bookings ? 'In-app + configured email' : 'No affected reservations']],
    d.recommendation.notification, 'aria-label="Member notification"') + hidden('impact', d.impact.key)
}

export function recommendationEvidence(s: any, d: any) {
  if (!d.recommendation) return ''
  const evidence = table(['Source class', 'Demand', 'Attendance', 'Coverage history'], d.recommendation.evidence.map((c: any) =>
    `<tr>${cell('Source class', `<a href="/app?day=${encodeURIComponent(dayOf(s,c.start))}&amp;class=${encodeURIComponent(c.classId)}#class-${h(c.classId)}">${h(c.title)}</a><small>${when(s,c.start)}</small>`)}${cell('Demand', `${c.reserved} / ${c.capacity} reserved · ${c.waiting} waiting · ${c.offered} offered`)}${cell('Attendance', `${c.attended} attended · ${c.noShows} no-shows`)}${cell('Coverage history', `${c.substitutions.length} substitutions`)}</tr>`).join(''))
  const notices = d.impact.classes.flatMap((c: any) => c.bookings)
  const preview = notices.length ? `<details class="more"><summary>Review member notices</summary>${notices.map((n: any) =>
    `<div class="panel-body" data-notice-booking-id="${h(n.bookingId)}"><strong>${h(person(s,n.personId))} · ${h(n.subject)}</strong><p class="letter">${h(n.body)}</p></div>`).join('')}</details>` : ''
  return `<p><strong>Demand recommendation: ${h(d.recommendation.action)}</strong> · ${h(d.recommendation.reason)}</p>${evidence}`
    + `<p>${h(d.recommendation.email)} · ${d.impact.notices} notices · no money or credits changed.</p>${preview}`
    + (d.stale ? '<p role="alert">Source facts changed. Request a fresh recommendation before approval.</p>' : '')
}
