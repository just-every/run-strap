// A member's home: the classes they can book, their credits and the waiver.
import { eligiblePack, livePacks, packName, upcoming, waiverSigned } from './facts'
import { packExpiration } from './pack-history'
import { weekTable } from './classes'
import { body, emptyLine, emptyState, form, h, hidden, panel, rows } from './shared'
import { memberCancel, windowState } from './booking-rules'
import { when } from './format'
import { packServiceEligible } from '../domain/pack-credits'
import { bookingSpot, ownSpot } from './spots'
import { memberCheckin } from './checkin'

function bookAction(s: any, c: any) {
  const own = rows(s, 'bookings').find(b => b.classId === c.id && b.personId === s.actor.personId && b.status !== 'cancelled')
  if (own) return `<span class="pill ${own.status === 'booked' ? 'done' : 'pending'}">${own.status === 'booked' ? 'Booked' : 'On the waitlist'}</span> ${ownSpot(c, own, '/app')}${memberCancel(own, '/app')}`
  if (Date.parse(c.start) <= Date.now()) return ''
  const priority = rows(s, 'packs').some(p => p.personId === s.actor.personId && p.priorityBooking && p.remaining > 0 && packServiceEligible(p, c) && p.expiresAt > c.start && Date.parse(p.expiresAt) > Date.now())
  const open = windowState(c, priority)
  if (open === 'closed') return '<span class="chip quiet">Booking closed</span>'
  if (open === 'not-open') return `<span class="chip quiet">Opens&nbsp;${when(s, priority && c.bookingWindow.priorityOpensAt ? c.bookingWindow.priorityOpensAt : c.bookingWindow.opensAt)}</span>`
  // A member cannot see who else booked: a full class puts them on its waitlist.
  if (!eligiblePack(s, s.actor.personId, c)) return '<span class="chip quiet">No credit for this class</span>'
  return form('booking.book', '/app', hidden('classId', c.id) + bookingSpot(c), c.occupancy.onlineOpen === 0 ? 'Join waitlist' : 'Book', 'primary', 'small')
}

export function memberHome(s: any) {
  const list = upcoming(s).filter(c => Date.parse(c.start) > Date.now() || rows(s, 'bookings').some(b => b.classId === c.id && b.personId === s.actor.personId))
  const packs = livePacks(s, s.actor.personId), credits = packs.reduce((n, p) => n + p.remaining, 0)
  const signed = waiverSigned(s, s.actor.personId)
  const waiver = s.waiver ? panel('Waiver', body(`<p class="letter">${h(s.waiver.text)}</p>${signed ? '<p class="meta">You acknowledged this version. You can book a class.</p>' : form('waiver.acknowledge', '/app', hidden('id', s.waiver.id), 'I acknowledge this waiver version')}`), { icon: 'report' }) : ''
  const creditPanel = panel('My credits', body(packs.length ? `<p class="credits-big"><b>${credits}</b> credits to use</p>${packs.map(p => `<p class="meta">${h(packName(p))}: ${p.remaining} available; expires ${packExpiration(s, p.expiresAt)}${p.eligibleServices?.length ? ` · ${h(p.eligibleServices.join(', '))}` : ''}</p>`).join('')}` : '<p class="meta">You have no class credits. Ask the studio for a pack.</p>'), { icon: 'card' })
  const schedule = list.length ? `<div class="table-wrap">${weekTable(s, list, c => bookAction(s, c))}</div>` : emptyState('calendar', 'No classes open for booking', 'The studio has not published upcoming classes yet.')
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Classes</h1><p>A booking uses one credit; the waitlist holds none until you move up.</p></div>${!signed ? `<p class="notice">Acknowledge the studio’s waiver before you book.</p>` : ''}${panel('Book a class', schedule, { icon: 'calendar' })}</div><aside class="rail">${memberCheckin(s)}${creditPanel}${waiver || panel('Waiver', emptyLine('The studio has not published a waiver.'))}</aside></div>`
}
