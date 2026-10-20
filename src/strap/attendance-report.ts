import { insist, type RecordData } from './domain/types'
import { roomOf, resourceLabel } from './domain/scheduling'

type Row = RecordData
const key = (value: unknown) => resourceLabel(String(value ?? '')).toLowerCase()
const isMember = (a: Row) => !a.staffMade && ['member','instructor'].includes(a.actorRole)
const counts = (bookings: Row[], actions: Row[]) => ({
  booked: bookings.filter(b => b.status === 'booked').length,
  waitlisted: bookings.filter(b => ['waitlisted','offered'].includes(b.status)).length,
  attended: bookings.filter(b => b.attendance === 'attended').length,
  noShow: bookings.filter(b => b.attendance === 'no_show').length,
  earlyCancelled: actions.filter(a => a.type === 'early').length,
  lateCancelled: actions.filter(a => a.type === 'late').length,
  memberCancelled: actions.filter(isMember).length,
  staffCancelled: actions.filter(a => a.staffMade).length,
  memberEarlyCancelled: actions.filter(a => isMember(a) && a.type === 'early').length,
  memberLateCancelled: actions.filter(a => isMember(a) && a.type === 'late').length,
  staffEarlyCancelled: actions.filter(a => a.staffMade && a.type === 'early').length,
  staffLateCancelled: actions.filter(a => a.staffMade && a.type === 'late').length,
  systemCancelled: actions.filter(a => !a.staffMade && !isMember(a)).length,
})

/** RPT-002: a live projection; source records remain authoritative. */
export function attendanceReport(s: any, query: URLSearchParams) {
  const zone = s.studio?.timeZone ?? 'UTC', location = s.studio?.location ?? 'Studio'
  const day = (at: string) => new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(new Date(at))
  const time = (at: string) => new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at))
  for (const name of ['from','to']) {
    const value = query.get(name)
    insist(!value || (/^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value),'invalid_report_date')
  }
  insist(!query.get('from') || !query.get('to') || query.get('from')! <= query.get('to')!,'invalid_report_range')
  insist(!query.get('time') || /^([01]\d|2[0-3]):[0-5]\d$/.test(query.get('time')!),'invalid_report_time')
  const classes = s.classes.filter((c: Row) => (!query.get('from') || day(c.start) >= query.get('from')!) && (!query.get('to') || day(c.start) <= query.get('to')!)
    && (!query.get('time') || time(c.start) === query.get('time')) && (!query.get('instructorId') || c.instructorId === query.get('instructorId'))
    && (!query.get('room') || key(roomOf(c)) === key(query.get('room'))) && (!query.get('service') || key(c.service) === key(query.get('service')))
    && (!query.get('location') || key(location) === key(query.get('location')))).sort((a: Row,b: Row) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
  const selected = new Set(classes.map((c: Row) => c.id)), bookings = s.bookings.filter((b: Row) => selected.has(b.classId))
  const actions = s.bookingActions.filter((a: Row) => a.action === 'cancel' && selected.has(a.classId))
  const rows = classes.map((c: Row) => {
    const sourceBookings = bookings.filter((b: Row) => b.classId === c.id), cancellations = actions.filter((a: Row) => a.classId === c.id)
    const usableSeats = c.status === 'cancelled' ? 0 : c.occupancy.total
    const occupiedSeats = c.status === 'cancelled' ? 0 : c.occupancy.booked
    return {classId:c.id,title:c.title,start:c.start,date:day(c.start),time:time(c.start),instructorId:c.instructorId,room:roomOf(c),service:c.service,location,status:c.status,
      ...counts(sourceBookings,cancellations),uniqueVisitors:new Set(sourceBookings.filter((b: Row) => b.attendance === 'attended').map((b: Row) => b.personId)).size,
      configuredSeats:c.capacity,disabledSpots:(c.spots ?? []).filter((p: Row) => p.state === 'disabled').length,usableSeats,occupiedSeats,
      onlineSeats:c.status === 'cancelled' ? 0 : c.occupancy.online,heldSeats:c.status === 'cancelled' ? 0 : c.occupancy.held,offeredSeats:c.status === 'cancelled' ? 0 : c.occupancy.offered,
      occupancyPercent:usableSeats ? Math.round(occupiedSeats / usableSeats * 10000) / 100 : null,
      bookingIds:sourceBookings.map((b: Row) => b.id),cancellationIds:cancellations.map((a: Row) => a.id),
      rosterUrl:`/app?day=${day(c.start)}&class=${encodeURIComponent(c.id)}#roster`,cancellationsUrl:`/app/people?classId=${encodeURIComponent(c.id)}#cancellations`}
  })
  const usableSeats = rows.reduce((n: number,r: Row) => n+r.usableSeats,0), occupiedSeats = rows.reduce((n: number,r: Row) => n+r.occupiedSeats,0)
  return {timeZone:zone,location,rows,totals:{...counts(bookings,actions),classes:rows.length,cancelledClasses:classes.filter((c: Row) => c.status === 'cancelled').length,
    uniqueVisitors:new Set(bookings.filter((b: Row) => b.attendance === 'attended').map((b: Row) => b.personId)).size,usableSeats,occupiedSeats,
    occupancyPercent:usableSeats ? Math.round(occupiedSeats / usableSeats * 10000) / 100 : null},
    inventory:{aggregatorSeats:0,status:'No aggregator inventory connected'},
    definitions:'Dates and class time use the studio time zone, with inclusive date bounds. Booked is current confirmed bookings, including attended and no-shows; waitlisted includes held claim offers. Attendance reflects corrections; unique visitors counts distinct attended people across selected classes. Cancellations count retained action identities once, even after restoration; member, staff and system counts include all cancellation types. Early and late counts use the recorded type. Occupancy is current occupied seats (including offers) divided by current usable seats, rounded to two decimal percent; canceled classes contribute zero seats. Usable seats are the smaller of configured capacity and currently enabled room spots. Online and desk-held pools share this limit. No seats means occupancy is unavailable.'}
}
