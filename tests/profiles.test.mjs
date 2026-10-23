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

test('MEM-001: scoped member-record staff create phoned-in profiles, invite once and edit contacts with canonical provenance; MFA, denied scope and revocation close every door without writes',()=>run(async h=>{
  await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Austin',timeZone:'America/Chicago'})
  const desk=await h.person('RecordDesk'),member=await h.person('RecordMember'),other=await h.person('RecordOther')
  const refused=async(name,input,cookie,status=403)=>{const v=(await h.state()).version;await h.cmd(name,input,cookie,status);assert.equal((await h.state()).version,v)}
  const create={name:'Phoned Member',email:'phoned-member@studio.example',phone:'5125550101',channel:'phone',requestId:'synthetic-strap-desk-create'}
  await refused('member.record.create',create,desk.cookie)
  await h.cmd('member.record.grant',{personId:desk.id,enabled:true,canCreate:true,memberIds:[member.id]})
  assert.equal((await h.send('/api/strap/state',undefined,desk.cookie)).status,401,'grant changes retire existing native sessions')
  desk.cookie=await h.signIn(desk.email)
  await refused('member.record.create',create,desk.cookie)
  assert.equal((await h.send('/api/strap/command',{name:'member.record.create',input:create},desk.cookie)).value.error,'mfa_enrollment_required')
  await h.enroll(desk.cookie)
  for(const path of ['/auth/invite','/auth/operator/status','/auth/operator/role']) {
    const v=(await h.state()).version
    assert.equal((await h.send(path,{email:'unscoped@studio.example',role:'member',operatorId:member.id,status:'inactive'},desk.cookie)).status,403)
    assert.equal((await h.state()).version,v)
  }
  const made=await h.cmd('member.record.create',create,desk.cookie)
  assert.deepEqual(await h.cmd('member.record.create',create,desk.cookie),made)
  assert.equal((await h.state()).staffActions.filter(a=>a.requestId===create.requestId).length,1)
  const input={personId:made.id,phone:'5125550102',emergencyName:'Emergency Person',emergencyPhone:'5125550103',channel:'phone',requestId:'synthetic-strap-desk-edit'}
  await h.cmd('profile.save.staff',input,desk.cookie)
  const actions=(await h.state()).staffActions.filter(a=>a.personId===made.id)
  assert.deepEqual(actions.map(a=>a.command).sort(),['member.record.create','profile.save.staff'])
  const edited=actions.find(a=>a.command==='profile.save.staff');assert.equal(edited.actorRole,'front-desk');assert.equal(edited.channel,'phone');assert.equal(edited.before.phone,'5125550101');assert.equal(edited.after.phone,'5125550102')
  await refused('profile.save.staff',{...input,personId:other.id},desk.cookie)
  assert.equal((await h.send('/api/strap/member-history?personId='+other.id,undefined,desk.cookie)).status,403)
  const history=(await h.send('/api/strap/member-history?personId='+made.id,undefined,desk.cookie)).value
  assert.equal(history.profile.phone,'5125550102');assert.ok(history.timeline.some(e=>e.record.command==='member.record.create'))
  const invite={personId:made.id,channel:'phone',requestId:'synthetic-strap-desk-invite'}
  const invitation=await h.cmd('member.record.invite',invite,desk.cookie)
  assert.equal(invitation.status,'submitted')
  const beforeMail=Number((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n)
  assert.deepEqual(await h.cmd('member.record.invite',invite,desk.cookie),invitation)
  assert.equal(Number((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n),beforeMail)
  assert.equal((await h.state()).staffActions.filter(a=>a.command==='member.record.invite'&&a.personId===made.id).length,1)
  assert.equal((await h.send('/api/strap/command',{name:'member.note.add',input:{personId:made.id,text:'Forbidden',alert:true}},desk.cookie)).status,403)
  if(process.env.STRAP_PROOF_DIR||process.env.CI)await(await import('./member-records-browser.mjs')).memberRecordsBrowser(h,{desk,member:made})
  await h.cmd('member.record.grant',{personId:desk.id,enabled:false,canCreate:false,memberIds:[]})
  await refused('profile.save.staff',{...input,requestId:'synthetic-strap-after-revoke'},desk.cookie,401)
  desk.cookie=await h.signIn(desk.email)
  await refused('profile.save.staff',{...input,requestId:'synthetic-strap-after-signin'},desk.cookie)
  await refused('member.record.invite',invite,desk.cookie)
  assert.equal((await h.send('/api/strap/member-history?personId='+made.id,undefined,desk.cookie)).status,403)
}))

test('MEM-001: migrated, booked, attended, paid and waived source histories remain linked after exact owner-reviewed duplicate merge; restricted alert notes never enter member, instructor or kiosk views',()=>run(async h=>{
  await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Austin',timeZone:'America/Chicago'})
  const csv='MemberId,FirstName,LastName,Email\nsynthetic-strap-1,Migrated,Member,migrated-history@studio.example\n'
  const preview=await h.cmd('import.preview',{csv});let job=(await h.cmd('import.apply',{csv,fingerprint:preview.fingerprint})).job
  while(job.state==='applying')job=(await h.cmd('import.resume',{jobId:job.id})).job
  const imported=(await h.state()).people.find(p=>p.email==='migrated-history@studio.example')
  await h.cmd('person.save',{...imported,active:true});await h.cmd('person.invite',{id:imported.id})
  const member={...imported,cookie:await h.signIn(imported.email)},target=await h.person('CanonicalMember'),coach=await h.person('HistoryCoach','instructor')
  const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z'})).id})
  const waiver=await h.cmd('waiver.publish',{text:'Studio waiver for source history'})
  await h.cmd('waiver.acknowledge',{id:waiver.id},member.cookie)
  const start=new Date(Date.now()+1500).toISOString(),session=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title:'History class',start,end:new Date(Date.parse(start)+60000).toISOString(),capacity:2,instructorId:coach.id}]})).id})).classes[0]
  const booking=await h.cmd('booking.book',{classId:session.id},member.cookie)
  await h.cmd('attendance.checkin',{id:booking.id},coach.cookie)
  const payment=await h.cmd('payment.record',{personId:member.id,amountCents:10000,reference:'synthetic-strap-history-payment'})
  await h.cmd('member.note.add',{personId:member.id,text:'Private owner alert',alert:true,requestId:'synthetic-strap-note'})
  let full=await h.state();assert.ok(full.bookings.find(b=>b.id===booking.id).alerts.some(a=>a.text==='Private owner alert'))
  for(const cookie of [member.cookie,target.cookie,coach.cookie])assert.ok(!(await h.send('/api/strap/state',undefined,cookie)).text.includes('Private owner alert'))
  const pairing=await h.cmd('kiosk.pair',{label:'Restricted-note privacy'})
  const paired=await h.mf.dispatchFetch(h.origin+'/kiosk/pair',{method:'POST',headers:{origin:h.origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:new URL(pairing.pairUrl).searchParams.get('token')}),redirect:'manual'})
  assert.equal(paired.status,303)
  const kiosk=paired.headers.get('set-cookie').split(';')[0]
  const lookup=await h.mf.dispatchFetch(h.origin+'/kiosk/lookup',{method:'POST',headers:{origin:h.origin,cookie:kiosk,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({q:'migrated'}),redirect:'manual'})
  assert.equal(lookup.status,200);assert.ok(!(await lookup.text()).includes('Private owner alert'))
  const reply=await h.cmd('member.message.send',{text:'Thank you for the class',requestId:'synthetic-strap-member-reply'},member.cookie)
  const history=(await h.send('/api/strap/member-history?personId='+member.id,undefined,h.owner)).value
  for(const source of [pack.id,booking.id,payment.id,reply.id])assert.ok(history.timeline.some(e=>e.id===source))
  assert.ok(history.waivers.some(a=>a.waiverId===waiver.id));assert.ok(history.ledger.some(r=>r.id===payment.id))
  const stale=await h.cmd('member.merge.prepare',{sourceId:member.id,targetId:target.id,reason:'Owner checked both records',requestId:'synthetic-strap-merge-stale'})
  await h.cmd('profile.save.staff',{personId:member.id,phone:'5125550199',requestId:'synthetic-strap-source-change'})
  const v=(await h.state()).version;await h.cmd('member.merge.confirm',{id:stale.id,key:stale.key,requestId:'synthetic-strap-stale-confirm'},h.owner,409);assert.equal((await h.state()).version,v)
  const reviewed=await h.cmd('member.merge.prepare',{sourceId:member.id,targetId:target.id,reason:'Owner verified duplicate with both source identities',requestId:'synthetic-strap-merge'})
  const confirm={id:reviewed.id,key:reviewed.key,requestId:'synthetic-strap-confirm-merge'}
  const merged=await h.cmd('member.merge.confirm',confirm);assert.deepEqual(await h.cmd('member.merge.confirm',confirm),merged)
  assert.equal((await h.send('/api/strap/state',undefined,member.cookie)).status,403,'retired source sign-in loses access')
  const linked=(await h.send('/api/strap/member-history?personId='+target.id,undefined,h.owner)).value
  assert.deepEqual(new Set(linked.sourceIdentities.map(p=>p.id)),new Set([member.id,target.id]))
  for(const source of [pack.id,booking.id,payment.id,reply.id])assert.ok(linked.timeline.some(e=>e.id===source&&e.personId===member.id))
  assert.equal(merged.authorityTransferred,false);assert.equal((await h.state(target.cookie)).packs.length,0,'history linking transfers no credit authority')
  if(process.env.STRAP_PROOF_DIR||process.env.CI)await(await import('./member-records-browser.mjs')).mergedHistoryBrowser(h,{member:target})
}))

