import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const weekOf = at => {const d=new Date(at);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)}
const publish = async(h,coach,title,start,room=title,capacity=8)=>(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:weekOf(start),classes:[{title,service:'Mat',start,end:new Date(Date.parse(start)+3600000).toISOString(),capacity,room,instructorId:coach.id}]})).id})).classes[0]
const rows = async h => (await h.db.prepare('SELECT * FROM st_notice_deliveries ORDER BY created_at,id').all()).results
async function refused(h,name,input,cookie,status=403) {
  const version=(await h.state()).version,r=await h.send('/api/strap/command',{name,input},cookie)
  assert.equal(r.status,status,r.text);assert.equal((await h.state()).version,version,'refusal has no writes');return r
}
const proof = async(h,stage,ana,extra={}) => {if(process.env.STRAP_PROOF_DIR) await(await import('./notices-browser.mjs')).noticesBrowser(h,{stage,ana,...extra})}

test('MSG-002: native member and desk booking, reschedule, cancellation, restore, substitution and grouped closure use local facts, studio text and once-only provider notices; courtesy suppression is audited',async()=>{
  const sent=[]
  await run(async h=>{
    await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
    await h.cmd('studio.save',{location:'Brooklyn Studio',timeZone:'America/New_York'})
    const coach=await h.person('Maya','instructor'),cover=await h.person('Noor','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben')
    for(const p of [ana,ben]) await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits:10,amountCents:18000,expiresAt:new Date(Date.now()+90*86400000).toISOString()})).id})
    await h.cmd('bookingRule.save',{cancelCutoffHours:12,lateCancelFeeCents:1500,lateCancelReturnsCredit:false})
    const template={prefix:'Welcome to Brooklyn Studio.',suffix:'Questions? Please call your studio.',requestId:'message-text'}
    await h.cmd('mail.templates.save',template)
    assert.deepEqual(await h.cmd('mail.templates.save',template),(await h.state()).messageTemplates)
    await refused(h,'mail.templates.save',{...template,requestId:'not-owner'},ana.cookie)
    await proof(h,'studio',ana)
    const start=new Date(Date.now()+7*86400000).toISOString()
    const first=await publish(h,coach,'Morning Mat',start),second=await publish(h,coach,'Evening Mat',new Date(Date.parse(start)+4*3600000).toISOString())
    const booking=await h.cmd('booking.book',{classId:first.id},ana.cookie)
    assert.equal(sent.length,1)
    const checkLetter=(letter,entry,instructor='Maya')=>{
      assert.match(letter.text,/Welcome to Brooklyn Studio\./);assert.match(letter.text,/Questions\? Please call your studio\./)
      assert.ok(letter.text.includes(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(entry.start))))
      assert.match(letter.text,/America\/New_York/);assert.match(letter.text,/Brooklyn Studio/);assert.ok(letter.text.includes('Instructor: '+instructor))
      assert.match(letter.text,/12 hours before start; late cancellation uses the credit, \$15\.00 fee/)
      assert.ok(letter.text.includes(h.origin+'/app'));assert.deepEqual(letter.to,[ana.email])
    }
    checkLetter(sent[0],first)
    assert.equal((await h.send(new URL(sent[0].text.match(/Open Strap: (\S+)/)[1]).pathname,undefined,ana.cookie)).status,200,'self-service link opens the authenticated member door')
    const count=sent.length
    await refused(h,'booking.book',{classId:first.id},ana.cookie,409);assert.equal(sent.length,count)
    await refused(h,'booking.move',{id:booking.id,classId:second.id},ben.cookie)
    await refused(h,'booking.move',{id:booking.id,classId:second.id,override:'Take held capacity'},ana.cookie)
    await proof(h,'booked',ana,{booking,second})
    if(!process.env.STRAP_PROOF_DIR) await h.cmd('booking.move',{id:booking.id,classId:second.id},ana.cookie)
    assert.equal((await h.state(ana.cookie)).bookings.find(b=>b.id===booking.id).classId,second.id)
    assert.equal(sent.length,2);checkLetter(sent.at(-1),second)
    await refused(h,'booking.move',{id:booking.id,classId:second.id},ana.cookie,400);assert.equal(sent.length,2)
    await h.cmd('booking.cancel',{id:booking.id},ana.cookie)
    assert.equal(sent.length,3);checkLetter(sent.at(-1),second)
    await refused(h,'booking.cancel',{id:booking.id},ana.cookie,409);assert.equal(sent.length,3)
    await h.cmd('booking.restore',{id:booking.id,reason:'Member requested original visit',requestId:'restore-visit',channel:'phone'})
    assert.equal(sent.length,4);checkLetter(sent.at(-1),second)
    const noWrites=(await h.state()).version
    await h.cmd('booking.restore',{id:booking.id,reason:'Member requested original visit',requestId:'restore-visit',channel:'phone'})
    assert.equal(sent.length,4);assert.equal((await h.state()).version,noWrites)
    await h.cmd('substitution.qualification.save',{instructorId:cover.id,service:'Mat',qualified:true,requestId:'qualify'})
    const request=await h.cmd('substitution.request',{classId:second.id,reason:'Instructor workshop',requestId:'cover'},coach.cookie)
    const draft=await h.cmd('substitution.prepare',{requestId:request.id,instructorId:cover.id})
    const approve={id:draft.id,impact:draft.impact.key}
    await h.cmd('substitution.approve',approve);await h.cmd('substitution.approve',approve)
    assert.equal(sent.length,5);checkLetter(sent.at(-1),second,'Noor')
    const courtesy=await h.cmd('booking.desk',{personId:ana.id,classId:first.id,requestId:'courtesy-booking',channel:'phone'})
    assert.equal(sent.length,6);checkLetter(sent.at(-1),first)
    await h.cmd('booking.desk',{personId:ana.id,classId:first.id,requestId:'courtesy-booking',channel:'phone'});assert.equal(sent.length,6)
    await h.cmd('booking.cancel',{id:courtesy.id,cancelReason:'Other',suppressNotice:true,suppressionReason:'Explained by phone',requestId:'courtesy-cancel',channel:'phone'})
    assert.equal(sent.length,6)
    const courtesyAction=(await h.state()).bookingActions.find(a=>a.bookingId===courtesy.id&&a.action==='cancel')
    assert.equal(courtesyAction.notice.status,'suppressed');assert.equal(courtesyAction.notice.suppressionReason,'Explained by phone')
    assert.equal((await h.state(ana.cookie)).notices.some(n=>n.id==='notice:action:'+courtesyAction.id),false)
    await h.cmd('booking.cancel',{id:booking.id,cancelReason:'Other',channel:'desk',requestId:'desk-cancel'})
    assert.equal(sent.length,7);checkLetter(sent.at(-1),second,'Noor')
    await h.cmd('booking.restore',{id:booking.id,reason:'Return to class',requestId:'restore-for-closure'})
    await h.cmd('booking.book',{classId:first.id},ana.cookie)
    const beforeClosure=sent.length
    const closure=await h.cmd('closure.prepare',{scope:'location',start:new Date(Date.parse(start)-1000).toISOString(),end:new Date(Date.parse(second.end)+1000).toISOString(),reason:'Building maintenance'})
    await h.cmd('closure.confirm',{id:closure.id,impact:closure.impact.key});await h.cmd('closure.confirm',{id:closure.id,impact:closure.impact.key})
    assert.equal(sent.length,beforeClosure+1,'one grouped email per affected member per closure')
    assert.ok(sent.at(-1).text.includes('Morning Mat'));assert.ok(sent.at(-1).text.includes('Evening Mat'));checkLetter(sent.at(-1),second,'Noor')
    const notices=(await h.state(ana.cookie)).notices.filter(n=>n.closureId===closure.id)
    assert.equal(notices.length,2)
    // Claiming a held offer creates a booking too, through either human door.
    await h.cmd('waitlist.save',{mode:'offer',claimMinutes:30,lateWindow:'promote'})
    const offerClass=await publish(h,coach,'Offer Mat',new Date(Date.parse(start)+86400000).toISOString(),'Offer room',1)
    const incumbent=await h.cmd('booking.book',{classId:offerClass.id},ben.cookie)
    const waiter=await h.cmd('booking.book',{classId:offerClass.id},ana.cookie)
    assert.match(sent.at(-1).subject,/Waitlist confirmed:/)
    await h.cmd('booking.cancel',{id:incumbent.id},ben.cookie)
    assert.equal((await h.state(ana.cookie)).bookings.find(b=>b.id===waiter.id).status,'offered')
    const beforeClaim=sent.length
    await h.cmd('booking.offer.accept',{id:waiter.id},ana.cookie)
    assert.equal(sent.length,beforeClaim+1,'member offer acceptance sends its confirmed-booking notice')
    assert.match(sent.at(-1).subject,/Booking confirmed:/);checkLetter(sent.at(-1),offerClass)
    await refused(h,'booking.offer.accept',{id:waiter.id},ana.cookie,409);assert.equal(sent.length,beforeClaim+1)
    const deliveries=await rows(h)
    assert.ok(deliveries.every(d=>d.status==='accepted'&&d.provider_message_id))
    assert.equal(new Set(sent.map(m=>m.key)).size,sent.length)
    assert.equal(new Set(deliveries.map(d=>d.source_kind+':'+d.source_id+':'+d.person_id)).size,deliveries.length)
    const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
    const kinds=portable.tables.st_records.map(r=>r.kind)
    assert.ok(kinds.includes('messageTemplates')&&kinds.includes('messageTemplateEvent'))
    assert.equal(portable.tables.st_notice_deliveries.length,deliveries.length)
    await proof(h,'closed',ana)
  },{auth:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'network-edge-test-key',MAIL_FROM:'studio@example.test'},outbound:async request=>{
    assert.equal(request.url,'https://api.resend.com/emails');sent.push({...await request.json(),key:request.headers.get('idempotency-key')});return Response.json({id:'message-'+sent.length})
  }})
})

