import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { run } from './harness.mjs'
const minute=60_000,hour=60*minute
const at=hours=>new Date(Math.ceil((Date.now()+hours*hour)/minute)*minute).toISOString()
const monday=start=>{const d=new Date(start);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)}
const form=(h,name,back,fields,cookie=h.owner)=>h.mf.dispatchFetch(h.origin+`/app/action?name=${name}&returnTo=${encodeURIComponent(back)}`,{method:'POST',headers:{origin:h.origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),redirect:'manual'})
async function refused(h,name,input,cookie,status,error,path='/api/strap/command') {
  const before=(await h.state()).version,r=await h.send(path,{name,input},cookie,cookie?{}:{authorization:`Bearer ${h.agentToken}`})
  assert.equal(r.status,status,`${name}: ${JSON.stringify(r.value)}`);if(error)assert.equal(r.value.error,error)
  assert.equal((await h.state()).version,before,`${name}: a refused edit writes nothing`)
}
const secrets=['Luis Lopez','6155550199','6155550177','6155550101']

test('APP-003: members edit their own name, phone and emergency contact; the owner member-record door edits them for the member; each change is audited once with actor, channel and before/after; refused edits change nothing and no other member, instructor or agent sees them', async () => {
  await run(async h => {
    await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
    await h.cmd('studio.save',{location:'Nashville',timeZone:'America/Chicago'})
    const coach=await h.person('Maya','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben')
    h.agentToken=(await h.cmd('agent.create',{label:'Profile agent'})).token
    await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:ana.id,credits:3,amountCents:6000,expiresAt:'2099-12-31T00:00:00Z'})).id})
    const start=at(30),entry=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title:'Profile Flow',start,end:new Date(Date.parse(start)+50*minute).toISOString(),capacity:4,instructorId:coach.id}]})).id})).classes[0]

    // The member door: name, mobile and an emergency contact, once per request identity.
    const own={name:'Ana Lopez',phone:'(615) 555-0101',emergencyName:'Luis Lopez',emergencyPhone:'615.555.0199',emergencyRelationship:'Brother',revision:0,requestId:randomUUID()}
    const saved=await h.cmd('profile.save',own,ana.cookie)
    const expected={personId:ana.id,name:'Ana Lopez',email:ana.email,phone:'6155550101',emergencyContact:{name:'Luis Lopez',phone:'6155550199',relationship:'Brother'},revision:1}
    assert.deepEqual(saved,expected)
    assert.deepEqual(await h.cmd('profile.save',own,ana.cookie),expected,'a replayed request returns the same profile')
    await refused(h,'profile.save',{...own,phone:'615 555 0102'},ana.cookie,409,'profile_request_changed')
    let owner=await h.state(),mine=await h.state(ana.cookie)
    const ownerRow=owner.people.find(p=>p.id===ana.id),memberRow=mine.people.find(p=>p.id===ana.id)
    for(const row of [ownerRow,memberRow]) assert.deepEqual([row.name,row.email,row.phone,row.emergencyContact,row.profileRevision],[expected.name,ana.email,expected.phone,expected.emergencyContact,1],'the owner sees the same profile the member saved')
    assert.equal(owner.profileChanges.length,1);assert.deepEqual(mine.profileChanges,owner.profileChanges)
    const change=owner.profileChanges[0]
    assert.deepEqual([change.actorId,change.actorRole,change.channel,change.staffMade,change.right,change.changed],[mine.actor.id,'member','self',false,null,['name','phone','emergencyContact']])
    assert.deepEqual(change.before,{name:'Ana',email:ana.email,phone:null,emergencyContact:null});assert.deepEqual(change.after,{name:'Ana Lopez',email:ana.email,phone:'6155550101',emergencyContact:expected.emergencyContact})
    assert.equal(owner.staffActions.length,0,'a member’s own edit is not a staff-made action')

    // Refused edits change nothing: the email is an owner-only identity change.
    const next={revision:1,requestId:randomUUID()}
    await refused(h,'profile.save',{...next,email:'ana.new@studio.example'},ana.cookie,403,'sign_in_email_is_owner_managed')
    await refused(h,'profile.save',{...next,personId:ben.id,name:'Not Ben'},ana.cookie,403,'own_profile_required')
    await refused(h,'profile.save',{...next,revision:0,name:'Stale'},ana.cookie,409,'profile_changed')
    await refused(h,'profile.save',{...next,phone:'555-0101'},ana.cookie,400,'invalid_phone')
    await refused(h,'profile.save',{...next,emergencyPhone:''},ana.cookie,400,'emergency_contact_needs_name_and_phone')
    await refused(h,'profile.save',{...next,emergencyPhone:'12'},ana.cookie,400,'invalid_emergencyPhone')
    await refused(h,'profile.save',{...next,name:'Ana Lopez'},ana.cookie,409,'profile_unchanged')
    for(const [cookie,error] of [[h.owner,'member_required'],[coach.cookie,'member_required']]) await refused(h,'profile.save',{...next,name:'Someone else'},cookie,403,error)
    const staffInput={personId:ana.id,emergencyPhone:'(615) 555-0177',channel:'phone',revision:1,requestId:randomUUID()}
    for(const cookie of [ana.cookie,ben.cookie,coach.cookie]) await refused(h,'profile.save.staff',staffInput,cookie,403)
    for(const name of ['profile.save.staff','profile.save']) await refused(h,name,staffInput,'',403,undefined,'/api/strap/agent/command')
    await refused(h,'profile.save.staff',{...staffInput,email:'ana.new@studio.example'},h.owner,400,'sign_in_email_is_changed_in_access_settings')
    await refused(h,'profile.save.staff',{...staffInput,personId:coach.id},h.owner,400,'member_required')

    // The owner's member-record door: one canonical staff-made entry; the member sees the result.
    const staff=await h.cmd('profile.save.staff',staffInput)
    assert.deepEqual(staff.emergencyContact,{name:'Luis Lopez',phone:'6155550177',relationship:'Brother'});assert.equal(staff.revision,2)
    owner=await h.state();mine=await h.state(ana.cookie)
    assert.equal(owner.staffActions.length,1)
    const event=owner.staffActions[0]
    assert.deepEqual([event.command,event.right,event.channel,event.actorId,event.actorRole,event.personId,event.staffMade,event.changed],['profile.save.staff','member-record','phone',owner.actor.id,'owner',ana.id,true,['emergencyContact']])
    assert.equal(event.before.emergencyContact.phone,'6155550199');assert.equal(event.after.emergencyContact.phone,'6155550177')
    assert.deepEqual(mine.people.find(p=>p.id===ana.id).emergencyContact,staff.emergencyContact)
    assert.equal(mine.profileChanges.length,2);assert.equal(mine.profileChanges[0].staffMade,true)
    assert.deepEqual(await h.cmd('profile.save.staff',staffInput),staff,'a staff replay returns the recorded profile')
    assert.equal((await h.state()).staffActions.length,1,'a staff replay writes no second entry')
    await refused(h,'profile.save.staff',{...staffInput,emergencyRelationship:'Partner'},h.owner,409,'staff_request_changed')
    // The browser staff form posts the same door; the person card and the member's page show it.
    assert.equal((await form(h,'profile.save.staff',`/app/people?person=${ana.id}`,{personId:ana.id,requestId:randomUUID(),revision:'2',channel:'desk',name:'Ana M. Lopez',phone:'(615) 555-0101',emergencyName:'Luis Lopez',emergencyPhone:'(615) 555-0177',emergencyRelationship:'Brother'})).status,303)
    owner=await h.state()
    assert.equal(owner.people.find(p=>p.id===ana.id).name,'Ana M. Lopez');assert.deepEqual(owner.staffActions[0].changed,['name']);assert.equal(owner.staffActions[0].channel,'desk')
    const card=(await h.send(`/app/people?person=${ana.id}`,undefined,h.owner)).text
    assert.match(card,/Emergency contact: Luis Lopez \(Brother\) · \(615\) 555-0177/);assert.match(card,/Save profile for member/);assert.match(card,/Staff \(Jordan Studio\) · front desk · changed name/)
    const page=(await h.send('/app/profile',undefined,ana.cookie)).text
    assert.match(page,/Ana M\. Lopez/);assert.match(page,new RegExp(`Sign-in email: <strong>${ana.email}</strong>`));assert.match(page,/Studio staff · phone · changed emergency contact/);assert.match(page,/You · member account · changed name, mobile phone, emergency contact/)
    assert.equal((await h.send('/app/profile',undefined,h.owner)).status,403)
    // The owner's identity door records a name or email change too; instructors are not member profiles.
    await h.cmd('person.save',{id:ben.id,name:'Ben Ortiz',email:ben.email,role:'member',active:true})
    const cy=await h.cmd('person.save',{name:'Cy',email:'cy@studio.example',role:'member',active:false})
    await h.cmd('person.save',{id:cy.id,name:'Cy',email:'cy.park@studio.example',role:'member',active:false})
    owner=await h.state()
    assert.deepEqual(owner.profileChanges.filter(c=>c.command==='person.save').map(c=>[c.personId,c.changed,c.channel,c.staffMade,c.right]),[[cy.id,['email'],'desk',true,'member-record'],[ben.id,['name'],'desk',true,'member-record']])

    // Book and cancel through the member door; the owner reads the same booking state.
    const booked=await h.cmd('booking.book',{classId:entry.id},ana.cookie)
    assert.equal((await h.state()).bookings.find(b=>b.id===booked.id).status,'booked')
    await h.cmd('booking.cancel',{id:booked.id,terms:(await h.state(ana.cookie)).bookings.find(b=>b.id===booked.id).cancelEffect.key},ana.cookie)
    assert.deepEqual([(await h.state()).bookings.find(b=>b.id===booked.id).status,(await h.state(ana.cookie)).bookings.find(b=>b.id===booked.id).status],['cancelled','cancelled'])

    // Another member and an instructor see none of it, in state or pages.
    const others=[await h.state(ben.cookie),await h.state(coach.cookie)]
    for(const view of others) {
      const text=JSON.stringify(view)
      for(const value of secrets) assert.ok(!text.includes(value),`${view.actor.role} cannot read ${value}`)
      assert.ok(!view.profileChanges.some(c=>c.personId===ana.id));assert.ok(!view.bookings.some(b=>b.personId===ana.id&&view.actor.role==='member'))
    }
    assert.ok(!others[0].people.some(p=>p.id===ana.id),'another member has no row for this member')
    const benPage=(await h.send('/app/profile',undefined,ben.cookie)).text
    assert.match(benPage,/Ben Ortiz/);for(const value of ['Luis Lopez','Ana M. Lopez']) assert.ok(!benPage.includes(value))
    assert.equal((await h.send(`/app/people?person=${ana.id}`,undefined,ben.cookie)).status,403)

    // MOVE-011: the profile and every change join the portable exit with stable person links.
    const exit=(await h.send('/api/strap/exit.json',undefined,h.owner)).value,ids=new Set(exit.tables.st_people.map(p=>p.id))
    const profiles=exit.tables.st_records.filter(r=>['memberProfile','profileChange'].includes(r.kind)).map(r=>({kind:r.kind,...JSON.parse(r.data)}))
    assert.deepEqual([exit.manifest.recordKinds.memberProfile,exit.manifest.recordKinds.profileChange],[3,5])
    assert.ok(profiles.every(r=>ids.has(r.personId)))
    assert.deepEqual(profiles.find(r=>r.kind==='memberProfile'&&r.personId===ana.id).emergencyContact,staff.emergencyContact)
    if(process.env.STRAP_PROOF_DIR) await (await import('./profiles-browser.mjs')).profilesBrowser(h,{ana,ben,entry})
  })
})