test('MEM-006: transactional choices stay independent of channel marketing consent, staff provenance, member-owned sensitive choices, exports and integration sharing opt-out',()=>run(async h=>{
  await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Austin',timeZone:'America/Chicago'})
  const member=await h.person('PreferenceMember'),desk=await h.person('PreferenceDesk'),coach=await h.person('PreferenceCoach','instructor')
  const own={revision:0,bookingEmail:false,marketingEmail:true,marketingSms:false,marketingInApp:false,consentStatement:'I request email marketing only',preferredTimes:'Early mornings',preferredClasses:'Mat and flow',accessibility:'Private access request',feedback:false,attendanceSharing:true,requestId:'synthetic-strap-preference'}
  const saved=await h.cmd('preferences.save',own,member.cookie)
  assert.equal(saved.marketing.email,'confirmed');assert.equal(saved.marketing.sms,'denied');assert.equal((await h.state(member.cookie)).messagePreference.optedOut,true)
  assert.deepEqual(await h.cmd('preferences.save',own,member.cookie),saved)
  const exported=(await h.send('/api/strap/preferences.json',undefined,member.cookie)).value
  assert.equal(exported.preference.preferredTimes,'Early mornings');assert.equal(exported.history.length,1);assert.equal(exported.history[0].source,'signed-in-member');assert.ok(Date.parse(exported.history[0].at))
  await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:3,amountCents:6000,expiresAt:'2099-12-31T00:00:00Z'})).id})
  const start=at(30),session=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title:'Preference flow',start,end:new Date(Date.parse(start)+60*minute).toISOString(),capacity:4,instructorId:coach.id}]})).id})).classes[0]
  await h.cmd('booking.book',{classId:session.id},member.cookie)
  assert.ok((await h.state(member.cookie)).notices.length>0,'transactional in-app notice survives booking-email opt-out')
  assert.equal((await h.send('/api/strap/preferences.json?personId='+member.id,undefined,coach.cookie)).status,403)
  await h.cmd('member.record.grant',{personId:desk.id,enabled:true,canCreate:false,memberIds:[member.id]});desk.cookie=await h.signIn(desk.email);await h.enroll(desk.cookie)
  const staff={personId:member.id,revision:1,marketingSms:true,consentStatement:'Member requested SMS by phone',sourceReference:'Recorded phone request',channel:'phone',requestId:'synthetic-strap-verbal-optin'}
  const pending=await h.cmd('preferences.save.staff',staff,desk.cookie)
  assert.equal(pending.marketing.sms,'pending');assert.equal(pending.accessibility,undefined)
  assert.ok(!(await h.send('/api/strap/state',undefined,desk.cookie)).text.includes('Private access request'))
  const v=(await h.state()).version
  await h.cmd('preferences.save.staff',{...staff,revision:2,feedback:true,requestId:'synthetic-strap-forbidden-feedback'},desk.cookie,403)
  assert.equal((await h.state()).version,v)
  await h.cmd('preferences.save.staff',{...staff,revision:2,bookingEmail:true,requestId:'synthetic-strap-forbidden-booking'},desk.cookie,403)
  const optout={personId:member.id,revision:2,marketingSms:false,channel:'phone',requestId:'synthetic-strap-phone-optout'}
  await h.cmd('preferences.save.staff',optout,desk.cookie)
  await h.cmd('preferences.save.staff',{personId:member.id,revision:3,accessibility:'Owner-recorded access request',channel:'phone',sourceReference:'Member phone request',requestId:'synthetic-strap-owner-accessibility'})
  const history=(await h.send('/api/strap/preferences.json?personId='+member.id,undefined,h.owner)).value.history
  assert.equal(history.at(-1).after.accessibility,'Owner-recorded access request');assert.equal(history.at(-1).actorRole,'owner')
  assert.deepEqual(history.filter(e=>e.actorRole==='front-desk').slice(-2).map(e=>[e.staffMade,e.channel,e.source]),[[true,'phone','staff-phone'],[true,'phone','staff-phone']])
  assert.equal((await h.state()).staffActions.filter(a=>a.command==='preferences.save.staff').length,3)
  // The owner creates a real scoped key through the app, with its native one-time secret.
  const keyPage=await h.mf.dispatchFetch(h.origin+'/app/action?name=integration.create&returnTo=%2Fapp%2Fintegrations',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({label:'Preference sharing','sc_attendance:read':'true',location:'studio'}),redirect:'manual'})
  const token=(await keyPage.text()).match(/<p class="token">(strap_int_[0-9a-f]{64})<\/p>/)?.[1];assert.ok(token)
  const attendance=async()=>{const r=await h.mf.dispatchFetch(h.origin+'/api/strap/integration/attendance',{headers:{authorization:'Bearer '+token,'strap-schema-version':'1',host:new URL(h.origin).host}});assert.equal(r.status,200);return r.json()}
  assert.ok((await attendance()).data.some(c=>c.attendance.length>0))
  await h.cmd('preferences.save',{revision:4,attendanceSharing:false,requestId:'synthetic-strap-sharing-off'},member.cookie)
  assert.ok((await attendance()).data.every(c=>c.attendance.length===0),'sharing opt-out removes the member rows from an existing key immediately')
  if(process.env.STRAP_PROOF_DIR||process.env.CI)await(await import('./preferences-browser.mjs')).preferencesBrowser(h,{member,desk})
}))

