import type { leadReport } from '../lead-report'
import { money } from './format'
import { body, cell, field, h, hidden, panel, table } from './shared'

export function leadReportPanel(report: ReturnType<typeof leadReport>) {
  const sources = report.sources.map(row => '<tr>'+cell('Source',h(row.source ?? 'Unknown source'))
    +cell('Inquiries',`${row.members} members · ${row.inquiries} inquiries<small>${row.recordedIntroBookings} recorded intro bookings</small>`)
    +cell('Sales',`${row.introPurchases} intro purchases · ${row.nativeMembershipConversions} native conversions<small>${money(row.attributedRevenueCents)} gross invoiced revenue</small>`)
    +cell('Attendance',`${row.firstVisits} first · ${row.repeatAttendance} repeat`)
    +cell('Outcomes',`${row.externalOutcomes} external · ${row.lostInquiries} lost<small>${row.incompleteFollowUps} follow-ups · ${row.overdueFollowUps} overdue</small>`)+'</tr>').join('')
  const rows = report.rows.map(row => `<tr data-funnel-member="${h(row.personId)}">`
    +cell('Member',`<a href="${h(row.leadUrl)}">${h(row.member)}</a><small>${h(row.source ?? 'Unknown source')}${row.campaignName ? ' · '+h(row.campaignName) : ''}</small>`)
    +cell('Attendance',`${row.attendedVisits} attended${row.repeatAttendance ? ' · repeat attendance' : ''}`)
    +cell('Sales',`<span>${row.introPurchases.length} intro purchases · ${row.nativeConversions.length ? 'Native membership converted' : 'No native conversion'}</span><small>${money(row.attributedRevenueCents)} gross invoiced revenue</small>`
      +`<details><summary>Recorded sales evidence</summary><ul>`
      +row.introPurchases.map(e => `<li data-intro-sale-id="${h(e.id)}"><a href="${h(e.url)}">Intro purchase</a> · ${money(e.amountCents)} · ${h(e.at)} · ${h(e.id)}</li>`).join('')
      +row.nativeConversions.map(e => `<li data-conversion-id="${h(e.id)}"><a href="${h(e.url)}">Native membership</a> · ${h(e.kind)} · ${h(e.at)} · ${h(e.id)}</li>`).join('')
      +row.revenueEvents.map(e => `<li data-revenue-id="${h(e.id)}"><a href="${h(e.url)}">Original sale charge</a> · ${money(e.amountCents)} · ${h(e.at)} · ${h(e.id)}</li>`).join('')+'</ul></details>')
    +cell('Evidence',`${row.leadIds.map((id,i) => `<a href="/app/leads?lead=${encodeURIComponent(id)}#lead">Inquiry ${i+1}</a>`).join(' · ')}${row.visitUrls.map((url,i) => ` · <a href="${h(url)}">Visit ${i+1}</a>`).join('')}`)
    +cell('Follow-up',`${row.incompleteLeadIds.length} incomplete · ${row.overdueLeadIds.length} overdue`)
    +'</tr>').join('')
  return panel('Inquiry and attendance funnel',body(`<form class="form" method="get" action="/app/leads">${field('funnelSource','Acquisition source',report.filters.source ?? '','text','maxlength="100"')}${hidden('funnelCampaign',report.filters.campaignId ?? '')}<button class="btn-quiet">Filter funnel</button></form>`
      +(report.filters.campaignId ? '<p>Campaign filter active · <a href="/app/leads">Clear campaign filter</a></p>' : ''))
    +`<div class="table-wrap">${table(['Source','Inquiries','Sales','Attendance','Outcomes'],sources || '<tr><td colspan="5">No inquiries match this source.</td></tr>')}</div>`
    +`<div class="table-wrap">${table(['Member','Attendance','Sales','Evidence','Follow-up'],rows || '<tr><td colspan="5">No member evidence in this view.</td></tr>')}</div>`
    +body('<details><summary>Funnel definitions</summary>'+report.definitions.map(text => `<p>${h(text)}</p>`).join('')+'</details>'))
}
