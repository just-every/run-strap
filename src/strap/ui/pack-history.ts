import { packLeft, packName } from './facts'
import { planTerms } from '../domain/entitlements'
import { when, zoneOf } from './format'
import { body, cell, emptyLine, field, form, h, hidden, person, rows, table } from './shared'

/** Display the stored instant exactly, including seconds, offset and studio zone. */
export function packExpiration(s: any, value: string) {
  const timeZone = zoneOf(s) ?? 'UTC', at = new Date(value)
  const label = new Intl.DateTimeFormat('en-US', {timeZone,year:'numeric',month:'short',day:'numeric',
    hour:'numeric',minute:'2-digit',second:'2-digit',...(at.getUTCMilliseconds() ? {fractionalSecondDigits:3 as const} : {}),timeZoneName:'longOffset'}).format(at)
  return `<time datetime="${h(value)}">${h(label)} (${h(timeZone)})</time>`
}

/** A plan's ledger event as a visit, never a credit count (PLAN-002). */
const visitEvent = (event: any) => event.type === 'grant' ? 'Plan starts' : event.type === 'reserve' ? 'Holds a visit' : event.type === 'restore' ? 'Returns the visit'
  : event.type === 'consume' ? (event.reason === 'late_cancel' ? 'Late cancel: visit kept' : event.reason === 'no_show' ? 'No-show: visit used' : 'Attended') : event.type === 'transfer' ? 'Visit moves with the booking' : 'Expiration change'

export function packCreditCounts(p: any) {
  const summary = p.summary, plan = summary.plan
  if (plan) return `<span class="chip${plan.left === 0 ? ' quiet' : ''}">${h(packLeft(p))}</span><small>${plan.reserved} reserved · ${plan.attended} attended · ${plan.absent ?? 0} reported absent (visit used) · ${plan.lateCancelled} late-cancelled (visit kept) · ${plan.returned} returned${plan.kind === 'visits' ? ` · ${plan.periods.reduce((n: number, x: any) => n + x.expired, 0)} expired` : ''}</small>`
  return `<span class="chip${summary.remaining ? '' : ' quiet'}">${summary.remaining} remaining</span><small>${summary.reserved} reserved · ${summary.consumed} consumed · ${summary.restored} restored · ${summary.expired} expired</small>`
}

function adjustment(s: any, p: any) {
  const plan = !!p.summary.plan
  return `<details class="more"><summary>${plan ? 'Adjust expiration' : 'Adjust credits or expiration'}</summary>${body(`<p>${plan ? 'A plan holds visits, not credits: only its expiration can change. Booked visits stay with their bookings.' : 'Adjust available credits only. Reserved credits stay with their bookings. A negative number removes available credits; zero changes only expiration.'} Money owed stays separate.</p>${form('pack.adjust','/app/packs',
    hidden('id',p.id)+hidden('requestId',crypto.randomUUID())+hidden('revision',p.summary.revision)
    +(plan ? hidden('creditsDelta',0) : field('creditsDelta','Credit adjustment','0','number','required min="-10000" max="10000" step="1"'))
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
    const history = events.length ? `<div class="table-wrap">${table(['Recorded','Event',p.summary.plan ? 'Visit' : 'Available change','Booking / reason','Actor'],events.map(event => {
      const entry = rows(s,'classes').find(c => c.id === event.classId)
      const booking = event.bookingId ? entry ? `<a href="/app?class=${encodeURIComponent(entry.id)}">${h(entry.title)}</a>` : '<span>Booked class</span>' : ''
      const reason = event.reason ? `<span>${h(event.reason)}</span>` : ''
      const expiryChange = event.type === 'adjust' && event.expiresAtBefore !== event.expiresAtAfter ? `<small>Expiration: ${packExpiration(s,event.expiresAtBefore)} → ${packExpiration(s,event.expiresAtAfter)}</small>` : ''
      const label = event.type === 'opening' ? 'Legacy opening balance' : `${event.type.charAt(0).toUpperCase()}${event.type.slice(1)}`
      const change = p.summary.plan ? h(visitEvent(event)) : `${event.credits > 0 ? '+' : ''}${event.credits}<small>${event.remainingAfter} available after</small>`
      return `<tr>${cell('Recorded',when(s,event.createdAt))}${cell('Event',h(label))}${cell(p.summary.plan ? 'Visit' : 'Available change',change)}${cell('Booking / reason',booking+reason+expiryChange || '—')}${cell('Actor',h(event.actorRole.charAt(0).toUpperCase() + event.actorRole.slice(1)))}</tr>`
    }).join(''))}</div>` : emptyLine('No credit events have been recorded since this legacy opening balance.')
    const plan = p.summary.plan, explain = plan ? `<p>${h(planTerms(p.entitlement))}. A booked seat holds one visit in the period its class starts (studio clock: weeks from Monday, months from the 1st). A freeze extension carries only the unused final paid allowance; it grants no new weekly or monthly allowance. Check-in or a no-show marks it attended; a late cancel that keeps the visit still counts; an early cancel returns it.</p>${plan.periods.length ? `<div class="table-wrap">${table(['Period','Visits','Rolled in','Booked','Attended','Late cancel','Absence','Returned','Rolls over','Expired'],plan.periods.map((x: any) => `<tr>${cell('Period',`${h(x.start)}<small>ends ${when(s,x.endsAt)}</small>`)}${cell('Visits',`${x.used} of ${x.allowance}`)}${cell('Rolled in',String(x.carriedIn))}${cell('Booked',String(x.reserved))}${cell('Attended',String(x.attended))}${cell('Late cancel',String(x.lateCancelled))}${cell('Absence',String(x.absent ?? 0))}${cell('Returned',String(x.returned))}${cell('Rolls over',x.ended ? String(x.carriedOut) : `${x.carriedOut} so far`)}${cell('Expired',x.ended ? String(x.expired) : '—')}</tr>`).join(''))}</div>` : ''}` : '<p>A booked seat reserves one credit. Check-in consumes it; cancellation returns it. Restored is the total returned over this history.</p>'
    return `<details class="more" id="pack-${h(p.id)}"><summary>${h(mine ? packName(p) : `${person(s,p.personId)} · ${packName(p)}`)} · ${plan ? 'Visit' : 'Credit'} history</summary>${body(`<p>${packCreditCounts(p)}</p><p>Eligible services: ${h(p.eligibleServices?.join(', ') || 'All classes')}. Expires ${packExpiration(s,p.expiresAt)}.</p>${explain}${opening}`)}${history}${mine ? '' : adjustment(s,p)}</details>`
  }).join('')
}
