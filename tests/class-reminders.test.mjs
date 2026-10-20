import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
const minute=60000
const at=minutes=>new Date(Date.now()+minutes*minute).toISOString()
const weekOf=instant=>{const d=new Date(instant);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)}
const tick=async h=>(await h.mf.getWorker()).scheduled({cron:'* * * * *'})
async function refused(h,name,input,cookie,status=403) {
 const before=(await h.state()).version,r=await h.send('/api/strap/command',{name,input},cookie)
 assert.equal(r.status,status,r.text);assert.equal((await h.state()).version,before,'refusal writes nothing');return r
}
const deliveries=async h=>(await h.db.prepare("SELECT * FROM st_notice_deliveries WHERE source_kind='reminder' ORDER BY person_id").all()).results
async function proof(h,stage,ana) {if(process.env.STRAP_PROOF_DIR) await(await import('./class-reminders-browser.mjs')).classRemindersBrowser(h,{stage,ana})}

test('MSG-003: current-time email reminders replace obsolete schedules, obey service rules and member choice, reserve once across replay and expose a private failed-channel follow-up',async()=>{
 const sent=[]
 await run(async h=>{
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Brooklyn Studio',timeZone:'America/New_York'})
  await h.cmd('mail.templates.save',{prefix:'Class day at Brooklyn.',suffix:'See you in the studio.',requestId:'reminder-message-text'})
  const coach=await h.person('Maya','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben'),cy=await h.person('Cy'),dee=await h.person('Dee'),eve=await h.person('Eve')
  for(const member of [ana,ben,cy,dee,eve]) await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z'})).id})
  const publish=async(title,start,service='Mat')=>(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:weekOf(start),classes:[{title,service,start,end:new Date(Date.parse(start)+20*minute).toISOString(),room:title,capacity:8,instructorId:coach.id}]})).id})).classes[0]
  const original=await publish('Later Mat',at(180)),revised=await publish('Earlier Mat',at(30))
  const input={service:'',enabled:true,leadMinutes:60,revision:0,requestId:'studio-reminders'}
  await refused(h,'reminder.rule.save',input,ana.cookie)
  await refused(h,'reminder.rule.save',input,coach.cookie)
  const key=await h.cmd('agent.create',{label:'No reminder policy authority'})
  assert.equal((await h.send('/api/strap/agent/command',{name:'reminder.rule.save',input},'',{authorization:'Bearer '+key.token})).status,403)
  const rule=await h.cmd('reminder.rule.save',input)
  assert.deepEqual(await h.cmd('reminder.rule.save',input),rule)
  await refused(h,'reminder.rule.save',{...input,leadMinutes:15},h.owner,409)
  const booking=await h.cmd('booking.book',{classId:original.id},ana.cookie)
  await tick(h);assert.equal(sent.length,0,'original future reminder is not due')
  await h.cmd('booking.move',{id:booking.id,classId:revised.id,requestId:'member-reschedule'},ana.cookie)
  await proof(h,'rules',ana)
  await tick(h);await tick(h)
  assert.equal(sent.length,1)
  assert.match(sent[0].subject,/Class reminder: Earlier Mat/);assert.match(sent[0].text,/Class day at Brooklyn\./)
  assert.match(sent[0].text,/America\/New_York/);assert.match(sent[0].text,/Instructor: Maya/)
  assert.ok(sent[0].text.includes(h.origin+'/app'))
  const local=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(revised.start))
  assert.ok(sent[0].text.includes(local))
  assert.equal((await deliveries(h)).filter(d=>d.person_id===ana.id).length,1)
  const anaNotice=(await h.state(ana.cookie)).notices.filter(n=>n.reminderId)
  assert.equal(anaNotice.length,1);assert.equal(anaNotice[0].classId,revised.id)
  await h.cmd('notice.dismiss',{id:anaNotice[0].id},ana.cookie)
  assert.ok((await h.state(ana.cookie)).notices.find(n=>n.id===anaNotice[0].id).dismissedAt,'reminder notices work through the ordinary dismiss door')
  await h.cmd('booking.book',{classId:revised.id},ben.cookie)
  await tick(h);await tick(h)
  assert.equal(sent.length,2,'a failed provider channel is not retried')
  let tasks=(await h.state()).reminderTasks
  assert.equal(tasks.length,1);assert.equal(tasks[0].personId,ben.id);assert.equal(tasks[0].deliveryStatus,'rejected')
  assert.deepEqual((await h.state(ana.cookie)).reminderTasks,[],'members cannot read private follow-up tasks')
  assert.deepEqual((await h.state(coach.cookie)).classReminderRules,[])
  await refused(h,'reminder.task.complete',{id:tasks[0].id,reason:'Called member',requestId:'forbidden-task'},ben.cookie)
  await proof(h,'failure',ana)
  if(!process.env.STRAP_PROOF_DIR) await h.cmd('reminder.task.complete',{id:tasks[0].id,reason:'Called the member',requestId:'called-member'})
  assert.equal((await h.state()).reminderTasks[0].status,'completed')
  assert.equal(sent.length,2,'completing follow-up does not send a message')
  await h.cmd('mail.preference.save',{optedOut:true,requestId:'quiet-reminders'},cy.cookie)
  const quiet=await h.cmd('booking.book',{classId:revised.id},cy.cookie)
  const canceled=await h.cmd('booking.book',{classId:revised.id},dee.cookie)
  await h.cmd('booking.cancel',{id:canceled.id},dee.cookie)
  await tick(h)
  assert.equal(sent.length,2)
  assert.equal((await deliveries(h)).find(d=>d.person_id===cy.id).status,'opted_out')
  assert.ok((await h.state(cy.cookie)).notices.some(n=>n.reminderId&&n.bookingId===quiet.id))
  assert.equal((await deliveries(h)).some(d=>d.person_id===dee.id),false,'canceled bookings have no reminder')
  assert.equal((await h.state()).reminderTasks.length,1,'opt-out creates no failed-channel task')
  const serviceRule=await h.cmd('reminder.rule.save',{service:'Restorative',enabled:false,leadMinutes:60,revision:0,requestId:'disable-restorative'})
  const gentle=await publish('Gentle class',at(55),'  restorative  ')
  await h.cmd('booking.book',{classId:gentle.id},eve.cookie)
  await tick(h);assert.equal(sent.length,2,'a disabled normalized service rule overrides enabled studio default')
  await h.cmd('reminder.rule.save',{service:'Restorative',enabled:true,leadMinutes:60,revision:serviceRule.revision,requestId:'enable-restorative'})
  await tick(h);assert.equal(sent.length,3)
  await h.cmd('reminder.rule.save',{...input,revision:rule.revision,leadMinutes:120,requestId:'longer-lead'})
  await Promise.allSettled([tick(h),tick(h)])
  assert.equal(sent.length,3,'rule edits and concurrent cron replay never issue another reminder for the same occurrence')
  const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
  const reminders=portable.tables.st_records.filter(r=>r.kind==='classReminder').map(r=>JSON.parse(r.data))
  assert.equal(reminders.some(r=>r.bookingId===booking.id&&r.classId===original.id),false,'obsolete schedule has no dispatch identity')
  assert.equal(reminders.filter(r=>r.personId===ana.id).length,1)
  assert.ok(portable.tables.st_records.some(r=>r.kind==='reminderTaskEvent'))
  assert.ok((await deliveries(h)).every(d=>d.status==='accepted'||d.status==='rejected'||d.status==='opted_out'))
  assert.equal(new Set(sent.map(m=>m.key)).size,sent.length)
  await proof(h,'member',ana)
 },{auth:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'network-edge-test-key'},outbound:async request=>{
  assert.equal(request.url,'https://api.resend.com/emails')
  const letter={...await request.json(),key:request.headers.get('idempotency-key')}
  if(!letter.subject.startsWith('Class reminder:')) return Response.json({id:letter.key})
  sent.push(letter)
  return letter.to.includes('ben@studio.example')?Response.json({message:'Provider rejected'},{status:422}):Response.json({id:'reminder-'+sent.length})
 }})
})
