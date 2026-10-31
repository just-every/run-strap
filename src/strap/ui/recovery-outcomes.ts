import type { recoveryOutcomes } from '../recovery-outcomes'
import { when } from './format'
import { body, cell, field, h, panel, table } from './shared'

type Report = ReturnType<typeof recoveryOutcomes>
const path = '/app/recovery-outcomes'
const label = (value: string) => h(value.replace(/_/g,' '))
export function recoveryOutcomesPage(s: any) {
  const report: Report = s.recoveryOutcomes, total = report.totals
  const summaries = report.campaigns.map(c => `<tr data-outcome-campaign="${h(c.id)}">`
    + cell('Campaign',`<a href="${path}?campaign=${encodeURIComponent(c.id)}&windowDays=${report.filters.windowDays}">${h(c.text)}</a><small>${h(c.kind)} · ${label(c.design)} · ${when(s,c.approvedAt)}</small>`)
    + cell('Sample',`${c.audienceMembers} audience members<small>${c.measuredMembers} measured members · ${c.excluded} excluded</small>`)
    + cell('Offers',`${c.accepted} accepted · ${c.declined} declined · ${c.unaccepted} unaccepted<small>${c.suppressed} suppressed · ${c.expired} expired</small>`)
    + cell('Observation',`${c.attendedVisits} completed visits · ${c.membersWithVisits} members<small>${c.completeWindows} complete windows · ${c.incompleteWindows} incomplete · ${c.windowDays} days</small>${c.design === 'randomized_holdout' ? c.groups.map(g => `<small>${label(g.group)}: ${g.measuredMembers} measured members · ${g.attendedVisits} visits</small>`).join('') : ''}`)
    + cell('Incentives',`$${(c.budgetCents/100).toFixed(2)} approved budget<small>$${(c.reservedIncentiveCents/100).toFixed(2)} reserved · ${c.postedCreditCents === null ? 'Unavailable' : '$'+(c.postedCreditCents/100).toFixed(2)} posted studio credits</small>`)
    + cell('Conclusion','Inconclusive<small>Collected renewal revenue unavailable</small>')+'</tr>').join('')
  const rows = report.rows.map(r => `<tr data-outcome-offer="${h(r.offerId ?? r.personId)}">`
    + cell('Member',r.memberUrl ? `<a href="${h(r.memberUrl)}">${h(r.member)}</a>` : h(r.member))
    + cell('Intervention',`${h(r.kind)} · ${h(r.status)}${r.group !== 'observational' ? `<small>${label(r.group)} group</small>` : ''}${r.exclusionReason ? `<small>Excluded: ${label(r.exclusionReason)}</small>` : ''}`)
    + cell('Window',r.window.end ? `${r.window.complete ? 'Complete' : 'Incomplete'}<small>${when(s,r.window.start)} to ${when(s,r.window.end)}</small>` : 'No offer window')
    + cell('Visits',`${r.attendedBookingIds.length} completed${r.detailUrl ? `<small><a href="${h(r.detailUrl)}">Inspect outcome sources</a></small>` : ''}`)
    + '</tr>').join('')
  const selected = report.selected
  const detail = selected ? panel('Intervention and visit sources',body(`<div id="outcome-source"><h3>${h(selected.member)} · ${h(selected.status)}</h3>`
    + `<p>Campaign ${h(selected.campaignId)} · approved ${when(s,selected.source.campaign.approvedAt)} by ${h(selected.source.campaign.approvedBy)}. ${selected.offerId ? 'Offer '+h(selected.offerId)+'.' : 'No campaign offer was sent.'}</p>`
    + `<p>${h(selected.source.campaign.text)}</p><p>Recorded source state: ${h(selected.source.offer?.status ?? selected.status)}. ${selected.exclusionReason ? 'Excluded: '+label(selected.exclusionReason)+'.' : ''} Acceptance: ${selected.source.offer?.acceptedAt ? when(s,selected.source.offer.acceptedAt) : 'Not recorded'}.</p>`
    + (selected.source.offer?.declinedAt ? `<p>Member declined ${when(s,selected.source.offer.declinedAt)} · recorded by ${h(selected.source.offer.declinedBy)}.</p>` : '')
    + (selected.cost ? `<p>Incentive: ${label(selected.cost.status)}. Reserved $${(selected.cost.reservedCents/100).toFixed(2)}. Posted studio credit: ${selected.cost.postedCreditCents === null ? 'Not established' : '$'+(selected.cost.postedCreditCents/100).toFixed(2)}.${selected.cost.chargeId ? ' Ledger source '+h(selected.cost.chargeId)+'.' : ''} No cash or collected revenue is inferred.</p>` : '')
    + (selected.source.offer?.bookingId ? `<p>Accepted booking: ${h(selected.source.offer.bookingId)}</p>` : '')
    + (selected.source.offer?.packId ? `<p><a href="/app/packs#pack-${encodeURIComponent(selected.source.offer.packId)}">Accepted finite membership source</a>. A studio balance is not collected renewal revenue.</p>` : '')
    + selected.observations.map(v => `<article data-outcome-booking="${h(v.bookingId)}"><h3><a href="${h(v.url)}">${h(v.title)}</a></h3><p>Booking ${h(v.bookingId)} · class ${h(v.classId)} · ${when(s,v.start)} to ${when(s,v.end)}.</p><p>${h(v.status)} · ${label(v.attendance)} · ${v.counted ? 'Counted completed visit' : 'Not counted'}.</p>`
      + (v.attendancePlanId ? `<p>Accepted attendance plan ${h(v.attendancePlanId)}.</p>` : '')
      + v.corrections.map((c: any) => `<p>Correction ${label(c.from)} to ${label(c.to)} · ${when(s,c.at)} · ${h(c.reason)} · recorded by ${h(c.by)}.</p>`).join('')+'</article>').join('')
    + (selected.observations.length ? '' : '<p>No eligible completed-class observations in this window.</p>')+'</div>')) : ''
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Recovery outcomes</h1><p>Observed attendance after approved offers. Causal effects remain inconclusive.</p><a href="/app/leads">Back to lead follow-up</a></div>`
    + panel('Observation window',body(`<form method="get" action="${path}" class="form">${field('windowDays','Observation days',report.filters.windowDays,'number','min="1" max="90" required')}${report.filters.campaign ? `<input type="hidden" name="campaign" value="${h(report.filters.campaign)}">` : ''}<button class="btn" type="submit">Apply observation window</button><a href="${path}">All approved campaigns</a></form><p><a href="/api/strap/reports/recovery-outcomes?windowDays=${report.filters.windowDays}${report.filters.campaign ? '&campaign='+encodeURIComponent(report.filters.campaign) : ''}">Read report JSON</a></p>`))
    + panel('Observed sample',body(`<div class="stat-row"><div class="stat"><b data-outcome-total="visits">${total.attendedVisits}</b><small>Distinct completed visits</small></div><div class="stat"><b>${total.measuredMembers}</b><small>Measured members</small></div><div class="stat"><b>${total.incompleteWindows}</b><small>Incomplete windows</small></div></div><p>${total.audienceMembers} audience members · ${total.completeWindows} complete windows · ${total.excluded} excluded observations. Collected renewal revenue: <strong>Unavailable</strong>.</p><p>Observed comparisons do not establish a causal effect. Randomized groups retain their approved observation days. Unaccepted offers are not declines. ${report.outsideCoverage} campaign previews are outside this report.</p>`))
    + panel('Approved campaigns',`<div class="table-wrap">${table(['Campaign','Sample','Offers','Observation','Incentives','Conclusion'],summaries || '<tr><td colspan="6">No approved zero-incentive campaigns.</td></tr>')}</div>`)
    + panel('Offer observations',`<div class="table-wrap">${table(['Member','Intervention','Window','Visits'],rows || '<tr><td colspan="4">No offer observations.</td></tr>')}</div>`)
    + detail + panel('Definitions and unavailable outcomes',body(report.definitions.map(d => `<p>${h(d)}</p>`).join('')))+'</div></div>'
}
