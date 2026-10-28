import { clientAppointmentsPanel } from './client-appointments'
import { serviceDocuments } from './signing-documents'
import { attendancePlanControls } from './attendance-plan'
import { reservationsPanel } from './reservations'
import { messagePreferencePanel } from './message-settings'
import { memberMove } from './member-move'
// A member's home: the classes they can book, their credits and the waiver.
import { eligiblePack, livePacks, packCanSeat, packLeft, packName, planReason, upcoming, waiverSigned } from './facts'
import { countsCredits, planTerms } from '../domain/entitlements'
import { packExpiration } from './pack-history'
import { weekTable } from './classes'
import { field, body, emptyLine, emptyState, form, h, hidden, panel, rows } from './shared'
import { memberCancel, windowState } from './booking-rules'
import { when } from './format'
import { packServiceEligible } from '../domain/pack-credits'
import { bookingSpot, ownSpot } from './spots'
import { memberCheckin } from './checkin'
import { noticesPanel } from './closures'
import { memberOffer } from './waitlist'

function bookAction(s: any, c: any) {
  if (c.privatePersonId) return c.status === 'cancelled' ? '<span class="pill quiet">Cancelled</span>' : '<span class="pill done">Private appointment</span>' + (rows(s, 'appointments').some(r => r.clientOfferId && r.occurrences.some((o: any) => (o.classId ?? o.id) === c.id)) ? '<small><a href="#client-appointments">Manage appointment</a></small>' : '<small>Contact the desk for changes.</small>')
  const own = rows(s, 'bookings').find(b => b.classId === c.id && b.personId === s.actor.personId && b.status !== 'cancelled')
  if (c.status === 'cancelled') return '<span class="chip quiet">Class cancelled</span>'
  if (own?.status === 'offered') return memberOffer(s, own, '/app')
  if (own) return `<span class="pill ${own.status === 'booked' ? 'done' : 'pending'}">${own.status === 'booked' ? 'Booked' : 'On the waitlist'}</span> ${ownSpot(c, own, '/app')}${memberCancel(own, '/app')}${memberMove(s,c,own)}`
  if (Date.parse(c.start) <= Date.now()) return ''
  const priority = rows(s, 'packs').some(p => p.personId === s.actor.personId && p.priorityBooking && packCanSeat(s, p, c) && packServiceEligible(p, c) && p.expiresAt > c.start && Date.parse(p.expiresAt) > Date.now())
  const open = windowState(c, priority)
  if (open === 'closed') return '<span class="chip quiet">Booking closed</span>'
  if (open === 'not-open') return `<span class="chip quiet">Opens&nbsp;${when(s, priority && c.bookingWindow.priorityOpensAt ? c.bookingWindow.priorityOpensAt : c.bookingWindow.opensAt)}</span>`
  // A member cannot see who else booked: a full class puts them on its waitlist.
  if (!eligiblePack(s, s.actor.personId, c)) return `<span class="chip quiet">${h(planReason(s, s.actor.personId, c) ?? 'No credit for this class')}</span>`
  return form('booking.book', '/app', hidden('classId', c.id) + bookingSpot(c), c.occupancy.onlineOpen === 0 ? 'Join waitlist' : 'Book', 'primary', 'small')
}

export function memberHome(s: any) {
  const list = upcoming(s).filter(c => Date.parse(c.start) > Date.now() || rows(s, 'bookings').some(b => b.classId === c.id && b.personId === s.actor.personId))
  const packs = livePacks(s, s.actor.personId), credits = packs.filter(countsCredits).reduce((n, p) => n + p.remaining, 0)
  const signed = waiverSigned(s, s.actor.personId)
  const waiver = s.waiver ? panel('Waiver', body(`<p class="letter">${h(s.waiver.text)}</p>${s.waiver.validDays ? `<p>Completion valid for ${s.waiver.validDays} days.</p>` : ''}${signed ? '<p class="meta">You completed this current version.</p>' : form('waiver.acknowledge', '/app', hidden('id', s.waiver.id) + (s.waiver.requiresSignature ? hidden('documentHash',s.waiver.documentHash) + field('signerName','Your full name',s.people.find((p: any)=>p.id===s.actor.personId)?.name ?? '', 'text','required maxlength="160"') + '<label class="check"><input type="checkbox" name="confirm" value="yes" required>I personally affirm this exact document. This does not authorize a payment.</label>' : ''), s.waiver.requiresSignature ? 'Sign this document' : 'I acknowledge this waiver version')}`), { id: 'waiver', icon: 'report' }) : ''
  const packLine = (p: any) => `<p class="meta" data-plan="${h(p.id)}">${h(packName(p))}: ${countsCredits(p) ? `${p.remaining} available` : `${h(planTerms(p.entitlement))}; ${h(packLeft(p))}`}; expires ${packExpiration(s, p.expiresAt)}${p.eligibleServices?.length ? ` · ${h(p.eligibleServices.join(', '))}` : ''}</p>`
  const creditPanel = panel('My credits', body(packs.length ? `${packs.some(countsCredits) ? `<p class="credits-big"><b>${credits}</b> credits to use</p>` : ''}${packs.map(packLine).join('')}` : '<p class="meta">You have no class credits. Ask the studio for a pack.</p>'), { icon: 'card' })
  const schedule = list.length ? `<div class="table-wrap">${weekTable(s, list, c => bookAction(s, c))}</div>` : emptyState('calendar', 'No classes open for booking', 'The studio has not published upcoming classes yet.')
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Classes</h1><p>A booking uses one credit; the waitlist holds none until you move up.</p></div>${(s.intake?.missing ?? []).some((m: any) => m.personId === s.actor.personId)?'<p class="notice"><a href="/app/intake">Complete the current intake forms</a> before your next relevant enrollment.</p>':''}${noticesPanel(s)}${!signed ? `<p class="notice">Acknowledge the studio’s waiver before you book.</p>` : ''}${attendancePlanControls(s,s.actor.personId,'/app#attendance-plan')}${panel('Book a class', schedule, { icon: 'calendar' })}${reservationsPanel(s,s.actor.personId,'/app#recurring-reservations')}${clientAppointmentsPanel(s,s.actor.personId,'/app#client-appointments')}</div><aside class="rail">${memberCheckin(s)}${creditPanel}${messagePreferencePanel(s)}${waiver}${serviceDocuments(s,s.actor.personId,'/app')}${rows(s,'acknowledgements').filter(a=>a.personId===s.actor.personId).map(a=>`<p><a href="/api/strap/waiver-evidence.json?id=${h(a.id)}">Download document evidence · ${h(a.signature?.documentVersion ?? a.waiverId)}</a> · <a href="/api/strap/waiver-evidence.html?id=${h(a.id)}">Download readable copy</a></p>`).join('')}${!waiver ? panel('Waiver', emptyLine('The studio has not published a waiver.'), { id: 'waiver' }) : ''}</aside></div>`
}
