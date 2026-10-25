import { body, emptyLine, form, h, hidden, owner, panel, rows, select } from './shared'

const checkbox = (prefix: string, record: any) => `<label><input type="checkbox" name="${prefix}_${h(record.id)}" value="true"> ${h(record.name)}</label>`
const scopeNames = (records: any[], ids: string[]) => ids.map(id => {
  const record = records.find(entry => entry.id === id)
  return h(record ? record.name : id)
}).join(', ')

/** A booking grant is additional to, and limited by, member-record access. */
export function attendanceBookingAccess(s: any, back = '/app/people') {
  if (!owner(s)) return ''
  const people = rows(s,'people')
  const members = people.filter(person => person.active && person.role === 'member')
  const locations = rows(s,'locations')
  const recordGrants = rows(s,'memberRecordGrants').filter(grant => grant.enabled)
  const staff = members.filter(person => recordGrants.some(grant => grant.personId === person.id))
  const grants = rows(s,'attendanceBookingGrants').map(grant => {
    const person = people.find(entry => entry.id === grant.personId)
    return `<p><strong>${h(person ? person.name : grant.personId)}</strong> · ${grant.enabled ? 'Granted' : 'Revoked'}<br>`
      + `<small>Members: ${grant.memberIds.length ? scopeNames(people,grant.memberIds) : 'None'}. Locations: ${grant.locationIds.length ? scopeNames(locations,grant.locationIds) : 'None'}.</small></p>`
  }).join('')
  const editor = staff.length ? form('attendance.booking.grant',back,
    hidden('requestId',crypto.randomUUID())
    + select('personId','Staff sign-in identity',[['','Choose a staff identity'],...staff.map(person => [person.id,person.name] as [unknown,unknown])])
    + select('enabled','Attendance booking right',[['true','Grant'],['false','Revoke']])
    + '<fieldset><legend>Permitted members</legend>' + members.map(member => checkbox('member',member)).join('') + '</fieldset>'
    + '<fieldset><legend>Permitted locations</legend>' + locations.map(location => checkbox('loc',location)).join('') + '</fieldset>',
    'Save attendance booking access','quiet') : emptyLine('Grant an active staff identity member-record access before granting attendance booking access.')
  return panel('Attendance booking staff access',body('<p>Attendance booking requires a separate, explicit right and is refused by default. Staff must also have enabled member-record access. The selected members and locations limit this booking right. This grant gives no financial access.</p>'
    + (grants || emptyLine('No attendance booking grants recorded.')) + editor),{id:'attendance-booking-access'})
}
