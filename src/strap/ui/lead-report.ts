import type { leadReport } from '../lead-report'
import { body, cell, field, h, panel, table } from './shared'

export function leadReportPanel(report: ReturnType<typeof leadReport>) {
  const sources = report.sources.map(row => '<tr>'+cell('Source',h(row.source ?? 'Unknown source'))
    +cell('Inquiries',`${row.members} members · ${row.inquiries} inquiries<small>${row.recordedIntroBookings} recorded intro bookings</small>`)
    +cell('Attendance',`${row.firstVisits} first · ${row.repeatAttendance} repeat`)
    +cell('Outcomes',`${row.externalOutcomes} external · ${row.lostInquiries} lost<small>${row.incompleteFollowUps} follow-ups · ${row.overdueFollowUps} overdue</small>`)+'</tr>').join('')
  const rows = report.rows.map(row => `<tr data-funnel-member="${h(row.personId)}">`
    +cell('Member',`<a href="${h(row.leadUrl)}">${h(row.member)}</a><small>${h(row.source ?? 'Unknown source')}</small>`)
    +cell('Attendance',`${row.attendedVisits} attended${row.repeatAttendance ? ' · repeat attendance' : ''}`)
    +cell('Evidence',`${row.leadIds.map((id,i) => `<a href="/app/leads?lead=${encodeURIComponent(id)}#lead">Inquiry ${i+1}</a>`).join(' · ')}${row.visitUrls.map((url,i) => ` · <a href="${h(url)}">Visit ${i+1}</a>`).join('')}`)
    +cell('Follow-up',`${row.incompleteLeadIds.length} incomplete · ${row.overdueLeadIds.length} overdue`)
    +'</tr>').join('')
  return panel('Inquiry and attendance funnel',body(`<form class="form" method="get" action="/app/leads">${field('funnelSource','Acquisition source',report.filters.source ?? '','text','maxlength="100"')}<button class="btn-quiet">Filter funnel</button></form>`)
    +`<div class="table-wrap">${table(['Source','Inquiries','Attendance','Outcomes'],sources || '<tr><td colspan="4">No inquiries match this source.</td></tr>')}</div>`
    +`<div class="table-wrap">${table(['Member','Attendance','Evidence','Follow-up'],rows || '<tr><td colspan="4">No member evidence in this view.</td></tr>')}</div>`
    +body('<p>Intro purchases, native membership conversions, campaign cost and attributed revenue: unavailable.</p>'
      +report.definitions.map(text => `<p>${h(text)}</p>`).join('')))
}
