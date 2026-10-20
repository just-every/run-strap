// APP-003: the member's own profile page, the owner's member-record door on the
// person card and the change history both read. Neither door edits the sign-in email.
import { actionChannel } from './booking-rules'
import { when } from './format'
import { body, emptyLine, field, form, h, hidden, owner, panel, rows } from './shared'

export const phoneText = (digits: unknown) => digits ? String(digits).replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3') : ''
export const contactText = (c: any) => c ? `${c.name}${c.relationship ? ` (${c.relationship})` : ''} · ${phoneText(c.phone)}` : 'None recorded'
const fieldNames: Record<string, string> = { name: 'name', email: 'sign-in email', phone: 'mobile phone', emergencyContact: 'emergency contact' }
const channels: Record<string, string> = { self: 'member account', desk: 'front desk', phone: 'phone', inbox: 'inbox' }

/** A recorded profile value, as the staff audit and history show it. */
export const profileText = (p: any) => `${h(p.name)} · ${h(p.email ?? 'no email')} · mobile ${h(phoneText(p.phone) || 'none')} · emergency contact ${h(contactText(p.emergencyContact))}`

const profileFields = (p: any) => field('name', 'Full name', p.name, 'text', 'required maxlength="160" autocomplete="name"')
  + field('phone', 'Mobile phone', phoneText(p.phone), 'tel', 'autocomplete="tel" maxlength="20"', 'US number, used for kiosk check-in')
  + '<p class="meta"><strong>Emergency contact</strong></p>'
  + `<div class="row2">${field('emergencyName', 'Contact name', p.emergencyContact?.name ?? '', 'text', 'maxlength="160" autocomplete="off"')}${field('emergencyPhone', 'Contact phone', phoneText(p.emergencyContact?.phone), 'tel', 'maxlength="20" autocomplete="off"')}</div>`
  + field('emergencyRelationship', 'Relationship', p.emergencyContact?.relationship ?? '', 'text', 'maxlength="60" autocomplete="off"', 'optional')

function changedBy(s: any, c: any) {
  if (c.staffMade) return owner(s) ? `Staff (${h(c.actorId === s.actor.id ? s.displayName || 'owner' : c.actorRole)}) · ${h(channels[c.channel] ?? c.channel)}` : `Studio staff · ${h(channels[c.channel] ?? c.channel)}`
  return owner(s) ? 'The member · member account' : 'You · member account'
}
/** Every recorded change to this member's profile, newest first, with its exact values. */
export function profileHistory(s: any, personId: string) {
  const changes = rows(s, 'profileChanges').filter(c => c.personId === personId)
  return changes.length ? `<div data-profile-history>${changes.map(c => `<div class="profile-change"><p class="meta">${when(s, c.at)} · ${changedBy(s, c)} · changed ${h(c.changed.map((f: string) => fieldNames[f] ?? f).join(', '))}</p>${c.erased ? '<p class="meta">Values erased with the member’s personal data.</p>'
    : `<details class="more"><summary>Before and after</summary><div class="panel-body"><dl><dt>Before</dt><dd>${profileText(c.before)}</dd><dt>After</dt><dd>${profileText(c.after)}</dd></dl></div></details>`}</div>`).join('')}</div>` : emptyLine('No profile changes recorded.')
}

/** The member's own page: name, phone and emergency contact; the email is shown, not edited. */
export function memberProfilePage(s: any) {
  const me = rows(s, 'people').find(p => p.id === s.actor.personId)
  if (!me) return `<div class="page single"><section class="panel">${emptyLine('Your member profile is unavailable.')}</section></div>`
  const editor = form('profile.save', '/app/profile#profile', hidden('requestId', crypto.randomUUID()) + hidden('revision', me.profileRevision ?? 0) + profileFields(me), 'Save my profile')
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>My profile</h1><p>Your name, mobile phone and emergency contact. The studio sees the same details.</p></div>`
    + panel('Contact details', body(`<p class="meta">Sign-in email: <strong>${h(me.email)}</strong>. Only the studio owner changes the email you sign in with.</p><p class="meta">Emergency contact: ${h(contactText(me.emergencyContact))}</p>${editor}`), { id: 'profile', icon: 'users' })
    + `</div><aside class="rail">${panel('Profile changes', body(profileHistory(s, me.id)), { id: 'profile-history', icon: 'report' })}</aside></div>`
}

/** The member-record staff door: the member's own fields, a channel and one request identity. */
export function staffProfileEditor(s: any, p: any, back: string) {
  if (!owner(s) || p.role !== 'member') return ''
  const fields = hidden('personId', p.id) + hidden('requestId', crypto.randomUUID()) + hidden('revision', p.profileRevision ?? 0) + actionChannel() + profileFields(p)
  return `<details class="more"><summary>Edit profile</summary><div class="panel-body"><p class="meta">Change the member’s name, mobile phone or emergency contact for them. Strap records you, the channel and the before and after values, and the member sees the change in their profile.</p>${form('profile.save.staff', back, fields, 'Save profile for member')}</div></details>`
    + `<details class="more"><summary>Profile changes</summary><div class="panel-body">${profileHistory(s, p.id)}</div></details>`
}
