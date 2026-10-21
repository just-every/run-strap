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
test('STAFF-006 / SEC-002: every current member command has a real staff door, identical member outcome and one canonical named-right audit entry; unauthorized users and agents cannot act for members',async()=>{
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
      assert.equal(fresh[0].command,name);assert.equal(fresh[0].right,name==='plan.change.prepare'?'contract-change':(name.startsWith('booking.')||name.startsWith('reservation.'))?'booking':['notice.dismiss.staff','recognition.launch','mail.preference.launch','profile.save.staff'].includes(name)?'member-record':'check-in');assert.ok('before'in fresh[0]&&'after'in fresh[0]);return {result,event:fresh[0],after}
    }
    let reservationDraft,reservation,cancellationDraft,seriesMember
    const actions={
      'reservation.prepare':async door=>{
        seriesMember=await h.person('SeriesMember')
        await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:seriesMember.id,credits:3,amountCents:6000,expiresAt:'2099-12-31T00:00:00Z'})).id})
        const dates={startDate:'2098-01-06',endDate:'2098-01-20',time:'09:00',minutes:50,intervalWeeks:1,title:'Standing class',service:'Yoga',room:'Series',capacity:3,instructorId:coach.id}
        const series=await h.cmd('series.publish',{id:(await h.cmd('series.prepare',dates)).id})
        const r=await checkAudit(door,{classId:series.classes[0].id,throughDate:dates.endDate,personId:seriesMember.id,channel:'phone',requestId:randomUUID()})
        reservationDraft=r.result
        assert.ok(reservationDraft.outcomes.every(o=>o.status==='booked'))
        assert.equal(r.after.bookings.filter(b=>b.reservationId).length,0,'staff preview books nothing')
      },
      'reservation.confirm':async door=>{
        const input={id:reservationDraft.id,key:reservationDraft.key,channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        reservation=r.result
        assert.equal(r.after.bookings.filter(b=>b.reservationId===reservation.id).length,3)
        assert.deepEqual((await h.state(seriesMember.cookie)).reservations.find(r=>r.id===reservation.id),reservation,'member reads the same staff-made outcomes')
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1)
      },
      'reservation.cancel.prepare':async door=>{
        const r=await checkAudit(door,{reservationId:reservation.id,channel:'phone',requestId:randomUUID()});cancellationDraft=r.result
        assert.equal(cancellationDraft.outcomes.length,3)
      },
      'reservation.cancel.confirm':async door=>{
        const input={id:cancellationDraft.id,key:cancellationDraft.key,channel:'phone',cancelReason:'Schedule conflict',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.equal(r.result.status,'cancelled')
        const children=r.after.bookingActions.filter(a=>a.parentActionId===r.event.id)
        assert.equal(children.length,3,'per-occurrence audit links to its one canonical command audit')
        assert.ok(children.every(a=>a.actorRole==='owner'&&a.staffMade&&a.channel==='phone'&&a.right==='booking'))
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1)
      },
      'profile.save':async door=>{
        const input={personId:ana.id,emergencyName:'Rosa Diaz',emergencyPhone:'(615) 555-0123',channel:'phone',revision:0,requestId:randomUUID()},r=await checkAudit(door,input)
        assert.deepEqual(r.result.emergencyContact,{name:'Rosa Diaz',phone:'6155550123',relationship:null})
        assert.deepEqual((await h.state(ana.cookie)).people.find(p=>p.id===ana.id).emergencyContact,r.result.emergencyContact,'the member reads the staff-made profile')
        assert.deepEqual([r.event.before.emergencyContact,r.event.after.emergencyContact],[null,r.result.emergencyContact])
        assert.equal((await h.cmd('profile.save',{emergencyRelationship:'Sister',revision:1,requestId:randomUUID()},ana.cookie)).emergencyContact.relationship,'Sister')
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.length,r.after.staffActions.length,'replay creates no second entry')
      },
      'recognition.preference.save':async door=>{
        const current=(await h.state(ana.cookie)).recognition.preferences[0]
        const input={personId:ana.id,channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.equal(r.result.preferenceDoor,true)
        assert.deepEqual((await h.state(ana.cookie)).recognition.preferences[0],current,'staff launch preserves the member-owned choice')
        const saved=await h.cmd('recognition.preference.save',{optedIn:true,version:current.version},ana.cookie)
        assert.equal(saved.optedIn,true)
        assert.equal(saved.history.at(-1).actorId,(await h.state(ana.cookie)).actor.id)
        await h.cmd(door,input)
        assert.equal((await h.state()).staffActions.filter(a=>a.command===door&&a.requestId===input.requestId).length,1)
      },
      'mail.preference.save':async door=>{
        const current=(await h.state(ana.cookie)).messagePreference
        const input={personId:ana.id,channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.equal(r.result.url,'/signin?returnTo=%2Fapp%23message-preferences')
        assert.equal(r.result.status,'member_action_required')
        assert.deepEqual((await h.state(ana.cookie)).messagePreference,current,'staff launch preserves the member-owned preference')
        assert.equal((await h.cmd('mail.preference.save',{optedOut:true,requestId:randomUUID()},ana.cookie)).optedOut,true)
        assert.equal((await h.cmd('mail.preference.save',{optedOut:false,requestId:randomUUID()},ana.cookie)).optedOut,false)
        await h.cmd(door,input)
        assert.equal((await h.state()).staffActions.filter(a=>a.command===door&&a.requestId===input.requestId).length,1)
      },
      'booking.move':async door=>{
        const from=await publish('Move from',30),to=await publish('Move to',32)
        const booked=await h.cmd('booking.book',{classId:from.id},ana.cookie)
        const input={id:booked.id,classId:to.id,cancelReason:'Other',channel:'phone',requestId:randomUUID()}
        const r=await checkAudit(door,input)
        assert.equal(r.result.classId,to.id)
        assert.equal((await h.state(ana.cookie)).bookings.find(b=>b.id===booked.id).classId,to.id)
        assert.equal(r.event.before.classId,from.id);assert.equal(r.event.after.classId,to.id)
        await h.cmd(door,input)
        assert.equal((await h.state()).staffActions.filter(a=>a.command===door&&a.requestId===input.requestId).length,1)
      },
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
        assert.equal(r.result.refunded,true);assert.equal((await h.state(ana.cookie)).notices.filter(n=>n.bookingId===b.id&&n.subject.startsWith('Booking cancelled:')).length,1)
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
      'plan.change.request':async door=>{
        const pack=(await h.state(ana.cookie)).packs[0]
        const input={packId:pack.id,mode:'renewal',credits:6,amountCents:12000,expiresAt:'2100-06-30T00:00:00.000Z',channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.equal(r.result.status,'preview');assert.equal(r.event.before.id,pack.id);assert.equal(r.event.after.id,r.result.id)
        assert.deepEqual((await h.state(ana.cookie)).planChanges.changes.find(c=>c.id===r.result.id),r.after.planChanges.changes.find(c=>c.id===r.result.id),'staff and member read the same preview')
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1)
      },
      'plan.change.accept':async door=>{
        const preview=(await h.state(ana.cookie)).planChanges.changes.find(c=>c.status==='preview')
        await refused(h,'plan.change.accept',{id:preview.id,key:preview.key},h.owner)
        assert.equal((await h.state(ana.cookie)).planChanges.changes.find(c=>c.id===preview.id).status,'preview','the staff preview never accepts for the member')
        const accepted=await h.cmd('plan.change.accept',{id:preview.id,key:preview.key},ana.cookie)
        assert.equal(accepted.acceptedBy,(await h.state(ana.cookie)).actor.id)
        await refused(h,door,{packId:preview.packId,mode:'renewal',credits:7,amountCents:13000,expiresAt:'2100-07-30T00:00:00.000Z',requestId:randomUUID()},h.owner,409)
      },
    }
    // Work in actual action order so every pair has a real member state to change.
    for (const name of Object.keys(actions)) {
      const entry=memberCommands.find(c=>c.name===name)
      assert.ok(entry,`${name}: discovered as a member command`)
      assert.ok(catalogue.some(c=>c.name===entry.memberDoor.staff),`${name}: registered staff command`)
      await actions[name](entry.memberDoor.staff);covered.add(name)
      if (name.startsWith('reservation.')) assert.equal((await h.send(`/app/people?person=${seriesMember.id}`,undefined,h.owner)).status,200,'the staff history renders the recurring action and its before/after effects')
    }
    for (const entry of memberCommands) assert.ok(covered.has(entry.name),`${entry.name}: a new member action needs a tested staff pair`)
    const key=await h.cmd('agent.create',{label:'Staff parity agent'})
    for (const entry of memberCommands) {
      const input={id:'unknown',personId:ana.id,classId:future.id,waiverId:(await h.state()).waiver.id,requestId:randomUUID()}
      if (entry.name.startsWith('reservation.')) Object.assign(input,{personId:seriesMember.id,classId:reservationDraft.classId,throughDate:reservationDraft.throughDate,reservationId:reservation.id,id:entry.name==='reservation.cancel.confirm'?cancellationDraft.id:reservationDraft.id,key:entry.name==='reservation.cancel.confirm'?cancellationDraft.key:reservationDraft.key})
      // Self-capable shared commands still refuse acting for somebody else.
      if (['booking.cancel','booking.spot','booking.offer.accept','booking.move'].includes(entry.memberDoor.staff)) {
        const other=(await h.state()).bookings.find(b=>b.personId===ben.id&&b.status==='booked');input.id=other.id
        if (entry.memberDoor.staff==='booking.move') input.classId=near.id
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
    // SEC-002: search and download actual staff-made changes, without broadening access or rewriting history.
    const historyMember=await h.person('HistoryOne'),otherHistoryMember=await h.person('HistoryTwo')
    const edit={personId:historyMember.id,phone:'6155550197',channel:'phone',revision:0,requestId:randomUUID()}
    await h.cmd('profile.save.staff',edit)
    await h.cmd('profile.save.staff',edit) // a replay remains one change in search and export
    await h.cmd('profile.save.staff',{personId:otherHistoryMember.id,phone:'6155550198',channel:'inbox',revision:0,requestId:randomUUID()})
    const historyQuery=new URLSearchParams({person:historyMember.id,auditActor:(await h.state()).actor.id,auditRight:'member-record',auditChannel:'phone',auditCommand:'profile.save.staff'})
    const history=await h.send('/api/strap/staff-history?'+historyQuery,undefined,h.owner)
    assert.equal(history.status,200);assert.equal(history.headers.get('cache-control'),'no-store')
    assert.equal(history.value.rows.length,1,'only the selected member, right, channel and command appear; replay is not duplicated')
    const change=history.value.rows[0]
    assert.deepEqual([change.actorRole,change.actorId,change.personId,change.right,change.channel,change.before.phone,change.after.phone],['owner',(await h.state()).actor.id,historyMember.id,'member-record','phone',null,'6155550197'])
    const {parseCsv}=await import('./report-downloads.mjs')
    const download=await h.send('/api/strap/staff-history.csv?'+historyQuery,undefined,h.owner)
    assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'no-store');assert.match(download.headers.get('content-disposition'),/attachment/)
    const [columns,...data]=parseCsv(download.text),exported=Object.fromEntries(columns.map((key,i)=>[key,data[0][i]]))
    assert.equal(data.length,1)
    assert.deepEqual(JSON.parse(exported.before),change.before);assert.deepEqual(JSON.parse(exported.after),change.after)
    for(const field of ['actorId','actorRole','personId','command','right','channel','at','reason'])assert.deepEqual(exported[field],change[field])
    const changedQuery=new URLSearchParams(historyQuery);changedQuery.set('auditChannel','inbox')
    assert.equal((await h.send('/api/strap/staff-history?'+changedQuery,undefined,h.owner)).value.rows.length,0)
    for(const [field,value] of [['auditActor','unrecorded-staff'],['auditRight','booking'],['auditCommand','booking.cancel'],['person',otherHistoryMember.id]]) {
      const excluded=new URLSearchParams(historyQuery);excluded.set(field,value)
      assert.equal((await h.send('/api/strap/staff-history?'+excluded,undefined,h.owner)).value.rows.length,0,field+' filters independently')
    }
    const empty=await h.send('/api/strap/staff-history.csv?'+changedQuery,undefined,h.owner);assert.equal(parseCsv(empty.text).length,1,'empty exports retain headers and no unrelated changes')
    const all=(await h.send('/api/strap/staff-history',undefined,h.owner)).value.rows
    for(let i=1;i<all.length;i++)assert.ok(all[i-1].at>=all[i].at,'history is newest first')
    assert.equal(all.filter(a=>a.personId===historyMember.id&&a.command==='profile.save.staff').length,1)
    assert.ok(all.some(a=>a.personId===otherHistoryMember.id&&a.channel==='inbox'&&a.after.phone==='6155550198'))
    const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(change.at))
    const dated=new URLSearchParams(historyQuery);dated.set('auditFrom',localDay);dated.set('auditTo',localDay)
    assert.deepEqual((await h.send('/api/strap/staff-history?'+dated,undefined,h.owner)).value.rows,history.value.rows,'inclusive studio-local bounds retain the exact change')
    dated.set('auditFrom','2099-12-30');dated.set('auditTo','2099-12-31')
    assert.equal((await h.send('/api/strap/staff-history?'+dated,undefined,h.owner)).value.rows.length,0,'out-of-period changes are excluded')
    const unused=await h.cmd('person.save',{name:'Unused History',email:'unused-history@studio.example',role:'member',active:true})
    await h.cmd('profile.save.staff',{personId:unused.id,phone:'6155550199',channel:'phone',revision:0,requestId:randomUUID()})
    await h.cmd('person.erase',{id:unused.id})
    const redacted=(await h.send('/api/strap/staff-history?person='+unused.id,undefined,h.owner)).value.rows
    assert.equal(redacted.length,1);assert.equal(redacted[0].erased,true)
    assert.deepEqual([redacted[0].before,redacted[0].after],[null,null],'existing unused-identity erasure keeps provenance without personal values')
    assert.ok(!JSON.stringify(redacted).includes('6155550199'))
    const redactedCsv=await h.send('/api/strap/staff-history.csv?person='+unused.id,undefined,h.owner)
    assert.ok(!redactedCsv.text.includes('6155550199'))
    const version=(await h.state()).version
    for(const path of ['/api/strap/staff-history','/api/strap/staff-history.csv']) {
      for(const cookie of [ana.cookie,coach.cookie,''])assert.equal((await h.send(path,undefined,cookie)).status,cookie?403:401)
      assert.equal((await h.send(path,undefined,'',{authorization:`Bearer ${key.token}`})).status,401)
      for(const query of ['auditFrom=2026-02-30','auditFrom=2026-02-02&auditTo=2026-02-01'])assert.equal((await h.send(path+'?'+query,undefined,h.owner)).status,400)
      assert.equal((await h.send(path,{},h.owner)).status,404,'no write door is exposed')
    }
    assert.equal((await h.state()).version,version,'search, exports, denied reads and attempted rewrites change no studio records')
    const fullExport=JSON.stringify(all)
    assert.ok(!fullExport.includes(rotated.result.code),'check-in credentials do not enter audit downloads')
    if(process.env.STRAP_PROOF_DIR)await(await import('./staff-actions-browser.mjs')).staffActionsBrowser(h,{ana,ben,publish,historyMember})
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
