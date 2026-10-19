import { packName } from './facts'
import { when, zoneOf } from './format'
import { body, cell, emptyLine, field, form, h, hidden, person, rows, table } from './shared'

/** Display the stored instant exactly, including seconds, offset and studio zone. */
export function packExpiration(s: any, value: string) {
  const timeZone = zoneOf(s) ?? 'UTC', at = new Date(value)
  const label = new Intl.DateTimeFormat('en-US', {timeZone,year:'numeric',month:'short',day:'numeric',
    hour:'numeric',minute:'2-digit',second:'2-digit',...(at.getUTCMilliseconds() ? {fractionalSecondDigits:3 as const} : {}),timeZoneName:'longOffset'}).format(at)
  return `<time datetime="${h(value)}">${h(label)} (${h(timeZone)})</time>`
}

export function packCreditCounts(p: any) {
  const summary = p.summary
  return `<span class="chip${summary.remaining ? '' : ' quiet'}">${summary.remaining} remaining</span><small>${summary.reserved} reserved · ${summary.consumed} consumed · ${summary.restored} restored · ${summary.expired} expired</small>`
}

function adjustment(s: any, p: any) {
  return `<details class="more"><summary>Adjust credits or expiration</summary>${body(`<p>Adjust available credits only. Reserved credits stay with their bookings. A negative number removes available credits; zero changes only expiration. Money owed stays separate.</p>${form('pack.adjust','/app/packs',
    hidden('id',p.id)+hidden('requestId',crypto.randomUUID())+hidden('revision',p.summary.revision)
    +field('creditsDelta','Credit adjustment','0','number','required min="-10000" max="10000" step="1"')
    +field('reason','Reason','','text','required maxlength="2000"')
    +`<p>Optional new expiration on the studio clock (${h(zoneOf(s) ?? 'UTC')}). Leave both fields blank to keep the current instant. A past instant expires available credits immediately.</p><div class="row2">`
    +field('expiresDate','New expiration date','','date')+field('expiresTime','New expiration time','','time','step="1"')+'</div>',
    'Save adjustment','quiet')}`)}</details>`
}

export function packHistory(s: any, packs: any[], mine: boolean) {
  if (!packs.length) return emptyLine('Credit history appears when a pack is approved.')
  return packs.map(p => {
    const events = rows(s,'packCreditEvents').filter(event => event.packId === p.id).sort((a,b) => a.revision-b.revision)
    const opening = p.summary.legacyOpening ? `<p>This pack predates detailed credit events. Its observed opening balance and retained booking allocations are shown; earlier unrecorded events are unavailable.${p.summary.unaccountedLegacy ? ` ${p.summary.unaccountedLegacy} earlier credits have no retained usage detail.` : ''}</p>` : ''
    const history = events.length ? `<div class="table-wrap">${table(['Recorded','Event','Available change','Booking / reason','Actor'],events.map(event => {
      const entry = rows(s,'classes').find(c => c.id === event.classId)
      const booking = event.bookingId ? entry ? `<a href="/app?class=${encodeURIComponent(entry.id)}">${h(entry.title)}</a>` : '<span>Booked class</span>' : ''
      const reason = event.reason ? `<span>${h(event.reason)}</span>` : ''
      const expiryChange = event.type === 'adjust' && event.expiresAtBefore !== event.expiresAtAfter ? `<small>Expiration: ${packExpiration(s,event.expiresAtBefore)} → ${packExpiration(s,event.expiresAtAfter)}</small>` : ''
      const label = event.type === 'opening' ? 'Legacy opening balance' : `${event.type.charAt(0).toUpperCase()}${event.type.slice(1)}`
      return `<tr>${cell('Recorded',when(s,event.createdAt))}${cell('Event',h(label))}${cell('Available change',`${event.credits > 0 ? '+' : ''}${event.credits}<small>${event.remainingAfter} available after</small>`)}${cell('Booking / reason',booking+reason+expiryChange || '—')}${cell('Actor',h(event.actorRole.charAt(0).toUpperCase() + event.actorRole.slice(1)))}</tr>`
    }).join(''))}</div>` : emptyLine('No credit events have been recorded since this legacy opening balance.')
    return `<details class="more" id="pack-${h(p.id)}"><summary>${h(mine ? packName(p) : `${person(s,p.personId)} · ${packName(p)}`)} · Credit history</summary>${body(`<p>${packCreditCounts(p)}</p><p>Eligible services: ${h(p.eligibleServices?.join(', ') || 'All classes')}. Expires ${packExpiration(s,p.expiresAt)}.</p><p>A booked seat reserves one credit. Check-in consumes it; cancellation returns it. Restored is the total returned over this history.</p>${opening}`)}${history}${mine ? '' : adjustment(s,p)}</details>`
  }).join('')
}
