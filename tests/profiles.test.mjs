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