test('MSG-002: only the member changes email opt-out; in-app notices and mandatory sign-in continue, provider failures stay honest and restore pauses delivery until explicit reconnection',async()=>{
  const sent=[]
  await run(async h=>{
    await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
    await h.cmd('studio.save',{location:'Brooklyn Studio',timeZone:'America/New_York'})
    const coach=await h.person('Maya','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben')
    for(const p of [ana,ben]) await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits:10,amountCents:18000,expiresAt:new Date(Date.now()+90*86400000).toISOString()})).id})
    const input={optedOut:true,requestId:'member-optout'}
    const disclosure=(await h.send('/app',undefined,ana.cookie)).text
    assert.match(disclosure,/Sign-in and security emails, payment receipts, failed-payment emails and required legal emails continue/)
    for(const cookie of [h.owner,coach.cookie]) await refused(h,'mail.preference.save',{...input,personId:ana.id},cookie)
    await refused(h,'mail.preference.save',{...input,personId:ben.id},ana.cookie)
    const key=await h.cmd('agent.create',{label:'No preference authority'})
    assert.equal((await h.send('/api/strap/agent/command',{name:'mail.preference.save',input},'',{authorization:'Bearer '+key.token})).status,403)
    const launchInput={personId:ana.id,requestId:'member-launch',channel:'phone'}
    const launch=await h.cmd('mail.preference.launch',launchInput)
    await h.cmd('mail.preference.launch',launchInput)
    assert.equal(launch.status,'member_action_required');assert.equal((await h.state(ana.cookie)).messagePreference.optedOut,false)
    assert.equal((await h.state()).staffActions.filter(a=>a.command==='mail.preference.launch').length,1)
    await proof(h,'staff',ana)
    await proof(h,'preferences',ana)
    if(!process.env.STRAP_PROOF_DIR) await h.cmd('mail.preference.save',input,ana.cookie)
    assert.equal((await h.state(ana.cookie)).messagePreference.optedOut,true)
    const saved=await h.cmd('mail.preference.save',input,ana.cookie)
    assert.deepEqual(await h.cmd('mail.preference.save',input,ana.cookie),saved)
    await refused(h,'mail.preference.save',{...input,optedOut:false},ana.cookie,409)
    assert.ok(await h.signIn(ana.email),'mandatory native sign-in email remains available while opted out')
    const start=new Date(Date.now()+8*86400000).toISOString(),entry=await publish(h,coach,'Quiet Mat',start)
    const b=await h.cmd('booking.book',{classId:entry.id},ana.cookie)
    assert.equal(sent.length,0);assert.equal((await rows(h)).at(-1).status,'opted_out')
    assert.ok((await h.state(ana.cookie)).notices.some(n=>n.bookingId===b.id))
    const closure=await h.cmd('closure.prepare',{scope:'class',classId:entry.id,reason:'Instructor unavailable'})
    await h.cmd('closure.confirm',{id:closure.id,impact:closure.impact.key})
    assert.equal(sent.length,0);assert.equal((await rows(h)).filter(d=>d.status==='opted_out').length,2)
    await refused(h,'mail.preference.save',{optedOut:false,personId:ana.id,requestId:'studio-reenable'},h.owner)
    await h.cmd('mail.preference.save',{optedOut:false,requestId:'member-reenable'},ana.cookie)
    const fail=await publish(h,coach,'Refused Mat',new Date(Date.parse(start)+4*3600000).toISOString())
    const rejected=await h.cmd('booking.book',{classId:fail.id},ana.cookie)
    assert.equal(sent.length,1);assert.equal((await rows(h)).find(d=>d.source_id===rejected.id).status,'rejected')
    assert.equal((await rows(h)).find(d=>d.source_id===rejected.id).provider,'resend')
    // The native restore writes this connection record unchanged on a new origin.
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.origin',?) WHERE id='member-mail'").bind('https://previous-installation.example').run()
    const paused=await h.cmd('booking.book',{classId:fail.id},ben.cookie)
    assert.equal((await rows(h)).find(d=>d.source_id===paused.id).status,'paused');assert.equal(sent.length,1)
    await h.cmd('mail.connect',{})
    await h.cmd('booking.cancel',{id:paused.id},ben.cookie)
    assert.equal(sent.length,2);assert.equal((await rows(h)).find(d=>d.source_id===paused.id).status,'paused','reconnect never replays historical email')
    const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
    assert.ok(portable.tables.st_records.some(r=>r.kind==='messagePreferenceEvent'&&JSON.parse(r.data).source==='member_session'))
    await proof(h,'outcome',ana)
  },{auth:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'network-edge-test-key'},outbound:async request=>{
    assert.equal(request.url,'https://api.resend.com/emails');const letter=await request.json();sent.push(letter)
    return sent.length===1 ? Response.json({message:'Provider rejected'},{status:422}) : Response.json({id:'accepted-'+sent.length})
  }})
})

