import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { enrollTotp } from './mfa-helpers.mjs'

const minute = 60_000, hour = 60 * minute, day = 24 * hour
const at = hours => new Date(Math.ceil((Date.now() + hours * hour) / minute) * minute).toISOString()
const monday = start => { const d = new Date(start); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)).toISOString().slice(0, 10) }
const localTime = (value, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const offset = (value, zone) => new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date(value)).find(p => p.type === 'timeZoneName').value
const refused = async (h, name, input, cookie, status, code) => {
  const before = (await h.state()).version
  const r = await h.send('/api/strap/command', { name, input }, cookie)
  assert.equal(r.status, status, `${name}: ${JSON.stringify(r.value)}`); assert.equal(r.value.error, code, name)
  assert.equal((await h.state()).version, before, `${code}: no writes`)
}
const page = async (h, path, cookie) => { const r = await h.send(path, undefined, cookie); assert.equal(r.status, 200, path); return r.text }
const receiptOf = (html, packId) => html.match(new RegExp(`<article class="receipt[^>]*data-pack-id="${packId}".*?</article>`, 's'))[0].replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')
const brooklyn = { line1: '85 Jay Street', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US' }
const santaMonica = { line1: '1 Ocean Avenue', line2: 'Suite 4', city: 'Santa Monica', region: 'CA', postalCode: '90401', country: 'US' }

// Profile edits and the multi-location journey share one native runtime and invited actors.
async function studioProfile(h) {
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  const settings = {location:'Brooklyn studio',timeZone:'America/New_York',legalName:'Willow Movement LLC',
    address:{line1:'85 Jay Street',line2:'Suite 2',city:'Brooklyn',region:'NY',postalCode:'11201-1234',country:'US'},
    receiptDetails:'Questions about an external receipt? Contact the studio desk.',
    businessHours:[{day:6,opens:'08:00',closes:'13:00'},{day:1,opens:'06:00',closes:'21:00'}]}
  const saved = await h.cmd('studio.save',settings)
  assert.deepEqual(saved.businessHours,[settings.businessHours[1],settings.businessHours[0]])
  const member = await h.person('Ana'), coach = await h.person('Maya','instructor')
  const before = await h.state()
  for (const cookie of [member.cookie,coach.cookie]) await h.cmd('studio.save',{...settings,legalName:'Changed without authority'},cookie,403)
  for (const patch of [
    {address:{...settings.address,postalCode:'1120'}},
    {address:{...settings.address,region:'XX'}},
    {address:{...settings.address,country:'CA'}},
    {address:{...settings.address,city:''}},
    {businessHours:[{day:1,opens:'21:00',closes:'06:00'}]},
    {businessHours:[{day:1,opens:'25:00',closes:'26:00'}]},
    {businessHours:[{day:1,opens:'06:00',closes:'21:00'},{day:1,opens:'07:00',closes:'08:00'}]},
    {businessHours:[{day:2,opens:'06:00'}]},
  ]) await h.cmd('studio.save',{...settings,...patch},h.owner,400)
  const after = await h.state()
  assert.deepEqual([after.studio,after.version],[before.studio,before.version],'rejected settings do not change the studio or revision')
  await h.cmd('studio.save',{location:'Downtown Brooklyn',timeZone:'America/New_York'})
  const retained = (await h.state()).studio
  for (const key of ['legalName','address','receiptDetails','businessHours']) assert.deepEqual(retained[key],saved[key],'a location-only edit retains '+key)
  const exit = await h.send('/api/strap/exit.json',undefined,h.owner)
  assert.equal(exit.status,200)
  const record = exit.value.tables.st_records.find(row => row.kind==='studio')
  assert.deepEqual(JSON.parse(record.data),retained,'portable exit retains the exact configuration')
  if (process.env.STRAP_PROOF_DIR || process.env.CI) await (await import('./studio-browser.mjs')).studioBrowser(h)
  await h.cmd('studio.save',{location:retained.location,timeZone:retained.timeZone,legalName:'',address:null,receiptDetails:'',businessHours:[]})
  const cleared = (await h.state()).studio
  assert.deepEqual([cleared.legalName,cleared.address,cleared.receiptDetails,cleared.businessHours],[null,null,null,[]])
  return { member, coach }
}

async function twoLocations(h) {
  const { member: ana, coach } = await studioProfile(h)
  await h.cmd('studio.save', { location: 'Brooklyn', timeZone: 'America/New_York', legalName: 'Larkhill Movement LLC', phone: '(718) 555-0100', address: brooklyn, receiptDetails: 'Questions? Visit the front desk.', businessHours: [{ day: 1, opens: '06:00', closes: '21:00' }] })
  const la = await h.cmd('location.save', { name: 'Los Angeles', timeZone: 'America/Los_Angeles', phone: '1 (310) 555-0111', address: santaMonica, businessHours: [{ day: 1, opens: '07:00', closes: '20:00' }] })
  const second = await h.person('Noor', 'instructor')
  const publish = async (title, start, instructor, locationId, room = 'Studio A') => (await h.cmd('classes.publish', { id: (await h.cmd('classes.prepare', { week: monday(start), classes: [{ title, start, end: new Date(Date.parse(start) + 50 * minute).toISOString(), capacity: 6, room, instructorId: instructor.id, ...(locationId ? { locationId } : {}) }] })).id })).classes[0]
  const sell = async (member, fields) => (await h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: member.id, credits: 10, expiresAt: '2099-12-31T00:00:00Z', ...fields })).id })).id
  return { la, coach, second, publish, sell, ana }
}

