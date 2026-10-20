import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
const day=86400_000
const weekOf=at=>{const d=new Date(at);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)}

test('LEAD-006: member-owned consent, 50 corrected attended visits, once-only private recognition, opt-out suppression and audited staff launch through HTTP',()=>run(async h=>{
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'})
  const maya=await h.person('Maya','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben')
  const rule=await h.cmd('recognition.milestone.save',{threshold:50,label:'50 visits',enabled:true})
  await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:ana.id,credits:60,amountCents:90000,expiresAt:'2099-12-31T00:00:00Z'})).id})
  const date=new Date(Date.now()+7*day).toISOString().slice(0,10),end=new Date(Date.parse(date+'T12:00:00Z')+48*7*day).toISOString().slice(0,10)
  const classes=(await h.cmd('series.publish',{id:(await h.cmd('series.prepare',{startDate:date,endDate:end,intervalWeeks:1,time:'09:00',minutes:50,title:'Weekly Yoga',service:'Yoga',room:'Mat room',instructorId:maya.id,capacity:12})).id})).classes
  assert.equal(classes.length,49)
  for(const c of classes){const b=await h.cmd('booking.book',{classId:c.id},ana.cookie);await h.cmd('attendance.checkin',{id:b.id},maya.cookie)}
  assert.equal((await h.state()).recognition.recognitions.length,0,'attendance alone never invents consent')
  const start=new Date(Date.now()+5000).toISOString()
  const last=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:weekOf(start),classes:[{title:'Attendance correction visit',service:'Yoga',room:'Mat room',start,end:new Date(Date.parse(start)+300000).toISOString(),capacity:12,instructorId:maya.id}]})).id})).classes[0]
  const finalBooking=await h.cmd('booking.book',{classId:last.id},ana.cookie)
  const launchInput={personId:ana.id,requestId:'recognition-choice',channel:'phone'}
  const launch=await h.cmd('recognition.launch',launchInput)
  assert.equal(launch.preferenceDoor,true)
  assert.deepEqual(await h.cmd('recognition.launch',launchInput),launch)
  assert.equal((await h.state()).staffActions.filter(a=>a.command==='recognition.launch'&&a.personId===ana.id).length,1)
  assert.equal((await h.state(ana.cookie)).recognition.preferences[0].optedIn,false,'launch does not opt in')
  const refused=async(name,input,cookie)=>{const before=(await h.state()).version;const r=await h.send('/api/strap/command',{name,input},cookie);assert.equal(r.status,403,r.text);assert.equal((await h.state()).version,before)}
  await refused('recognition.preference.save',{personId:ana.id,optedIn:true,version:0},h.owner)
  await refused('recognition.preference.save',{personId:ana.id,optedIn:true,version:0},ben.cookie)
  await refused('recognition.launch',launchInput,maya.cookie)
  let pref=await h.cmd('recognition.preference.save',{optedIn:true,version:0},ana.cookie)
  assert.equal(pref.optedIn,true)
  assert.equal((await h.state()).recognition.recognitions.length,0,'a reservation without attendance is not a visit')
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(start)-Date.now()+50)))
  await h.cmd('attendance.noshow',{id:finalBooking.id},maya.cookie)
  assert.equal((await h.state()).recognition.recognitions.length,0)
  await h.cmd('attendance.correct',{id:finalBooking.id,outcome:'attended',reason:'Instructor confirmed the missed check-in'})
  let s=await h.state(),task=s.recognition.recognitions[0]
  assert.equal(s.recognition.recognitions.length,1)
  assert.equal(task.personId,ana.id);assert.equal(task.threshold,50);assert.equal(task.status,'open')
  assert.equal(task.sourceBookingIds.length,50)
  assert.ok(task.sourceBookingIds.includes(finalBooking.id))
  for(const id of task.sourceBookingIds)assert.equal(s.bookings.find(b=>b.id===id).attendance,'attended')
  for(let i=0;i<3;i++)await h.cmd('recognition.process',{})
  assert.equal((await h.state()).recognition.recognitions.length,1)
  assert.equal((await h.send('/api/strap/command',{name:'attendance.correct',input:{id:finalBooking.id,outcome:'attended',reason:'Replay'}},h.owner)).status,409)
  const edited=await h.cmd('recognition.milestone.save',{id:rule.id,version:rule.version,threshold:50,label:'Fifty visits together',enabled:true})
  assert.equal(edited.id,rule.id)
  assert.equal((await h.state()).recognition.recognitions.length,1,'label revisions never reset milestone identity')
  pref=await h.cmd('recognition.preference.save',{optedIn:false,version:pref.version},ana.cookie)
  s=await h.state();assert.equal(s.recognition.recognitions[0].status,'suppressed')
  const beforeComplete=s.version
  assert.equal((await h.send('/api/strap/command',{name:'recognition.complete',input:{id:task.id,version:task.version,requestId:'suppressed-completion'}},h.owner)).status,409)
  assert.equal((await h.state()).version,beforeComplete)
  pref=await h.cmd('recognition.preference.save',{optedIn:true,version:pref.version},ana.cookie)
  await h.cmd('recognition.process',{})
  assert.equal((await h.state()).recognition.recognitions.length,1,'re-opt-in never repeats recognition')
  for(const p of [ana,ben,maya]){
    const current=await h.state(p.cookie)
    assert.equal(current.recognition.recognitions.length,0,'private owner tasks never reach members or instructors')
    assert.ok(current.recognition.preferences.every(r=>r.personId===p.id))
  }
  assert.equal((await h.state(maya.cookie)).recognition.preferences.length,0)
  assert.equal((await h.send('/app/recognition',undefined,maya.cookie)).status,403)
  await refused('recognition.process',{},ana.cookie)
  await refused('recognition.milestone.save',{threshold:1,label:'Forged',enabled:true},maya.cookie)
  await h.cmd('recognition.milestone.save',{threshold:49,label:'Consistent practice',enabled:true})
  const followup=(await h.state()).recognition.recognitions.find(r=>r.threshold===49)
  const completion={id:followup.id,version:followup.version,requestId:'owner-followup'}
  await refused('recognition.complete',completion,ana.cookie)
  const completed=await h.cmd('recognition.complete',completion)
  assert.equal(completed.status,'completed')
  assert.deepEqual(await h.cmd('recognition.complete',completion),completed)
  assert.equal((await h.send('/api/strap/command',{name:'recognition.complete',input:{...completion,id:task.id}},h.owner)).status,409)
  assert.equal((await h.state()).recognition.recognitions.filter(r=>r.threshold===50).length,1)
  const mailCount=(await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n
  await h.cmd('recognition.process',{})
  assert.equal((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n,mailCount,'processing never sends recognition mail')
  const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
  const records=portable.tables.st_records.map(r=>({kind:r.kind,data:JSON.parse(r.data)}))
  assert.ok(records.some(r=>r.kind==='recognition'&&r.data.id===task.id))
  assert.ok(records.some(r=>r.kind==='recognitionPreference'&&r.data.personId===ana.id))
  if(process.env.STRAP_PROOF_DIR)await(await import('./recognition-browser.mjs')).recognitionBrowser(h,{ana,ben,maya,pref,task,rule:edited})
}))
