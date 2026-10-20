import { delivery } from './closures'
// STAFF-006 uses the existing member profile and the owner's command forms.
import { actionChannel } from './booking-rules'
import { waiverSigned } from './facts'
import { money, when } from './format'
import { body, cell, emptyLine, form, h, hidden, owner, panel, person, rows, table } from './shared'
import { profileText } from './profile'

/** One request identity per rendered form; submitting it again keeps that identity. */
export const staffRequestFields = (personId: string) => hidden('personId', personId)
  + hidden('requestId', crypto.randomUUID()) + actionChannel()

const launchStatus = (status: string) => ({
  requested: 'Request recorded; delivery not confirmed',
  not_sent: 'Not sent',
  uncertain: 'Outcome unknown; delivery not confirmed',
  sending: 'Outcome unknown; delivery not confirmed',
  queued: 'Request recorded; dispatch not confirmed',
} as Record<string, string>)[status] ?? status

function waiverLaunch(s: any, p: any, back: string) {
  if (!s.waiver) return emptyLine('The studio has not published a waiver.')
  const w = s.waiver
  const launches = rows(s, 'waiverLaunches').filter(l => l.personId === p.id && l.waiverId === w.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return `<p class="meta">Current waiver · Version ${h(w.version)} · ${waiverSigned(s, p.id) ? 'Acknowledged by this member' : 'Awaiting member acknowledgement'}</p><p class="letter">${h(w.text)}</p>`
    + '<p class="meta">The member opens their own secure sign-in link and acknowledges this exact version. Only the member can complete it. A link request does not confirm delivery or acknowledgement.</p>'
    + (s.memberMail && s.memberMail.origin !== s.origin ? '<p class="notice">Member email is paused after restore. <a href="/app/studio#member-mail">Review and reconnect in Studio</a> before requesting a waiver link.</p>' : p.active ? form('waiver.launch', back, hidden('waiverId', w.id) + staffRequestFields(p.id), 'Request a waiver sign-in link', 'quiet', 'small') : '<p class="meta">Activate this member before requesting a sign-in link.</p>')
    + launches.map(l => `<p class="meta">${when(s, l.createdAt)} · ${h(launchStatus(l.status))}</p>`).join('')
}

function memberNotices(s: any, p: any, back: string) {
  const mailOf = (n: any) => rows(s,'noticeDeliveries').find(d => d.id === n.id.replace(/^notice:/,'mail:') || (n.closureId && d.sourceKind === 'closure' && d.sourceId === n.closureId && d.personId === n.personId))
  const notices = rows(s, 'staffNotices').filter(n => n.personId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return notices.length ? notices.map(n => `<div class="notice"><p><strong>${h(n.subject)}</strong></p><p>${h(n.body)}</p><p class="meta">${when(s, n.createdAt)}${mailOf(n) ? ` · ${h(delivery(mailOf(n)))}` : ''}</p>${n.dismissedAt
    ? `<p class="meta">${n.dismissedByStaff ? 'Marked read by staff' : 'Read by member'} · ${when(s, n.dismissedAt)}</p>`
    : form('notice.dismiss.staff', back, hidden('id', n.id) + staffRequestFields(p.id), 'Mark read for this member', 'quiet', 'small')}</div>`).join('') : emptyLine('No notices for this member.')
}

/** These doors never acknowledge a waiver or change a notice's contents. */
export function staffProfileActions(s: any, p: any, back: string) {
  if (!owner(s) || p.role !== 'member') return ''
  return `<details class="more"><summary>Message preferences</summary><div class="panel-body"><p>The member signs in and changes their own booking email choice. Staff cannot opt them in or out.</p>${form('mail.preference.launch', back, staffRequestFields(p.id), 'Open member message preferences', 'quiet', 'small')}${rows(s,'messagePreferenceLaunches').some(l => l.personId === p.id) ? '<p><a href="/signin?returnTo=%2Fapp%23message-preferences">Member message sign-in</a> — open on the member’s device.</p>' : ''}</div></details>`
    + `<details class="more"><summary>Member waiver link</summary><div class="panel-body">${waiverLaunch(s, p, back)}</div></details>`
    + `<details class="more"><summary>Plan changes</summary><div class="panel-body"><p class="meta">Preview an upgrade or downgrade of this member’s pack. The member accepts the exact charge or credit themselves.</p><a class="btn-quiet" href="/app/packs?person=${encodeURIComponent(p.id)}#plan-changes">Change this member’s plan</a></div></details>`
    + `<details class="more"><summary>Member notices</summary><div class="panel-body"><p class="meta">Marking a notice read records who acted. The member can still see the notice in their read history.</p>${memberNotices(s, p, back)}</div></details>`
}

function effect(s: any, value: any) {
  if (!value) return 'No previous record'
  if ('emergencyContact' in value) return profileText(value)
  if (typeof value.issued === 'boolean') return value.issued ? `Check-in code revision ${h(value.codeRevision)}${value.codeIssuedAt ? ` · issued ${when(s,value.codeIssuedAt)}` : ''}` : 'No check-in code issued'
  if (typeof value.acknowledged === 'boolean') return value.acknowledged ? 'Current waiver acknowledged by the member' : 'Current waiver awaiting the member’s acknowledgement'
  if (value.waiverId && value.status) return 'Waiver sign-in link requested; delivery and acknowledgement not confirmed'
  if (value.preferenceDoor) return 'Member preference sign-in door opened; no consent granted'
  if ('dismissedAt' in value && !value.classId) return value.dismissedAt ? `Notice marked read ${when(s,value.dismissedAt)}` : 'Notice unread'
  if (value.formula) return `Plan change preview: ${h(value.credits)} credits at ${money(value.amountCents)} · ${value.chargeCents < 0 ? `${money(-value.chargeCents)} balance credit` : `${money(value.chargeCents)} charge`} · effective ${when(s,value.effectiveAt)} · awaiting the member’s acceptance`
  if ('credits' in value && 'remaining' in value && !value.classId) return `Pack: ${h(value.remaining)} of ${h(value.credits)} credits available · ${money(value.amountCents)} · ends ${when(s,value.expiresAt)}`
  if (['late_cancel_fee','no_show_fee'].includes(value.reason)) return `${money(value.amountCents)} attendance fee · ${h(value.status ?? 'pending')}${value.receipt ? ` · external receipt ${h(value.receipt.reference)}` : ''}${value.reversal ? ` · waived: ${h(value.reversal.note)}` : ''}`
  if (value.classId) {
    const c = rows(s,'classes').find(c => c.id === value.classId)
    return `${h(c?.title ?? 'Class booking')} · ${h(value.status)}${value.spot ? ` · ${h(value.spot)}` : ''}${value.cancellation ? ` · ${h(value.cancellation)}` : ''}${value.checkedInAt ? ` · checked in ${when(s,value.checkedInAt)}` : ''}`
  }
  throw new Error('Unsupported staff action effect')
}

const actionLabels: Record<string,string> = {'mail.preference.launch':'Open member message preferences','fee.collect':'Record fee receipt','fee.waive':'Waive attendance fee',schedule:'Change class schedule','booking.desk':'Book at desk','booking.cancel':'Cancel booking',cancel:'Cancel booking','booking.spot':'Move spot','booking.offer.accept':'Accept offer',accept:'Accept offer','booking.move':'Move booking',move:'Move booking','booking.restore':'Restore booking',restore:'Restore booking','booking.waitlist.position':'Change waitlist position',position:'Change waitlist position',waitlist:'Join waitlist','attendance.checkin':'Check in','checkin.code.staff':'Read or issue check-in code','checkin.rotate':'Replace check-in code','waiver.launch':'Request waiver link','notice.dismiss.staff':'Mark notice read','recognition.launch':'Open member recognition preferences','plan.change.prepare':'Preview plan change','profile.save.staff':'Edit member profile','person.save':'Change sign-in email or name'}
const actionLabel = (action: string) => { if (!actionLabels[action]) throw new Error('Staff action needs a display label'); return actionLabels[action] }

/** The canonical staff audit stays focused on the selected person, when any. */
export function staffActionHistory(s: any, chosen?: any) {
  if (!owner(s)) return ''
  const events = rows(s, 'staffActions').filter(a => !chosen || a.personId === chosen.id).sort((a, b) => b.at.localeCompare(a.at))
  const list = events.map(a => `<tr data-staff-command="${h(a.command ?? a.action)}">${cell('When / member', `${when(s, a.at)}<small>${h(person(s, a.personId))}</small>`)}${cell('Staff / channel', `${h(a.actorId === s.actor.id ? s.displayName : a.actorId)}<small>${h(a.actorRole)} · ${h(a.channel)}</small>`)}${cell('Action', `${h(actionLabel(a.action))}<small>Right: ${h(a.right)}</small>${a.reason ? `<small>Reason: ${h(a.reason)}</small>` : ''}`)}</tr>`
    + `<tr><td colspan="3"><details class="more"><summary>Recorded change</summary><div class="panel-body">${a.erased ? '<p class="meta">Values erased with the member’s personal data.</p>' : `<dl><dt>Before</dt><dd>${effect(s,a.before)}</dd><dt>After</dt><dd>${effect(s,a.after)}</dd></dl>`}</div></details></td></tr>`).join('')
  return panel('Staff action history', body(`<p class="meta">${chosen ? `Actions for ${h(chosen.name)}.` : 'Actions for all members. Select a person to focus their history.'}</p>`)
    + (list ? `<div class="table-wrap">${table(['When / member', 'Staff / channel', 'Action'], list)}</div>` : emptyLine('No staff actions recorded.')), { id: 'staff-actions', icon: 'users' })
}