test('STUDIO-001/002: a New York studio and a Los Angeles location keep their own addresses, phones and clocks; plans name where they are valid, receipts and screens agree, and a closure touches one location', () => run(async h => {
  const { la, coach, second, publish, sell, ana } = await twoLocations(h)
  let state = await h.state()
  assert.equal(state.studio.phone, '7185550100'); assert.equal(la.phone, '3105550111')
  assert.deepEqual(state.locations.map(l => [l.id, l.name, l.timeZone]), [['studio', 'Brooklyn', 'America/New_York'], [la.id, 'Los Angeles', 'America/Los_Angeles']])
  // Configuration is the owner's alone and refuses invalid values, writing nothing.
  const ben = await h.person('Ben'), cy = await h.person('Cy')
  for (const cookie of [ana.cookie, coach.cookie]) await refused(h, 'location.save', { name: 'Austin', timeZone: 'America/Chicago' }, cookie, 403, 'owner_required')
  await refused(h, 'location.save', { name: ' los  ANGELES ', timeZone: 'America/Los_Angeles' }, h.owner, 409, 'location_name_used')
  await refused(h, 'location.save', { name: 'Austin', timeZone: 'Mars/Olympus' }, h.owner, 400, 'invalid_time_zone')
  await refused(h, 'location.save', { name: 'Austin', timeZone: 'America/Chicago', phone: '555-0100' }, h.owner, 400, 'invalid_phone')
  await refused(h, 'location.save', { name: 'Austin', timeZone: 'America/Chicago', address: { ...santaMonica, region: 'XX' } }, h.owner, 400, 'invalid_address_region')
  const chicago = await h.cmd('location.save', { name: 'Chicago', timeZone: 'America/Chicago' })

  // Plans: Ana is valid at both studios, Ben at Brooklyn only, and a third location is denied.
  const anaPack = await sell(ana, { amountCents: 18900, initiationFeeCents: 2500, eligibleLocations: ['studio', la.id] })
  const benPack = await sell(ben, { amountCents: 9000 })
  const cyPack = await sell(cy, { amountCents: 12000, locationId: la.id, eligibleLocations: [la.id] })
  const nyClass = await publish('Morning Flow', at(30), coach, undefined), laClass = await publish('Evening Flow', at(54), second, la.id), chiClass = await publish('Lake Flow', at(78), coach, chicago.id)
  assert.deepEqual([nyClass.locationId, laClass.locationId, laClass.timeZone, laClass.location], ['studio', la.id, 'America/Los_Angeles', 'Los Angeles'])
  await refused(h, 'classes.prepare', { week: monday(at(30)), classes: [{ title: 'Nowhere', start: at(30), end: at(31), capacity: 3, instructorId: coach.id, locationId: 'nowhere' }] }, h.owner, 404, 'location_not_found')
  await h.cmd('booking.book', { classId: nyClass.id }, ana.cookie)
  await h.cmd('booking.book', { classId: laClass.id }, ana.cookie)
  await refused(h, 'booking.book', { classId: chiClass.id }, ana.cookie, 409, 'plan_location_not_eligible')
  await refused(h, 'booking.book', { classId: laClass.id }, ben.cookie, 409, 'plan_location_not_eligible')
  assert.match(await page(h, '/app', ben.cookie), /Your plan is not valid at this location/)
  // A room name belongs to its location: the same room and hour at two locations is not a conflict; one instructor in two places is.
  await publish('Same Hour', new Date(Date.parse(nyClass.start) + 120 * minute).toISOString(), second, la.id)
  await publish('Same Hour NY', new Date(Date.parse(nyClass.start) + 120 * minute).toISOString(), coach, undefined)
  const overlap = new Date(Date.parse(laClass.start) + 10 * minute).toISOString()
  const double = await h.send('/api/strap/command', { name: 'classes.prepare', input: { week: monday(overlap), classes: [{ title: 'Double booked', start: overlap, end: new Date(Date.parse(laClass.start) + 40 * minute).toISOString(), capacity: 3, instructorId: second.id, locationId: 'studio', room: 'Elsewhere' }] } }, h.owner)
  assert.equal(double.status, 409); assert.match(double.value.error, /Scheduling conflict.*instructor/)

  // Changing where one plan is valid keeps its credits and ledger; nothing is granted or copied.
  const before = (await h.state()).packs.find(p => p.id === benPack), eventsBefore = (await h.state()).packCreditEvents.length
  await refused(h, 'pack.locations.set', { id: benPack, eligibleLocations: [], reason: 'x' }, h.owner, 400, 'invalid_eligibleLocations')
  const change = await h.cmd('pack.locations.set', { id: benPack, eligibleLocations: ['studio', la.id], reason: 'Ben now trains in both studios' })
  state = await h.state()
  assert.deepEqual([state.packs.find(p => p.id === benPack).remaining, state.packs.find(p => p.id === benPack).credits, state.packCreditEvents.length, state.packs.length], [before.remaining, before.credits, eventsBefore, 3])
  assert.deepEqual([change.before, change.after, change.creditsBefore, change.creditsAfter], [['studio'], ['studio', la.id].sort(), 10, 10])
  const benLa = await h.cmd('booking.book', { classId: laClass.id }, ben.cookie)
  assert.equal(benLa.status, 'booked')
  await refused(h, 'pack.locations.set', { id: benPack, eligibleLocations: ['studio'], reason: 'Back to one' }, h.owner, 409, 'future_bookings_at_removed_location')
  await refused(h, 'pack.locations.set', { id: benPack, eligibleLocations: 'all', reason: 'x' }, ben.cookie, 403, 'owner_required')

  // Receipts: the same legal identity, location address, USD cents and local sale time for the member and for staff.
  const anaHtml = await page(h, '/app/packs', ana.cookie), cyHtml = await page(h, '/app/packs', cy.cookie), ownerHtml = await page(h, '/app/packs', h.owner)
  for (const [html, pack, facts] of [[anaHtml, anaPack, ['Larkhill Movement LLC', '85 Jay Street', '$189.00', '$25.00', '$214.00', 'EDT|EST']], [cyHtml, cyPack, ['1 Ocean Avenue', 'Santa Monica, CA 90401', '(310) 555-0111', '$120.00', 'PDT|PST', 'Questions? Visit the front desk.']]]) {
    const own = receiptOf(html, pack), staff = receiptOf(ownerHtml, pack)
    for (const fact of facts) assert.match(own, new RegExp(fact.replace(/[$.()?+]/g, '\\$&')), `${pack}: ${fact}`)
    assert.equal(own.match(/\w{3}, \w{3} \d+, \d{4}.{1,6}[\d:]+\s[AP]M \w+/)[0], staff.match(/\w{3}, \w{3} \d+, \d{4}.{1,6}[\d:]+\s[AP]M \w+/)[0], 'the sale time agrees across views')
  }
  assert.deepEqual((await h.state(ana.cookie)).charges.map(c => c.amountCents).sort((a, b) => a - b), [2500, 18900])

  // Daylight saving: a weekly Los Angeles class keeps its 6:00 pm local start across both transitions, while its UTC instant moves.
  const first = new Date(Date.parse(at(8 * 24))).toISOString().slice(0, 10)
  const draft = await h.cmd('series.prepare', { locationId: la.id, title: 'Sunset Flow', service: 'Flow', startDate: first, endDate: new Date(Date.parse(first) + 60 * 7 * day).toISOString().slice(0, 10), intervalWeeks: 1, time: '18:00', minutes: 50, instructorId: second.id, capacity: 8, room: 'Studio B' })
  assert.equal(draft.classes.length, 61)
  assert.ok(draft.classes.every(c => localTime(c.start, 'America/Los_Angeles') === '18:00' && c.timeZone === 'America/Los_Angeles' && c.location === 'Los Angeles'))
  assert.equal(new Set(draft.classes.map(c => offset(c.start, 'America/Los_Angeles'))).size, 2, 'the series crosses a daylight-saving change')
  assert.equal(new Set(draft.classes.map(c => c.start.slice(11, 16))).size, 2, 'UTC start moves with it')
  await h.cmd('series.publish', { id: draft.id })
  // A member books the last class before the change and the first after it: each reads 6:00 pm on its own Los Angeles date, in both views.
  const published = (await h.state()).classes.filter(c => c.seriesId === draft.seriesId).sort((x, y) => x.start.localeCompare(y.start))
  const turn = published.findIndex((c, i) => i && offset(c.start, 'America/Los_Angeles') !== offset(published[i - 1].start, 'America/Los_Angeles'))
  for (const entry of [published[turn - 1], published[turn]]) {
    await h.cmd('booking.book', { classId: entry.id }, ana.cookie)
    const label = new RegExp(`6:00 pm ${offset(entry.start, 'America/Los_Angeles') === 'GMT-07:00' ? 'PDT' : 'PST'}`)
    for (const cookie of [ana.cookie, h.owner]) assert.ok(label.test(await page(h, `/app?day=${entry.occurrenceDate}`, cookie)), `${entry.occurrenceDate} reads 6:00 pm local for ${cookie === h.owner ? 'staff' : 'the member'}`)
  }
  const classesHtml = [await page(h, '/app/classes', h.owner), await page(h, '/app', ana.cookie)]
  for (const html of classesHtml) assert.match(html, /6:00 pm P[DS]T/, 'staff and member views show the Los Angeles local time')

  // A location closure cancels only that location's classes and its notices name it.
  const closure = await h.cmd('closure.prepare', { scope: 'location', locationId: la.id, start: at(1), end: new Date(Date.parse(laClass.end) + hour).toISOString(), reason: 'Studio flooded' })
  assert.deepEqual(closure.impact.classes.map(c => [c.location, c.locationId]), [['Los Angeles', la.id], ['Los Angeles', la.id]])
  assert.ok(closure.impact.classes.every(c => c.classId !== nyClass.id))
  await h.cmd('closure.confirm', { id: closure.id, impact: closure.impact.key })
  state = await h.state(ana.cookie)
  assert.equal(state.bookings.find(b => b.classId === nyClass.id).status, 'booked')
  assert.equal(state.bookings.find(b => b.classId === laClass.id).status, 'cancelled')
  assert.match(state.notices.find(n => n.classId === laClass.id && n.closureId).body, /Evening Flow at Los Angeles/)
  await refused(h, 'classes.prepare', { week: monday(laClass.start), classes: [{ title: 'Too late', start: laClass.start, end: laClass.end, capacity: 3, instructorId: second.id, locationId: la.id, room: 'Studio C' }] }, h.owner, 409, `Los Angeles closed ${closure.start} to ${closure.end}: Studio flooded`)
  if (process.env.STRAP_PROOF_DIR || process.env.CI) await (await import('./locations-browser.mjs')).locationsBrowser(h, { la, ana, ben, cy })
}))

