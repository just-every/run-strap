import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const weekOf = at => { const d=new Date(at); return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10) }

test('STAFF-002: versioned teaching compensation, corrected attendance, minimums, cancellation treatment and exact reasoned adjustments through HTTP', {timeout:process.env.STRAP_PROOF_DIR?600_000:120_000},()=>run(async h=>{
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'})
  const maya=await h.person('Maya','instructor'),leo=await h.person('Leo','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben')
  for(const p of [ana,ben])await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits:20,amountCents:30000,expiresAt:'2099-12-31T00:00:00Z'})).id})
  const start=new Date(Date.now()+18_000).toISOString(),effectiveAt=new Date(Date.now()+8_000).toISOString()
  const spec=(service,mode,extra={})=>({service,effectiveAt,mode,...(mode==='tiered'?{}:{rateCents:2500}),minimumCents:0,cancellation:{treatment:'none'},...extra})
  const specs=[spec('Full','flat-class'),spec('Low','per-attendee',{rateCents:800,minimumCents:1800}),spec('Tier','tiered',{tiers:[{upTo:1,rateCents:1200},{upTo:null,rateCents:500}]}),spec('Hour','hourly',{rateCents:3600}),spec('Canceled','flat-class',{cancellation:{treatment:'flat',amountCents:900}})]
  const rules=[]
  for(const s of specs)rules.push(await h.cmd('pay.rule.save',s))
  const classes=[]
  for(let i=0;i<specs.length;i++){
    const instructorId=i%2?leo.id:maya.id,at=new Date(Date.parse(start)+i*3000).toISOString(),end=new Date(Date.parse(at)+2000).toISOString()
    const c=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:weekOf(at),classes:[{title:specs[i].service+' Flow',service:specs[i].service,room:'Room '+i,start:at,end,capacity:2,instructorId}]})).id})).classes[0]
    classes.push(c)
    if(i!==4)for(const p of (i===1?[ana]:[ana,ben])){
      const b=await h.cmd('booking.book',{classId:c.id},p.cookie)
      if(i!==0 || p===ana)await h.cmd('attendance.checkin',{id:b.id},instructorId===maya.id?maya.cookie:leo.cookie)
    }
  }
  const closure=await h.cmd('closure.prepare',{scope:'class',classId:classes[4].id,reason:'Studio holiday'})
  await h.cmd('closure.confirm',{id:closure.id,impact:closure.impact.key})
  const denied=async(name,input,cookie)=>{
    const before=(await h.state()).version
    assert.equal((await h.send('/api/strap/command',{name,input},cookie)).status,403)
    assert.equal((await h.state()).version,before)
  }
  await denied('pay.rule.save',spec('Denied','flat-class'),ana.cookie)
  await denied('pay.rule.save',spec('Denied','flat-class'),maya.cookie)
  assert.equal((await h.send('/api/strap/teaching-pay',undefined,ana.cookie)).status,403)
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(classes[3].end)-Date.now()+50)))
  const report=async cookie=>{const r=await h.send('/api/strap/teaching-pay',undefined,cookie);assert.equal(r.status,200,r.text);return r.value}
  let pay=await report(h.owner)
  const row=id=>pay.rows.find(r=>r.classId===id)
  assert.deepEqual(classes.map(c=>row(c.id).totalCents),[2500,1800,1700,2,900])
  assert.equal(pay.totalCents,6902)
  assert.equal((await report(maya.cookie)).rows.every(r=>r.instructorId===maya.id),true)
  assert.equal((await report(leo.cookie)).rows.every(r=>r.instructorId===leo.id),true)
  const missed=(await h.state()).bookings.find(b=>b.classId===classes[0].id&&b.personId===ben.id)
  await h.cmd('attendance.noshow',{id:missed.id},maya.cookie)
  await h.cmd('attendance.correct',{id:missed.id,outcome:'attended',reason:'Attendance sheet confirms the visit'})
  pay=await report(h.owner);assert.equal(row(classes[0].id).attendees,2)
  const adjustment={classId:classes[0].id,instructorId:maya.id,amountCents:350,reason:'Agreed extra setup time',requestId:'extra-setup'}
  await denied('pay.adjust',adjustment,maya.cookie)
  const adjusted=await h.cmd('pay.adjust',adjustment)
  assert.deepEqual(await h.cmd('pay.adjust',adjustment),adjusted)
  assert.equal((await h.send('/api/strap/command',{name:'pay.adjust',input:{...adjustment,amountCents:351}},h.owner)).status,409)
  pay=await report(h.owner);assert.equal(row(classes[0].id).totalCents,2850)
  assert.equal(row(classes[0].id).ruleId,rules[0].id)
  assert.ok(row(classes[0].id).bookingIds.includes(missed.id))
  const revised=await h.cmd('pay.rule.save',{...spec('Full','flat-class'),effectiveAt:new Date(Date.now()+3600_000).toISOString(),rateCents:4000})
  pay=await report(h.owner);assert.equal(row(classes[0].id).ruleId,rules[0].id);assert.notEqual(revised.id,rules[0].id)
  assert.equal((await h.send('/app/teaching-pay',undefined,maya.cookie)).status,200)
  const unknownStart=new Date(Date.now()+86400_000).toISOString()
  const unknown=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:weekOf(unknownStart),classes:[{title:'Unconfigured Workshop',service:'Workshop',room:'Annex',start:unknownStart,end:new Date(Date.parse(unknownStart)+3600_000).toISOString(),capacity:5,instructorId:maya.id}]})).id})).classes[0]
  const unknownClosure=await h.cmd('closure.prepare',{scope:'class',classId:unknown.id,reason:'Instructor unavailable'})
  await h.cmd('closure.confirm',{id:unknownClosure.id,impact:unknownClosure.impact.key})
  const incomplete=await report(h.owner)
  assert.equal(incomplete.totalCents,null,'unconfigured compensation is never silently counted as zero')
  assert.equal(incomplete.rows.find(r=>r.classId===unknown.id).status,'unconfigured')
  assert.equal(incomplete.configuredTotalCents,7252)
  const filtered=await h.send('/api/strap/teaching-pay?from='+encodeURIComponent(start)+'&to='+encodeURIComponent(classes[3].end),undefined,h.owner)
  assert.equal(filtered.status,200)
  assert.equal(filtered.value.rows.some(r=>r.classId===unknown.id),false)
  const privateQuery=await h.send('/api/strap/teaching-pay?instructorId='+leo.id,undefined,maya.cookie)
  assert.equal(privateQuery.value.rows.every(r=>r.instructorId===maya.id),true,'query parameters cannot widen instructor authority')
  for(const bad of [{...spec('Bad','tiered'),tiers:[{upTo:1,rateCents:100}]},{...spec('Bad','flat-class'),effectiveAt:new Date(Date.now()-1000).toISOString()},{...spec('Bad','hourly'),rateCents:0.5}])assert.ok((await h.send('/api/strap/command',{name:'pay.rule.save',input:bad},h.owner)).status>=400)

  const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
  const records=portable.tables.st_records.map(r=>({kind:r.kind,data:JSON.parse(r.data)}))
  assert.ok(records.some(r=>r.kind==='payRule'&&r.data.id===rules[0].id))
  assert.ok(records.some(r=>r.kind==='payAdjustment'&&r.data.id===adjusted.id))
  if(process.env.STRAP_PROOF_DIR)await(await import('./teaching-pay-browser.mjs')).teachingPayBrowser(h,maya)
}))
