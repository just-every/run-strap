import type { retentionReport } from '../retention-report'
import { money, when } from './format'
import { body, cell, field, h, panel, table, textarea } from './shared'

const path = '/app/retention'
type Report = ReturnType<typeof retentionReport>

const rate = (value: number | null) => value === null ? 'Unavailable' : h(value)+'%'
const frequency = (value: number | null) => value === null ? 'Unavailable' : h(value)+' per 30 days'

/** Reads the same authoritative report and filters as the JSON and CSV doors. */
export function retentionPage(s: any) {
  const report: Report = s.retentionReport
  const filters = new URLSearchParams(); for (const [key,value] of Object.entries(report.filters)) if (value !== null) filters.set(key,value)
  const query = filters.size ? '?'+filters : ''
  const cohorts = report.cohorts.map(cohort => `<tr data-cohort="${h(cohort.acquisitionMonth)}" data-offer="${h(cohort.initialOffer)}">`
    + cell('Cohort',`${h(cohort.acquisitionMonth)}<small>${h(cohort.initialOffer)}</small>`)
    + cell('Members / terms',`${h(cohort.members)} member${cohort.members === 1 ? '' : 's'}<small>${h(cohort.terms)} term${cohort.terms === 1 ? '' : 's'}</small>`)
    + cell('Renewal',`${h(cohort.renewedTerms)} of ${h(cohort.completedTerms)} completed renewed<small>${rate(cohort.renewalRatePercent)} · ${h(cohort.scheduledRenewals)} scheduled · ${h(cohort.expiredWithoutLinkedRenewal)} expired without a linked renewal</small>`)
    + cell('Period churn',`${h(cohort.churn.lostMembers)} of ${h(cohort.churn.openingMembers)} opening members lost<small>${rate(cohort.churn.memberChurnPercent)} member churn</small><div>${rate(cohort.churn.revenueChurnPercent)} gross canceled recurring revenue<small>${cohort.churn.lostMonthlyCents === null ? 'Unavailable' : money(cohort.churn.lostMonthlyCents)} lost of ${cohort.churn.openingMonthlyCents === null ? 'unavailable' : money(cohort.churn.openingMonthlyCents)} opening monthly commitment</small></div>`)
    + cell('Tenure',`${h(cohort.meanTenureDays)} days mean`)
    + cell('Lifecycle',`${h(cohort.terminatedAgreements)} terminated · ${h(cohort.scheduledTerminations)} scheduled<small>${cohort.churnByReason.map(r => h(r.label)+': '+h(r.count)).join(' · ') || 'No terminations'}</small><div>${h(cohort.freezes)} native freezes · ${h(cohort.reactivations)} resumed<small>${cohort.freezeByType.map(r => h(r.label)+': '+h(r.count)).join(' · ') || 'No started freezes'}</small></div>` )
    + cell('Collected renewals',cohort.collectedRenewalCents === null ? 'Unavailable' : money(cohort.collectedRenewalCents))
    + cell('Attendance',`${h(cohort.attendedVisits)} visits<small>${frequency(cohort.visitsPer30Days)}</small>`)
    + '</tr>').join('')
  const terms = report.rows.map(row => `<tr data-pack-id="${h(row.packId)}">`
    + cell('Member / offer',`<a href="/app/people?person=${encodeURIComponent(row.personId)}#person">${h(row.member)}</a><small>${h(row.initialOffer)} · cohort ${h(row.acquisitionMonth)}</small>`)
    + cell('Term',`${h(row.source)}${row.historyId ? ` · <a href="/app/retention?history=${encodeURIComponent(row.historyId)}#history-evidence">Import evidence</a>` : ''}<small>${when(s,row.termStartAt)}</small><small>to ${when(s,row.expiresAt)} · ${row.completed ? 'completed' : 'running'}</small>`)
    + cell('Renewal',`${h(row.renewalStatus.replace(/-/g,' '))}`)
    + cell('Tenure / visits',`${h(row.tenureDays)} days<small>${h(row.attendedVisits)} visits · ${frequency(row.visitsPer30Days)}</small>`)
    + cell('Lifecycle',`${h(row.terminationReasons.join(', ') || 'No applied termination')}<small>${h(row.freezeTypes.join(', ') || 'No started freeze')} · ${h(row.resumedFreezeIds.length)} resumed</small><div><a href="${h(row.lifecycleUrl)}">Cancellation evidence</a> · <a href="${h(row.freezeUrl)}">Freeze evidence</a></div>`)
    + cell('Collected renewals',`${row.collectedRenewalCents === null ? 'Unavailable' : money(row.collectedRenewalCents)}${row.paymentUrls.map((url,i) => ` · <a href="${h(url)}">Receipt ${i+1}</a>`).join('')}`)
    + cell('Evidence',`<a href="${h(row.packUrl)}">Pack</a>${row.churnEvidence.agreementUrls.map((url,i) => ` · <a href="${h(url)}">Opening agreement ${i+1}</a>`).join('')}${row.renewalUrl ? ` · <a href="${h(row.renewalUrl)}">Renewal</a>` : ''}${row.chargeUrls.map((url,i) => ` · <a href="${h(url)}">Charge ${i+1}</a>`).join('')}`)
    + '</tr>').join('')
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Retention cohorts</h1><p>Native credit, visit and unlimited plans, as of ${when(s,report.asOf)}.</p></div>`
    + panel('Cohort filters',body(`<form class="form" method="get" action="${path}"><div class="row2">`
      + field('month','Acquisition month (YYYY-MM)',report.filters.month ?? '','text','pattern="\\d{4}-(0[1-9]|1[0-2])" placeholder="2026-10"')
      + field('offer','Initial offer',report.filters.offer ?? '','text','maxlength="80"')
      + field('churnFrom','Churn from (UTC instant)',report.filters.churnFrom ?? '','text','placeholder="2026-10-01T00:00:00Z"')
      + field('churnTo','Churn to (UTC instant)',report.filters.churnTo ?? '','text','placeholder="2026-10-24T00:00:00Z"')
      + `</div><p>Churn period: ${h(report.churnPeriod.from)} to ${h(report.churnPeriod.to)}. Blank dates use the last 30 complete UTC days.</p><button class="btn" type="submit">Apply cohort filters</button></form><p><a href="/api/strap/reports/retention.csv${h(query)}">Download retention CSV</a> · <a href="/api/strap/reports/retention.xlsx${h(query)}">Download retention XLSX</a></p>`))
    + panel('Cohorts',`<div class="table-wrap">${table(['Cohort','Members / terms','Renewal','Period churn','Tenure','Lifecycle','Collected renewals','Attendance'],cohorts || '<tr><td colspan="8">No cohorts match these filters.</td></tr>')}</div>`)
    + panel('Terms behind the cohorts',`<div class="table-wrap">${table(['Member / offer','Term','Renewal','Tenure / visits','Lifecycle','Collected renewals','Evidence'],terms || '<tr><td colspan="7">No terms match these filters.</td></tr>')}</div>`)
    + (report.selectedHistory ? panel('Imported source evidence',body(`<div id="history-evidence"><p>${h(report.selectedHistory.source)} · reviewed ${h(report.selectedHistory.importedAt)}</p><p>${h(report.selectedHistory.definitionDifferences)}</p>${textarea('historyEvidence','Retained historical source',JSON.stringify(report.selectedHistory,null,2),'readonly rows="18" class="mono"')}</div>`)) : '')
    + (report.histories.length ? panel('Imported definition differences',body(report.histories.map(source => `<p><a href="/app/retention?history=${encodeURIComponent(source.id)}#history-evidence">${h(source.source)}</a>: ${h(source.definitionDifferences)}</p>`).join('')+'<p>Historical source totals join native terms and corrected visits. Period churn and freeze events cover native records only; historical denominators and freeze events are unavailable.</p>')) : '')
    + panel('Definitions',body(report.definitions.map(text => `<p>${h(text)}</p>`).join('')+'<p>Imported rows are owner-reviewed historical observations. Period churn covers accepted native recurring agreements only; finite expiry alone never establishes churn. Collected amounts include only explicitly allocated external receipts.</p>'))
    + '</div></div>'
}