// The integration door is server to server: a Bearer secret and a schema version; secrets are issued only on the Integrations page.
async function inApp(h, fields) {
  const response = await h.mf.dispatchFetch(h.origin + '/app/action?name=integration.create&returnTo=%2Fapp%2Fintegrations', { method: 'POST', redirect: 'manual', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() })
  const text = await response.text()
  return { status: response.status, text, token: text.match(/<p class="token">(strap_int_[0-9a-f]{64})<\/p>/)?.[1] ?? null }
}
const api = async (h, token, path) => {
  const response = await h.mf.dispatchFetch(h.origin + path, { headers: { host: new URL(h.origin).host, authorization: `Bearer ${token}`, 'strap-schema-version': '1' } })
  return { status: response.status, value: await response.json() }
}

test('STUDIO-002: a manager for one location reads only its reports while the owner consolidates them, and integration keys read only the locations they name', () => run(async h => {
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  await h.cmd('studio.save', { location: 'Brooklyn', timeZone: 'America/New_York' })
  // A key made before locations existed names the one original location.
  const legacy = await inApp(h, { label: 'Legacy display', 'sc_roster:read': 'true', location: 'studio' })
  assert.ok(legacy.token)
  const la = await h.cmd('location.save', { name: 'Los Angeles', timeZone: 'America/Los_Angeles' })
  const coach = await h.person('Maya', 'instructor'), second = await h.person('Noor', 'instructor')
  const ana = await h.person('Ana'), cy = await h.person('Cy'), mara = await h.person('Mara')
  const publish = async (title, start, instructor, locationId) => (await h.cmd('classes.publish', { id: (await h.cmd('classes.prepare', { week: monday(start), classes: [{ title, start, end: new Date(Date.parse(start) + 50 * minute).toISOString(), capacity: 6, instructorId: instructor.id, ...(locationId ? { locationId } : {}) }] })).id })).classes[0]
  const sell = async (member, fields) => h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: member.id, credits: 10, expiresAt: '2099-12-31T00:00:00Z', ...fields })).id })
  await sell(ana, { amountCents: 18900 }); await sell(ana, { amountCents: 10000, locationId: la.id, eligibleLocations: 'all' }); await sell(cy, { amountCents: 12000, locationId: la.id, eligibleLocations: [la.id] })
  await h.cmd('payment.record', { personId: ana.id, amountCents: 5000, reference: 'STUDIO-002-la', locationId: la.id })
  const nyClass = await publish('Morning Flow', at(30), coach), laClass = await publish('Evening Flow', at(54), second, la.id)
  await h.cmd('booking.book', { classId: nyClass.id }, ana.cookie); await h.cmd('booking.book', { classId: laClass.id }, ana.cookie); await h.cmd('booking.book', { classId: laClass.id }, cy.cookie)

  // The owner's consolidated reports equal the sum of their locations; a location filter narrows them.
  const read = async (path, cookie = h.owner) => { const r = await h.send(path, undefined, cookie); assert.equal(r.status, 200, `${path}: ${r.text.slice(0, 200)}`); return r.value }
  const revenue = await read('/api/strap/reports/revenue'), laRevenue = await read('/api/strap/reports/revenue?location=Los+Angeles')
  assert.deepEqual(revenue.locationTotals.map(l => [l.name, l.netSalesCents, l.collectionsCents, l.newPlans]), [['Brooklyn', 18900, 0, 1], ['Los Angeles', 22000, 5000, 2]])
  assert.equal(revenue.totals.netSalesCents, 40900); assert.equal(laRevenue.totals.netSalesCents, 22000); assert.equal(laRevenue.totals.collectionsCents, 5000)
  const attendance = await read('/api/strap/reports/attendance')
  assert.deepEqual(attendance.locationTotals.map(l => [l.name, l.classes, l.booked]), [['Brooklyn', 1, 1], ['Los Angeles', 1, 2]])

  // A manager for Los Angeles: no access before the grant, a second factor first, then only that location's inputs.
  await refused(h, 'manager.grant', { id: mara.id, locationIds: [la.id] }, mara.cookie, 403, 'owner_required')
  await refused(h, 'manager.grant', { id: mara.id, locationIds: ['nowhere'] }, h.owner, 400, 'Choose at least one of the studio’s locations')
  await refused(h, 'manager.grant', { id: coach.id, locationIds: [la.id] }, h.owner, 409, 'Only a member identity can become a manager')
  assert.equal((await h.send('/api/strap/reports/revenue', undefined, mara.cookie)).status, 403, 'a member is refused the report')
  await h.cmd('manager.grant', { id: mara.id, locationIds: [la.id] })
  assert.equal((await h.send('/api/strap/reports/revenue', undefined, mara.cookie)).value.error, 'mfa_enrollment_required')
  await enrollTotp(h, mara.cookie)
  const managed = await read('/api/strap/reports/revenue', mara.cookie)
  assert.ok(managed.sources.length > 0 && managed.sources.every(row => row.locationId === la.id), 'only Los Angeles sources')
  assert.deepEqual([managed.totals.netSalesCents, managed.totals.collectionsCents, managed.locationTotals], [22000, 5000, []])
  const owed = Object.fromEntries(managed.balanceRows.map(row => [row.personId, row.balanceCents]))
  assert.deepEqual(owed, { [ana.id]: 5000, [cy.id]: 12000 }, 'a manager sees the member balance made at their location only, never the whole studio balance')
  assert.equal((await read('/api/strap/reports/revenue?location=Brooklyn', mara.cookie)).sources.length, 0, 'another location is empty, never leaked')
  const managedAttendance = await read('/api/strap/reports/attendance', mara.cookie)
  assert.deepEqual(managedAttendance.rows.map(row => [row.locationId, row.classId]), [[la.id, laClass.id]])
  assert.equal((await read('/api/strap/reports/attendance?location=Brooklyn', mara.cookie)).rows.length, 0)
  const managerPage = await page(h, '/app/revenue', mara.cookie)
  assert.ok(/Los Angeles/.test(managerPage) && !/Brooklyn/.test(managerPage), 'the manager’s screen names their location only')
  for (const path of ['/api/strap/state', '/app/people', '/app/packs', '/api/strap/staff-history']) { const r = await h.send(path, undefined, mara.cookie); assert.equal(r.status, 403, path) }
  await refused(h, 'booking.cancel', { id: 'x' }, mara.cookie, 403, 'manager_reports_only')
  if (process.env.STRAP_PROOF_DIR || process.env.CI) await (await import('./locations-browser.mjs')).managerBrowser(h, mara.cookie, { name: 'Los Angeles', other: 'Brooklyn' })
  await h.cmd('manager.revoke', { id: mara.id })
  assert.equal((await h.send('/api/strap/reports/revenue', undefined, mara.cookie)).status, 403, 'revoking returns the person to a member')

  // Integration keys read only the locations they name; a refused location is named in the refusal, never silently widened.
  const both = await inApp(h, { label: 'Both studios', 'sc_roster:read': 'true', 'lc_studio': 'true', [`lc_${la.id}`]: 'true' }), only = await inApp(h, { label: 'LA display', 'sc_attendance:read': 'true', [`lc_${la.id}`]: 'true' })
  assert.ok(both.token && only.token)
  assert.ok((await inApp(h, { label: 'Nowhere', 'sc_roster:read': 'true', 'lc_nowhere': 'true' })).text.includes('unknown location'))
  const titles = value => value.data.map(c => c.title)
  assert.deepEqual(titles((await api(h, legacy.token, '/api/strap/integration/roster')).value), ['Morning Flow'], 'a key made before locations existed reads only the original location')
  assert.deepEqual(titles((await api(h, both.token, '/api/strap/integration/roster')).value), ['Morning Flow', 'Evening Flow'])
  const attendanceKey = await api(h, only.token, '/api/strap/integration/attendance')
  assert.deepEqual([titles(attendanceKey.value), attendanceKey.value.locations], [['Evening Flow'], [{ id: la.id, name: 'Los Angeles' }]])
  const asked = await api(h, only.token, '/api/strap/integration/attendance?location=studio')
  assert.deepEqual([asked.status, asked.value.error, asked.value.locations], [403, 'location_not_granted', [la.id]])
  assert.deepEqual((await api(h, only.token, '/api/strap/integration/key')).value.locations, [la.id])
  assert.equal((await api(h, legacy.token, `/api/strap/integration/roster?location=${la.id}`)).status, 403)
  assert.deepEqual((await h.state()).integrations.map(k => [k.label, k.locations]).sort(), [['Both studios', ['studio', la.id].sort()], ['LA display', [la.id]], ['Legacy display', ['studio']]])
}))
