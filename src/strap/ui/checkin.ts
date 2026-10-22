// ATT-001 screens: the staff roster's role-scoped alerts, the desk's code scan,
// a member's own check-in and code, and the owner's kiosks and key tags.
import { classTitle } from './facts'
import { clock, datePlain, dayOf, money, when } from './format'
import { body, emptyLine, field, form, h, hidden, owner, panel, rows } from './shared'
import { qrSvg } from './qr'
import { staffRequestFields } from './staff-actions'

const alertText = (s: any, a: any) => ({
  balance_due: `Owes ${money(a.amountCents)}`,
  waiver_missing: 'Waiver not signed',
  waiver_outdated: `Waiver v${a.version} not signed`,
  last_credit: 'Last credit',
  pack_expiring: `Pack ends ${a.expiresAt ? datePlain(dayOf(s, a.expiresAt)).replace(/, \d{4}$/, '') : ''}`,
} as Record<string, string>)[a.type] ?? a.type

/** The roster's Notes cell for a booked seat: its alerts for this staff role. */
export const alertNotes = (s: any, b: any) => (b.alerts ?? []).length
  ? b.alerts.map((a: any) => `<span class="note${a.type === 'balance_due' ? ' owes' : ''}">${h(alertText(s, a))}</span>`).join(' ')
  : '<span class="note none">—</span>'

export const deskScan = (back: string) => `<section class="panel"><div class="panel-body">${form('attendance.scan', back, field('code', 'Scan a member’s check-in code', '', 'text', 'required maxlength="64" autocomplete="off"'), 'Check in', 'quiet')}</div></section>`

const codeCard = (code: any, label: string) => `<div class="checkin-code">${qrSvg(code.code, label)}<p class="meta"><code>${h(code.code.match(/.{1,4}/g)!.join(' '))}</code></p></div>`

/** A member's own check-in: booked classes whose check-in is open, and their code. */
export function memberCheckin(s: any) {
  const open = rows(s, 'bookings').filter(b => b.personId === s.actor.personId && b.status === 'booked' && b.checkinOpen)
    .map(b => ({ b, c: rows(s, 'classes').find(c => c.id === b.classId) })).filter(x => x.c)
  const seats = open.map(({ b, c }) => `<p>${h(classTitle(c))} · ${h(clock(s, c.start, c.timeZone))} ${b.checkedInAt || b.attendance ? '<span class="pill done">Checked in</span>' : form('attendance.self', '/app', hidden('id', b.id), 'Check in', 'primary', 'small')}</p>`).join('')
  const code = rows(s, 'checkinCodes').find(c => c.personId === s.actor.personId)
  return panel('Check in', body(`${seats || '<p class="meta">Check-in opens an hour before each class you booked.</p>'}${code ? `${codeCard(code, 'Your check-in code')}<p class="meta">Show this code at the studio’s kiosk or front desk.</p>` : form('checkin.code', '/app', '', 'Show my check-in code', 'quiet', 'small')}`), { icon: 'scan' })
}

/** The owner's person card: phone for kiosk lookup and the key-tag code. */
export function personCheckin(s: any, p: any, back: string) {
  if (!owner(s) || p.role !== 'member') return ''
  const code = rows(s, 'checkinCodes').find(c => c.personId === p.id)
  const read = form('checkin.code.staff', back, staffRequestFields(p.id), code ? 'Read existing check-in code' : 'Issue a check-in code', 'quiet', 'small')
  const rotate = code ? `<details class="more"><summary>Replace a lost code or key tag</summary><div class="panel-body"><p class="meta">Issuing a new code immediately stops the old code and key tag from working. Your reason is recorded.</p>${form('checkin.rotate', back, staffRequestFields(p.id) + field('reason', 'Reason for replacing the code', '', 'text', 'required maxlength="500"'), 'Issue a new code (the old one stops working)', 'quiet', 'small')}</div></details>` : ''
  return `<details class="more"><summary>Check-in code and key tag</summary><div class="panel-body">${code ? `${codeCard(code, `Check-in code for ${p.name}`)}<p class="meta">Print this for a key tag. Issued ${when(s, code.codeIssuedAt)}.</p>` : '<p class="meta">No check-in code yet.</p>'}<p class="meta">Reading an existing code keeps the current code and key tag working.</p>${read}${rotate}</div></details>`
}

/** Studio settings: pair, list and revoke check-in kiosks. */
export function kiosksPanel(s: any, notice: any = {}) {
  if (!owner(s)) return ''
  const made = notice.result?.pairUrl ? `<div class="notice" role="status"><p>Open this link once on the kiosk device within 15 minutes, then choose Pair this device. It is shown only now.</p><p><code>${h(notice.result.pairUrl)}</code></p></div>` : ''
  const list = rows(s, 'kiosks').map(k => `<p>${h(k.label)} · ${k.revokedAt ? 'Revoked' : k.pairedAt ? `Paired ${when(s, k.pairedAt)}` : 'Waiting to pair'}${k.revokedAt ? '' : form('kiosk.revoke', '/app/studio', hidden('id', k.id), 'Revoke', 'quiet', 'small')}</p>`).join('')
  return panel('Check-in kiosks', body(`${made}<p class="meta">A kiosk lets members check in by name, phone or code. It shows no balances, packs, waivers or alerts, and cannot open the studio app.</p>${list || emptyLine('No kiosks yet.')}${form('kiosk.pair', '/app/studio', field('label', 'Kiosk name', '', 'text', 'required maxlength="80" placeholder="Front desk tablet"'), 'Make a pairing link')}`), { icon: 'scan' })
}
