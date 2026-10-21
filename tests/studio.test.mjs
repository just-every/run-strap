import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

// STUDIO-001: configuration through native owner commands; full multi-location receipt acceptance remains open.
test('STUDIO-001: studio identity, US address, receipt details and local hours survive edits and refuse invalid or unauthorized saves', () => run(async h => {
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
}))
