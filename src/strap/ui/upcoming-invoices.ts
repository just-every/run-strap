import type { upcomingInvoices } from '../upcoming-invoices'
import { invoiceForecastStatuses } from '../upcoming-invoices'
import { money, when } from './format'
import { body, cell, field, h, panel, select, statusPill, table } from './shared'

export function upcomingInvoicesPage(s: any) {
  const report: ReturnType<typeof upcomingInvoices> = s.upcomingInvoices
  const query = new URLSearchParams({from:report.from,to:report.to})
  for (const name of ['location','plan','status'] as const) if (report.filters[name]) query.set(name,report.filters[name]!)
  const rows = (items: typeof report.rows) => items.map(r => `<tr data-upcoming-agreement="${h(r.agreementId)}">`
    + cell('Member and source',`<a href="${h(r.agreementUrl)}">${h(r.member)}</a><small>Agreement ${h(r.agreementId)}</small><a href="${h(r.packUrl)}">Source pack ${h(r.packId)}</a><small>${h(r.location)} · ${h(r.plan)}</small>`)
    + cell('Invoice date',`${when(s,r.dueAt)}<small>${h(r.localDate)} · ${h(report.timeZone)}</small>${r.movedByFreezeId?'<small>Renewal moved by an agreed freeze</small>':''}`)
    + cell('Native invoice',`${money(r.amountCents)}<small>Current agreed price ${money(r.agreedAmountCents)}</small>${r.acceptedPriceId?'<small>Personally accepted renewal price</small>':''}`)
    + cell('Eligibility',`${statusPill(r.status)}${r.reason?'<p>'+h(r.reason.replace(/_/g,' '))+'</p>':''}${r.terminationAt?'<p>Access ends '+when(s,r.terminationAt)+'</p>':''}<small>Payment readiness unavailable</small>`)
    + cell('Forecast',money(r.forecastCents))+'</tr>').join('')
  const sources = (items: typeof report.rows) => `<div class="table-wrap">${table(['Member and source','Invoice date','Native invoice','Eligibility','Forecast'],rows(items) || '<tr><td colspan="5">No accepted agreements in this period.</td></tr>')}</div>`
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Upcoming native invoices</h1><p>Accepted recurring studio-balance invoices.</p></div>`
    + panel('Forecast period',body(`<form class="form" action="/app/upcoming-invoices" method="get">${field('from','First studio date',report.from,'date','required')}${field('to','Last studio date',report.to,'date','required')}${select('location','Sale location',[['','All locations'],...report.locations.map(p => [p.id,p.name] as [string,string])],report.filters.location ?? '','')}${select('plan','Accepted plan',[['','All plans'],...report.plans.map(plan => [plan,plan] as [string,string])],report.filters.plan ?? '','')}${select('status','Invoice status',[['','All statuses'],...invoiceForecastStatuses.map(status => [status,status.replace(/_/g,' ')] as [string,string])],report.filters.status ?? '','')}<button class="btn" type="submit">Show forecast</button></form><p>${h(report.from)} through ${h(report.to)} · ${h(report.timeZone)}</p><p><strong data-forecast-total="${report.totals.forecastCents}">${money(report.totals.forecastCents)}</strong> · ${report.totals.scheduledCount} eligible invoices · ${report.totals.excludedCount} excluded agreements</p><p><a href="/api/strap/reports/upcoming-invoices.csv?${h(query)}">Download forecast CSV</a> · <a href="/api/strap/reports/upcoming-invoices.xlsx?${h(query)}">Download forecast XLSX</a> · <a href="/app/packs#freezes">Review invoice agreements</a></p>`))
    + panel('Accepted agreements',sources(report.rows))
    + panel('Daily totals',`<div class="table-wrap">${table(['Studio date','Eligible invoices','Forecast'],report.daily.map(d => '<tr>'+cell('Studio date',h(d.date))+cell('Eligible invoices',h(d.scheduledCount))+cell('Forecast',money(d.forecastCents))+'</tr>').join(''))}</div>`)
    + (report.overdue.length ? panel('Earlier dates needing review',body('<p>These dates precede the selected period and do not enter its forecast.</p>')+sources(report.overdue)) : '')
    + panel('Coverage',body(`<p>${h(report.coverage)}</p><p>Checked ${when(s,report.asOf)}. No collection controls are available here.</p>`))+'</div></div>'
}
