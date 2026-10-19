// SCHED-010 at the desk: book a member choosing how the visit is paid (their
// earliest-expiring credit, a chosen pack, a drop-in or pack sold now, or an
// unpaid visit their next purchase settles), with an override reason to book
// past a full roster or outside the booking window.
import { packName } from './facts'
import { packServiceEligible } from '../domain/pack-credits'
import { field, form, h, hidden, rows, select } from './shared'
import { deskSpot } from './spots'

export function deskForm(s: any, c: any, back: string) {
  const members = rows(s, 'people').filter(p => p.active && p.role === 'member')
  const packs = members.flatMap(p => rows(s, 'packs').filter(k => k.personId === p.id && packServiceEligible(k, c) && k.remaining > 0 && Date.parse(k.expiresAt) > Date.now() && k.expiresAt > c.start).map(k => [k.id, `${p.name} · ${packName(k)} · ${k.remaining} left`] as [unknown, unknown]))
  const full = c.occupancy.totalOpen === 0
  const fields = hidden('classId',c.id) + select('personId', 'Member or walk-in profile', members.map(p => [p.id, p.name]), '')
    + select('channel', 'Request channel', [['desk', 'At the desk'], ['phone', 'Phone'], ['inbox', 'Inbox']], 'desk')
    + select('pay', 'Pays with', [['auto', 'Their credit that expires first'], ['pack', 'The pack chosen below'], ['drop-in', 'Sell a drop-in now'], ['sell-pack', 'Sell a pack now'], ['unpaid', 'Unpaid visit (their next pack settles it)']], 'auto')
    + (packs.length ? select('packId', 'Pack (when chosen)', [['', 'Choose a pack'], ...packs], '', '') : '')
    + `<div class="row2">${field('amount', 'Sale price (drop-in or pack)', '', 'text', 'inputmode="decimal" placeholder="25.00"')}${field('credits', 'Pack credits (pack sale)', '', 'number', 'min="1" max="10000" step="1"')}</div>`
    + `<div class="row2">${field('expiresOn', 'Pack good through (pack sale)', '', 'date')}${field('reference', 'Payment received outside Strap (reference)', '', 'text', 'maxlength="160"')}</div>`
    + (c.spots && !full ? deskSpot(c) : '')
    + field('override', 'Override reason (books past a full class or outside the booking window)', '', 'text', 'maxlength="500"')
  const book = form('booking.desk', back, fields, 'Book at desk')
  const wait = full ? form('booking.desk', back, hidden('classId',c.id) + select('personId', 'Member', members.map(p => [p.id, p.name]), '') + select('channel', 'Request channel', [['desk', 'At the desk'], ['phone', 'Phone'], ['inbox', 'Inbox']], 'desk') + hidden('waitlist', 'true'), 'Add to waitlist', 'quiet') : ''
  return `<div class="panel-body">${book}${wait}<p class="meta">Walk-ins need an active profile and their own current waiver acknowledgment. <a href="/app/people#add-person">Add a profile</a>. Held spots are available only at the desk. A sale here records the charge, and a payment only as received outside Strap.</p></div>`
}

/** How a desk visit was paid, and any override, on its roster row. */
export function deskNote(b: any) {
  const paid = b.unpaid && !b.packId ? 'Unpaid visit: their next pack settles it' : b.settledByPackId ? 'Unpaid visit, settled by a later pack' : b.payment === 'drop-in' ? 'Drop-in sold at the desk' : b.payment === 'sell-pack' ? 'Pack sold at the desk' : ''
  const override = b.override ? `Override: ${b.override.reason} (${b.override.bypassed.join('; ')})` : ''
  return [paid, override].filter(Boolean).map(text => ` · ${h(text)}`).join('')
}
