// STUDIO-002: the studio's locations. The first is the one Studio settings edits; each added location has its
// own name, address, US phone, time zone and weekly hours, and every class there is entered and shown on its clock.
import { usZones, zoneName } from '../zone'
import { phoneText } from './profile'
import { body, cell, emptyLine, field, form, h, hidden, panel, person, rows, select, table } from './shared'
import { packName } from './facts'

const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hoursText = (hours: any[]) => hours?.length ? hours.map(row => `${dayNames[row.day - 1]} ${row.opens}–${row.closes}`).join(', ') : 'No hours set'
export const addressText = (a: any) => a ? [a.line1, a.line2, `${a.city}, ${a.region} ${a.postalCode}`].filter(Boolean).join(', ') : 'No address'

function fields(l: any = {}) {
  const address = l.address ?? {}, hours = l.businessHours ?? []
  return field('name', 'Location name', l.name ?? '', 'text', 'required maxlength="80" autocomplete="off" placeholder="Santa Monica"')
    + select('timeZone', 'Time zone', [['', 'Choose the location’s time zone'], ...usZones], l.timeZone ?? '')
    + field('phone', 'Phone (US number)', phoneText(l.phone), 'tel', 'autocomplete="tel" maxlength="20" placeholder="(310) 555-0100"', 'A 10-digit US number; a leading +1 is assumed')
    + hidden('profile', 'true')
    + '<fieldset><legend>US address</legend>'
    + field('line1', 'Street address', address.line1 ?? '', 'text', 'maxlength="160"') + field('line2', 'Suite or unit', address.line2 ?? '', 'text', 'maxlength="160"')
    + `<div class="row2">${field('city', 'City', address.city ?? '', 'text', 'maxlength="100"')}${field('region', 'State or territory code', address.region ?? '', 'text', 'maxlength="2"')}</div>`
    + field('postalCode', 'ZIP code', address.postalCode ?? '', 'text', 'pattern="[0-9]{5}(-[0-9]{4})?" maxlength="10"') + '</fieldset>'
    + '<fieldset><legend>Weekly hours (location clock)</legend>' + ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((label, i) => {
      const day = i + 1, row = hours.find((item: any) => item.day === day)
      return `<div class="row2">${field(`opens_${day}`, `${label} opens`, row?.opens ?? '', 'time')}${field(`closes_${day}`, `${label} closes`, row?.closes ?? '', 'time')}</div>`
    }).join('') + '</fieldset>'
}

export function locationsPanel(s: any) {
  const places = rows(s, 'locations')
  const lines = places.map((l: any) => `<tr data-location-id="${h(l.id)}">${cell('Location', `<strong>${h(l.name)}</strong>${l.original ? '<small>Edited in Studio settings above</small>' : ''}`)}${cell('Address', h(addressText(l.address)))}${cell('Phone', h(l.phone ? phoneText(l.phone) : 'None'))}${cell('Time zone', h(zoneName(l.timeZone)))}${cell('Hours', h(hoursText(l.businessHours)))}${cell('', l.original ? '' : `<details class="more"><summary>Edit ${h(l.name)}</summary><div class="panel-body">${form('location.save', '/app/studio', hidden('id', l.id) + fields(l), 'Save location')}</div></details>`)}</tr>`).join('')
  return panel('Locations', body(`<p>One business can run several studios. Each location keeps its own address, phone, time zone, rooms, schedule and reports; the first one is your studio above. Classes, closures and reports name the location they belong to, and plans say which locations they are valid at.</p>`
    + (lines ? `<div class="table-wrap">${table(['Location', 'Address', 'Phone', 'Time zone', 'Hours', ''], lines)}</div>` : emptyLine('Save your studio settings first; its location is the first one.'))
    + (s.studio ? `<details class="more" id="add-location"><summary>Add a location</summary><div class="panel-body">${form('location.save', '/app/studio', fields(), 'Add location')}</div></details>` : '')), { icon: 'pin', id: 'locations' })
}

/** Where a plan is valid, in words. */
export const packPlacesText = (s: any, p: any) => {
  const places = p.eligibleLocations ?? ['studio']
  return places === 'all' ? 'Valid at every location' : `Valid at ${places.map((id: string) => rows(s, 'locations').find(l => l.id === id)?.name ?? id).join(', ')}`
}
/** The pack form's location choices: where it is sold and where it is valid. One location needs no choice. */
export function packPlacesFields(s: any) {
  const places = rows(s, 'locations')
  if (places.length < 2) return ''
  return select('locationId', 'Sold at', places.map((l: any) => [l.id, l.name] as [string, string]), 'studio')
    + `<fieldset class="days"><legend>Valid at (none ticked = the location it is sold at)</legend><label class="check"><input type="checkbox" name="allLocations" value="true"> Every location</label>${places.map((l: any) => `<label class="check"><input type="checkbox" name="lc_${h(l.id)}" value="true"> ${h(l.name)}</label>`).join('')}</fieldset>`
}
/** The owner's door to change where an existing plan is valid; its credits, term and ledger stay as they are. */
export function packPlacesForm(s: any, p: any) {
  const places = rows(s, 'locations'), now = p.eligibleLocations ?? ['studio']
  if (places.length < 2) return ''
  return `<details class="more"><summary>Change where it is valid</summary><div class="panel-body">${form('pack.locations.set', '/app/packs', hidden('id', p.id) + `<fieldset class="days"><legend>Valid at</legend><label class="check"><input type="checkbox" name="allLocations" value="true"${now === 'all' ? ' checked' : ''}> Every location</label>${places.map((l: any) => `<label class="check"><input type="checkbox" name="lc_${h(l.id)}" value="true"${now !== 'all' && now.includes(l.id) ? ' checked' : ''}> ${h(l.name)}</label>`).join('')}</fieldset>` + field('reason', 'Reason', '', 'text', 'required maxlength="300"'), 'Save locations')}<p class="meta">The same plan keeps its credits, term and history: nothing is granted or copied.</p></div></details>`
}

/** The owner's list of live plans with where each is valid and the door to change it. */
export function packPlacesPanel(s: any, packs: any[]) {
  if (rows(s, 'locations').length < 2) return ''
  const live = packs.filter(p => Date.parse(p.expiresAt) > Date.now())
  const lines = live.map(p => `<tr data-pack-id="${h(p.id)}">${cell('Plan', `<strong>${h(packName(p))}</strong><small>${h(person(s, p.personId))}</small>`)}${cell('Valid at', h(packPlacesText(s, p)))}${cell('', packPlacesForm(s, p))}</tr>`).join('')
  return panel('Where plans are valid', lines ? `<div class="table-wrap">${table(['Plan', 'Valid at', ''], lines)}</div>` : emptyLine('No live plans.'), { icon: 'pin', id: 'plan-locations' })
}
