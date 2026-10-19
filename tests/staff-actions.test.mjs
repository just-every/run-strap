import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { run } from './harness.mjs'
const minute=60_000, hour=60*minute
const at = hours => new Date(Math.ceil((Date.now()+hours*hour)/minute)*minute).toISOString()
const monday = start => {const d=new Date(start);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)}
const form=(h,name,back,fields,cookie=h.owner)=>h.mf.dispatchFetch(h.origin+`/app/action?name=${name}&returnTo=${encodeURIComponent(back)}`,{method:'POST',headers:{origin:h.origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),redirect:'manual'})
async function refused(h,name,input,cookie,status=403) {const before=(await h.state()).version,r=await h.send('/api/strap/command',{name,input},cookie);assert.equal(r.status,status,JSON.stringify(r.value));assert.equal((await h.state()).version,before);return r}
async function followLink(h,email) {
  const mail=(await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()).results.map(row=>JSON.parse(row.message)).find(m=>m.to.includes(email))
  assert.ok(mail)
  const token=new URL(mail.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
  const response=await h.send('/auth/confirm',{token});assert.equal(response.status,303,response.text)
  assert.equal(response.headers.get('location'),'/app#waiver');return response.cookie
}
async function prepare(h) {
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Nashville',timeZone:'America/Chicago'})
  const coach=await h.person('Maya','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben')
  for (const p of [ana,ben]) await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits:5,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z'})).id})
  const publish=async(title,hours,capacity=1)=>{const start=at(hours);return (await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title,room:title,start,end:new Date(Date.parse(start)+50*minute).toISOString(),capacity,instructorId:coach.id}]})).id})).classes[0]}
  return {coach,ana,ben,publish}
}

