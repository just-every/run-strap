// STAFF-006 uses the existing member profile and the owner's command forms.
import { actionChannel } from './booking-rules'
import { waiverSigned } from './facts'
import { when } from './format'
import { body, cell, emptyLine, form, h, hidden, owner, panel, person, rows, table } from './shared'

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
  const notices = rows(s, 'staffNotices').filter(n => n.personId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return notices.length ? notices.map(n => `<div class="notice"><p><strong>${h(n.subject)}</strong></p><p>${h(n.body)}</p><p class="meta">${when(s, n.createdAt)}</p>${n.dismissedAt
    ? `<p class="meta">${n.dismissedByStaff ? 'Marked read by staff' : 'Read by member'} · ${when(s, n.dismissedAt)}</p>`
    : form('notice.dismiss.staff', back, hidden('id', n.id) + staffRequestFields(p.id), 'Mark read for this member', 'quiet', 'small')}</div>`).join('') : emptyLine('No notices for this member.')
}

/** These doors never acknowledge a waiver or change a notice's contents. */
export function staffProfileActions(s: any, p: any, back: string) {
  if (!owner(s) || p.role !== 'member') return ''
  return `<details class="more"><summary>Member waiver link</summary><div class="panel-body">${waiverLaunch(s, p, back)}</div></details>`
    + `<details class="more"><summary>Member notices</summary><div class="panel-body"><p class="meta">Marking a notice read records who acted. The member can still see the notice in their read history.</p>${memberNotices(s, p, back)}</div></details>`
}

function effect(s: any, value: any) {
  if (!value) return 'No previous record'
  if (typeof value.issued === 'boolean') return value.issued ? `Check-in code revision ${h(value.codeRevision)}${value.codeIssuedAt ? ` · issued ${when(s,value.codeIssuedAt)}` : ''}` : 'No check-in code issued'
  if (typeof value.acknowledged === 'boolean') return value.acknowledged ? 'Current waiver acknowledged by the member' : 'Current waiver awaiting the member’s acknowledgement'
  if (value.waiverId && value.status) return 'Waiver sign-in link requested; delivery and acknowledgement not confirmed'
  if ('dismissedAt' in value && !value.classId) return value.dismissedAt ? `Notice marked read ${when(s,value.dismissedAt)}` : 'Notice unread'
  if (value.classId) {
    const c = rows(s,'classes').find(c => c.id === value.classId)
    return `${h(c?.title ?? 'Class booking')} · ${h(value.status)}${value.spot ? ` · ${h(value.spot)}` : ''}${value.cancellation ? ` · ${h(value.cancellation)}` : ''}${value.checkedInAt ? ` · checked in ${when(s,value.checkedInAt)}` : ''}`
  }
  throw new Error('Unsupported staff action effect')
}

const actionLabels: Record<string,string> = {'booking.desk':'Book at desk','booking.cancel':'Cancel booking',cancel:'Cancel booking','booking.spot':'Move spot','booking.offer.accept':'Accept offer',accept:'Accept offer','booking.move':'Move booking',move:'Move booking','booking.restore':'Restore booking',restore:'Restore booking','booking.waitlist.position':'Change waitlist position',position:'Change waitlist position',waitlist:'Join waitlist','attendance.checkin':'Check in','checkin.code.staff':'Read or issue check-in code','checkin.rotate':'Replace check-in code','waiver.launch':'Request waiver link','notice.dismiss.staff':'Mark notice read'}
const actionLabel = (action: string) => { if (!actionLabels[action]) throw new Error('Staff action needs a display label'); return actionLabels[action] }

/** The canonical staff audit stays focused on the selected person, when any. */
export function staffActionHistory(s: any, chosen?: any) {
  if (!owner(s)) return ''
  const events = rows(s, 'staffActions').filter(a => !chosen || a.personId === chosen.id).sort((a, b) => b.at.localeCompare(a.at))
  const list = events.map(a => `<tr>${cell('When / member', `${when(s, a.at)}<small>${h(person(s, a.personId))}</small>`)}${cell('Staff / channel', `${h(a.actorId === s.actor.id ? s.displayName : a.actorId)}<small>${h(a.actorRole)} · ${h(a.channel)}</small>`)}${cell('Action', `${h(actionLabel(a.action))}<small>Right: ${h(a.right)}</small>${a.reason ? `<small>Reason: ${h(a.reason)}</small>` : ''}`)}</tr>`
    + `<tr><td colspan="3"><details class="more"><summary>Recorded change</summary><div class="panel-body"><dl><dt>Before</dt><dd>${effect(s,a.before)}</dd><dt>After</dt><dd>${effect(s,a.after)}</dd></dl></div></details></td></tr>`).join('')
  return panel('Staff action history', body(`<p class="meta">${chosen ? `Actions for ${h(chosen.name)}.` : 'Actions for all members. Select a person to focus their history.'}</p>`)
    + (list ? `<div class="table-wrap">${table(['When / member', 'Staff / channel', 'Action'], list)}</div>` : emptyLine('No staff actions recorded.')), { id: 'staff-actions', icon: 'users' })
}