test('MEM-003: exact payer-approved monthly family tuition preserves participant entitlements, sibling discounts, external receipts and future-only withdrawals',()=>run(async h=>{
  await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Austin',timeZone:'America/Chicago'})
  const payer=await h.person('TuitionPayer'),a=await h.person('TuitionOne'),b=await h.person('TuitionTwo'),other=await h.person('TuitionOther'),coach=await h.person('TuitionCoach','instructor')
  const household=await h.cmd('household.save',{name:'Tuition family'})
  for(const m of [a,b])await h.cmd('household.participant.add',{id:household.id,personId:m.id})
  await h.cmd('household.payer.propose',{id:household.id,payerId:payer.id})
  await h.cmd('household.payer.accept',{id:household.id},payer.cookie)
  const initial=new Date().toISOString().slice(0,7),next=offset=>{const [y,m]=initial.split('-').map(Number);return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,7)}
  const input={householdId:household.id,name:'Sibling monthly mat',service:'Mat tuition',startsMonth:initial,endsMonth:next(4),discountBps:1000,rows:[{personId:a.id,amountCents:10000,credits:4},{personId:b.id,amountCents:10000,credits:4}],requestId:'synthetic-strap-tuition-1'}
  const plan=await h.cmd('family.tuition.save',input)
  assert.deepEqual(await h.cmd('family.tuition.save',input),plan,'schedule replay is once-only')
  const preview=await h.cmd('family.bill.preview',{id:plan.id,month:initial,requestId:'synthetic-strap-tuition-2'})
  assert.deepEqual(preview.rows.map(r=>[r.amountCents,r.discountCents,r.netCents]),[[10000,1000,9000],[10000,1000,9000]])
  assert.equal(preview.amountCents,18000);assert.equal((await h.state()).charges.length,0)
  const accept={id:preview.id,key:preview.key,confirm:true}
  await refused(h,'family.bill.accept',accept,other.cookie,404)
  await refused(h,'family.bill.accept',accept,h.owner,403)
  await refused(h,'family.bill.accept',{...accept,key:'changed'},payer.cookie,409)
  await refused(h,'family.bill.accept',{...accept,confirm:false},payer.cookie,409)
  const launched=await h.cmd('family.bill.launch',{id:preview.id,requestId:'synthetic-strap-tuition-3',channel:'phone'})
  assert.equal(launched.status,'member_action_required');assert.equal((await h.state()).charges.length,0)
  const bill=await h.cmd('family.bill.accept',accept,payer.cookie)
  assert.deepEqual(await h.cmd('family.bill.accept',accept,payer.cookie),bill,'accepted bill replays without another invoice, charge or entitlement')
  const full=await h.state();assert.equal(full.familyTuition.invoices.length,1);assert.equal(full.charges.length,2)
  assert.deepEqual(full.charges.map(c=>[c.personId,c.amountCents]),[[payer.id,9000],[payer.id,9000]])
  for(const m of [a,b]){const state=await h.state(m.cookie);assert.equal(state.packs.length,1);assert.equal(state.packs[0].remaining,4);assert.equal(state.packs[0].expiresAt,bill.termEndAt);assert.equal(state.balances[0].balanceCents,0);assert.equal(state.familyTuition.invoices.length,0)}
  const payment=await h.cmd('payment.record',{personId:payer.id,amountCents:18000,reference:'synthetic-strap-tuition-receipt'})
  assert.equal((await h.state(payer.cookie)).balances[0].balanceCents,0)
  await refused(h,'payment.record',{personId:payer.id,amountCents:18000,reference:payment.reference},h.owner,409)
  const old=structuredClone((await h.state()).charges)
  await refused(h,'family.participant.withdraw',{id:plan.id,personId:b.id,revision:1,effectiveMonth:initial,reason:'Phone withdrawal',requestId:'synthetic-strap-tuition-4'},h.owner,409)
  const stale=await h.cmd('family.bill.preview',{id:plan.id,month:next(1),requestId:'synthetic-strap-tuition-5'})
  const withdrawal=await h.cmd('family.participant.withdraw',{id:plan.id,personId:b.id,revision:1,effectiveMonth:next(1),reason:'Member phoned to withdraw after this month',requestId:'synthetic-strap-tuition-6',channel:'phone'})
  assert.equal(withdrawal.effectiveMonth,next(1));assert.deepEqual((await h.state()).charges,old)
  await refused(h,'family.bill.accept',{id:stale.id,key:stale.key,confirm:true},payer.cookie,409)
  const future=await h.cmd('family.bill.preview',{id:plan.id,month:next(1),requestId:'synthetic-strap-tuition-7'})
  assert.equal(future.rows.length,1);assert.equal(future.rows[0].personId,a.id);assert.equal(future.amountCents,10000);assert.equal(future.discountBps,0)
  const nextBill=await h.cmd('family.bill.accept',{id:future.id,key:future.key,confirm:true},payer.cookie)
  assert.equal(nextBill.rows.length,1);assert.equal((await h.state(b.cookie)).packs.length,1);assert.equal((await h.state(a.cookie)).packs.length,2)
  assert.deepEqual((await h.state()).charges.filter(c=>c.familyInvoiceId===bill.id),old)
  const classStart=next(1)+'-02T15:00:00Z';
  const session=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(classStart),classes:[{title:'Tuition mat',service:'Mat tuition',start:classStart,end:next(1)+'-02T16:00:00Z',capacity:3,instructorId:coach.id}]})).id})).classes[0];
  const booking=await h.cmd('booking.book',{classId:session.id},a.cookie);
  assert.equal(booking.packId,nextBill.rows[0].packId,'the continuing participant books with next month’s paid entitlement');
  await refused(h,'booking.book',{classId:session.id},b.cookie,409);
  const payerState=JSON.stringify(await h.state(payer.cookie));assert.ok(!payerState.includes('guardianEvidence'),'preview fingerprints do not disclose private household facts');
  const v=(await h.state()).version;await h.cmd('family.bill.preview',{id:plan.id,month:initial,requestId:'synthetic-strap-tuition-8'},h.owner,409);assert.equal((await h.state()).version,v)
  for(const cookie of [other.cookie,coach.cookie]){const text=JSON.stringify(await h.state(cookie));assert.ok(!text.includes('Sibling monthly mat'));assert.equal((await h.send('/app/tuition',undefined,cookie)).status,cookie===coach.cookie?403:200)}
  const exit=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
  assert.equal(exit.manifest.recordKinds.familyInvoice,2)
  assert.ok(exit.tables.st_records.some(r=>r.kind==='familyTuitionWithdrawal'&&JSON.parse(r.data).personId===b.id))
  if(process.env.STRAP_PROOF_DIR||process.env.CI)await(await import('./tuition-browser.mjs')).familyTuitionBrowser(h,{plan,payer,a,b,household,initial,nextMonth:next(2)})
}))