// The catalogue is the real dispatch registry. Every member-tagged command
// must have a working staff pair, not just a matching string in a second list.
test('STAFF-006: every current member command has a real staff door, identical member outcome and one canonical named-right audit entry; unauthorized users and agents cannot act for members',async()=>{
  await run(async h=>{
    const {coach,ana,ben,publish}=await prepare(h)
    const future=await publish('Future Flow',26),near=await publish('Open check-in',0.25)
    await h.cmd('spots.save',{room:'Future Flow',spots:['Mat 1','Mat 2'],disabled:[]})
    // First get a code by the member door; staff reading it preserves its bytes and revision.
    const ownCode=await h.cmd('checkin.code',{},ana.cookie)
    const catalogue=(await h.send('/api/strap/commands',undefined,h.owner)).value.commands
    const memberCommands=catalogue.filter(c=>c.roles.includes('member')),covered=new Set()
    const checkAudit=async(name,input,runCommand=()=>h.cmd(name,input))=>{
      const before=await h.state(),ids=new Set(before.staffActions.map(a=>a.id));const result=await runCommand();const after=await h.state()
      const fresh=after.staffActions.filter(a=>!ids.has(a.id))
      assert.equal(fresh.length,1,`${name}: exactly one canonical staff entry`)
      assert.deepEqual([fresh[0].actorId,fresh[0].actorRole,fresh[0].channel],[after.actor.id,'owner',input.channel??'desk'])
      assert.equal(fresh[0].command,name);assert.equal(fresh[0].right,name.startsWith('booking.')?'booking':name==='notice.dismiss.staff'?'member-record':'check-in');assert.ok('before'in fresh[0]&&'after'in fresh[0]);return {result,event:fresh[0],after}
    }
    const actions={
      'booking.book':async door=>{
        const r=await checkAudit(door,{personId:ana.id,classId:future.id,channel:'phone'})
        assert.equal(r.result.status,'booked');assert.equal((await h.state(ana.cookie)).bookings.find(b=>b.id===r.result.id).status,'booked');return r.result
      },
      'booking.spot':async door=>{
        const b=(await h.state()).bookings.find(b=>b.personId===ana.id&&b.classId===future.id&&b.status==='booked')
        const r=await checkAudit(door,{id:b.id,spot:'Mat 2',channel:'phone'})
        assert.equal(r.result.spot,'Mat 2');assert.equal((await h.state(ana.cookie)).bookings.find(x=>x.id===b.id).spot,'Mat 2')
      },
      'booking.cancel':async door=>{
        const b=(await h.state()).bookings.find(b=>b.personId===ana.id&&b.classId===future.id&&b.status==='booked')
        assert.deepEqual((await h.state(ana.cookie)).bookings.find(x=>x.id===b.id).cancelEffect,b.cancelEffect,'staff and member read the same preview')
        const r=await checkAudit(door,{id:b.id,cancelReason:'Other',channel:'phone'})
        assert.equal(r.result.refunded,true);assert.equal((await h.state(ana.cookie)).notices.filter(n=>n.bookingId===b.id).length,1)
      },
      'booking.offer.accept':async door=>{
        await h.cmd('waitlist.save',{mode:'offer',claimMinutes:30,lateWindow:'promote'})
        const first=await h.cmd('booking.book',{classId:future.id},ana.cookie)
        const waiter=await h.cmd('booking.book',{classId:future.id},ben.cookie)
        await h.cmd('booking.cancel',{id:first.id},ana.cookie)
        const cancellations=(await h.state(ana.cookie)).notices.filter(n=>n.subject.startsWith('Booking cancelled:'))
        assert.equal(new Set(cancellations.map(n=>n.body)).size,1,'staff and member cancellation notices agree')
        const r=await checkAudit(door,{id:waiter.id,channel:'inbox'})
        assert.equal(r.result.status,'booked');assert.equal((await h.state(ben.cookie)).bookings.find(b=>b.id===waiter.id).status,'booked')
      },
      'attendance.self':async door=>{
        const b=await h.cmd('booking.book',{classId:near.id},ana.cookie)
        const r=await checkAudit(door,{id:b.id,channel:'desk'})
        assert.equal(r.result.attendance,'attended');assert.equal((await h.state(ana.cookie)).bookings.find(x=>x.id===b.id).attendance,'attended')
      },
      'checkin.code':async door=>{
        const input={personId:ana.id,channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.equal(r.result.code,ownCode.code);assert.equal(r.result.codeRevision,ownCode.codeRevision)
        assert.ok(!JSON.stringify(r.event).includes(ownCode.code),'raw check-in credentials stay out of audit')
        const count=r.after.staffActions.length
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.length,count,'replay creates no second entry')
        await refused(h,door,{...input,personId:ben.id},h.owner,409)
      },
      'waiver.acknowledge':async door=>{
        const w=await h.cmd('waiver.publish',{text:'Current waiver: choose your own limits; acknowledge only for yourself.'})
        const input={personId:ana.id,waiverId:w.id,channel:'desk',requestId:randomUUID()}
        const beforeMails=(await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n
        const r=await checkAudit(door,input)
        assert.equal(r.result.status,'requested');assert.ok(!(await h.state()).acknowledgements.some(a=>a.personId===ana.id&&a.waiverId===w.id),'staff launch never acknowledges')
        await h.cmd(door,input)
        assert.equal((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n,beforeMails+1,'same request sends one secure link')
        const cookie=await followLink(h,ana.email)
        assert.equal((await h.send('/app',undefined,cookie)).status,200)
        await h.cmd('waiver.acknowledge',{id:w.id},cookie)
        assert.equal((await h.state()).acknowledgements.find(a=>a.personId===ana.id&&a.waiverId===w.id).actorId,(await h.state(cookie)).actor.id)
        assert.equal(r.event.right,'check-in')
      },
      'notice.dismiss':async door=>{
        const n=(await h.state(ana.cookie)).notices.find(n=>!n.dismissedAt)
        const input={id:n.id,personId:ana.id,channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        const own=(await h.state(ana.cookie)).notices.find(x=>x.id===n.id)
        assert.deepEqual([own.subject,own.body],[n.subject,n.body]);assert.ok(own.dismissedAt)
        assert.equal(own.dismissedByStaff.actorId,r.after.actor.id);assert.equal(r.event.right,'member-record')
        assert.match((await h.send('/app',undefined,ana.cookie)).text,/Marked read by staff/)
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.length,r.after.staffActions.length)
      },
    }
    // Work in actual action order so every pair has a real member state to change.
    for (const name of Object.keys(actions)) {
      const entry=memberCommands.find(c=>c.name===name)
      assert.ok(entry,`${name}: discovered as a member command`)
      assert.ok(catalogue.some(c=>c.name===entry.memberDoor.staff),`${name}: registered staff command`)
      await actions[name](entry.memberDoor.staff);covered.add(name)
    }
    for (const entry of memberCommands) assert.ok(covered.has(entry.name),`${entry.name}: a new member action needs a tested staff pair`)
    const key=await h.cmd('agent.create',{label:'Staff parity agent'})
    for (const entry of memberCommands) {
      const input={id:'unknown',personId:ana.id,classId:future.id,waiverId:(await h.state()).waiver.id,requestId:randomUUID()}
      // Self-capable shared commands still refuse acting for somebody else.
      if (['booking.cancel','booking.spot','booking.offer.accept'].includes(entry.memberDoor.staff)) {
        const other=(await h.state()).bookings.find(b=>b.personId===ben.id&&b.status==='booked');input.id=other.id
      }
      await refused(h,entry.memberDoor.staff,input,ana.cookie)
      if (!['attendance.checkin'].includes(entry.memberDoor.staff)) await refused(h,entry.memberDoor.staff,input,coach.cookie)
      const before=(await h.state()).version
      assert.equal((await h.send('/api/strap/agent/command',{name:entry.memberDoor.staff,input},'',{authorization:`Bearer ${key.token}`})).status,403)
      assert.equal((await h.state()).version,before)
    }
    const codeBefore=(await h.state()).checkinCodes.find(c=>c.personId===ana.id)
    await refused(h,'checkin.rotate',{personId:ana.id},h.owner,400)
    const rotated=await checkAudit('checkin.rotate',{personId:ana.id,reason:'Lost key tag',channel:'phone',requestId:randomUUID()})
    assert.notEqual(rotated.result.code,codeBefore.code);assert.equal(rotated.result.codeRevision,codeBefore.codeRevision+1)
    if(process.env.STRAP_PROOF_DIR)await(await import('./staff-actions-browser.mjs')).staffActionsBrowser(h,{ana,ben,publish})
  })
})

test('STAFF-006: invitation launch is an audited request, the new member alone acknowledges, code issuance and reasoned rotation replay once, and uncertain mail is never resent',async()=>{
  await run(async h=>{
    await h.cmd('studio.save',{location:'Nashville',timeZone:'America/Chicago'})
    const cy=await h.cmd('person.save',{name:'Cy',email:'cy@studio.example',role:'member',active:true})
    const w=await h.cmd('waiver.publish',{text:'Cy must acknowledge this exact version personally.'})
    const input={personId:cy.id,waiverId:w.id,requestId:randomUUID(),channel:'phone'}
    await refused(h,'waiver.launch',{...input,waiverId:'obsolete'},h.owner,409)
    const launch=await h.cmd('waiver.launch',input)
    assert.equal(launch.status,'requested');assert.equal((await h.state()).acknowledgements.length,0)
    const cookie=await followLink(h,cy.email)
    await refused(h,'waiver.acknowledge',{id:w.id,personId:cy.id},h.owner)
    await h.cmd('waiver.acknowledge',{id:w.id},cookie)
    const s=await h.state();assert.equal(s.acknowledgements[0].actorId,(await h.state(cookie)).actor.id)
    assert.equal(s.staffActions.filter(a=>a.command==='waiver.launch').length,1)
    const codeInput={personId:cy.id,requestId:randomUUID(),channel:'desk'}
    const code=await h.cmd('checkin.code.staff',codeInput)
    assert.equal((await h.cmd('checkin.code',{},cookie)).code,code.code,'member and staff receive the same first-issued code')
    const rotateInput={personId:cy.id,requestId:randomUUID(),channel:'phone',reason:'Lost tag'}
    const rotated=await h.cmd('checkin.rotate',rotateInput),replayed=await h.cmd('checkin.rotate',rotateInput)
    assert.deepEqual([replayed.code,replayed.codeRevision],[rotated.code,rotated.codeRevision])
    assert.equal((await h.state()).staffActions.filter(a=>a.command==='checkin.rotate').length,1)
    await refused(h,'checkin.code.staff',codeInput,h.owner,409)
    const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
    const records=portable.tables.st_records.map(r=>({kind:r.kind,data:JSON.parse(r.data)}))
    assert.equal(records.filter(r=>r.kind==='waiverLaunch').length,1)
    assert.equal(records.filter(r=>r.kind==='staffAction').length,3)
    assert.ok(!('st_waiver_launch_dispatches'in portable.tables))
  })
  await run(async h=>{
    await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
    const cy=await h.cmd('person.save',{name:'Cy',email:'cy@studio.example',role:'member',active:true})
    const w=await h.cmd('waiver.publish',{text:'An uncertain email cannot stand in for this person’s acknowledgment.'})
    const input={personId:cy.id,waiverId:w.id,requestId:randomUUID(),channel:'desk'}
    const first=await h.cmd('waiver.launch',input),again=await h.cmd('waiver.launch',input)
    assert.equal(first.status,'uncertain');assert.equal(again.status,'uncertain')
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n,1,'uncertainty never automatically mints/sends a second link')
    assert.equal((await h.state()).staffActions.filter(a=>a.command==='waiver.launch').length,1)
    assert.equal((await h.state()).acknowledgements.length,0)
    assert.match((await h.send('/app/people?person='+cy.id,undefined,h.owner)).text,/Outcome unknown; delivery not confirmed/)
  },{auth:{TEST_MAIL_FAILURE:'unknown'}})
})
