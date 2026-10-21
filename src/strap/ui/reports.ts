import { attendanceReport } from '../attendance-report'
import { roomOf } from '../domain/scheduling'
import { body, cell, field, h, panel, person, select, table } from './shared'

export function reportsPage(s: any, query: URLSearchParams) {
  const report = attendanceReport(s,query), total = report.totals
  const choices = (name: string, label: string, values: [unknown,unknown][]) => select(name,label,[['','All'],...values],query.get(name) ?? '',`aria-label="${h(label)}"`)
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort().map(v => [v,v] as [unknown,unknown])
  const filters = `<form method="get" class="form" action="/app/reports">${field('from','From date',query.get('from'),'date')}${field('to','Through date',query.get('to'),'date')}${field('time','Class time',query.get('time'),'time')}`
    + choices('instructorId','Instructor',s.people.filter((p: any) => p.role === 'instructor').map((p: any) => [p.id,p.name]))
    + choices('room','Room',unique(s.classes.map(roomOf))) + choices('service','Service',unique(s.classes.map((c: any) => c.service)))
    + choices('location','Location',[[report.location,report.location]]) + '<button class="btn" type="submit">Apply report filters</button><a href="/app/reports">Clear filters</a></form>'
  const metrics = [['Classes',total.classes],['Booked',total.booked],['Waitlisted',total.waitlisted],['Attended',total.attended],['No-show',total.noShow],['Unique visitors',total.uniqueVisitors],['Early cancels',total.earlyCancelled],['Late cancels',total.lateCancelled],['Member cancels',total.memberCancelled],['Staff cancels',total.staffCancelled],['System cancels',total.systemCancelled],['Occupied / usable',`${total.occupiedSeats} / ${total.usableSeats}`],['Occupancy',total.occupancyPercent === null ? 'Unavailable' : `${total.occupancyPercent}%`]]
  const summary = `<div class="stat-row">${metrics.map(([label,value]) => `<div class="stat"><b>${h(value)}</b><small>${h(label)}</small></div>`).join('')}</div>`
  const rows = report.rows.map((r: any) => `<tr data-class-id="${h(r.classId)}">`
    + cell('Session',`<strong>${h(r.title)}</strong><small>${h(r.date)} ${h(r.time)} · ${h(r.status)}</small><small>${h(person(s,r.instructorId))} · ${h(r.room)} · ${h(r.service)} · ${h(r.location)}</small>`)
    + cell('Demand',`${r.booked} booked · ${r.waitlisted} waitlisted<small>${r.attended} attended · ${r.noShow} no-show · ${r.uniqueVisitors} visitors</small>`)
    + cell('Cancellations',`${r.earlyCancelled} early · ${r.lateCancelled} late<small>${r.memberCancelled} member (${r.memberEarlyCancelled} early / ${r.memberLateCancelled} late) · ${r.staffCancelled} staff (${r.staffEarlyCancelled} early / ${r.staffLateCancelled} late) · ${r.systemCancelled} system</small>`)
    + cell('Seats',`${r.occupiedSeats} / ${r.usableSeats} usable · ${r.occupancyPercent === null ? 'Unavailable' : r.occupancyPercent+'%'}<small>${r.configuredSeats} configured · ${r.disabledSpots} out of service</small><small>${r.onlineSeats} online · ${r.heldSeats} desk-held · ${r.offeredSeats} offered</small>${r.status === 'cancelled' ? '<small>Canceled session excluded from seat denominator</small>' : ''}`)
    + cell('Sources',`<a href="${h(r.rosterUrl)}">Roster and bookings</a><small><a href="${h(r.cancellationsUrl)}">Cancellation actions (${r.cancellationIds.length})</a></small>`)+'</tr>').join('')
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Attendance and demand</h1><p>${h(report.timeZone)}</p></div>`
    + panel('Report filters',body(filters+`<p><a class="btn quiet" href="/api/strap/reports/attendance.csv?${h(query.toString())}">Download CSV</a> <a class="btn quiet" href="/api/strap/reports/attendance.xlsx?${h(query.toString())}">Download XLSX</a></p><p class="meta">Current filtered sources. XLSX includes totals and definitions; CSV data cells use JSON values. Scheduled delivery is not available.</p>`),{icon:'report'}) + panel('Selected totals',`<div class="table-wrap">${summary}</div>`,{id:'report-totals'})
    + panel('Class sources',`<div class="table-wrap">${table(['Session','Demand','Cancellations','Seats','Sources'],rows || '<tr><td colspan="5">No sessions match these filters.</td></tr>')}</div>`,{id:'report-sources'})
    + panel('Metric definitions',body(`<p>${h(report.definitions)}</p><p>${h(report.inventory.status)} · ${report.inventory.aggregatorSeats} aggregator seats.</p>`))+'</div></div>'
}