test('MEM-004: versioned signup and service intake gates enrollment, preserves exact answers and phone provenance, and enforces separate sensitive-notes scope on reads, writes and replay',()=>run(async h=>{
  await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Austin',timeZone:'America/Chicago'})
  const member=await h.person('IntakeMember'),desk=await h.person('IntakeDesk'),other=await h.person('IntakeOther'),coach=await h.person('IntakeCoach','instructor')
  const formInput={title:'Member intake',scope:'signup',required:true,questions:[{label:'Preferred class pace',required:true,sensitive:false},{label:'Private care request',required:true,sensitive:true}],requestId:'synthetic-strap-intake-1'}
  const f=await h.cmd('intake.form.publish',formInput)
  assert.match((await h.send('/app',undefined,member.cookie)).text,/Complete the current intake forms/)
  const draft=await h.cmd('pack.prepare',{personId:member.id,credits:4,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z'})
  await refused(h,'pack.approve',{id:draft.id},h.owner,409,'intake_completion_required')
  const answers={formId:f.id,answers:{q0:'Steady pace',q1:'Private synthetic request'},requestId:'synthetic-strap-intake-2'}
  await refused(h,'intake.submit',{...answers,answers:{q0:'Steady pace'}},member.cookie,400,'required_intake_answer')
  await refused(h,'intake.submit',{...answers,personId:other.id},member.cookie,403,'own_intake_required')
  const response=await h.cmd('intake.submit',answers,member.cookie)
  assert.equal(response.complete,true);assert.equal(response.staffMade,false);assert.equal(response.version,1)
  assert.deepEqual(await h.cmd('intake.submit',answers,member.cookie),response,'member submission replays without another completion')
  await refused(h,'intake.submit',{...answers,answers:{q0:'Different',q1:'Private synthetic request'}},member.cookie,409,'intake_request_changed')
  await h.cmd('pack.approve',{id:draft.id})
  const start=at(25),session=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title:'Intake mat',service:'Mat',start,end:new Date(Date.parse(start)+3600000).toISOString(),capacity:4,instructorId:coach.id}]})).id})).classes[0]
  await h.cmd('booking.book',{classId:session.id},member.cookie)
  const changed=await h.cmd('intake.form.publish',{...formInput,seriesId:f.seriesId,revision:1,questions:[...formInput.questions,{label:'New required acknowledgment',required:true,sensitive:false}],requestId:'synthetic-strap-intake-3'})
  const laterStart=at(27),later=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(laterStart),classes:[{title:'Later intake mat',service:'Mat',start:laterStart,end:new Date(Date.parse(laterStart)+3600000).toISOString(),capacity:4,instructorId:coach.id}]})).id})).classes[0]
  await refused(h,'booking.book',{classId:later.id},member.cookie,409,'intake_completion_required')
  await refused(h,'intake.submit',{...answers,requestId:'synthetic-strap-intake-old'},member.cookie,409,'intake_form_changed')
  await h.cmd('member.record.grant',{personId:desk.id,enabled:true,canCreate:false,memberIds:[member.id]});desk.cookie=await h.signIn(desk.email);const factor=await h.enroll(desk.cookie)
  const phone={personId:member.id,formId:changed.id,answers:{q0:'Member phoned: quiet classes',q2:'Member acknowledged by phone'},requestId:'synthetic-strap-intake-phone',channel:'phone'}
  const partial=await h.cmd('intake.submit.staff',phone,desk.cookie)
  assert.equal(partial.complete,false);assert.equal(partial.staffMade,true);assert.equal(partial.channel,'phone');assert.ok(!('q1'in partial.answers))
  await refused(h,'booking.book',{classId:later.id},member.cookie,409,'intake_completion_required')
  await refused(h,'intake.submit.staff',{...phone,answers:{...phone.answers,q1:'Forbidden'},requestId:'synthetic-strap-intake-forbidden'},desk.cookie,403,'sensitive_notes_right_required')
  assert.ok(!(await h.send('/api/strap/state',undefined,desk.cookie)).text.includes('Private synthetic request'))
  await h.cmd('intake.sensitive.grant',{personId:desk.id,enabled:true,memberIds:[member.id],requestId:'synthetic-strap-intake-grant'})
  assert.equal((await h.send('/api/strap/state',undefined,desk.cookie)).status,401)
  desk.cookie=await h.signIn(desk.email);await h.cmd('mfa.verify',{code:factor.recoveryCodes[0]},desk.cookie)
  const completeInput={...phone,answers:{...phone.answers,q1:'Private phone answer'},requestId:'synthetic-strap-intake-complete'}
  const complete=await h.cmd('intake.submit.staff',completeInput,desk.cookie)
  assert.equal(complete.complete,true);assert.deepEqual(await h.cmd('intake.submit.staff',completeInput,desk.cookie),complete)
  const audit=(await h.state()).staffActions.filter(a=>a.command==='intake.submit.staff'&&a.requestId===completeInput.requestId)
  assert.equal(audit.length,1);assert.equal(audit[0].right,'member-record');assert.equal(audit[0].actorRole,'front-desk');assert.equal(audit[0].channel,'phone');assert.equal(audit[0].before.complete,false);assert.equal(audit[0].after.complete,true)
  await h.cmd('booking.book',{classId:later.id},member.cookie)
  const own=await h.state(member.cookie);assert.equal(own.intake.responses.filter(r=>r.formId===f.id)[0].answers.q1,'Private synthetic request');assert.equal(own.intake.responses.filter(r=>r.formId===changed.id).at(-1).answers.q1,'Private phone answer')
  const service=await h.cmd('intake.form.publish',{title:'Reformer intake',scope:'service',service:'Reformer',required:true,questions:[{label:'Experience',required:true,sensitive:false}],requestId:'synthetic-strap-intake-service'})
  const reformerStart=at(29),reformer=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(reformerStart),classes:[{title:'Reformer intake class',service:'Reformer',start:reformerStart,end:new Date(Date.parse(reformerStart)+3600000).toISOString(),capacity:4,instructorId:coach.id}]})).id})).classes[0]
  await refused(h,'booking.book',{classId:reformer.id},member.cookie,409,'intake_completion_required')
  await h.cmd('intake.submit',{formId:service.id,answers:{q0:'First class'},requestId:'synthetic-strap-intake-service-answer'},member.cookie)
  await h.cmd('booking.book',{classId:reformer.id},member.cookie)
  for(const cookie of [other.cookie,coach.cookie]){const state=JSON.stringify(await h.state(cookie));for(const value of ['Private synthetic request','Private phone answer','Member phoned: quiet classes'])assert.ok(!state.includes(value));await refused(h,'intake.submit.staff',completeInput,cookie,403)}
  assert.match((await h.send('/app/profile',undefined,member.cookie)).text,/Staff-entered/)
  const tablet=await h.cmd('intake.tablet.launch',{personId:member.id,formId:changed.id,requestId:'synthetic-strap-tablet-launch',channel:'desk'},desk.cookie)
  const secret=new URL(tablet.url,h.origin).searchParams.get('token')
  assert.ok(secret && !(await h.send('/api/strap/state',undefined,h.owner)).text.includes(secret),'handoff credentials stay out of records and canonical audits')
  assert.equal((await h.send(tablet.url,undefined,desk.cookie)).status,403,'a signed-in device cannot become the tablet')
  assert.equal((await h.send(tablet.url)).status,200)
  const paired=await h.mf.dispatchFetch(h.origin+'/intake/tablet/start',{method:'POST',headers:{origin:h.origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:secret}),redirect:'manual'})
  assert.equal(paired.status,303);const tabletCookie=paired.headers.get('set-cookie').split(';')[0]
  const blank=await h.send('/intake/tablet',undefined,tabletCookie);assert.equal(blank.status,200);assert.ok(!blank.text.includes('Private phone answer'));assert.ok(!blank.text.includes(member.email))
  for(const path of ['/app','/api/strap/state','/auth/session','/signin'])assert.equal((await h.send(path,undefined,tabletCookie)).status,403,'locked tablet has no account or private route')
  const tabletBody={answer_q0:'Tablet steady pace',answer_q1:'Private tablet answer',answer_q2:'Tablet acknowledgment',confirm:'yes'}
  const sent=await h.mf.dispatchFetch(h.origin+'/intake/tablet',{method:'POST',headers:{origin:h.origin,cookie:tabletCookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(tabletBody),redirect:'manual'})
  assert.equal(sent.status,200);assert.match(await sent.text(),/tablet locked/)
  const afterTablet=(await h.state(member.cookie)).intake.responses.find(r=>r.tabletLaunchId===tablet.id);assert.equal(afterTablet.actorRole,'tablet-member');assert.equal(afterTablet.staffMade,false);assert.equal(afterTablet.launchedBy,(await h.state(desk.cookie)).actor.id)
  const v=(await h.state()).version;assert.equal((await h.send('/intake/tablet',undefined,tabletCookie)).status,410);assert.equal((await h.send(tablet.url)).status,410);assert.equal((await h.state()).version,v)
  const exit=(await h.send('/api/strap/exit.json',undefined,h.owner)).value;assert.equal(exit.manifest.recordKinds.intakeForm,3);assert.equal(exit.manifest.recordKinds.intakeResponse,5);assert.ok(!('st_intake_tablets'in exit.tables))
  if(process.env.STRAP_PROOF_DIR||process.env.CI)await(await import('./intake-browser.mjs')).intakeBrowser(h,{member,desk,coach})
  await h.cmd('intake.sensitive.grant',{personId:desk.id,enabled:false,memberIds:[],requestId:'synthetic-strap-intake-revoke'})
  desk.cookie=await h.signIn(desk.email);await h.cmd('mfa.verify',{code:factor.recoveryCodes[1]},desk.cookie)
  await refused(h,'intake.submit.staff',completeInput,desk.cookie,403,'sensitive_notes_right_required')
  const redacted=(await h.send('/api/strap/state',undefined,desk.cookie)).text;assert.ok(!redacted.includes('Private phone answer'));assert.ok(!redacted.includes('Private synthetic request'))
  await h.cmd('member.record.grant',{personId:desk.id,enabled:false,canCreate:false,memberIds:[]});desk.cookie=await h.signIn(desk.email);await h.cmd('mfa.verify',{code:factor.recoveryCodes[2]},desk.cookie)
  await refused(h,'intake.submit.staff',phone,desk.cookie,403)
}))
