// MSG-004 on screen: the studio's waitlist policy in Studio settings, a
// member's open claim offer, and the desk's view of an offer with its email
// outcome and the accept-for-member action.
import { when } from './format'
import { body, field, form, h, hidden, panel, rows, select } from './shared'
import { delivery } from './closures'

const lateText: Record<string, string> = { promote: 'follow the policy above', offer: 'send a claim offer instead of booking anyone', none: 'promote no one; the spot stays open to booking' }

/** After a restore into this installation, member email waits for the owner. */
export function memberMailPanel(s: any) {
  if (!s.memberMail || s.memberMail.origin === s.origin) return ''
  return panel('Member email paused', body(`<p class="notice">This studio was restored from ${h(s.memberMail.origin)}. Member emails (waitlist offers, closures) are paused and members see in-app notices only until you review and reconnect member email here, through this installation’s mail settings.</p>${form('mail.connect', '/app/studio', '', 'Reconnect member email')}`), { id: 'member-mail', icon: 'alert' })
}

export function waitlistPanel(s: any) {
  const p = s.waitlistPolicy ?? { mode: 'auto', claimMinutes: 30, lateWindow: 'promote' }
  const now = p.mode === 'auto' ? 'A freed spot books the next eligible person waiting at once.' : `A freed spot is held for the next eligible person waiting, who has ${p.claimMinutes} min to claim it (never past class start).`
  return panel('Waitlist', body(`<p class="meta">${h(now)} Inside the late-cancel window: ${h(lateText[p.lateWindow])}. A credit is used only when a spot is assigned.</p>`
    + form('waitlist.save', '/app/studio', `<div class="row2">${select('mode', 'When a spot opens', [['auto', 'Book the next person automatically'], ['offer', 'Offer it; they claim it']], p.mode)}${field('claimMinutes', 'Time to claim an offer (minutes)', p.claimMinutes, 'number', 'required min="1" max="1440" step="1"')}</div>`
      + select('lateWindow', 'Inside the late-cancel window', [['promote', 'Same as above'], ['offer', 'Send a claim offer'], ['none', 'Promote no one']], p.lateWindow), 'Save waitlist policy')), { id: 'waitlist', icon: 'users' })
}

/** A member's own open offer: claim it, or decline (leaving the waitlist costs nothing). */
export const memberOffer = (s: any, b: any, back: string) => `<span class="pill pending">Spot offered</span> <small class="effect">Claim by ${h(when(s, b.offer.expiresAt))}; a credit is used only when you claim.</small>`
  + form('booking.offer.accept', back, hidden('id', b.id), 'Claim spot', 'primary', 'small') + form('booking.cancel', back, hidden('id', b.id), 'Decline', 'quiet', 'small')

/** The desk's line for an offered seat, with the offer email's recorded outcome. */
export function offerLine(s: any, b: any) {
  const mail = rows(s, 'noticeDeliveries').find(d => d.sourceKind === 'booking' && d.sourceId === b.id)
  return `Claim by ${h(when(s, b.offer.expiresAt))}${b.offer.reason === 'late_window' ? ' · late-cancel window' : ''}${mail ? ` · ${h(delivery(mail))}` : ''}`
}
export const acceptForMember = (b: any, back: string) => form('booking.offer.accept', back, hidden('id', b.id), 'Accept for member', 'quiet', 'small')
