import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const weekOf = at => {const d=new Date(at);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)}
const publish = async(h,input)=>(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:weekOf(input.start),classes:[input]})).id})).classes[0]
test('SCHED-004: qualified substitute approval transfers roster and pay with exact once-only notices and stale preview refusal', {timeout:process.env.STRAP_PROOF_DIR?600_000:120_000},()=>{
  const mails=[]
  return run(async h=>{
    await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
    await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'})
    const original=await h.person('Original','instructor'),cover=await h.person('Cover','instructor'),busy=await h.person('Busy','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben')
    for(const member of [ana,ben])await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:10,amountCents:18000,expiresAt:'2099-12-31T00:00:00Z'})).id})
    const start=new Date(Date.now()+25_000).toISOString(),end=new Date(Date.parse(start)+2000).toISOString()
    const rate=await h.cmd('pay.rule.save',{service:'Mat',effectiveAt:new Date(Date.now()+2000).toISOString(),mode:'flat-class',rateCents:4000,minimumCents:0,cancellation:{treatment:'full'},substitute:{mode:'flat-class',rateCents:6500,minimumCents:0}})
    const entry=await publish(h,{title:'Mat Flow',service:'Mat',room:'Main',start,end,capacity:3,instructorId:original.id})
    const conflicting=await publish(h,{title:'Busy Flow',service:'Mat',room:'Annex',start,end,capacity:3,instructorId:busy.id})
    const booking=await h.cmd('booking.book',{classId:entry.id},ana.cookie)
    const denied=async(name,input,cookie,status=403,error)=>{
      const before=(await h.state()).version,r=await h.send('/api/strap/command',{name,input},cookie)
      assert.equal(r.status,status,r.text);if(error)assert.match(r.value.error,error)
      assert.equal((await h.state()).version,before,'refused commands write nothing');return r
    }
    await denied('substitution.request',{classId:entry.id,reason:'Coverage needed',requestId:'not-assigned'},cover.cookie)
    await denied('substitution.request',{classId:entry.id,reason:'Coverage needed',requestId:'member'},ana.cookie)
    const input={classId:entry.id,reason:'Teaching workshop',requestId:'coverage-request'}
    const request=await h.cmd('substitution.request',input,original.cookie)
    assert.deepEqual(await h.cmd('substitution.request',input,original.cookie),request)
    await denied('substitution.request',{...input,reason:'Different reason'},original.cookie,409,/request_changed/)
    assert.equal((await h.state()).classes.find(c=>c.id===entry.id).instructorId,original.id)
    assert.equal((await h.state(cover.cookie)).substitutions.requests.length,0)
    for(const cookie of [ana.cookie,ben.cookie])assert.deepEqual((await h.state(cookie)).substitutions,{qualifications:[],requests:[],drafts:[],candidates:[]})
    await denied('substitution.prepare',{requestId:request.id,instructorId:cover.id},h.owner,409,/qualification_required/)
    for(const p of [cover,busy])await h.cmd('substitution.qualification.save',{instructorId:p.id,service:'Mat',qualified:true,requestId:'qualify-'+p.id})
    await denied('substitution.prepare',{requestId:request.id,instructorId:busy.id},h.owner,409,/Scheduling conflict/)
    const candidates=(await h.state()).substitutions.candidates
    assert.equal(candidates.find(c=>c.instructorId===busy.id).available,false)
    assert.equal(candidates.find(c=>c.instructorId===cover.id).qualified,true)
    let draft=await h.cmd('substitution.prepare',{requestId:request.id,instructorId:cover.id})
    assert.deepEqual(await h.cmd('substitution.prepare',{requestId:request.id,instructorId:cover.id}),draft,'unchanged previews reuse the exact draft')
    assert.deepEqual([draft.impact.notices,draft.impact.creditsChanged,draft.impact.moneyMoved],[1,0,0])
    assert.equal(draft.pay.ruleId,rate.id);assert.equal(draft.pay.rate.rateCents,6500)
    await denied('substitution.approve',{id:draft.id,impact:draft.impact.key},original.cookie)
    await denied('substitution.qualification.save',{instructorId:cover.id,service:'Mat',qualified:true,requestId:'bad-grant'},cover.cookie)
    await h.cmd('substitution.qualification.save',{instructorId:cover.id,service:'Mat',qualified:false,requestId:'revoke'})
    await denied('substitution.approve',{id:draft.id,impact:draft.impact.key},h.owner,409,/facts_changed/)
    await h.cmd('substitution.qualification.save',{instructorId:cover.id,service:'Mat',qualified:true,requestId:'restore'})
    draft=await h.cmd('substitution.prepare',{requestId:request.id,instructorId:cover.id})
    assert.doesNotMatch(draft.impact.classes[0].bookings[0].body,/undefined/,'ordinary-class notices use the authoritative studio location')
    await h.cmd('booking.book',{classId:entry.id},ben.cookie)
    await denied('substitution.approve',{id:draft.id,impact:draft.impact.key},h.owner,409,/facts_changed/)
    draft=await h.cmd('substitution.prepare',{requestId:request.id,instructorId:cover.id})
    await denied('substitution.approve',{id:draft.id,impact:'changed'},h.owner,409,/preview_changed/)
    const before=await h.state(),approved=await h.cmd('substitution.approve',{id:draft.id,impact:draft.impact.key})
    assert.deepEqual(await h.cmd('substitution.approve',{id:draft.id,impact:draft.impact.key}),approved)
    const after=await h.state(),assigned=after.classes.find(c=>c.id===entry.id)
    assert.equal(assigned.instructorId,cover.id);assert.equal(assigned.substitution.originalInstructorId,original.id)
    const profile=await h.send('/app/people?person='+ana.id,undefined,h.owner)
    assert.equal(profile.status,200,profile.text)
    assert.equal(assigned.substitution.id,draft.id);assert.equal(assigned.substitutionHistory.length,1)
    assert.deepEqual(after.packs.map(p=>p.remaining),before.packs.map(p=>p.remaining))
    assert.equal(mails.length,2);assert.equal(new Set(mails.map(m=>m.key)).size,2)
    assert.equal(after.bookingActions.filter(a=>a.seriesChangeId===draft.id).length,2)
    for(const member of [ana,ben]){
      const notices=(await h.state(member.cookie)).notices.filter(n=>n.seriesChangeId===draft.id)
      assert.equal(notices.length,1);assert.equal(notices[0].body,draft.impact.classes[0].bookings.find(b=>b.personId===member.id).body)
    }
    assert.equal((await h.state(original.cookie)).bookings.some(b=>b.id===booking.id),false)
    assert.equal((await h.state(cover.cookie)).bookings.some(b=>b.id===booking.id),true)
    await denied('attendance.checkin',{id:booking.id},original.cookie)
    await h.cmd('attendance.checkin',{id:booking.id},cover.cookie)
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(end)-Date.now()+50)))
    const report=await h.send('/api/strap/teaching-pay',undefined,cover.cookie)
    const earned=report.value.rows.find(r=>r.classId===entry.id)
    assert.equal(earned.totalCents,6500);assert.equal(earned.substitute,true);assert.equal(earned.ruleId,rate.id)
    assert.equal((await h.send('/api/strap/teaching-pay',undefined,original.cookie)).value.rows.some(r=>r.classId===entry.id),false)
    const key=await h.cmd('agent.create',{label:'Denied substitution agent'})
    const agent=await h.send('/api/strap/agent/command',{name:'substitution.approve',input:{id:draft.id,impact:draft.impact.key}},'',{authorization:'Bearer '+key.token})
    assert.equal(agent.status,403)
    const records=(await h.send('/api/strap/exit.json',undefined,h.owner)).value.tables.st_records.map(r=>({kind:r.kind,data:JSON.parse(r.data)}))
    assert.ok(records.some(r=>r.kind==='substitutionRequest'&&r.data.id===request.id))
    assert.ok(records.some(r=>r.kind==='substitutionDraft'&&r.data.id===draft.id&&r.data.status==='approved'))
    assert.ok(records.some(r=>r.kind==='substitutionQualification'&&r.data.instructorId===cover.id))
    if(process.env.STRAP_PROOF_DIR)await(await import('./substitutions-browser.mjs')).substitutionsBrowser(h,{original,cover,member:ana,publish})
    assert.ok(conflicting.id)
  },{auth:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'test-only-key'},outbound:async request=>{
    assert.equal(request.url,'https://api.resend.com/emails');mails.push({...await request.json(),key:request.headers.get('idempotency-key')});return Response.json({id:'substitution_'+mails.length})
  }})
})