test('MSG-002: the confirmation/reminder opt-out leaves waitlist-offer preferences to MSG-008 while templates apply to the offer and the accepted-booking confirmation stays opted out',async()=>{
 const sent=[]
 await run(async h=>{
  await h.cmd('studio.save',{location:'Brooklyn Studio',timeZone:'America/New_York'})
  await h.cmd('mail.templates.save',{prefix:'Your Brooklyn Studio update',suffix:'Please contact the studio for help.',requestId:'offer-template'})
  const coach=await h.person('Maya','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben')
  for(const p of [ana,ben]) await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits:2,amountCents:4000,expiresAt:new Date(Date.now()+90*86400000).toISOString()})).id})
  await h.cmd('waitlist.save',{mode:'offer',claimMinutes:30,lateWindow:'promote'})
  await h.cmd('mail.preference.save',{optedOut:true,requestId:'confirmation-optout'},ana.cookie)
  const entry=await publish(h,coach,'Held Mat',new Date(Date.now()+86400000).toISOString(),'Main',1)
  const incumbent=await h.cmd('booking.book',{classId:entry.id},ben.cookie)
  const waiter=await h.cmd('booking.book',{classId:entry.id},ana.cookie)
  assert.equal(sent.filter(m=>m.to.includes(ana.email)).length,0)
  await h.cmd('booking.cancel',{id:incumbent.id},ben.cookie)
  const offers=sent.filter(m=>m.to.includes(ana.email))
  assert.equal(offers.length,1,'this setting does not add the broader offer preference before MSG-008')
  assert.match(offers[0].subject,/Spot offered:/);assert.match(offers[0].text,/Your Brooklyn Studio update/)
  await h.cmd('booking.offer.accept',{id:waiter.id},ana.cookie)
  assert.equal(sent.filter(m=>m.to.includes(ana.email)).length,1,'the new booking confirmation honors the member opt-out')
  const deliveries=await rows(h)
  assert.deepEqual(deliveries.filter(d=>d.person_id===ana.id).map(d=>d.status).sort(),['accepted','opted_out','opted_out'])
 },{auth:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'network-edge-test-key'},outbound:async request=>{
  assert.equal(request.url,'https://api.resend.com/emails');sent.push(await request.json());return Response.json({id:'offer-message-'+sent.length})
 }})
})
