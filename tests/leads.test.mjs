import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

test('LEAD-002: assigned inquiry, overdue callback, evidenced first visit, external membership outcome and retained stage history through HTTP',{timeout:process.env.STRAP_PROOF_DIR?300000:120000},()=>run(async h=>{
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Brooklyn Studio',timeZone:'America/New_York'})
  const maya=await h.person('Maya','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben')
  const ownerId=(await h.state()).actor.id,dueAt=new Date(Date.now()+500).toISOString()
  const inquiry={requestId:'ana-inquiry',personId:ana.id,ownerId,nextAction:'Call about a two-week intro',dueAt,note:'Ana called to ask about morning mat classes.'}
  let lead=await h.cmd('lead.create',inquiry)
  assert.equal(lead.stage,'inquiry');assert.equal(lead.ownerId,ownerId)
  assert.deepEqual(await h.cmd('lead.create',inquiry),lead)
  const failed=async(name,input,cookie=h.owner,status=409)=>{
    const before=(await h.state()).version
    await h.cmd(name,input,cookie,status)
    assert.equal((await h.state()).version,before)
  }
  await failed('lead.create',{...inquiry,note:'Changed replay'})
  await failed('lead.create',{...inquiry,requestId:'wrong-owner',ownerId:maya.id})
  await new Promise(r=>setTimeout(r,Math.max(0,Date.parse(dueAt)-Date.now()+20)))
  let pipeline=(await h.state()).pipeline
  assert.equal(pipeline.overdue[0].id,lead.id);assert.equal(pipeline.stages.find(r=>r.stage==='inquiry').overdue,1)
  const fresh=()=>new Date(Date.now()+86400000).toISOString()
  const callback={id:lead.id,version:lead.version,requestId:'callback',nextAction:'Call Ana at her requested time',dueAt:fresh(),note:'Ana requested a callback tomorrow.'}
  lead=await h.cmd('lead.update',callback)
  assert.equal((await h.state()).pipeline.overdue.length,0)
  assert.equal(lead.nextAction,callback.nextAction)
  const start=new Date(Date.now()+3600000).toISOString(),end=new Date(Date.parse(start)+3600000).toISOString()
  const d=new Date(start),week=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)
  const c=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[{title:'Morning Mat',room:'Mat room',start,end,capacity:3,instructorId:maya.id}]})).id})).classes[0]
  await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:ana.id,credits:3,amountCents:4500,expiresAt:'2099-12-31T00:00:00Z'})).id})
  const booking=await h.cmd('booking.book',{classId:c.id},ana.cookie)
  const stage=async(stage,extra={})=>{
    lead=await h.cmd('lead.update',{id:lead.id,version:lead.version,requestId:'stage-'+stage,stage,nextAction:'Follow up after '+stage,dueAt:fresh(),...extra})
    const p=(await h.state()).pipeline
    assert.equal(p.stages.find(s=>s.stage===stage).count,1)
    assert.equal(p.leads.find(l=>l.id===lead.id).nextAction,lead.nextAction)
  }
  await stage('intro-booked',{bookingId:booking.id})
  await failed('lead.update',{id:lead.id,version:lead.version,requestId:'visit-too-soon',stage:'first-visit',bookingId:booking.id,nextAction:'Offer membership',dueAt:fresh()})
  await h.cmd('attendance.checkin',{id:booking.id},maya.cookie)
  await stage('first-visit',{bookingId:booking.id})
  await stage('offer',{note:'Discussed the studio monthly membership; Ana will review her existing contract.'})
  const convert={id:lead.id,version:lead.version,requestId:'conversion',stage:'membership',externalMembershipReference:'Studio contract ANA-2026-104',note:'Owner checked the signed membership in the studio external system.'}
  const before=await h.state();lead=await h.cmd('lead.update',convert)
  assert.deepEqual(await h.cmd('lead.update',convert),lead)
  const after=await h.state()
  assert.equal(lead.stage,'membership');assert.equal(lead.nextAction,null);assert.equal(lead.dueAt,null)
  assert.match(lead.externalOutcomeLabel,/external outcome/)
  assert.deepEqual(after.packs,before.packs);assert.deepEqual(after.charges,before.charges);assert.deepEqual(after.payments,before.payments)
  assert.equal(after.pipeline.queue.some(l=>l.id===lead.id),false)
  assert.equal(after.pipeline.stages.find(s=>s.stage==='membership').count,1)
  assert.deepEqual(after.pipeline.events.filter(e=>e.leadId===lead.id).map(e=>e.toStage),['inquiry','inquiry','intro-booked','first-visit','offer','membership'])
  assert.ok(after.pipeline.events.every(e=>e.actorId===ownerId&&e.at&&e.after))
  await failed('lead.update',{...convert,externalMembershipReference:'Changed contract'})
  await failed('lead.update',{id:lead.id,version:1,requestId:'stale',nextAction:'Stale edit',dueAt:fresh()})
  const other=await h.cmd('lead.create',{...inquiry,requestId:'ben-inquiry',personId:ben.id,dueAt:fresh()})
  await failed('lead.update',{id:other.id,version:other.version,requestId:'wrong-booking',stage:'intro-booked',bookingId:booking.id,nextAction:'Call',dueAt:fresh()})
  const lost=await h.cmd('lead.update',{id:other.id,version:other.version,requestId:'lost',stage:'lost',lostReason:'Moved outside the studio area',note:'Ben told the owner by phone.'})
  assert.equal(lost.lostReason,'Moved outside the studio area')
  const noted=await h.cmd('lead.note',{id:lead.id,version:lead.version,requestId:'conversation',note:'Ana confirmed her preferred class time in person.'})
  assert.equal(noted.stage,'membership')
  for(const p of [ana,maya]) {
    assert.equal((await h.state(p.cookie)).pipeline,null)
    assert.equal((await h.send('/app/leads',undefined,p.cookie)).status,403)
    await failed('lead.note',{id:lead.id,version:noted.version,requestId:'forbidden-'+p.id,note:'Private note'},p.cookie,403)
  }
  const key=await h.cmd('agent.create',{label:'Scheduling assistant'})
  const token=key.token
  const agent=await h.send('/api/strap/agent/context',undefined,'',{authorization:'Bearer '+token})
  assert.equal(agent.status,200,agent.text);assert.equal(agent.value.pipeline,null)
  const exit=await h.send('/api/strap/exit.json',undefined,h.owner)
  assert.equal(exit.status,200);assert.equal(exit.value.tables.st_records.filter(r=>r.kind==='lead').length,2)
  assert.deepEqual(exit.value.tables.st_records.filter(r=>r.kind==='leadEvent').map(r=>JSON.parse(r.data)).sort((a,b)=>a.id.localeCompare(b.id)),(await h.state()).pipeline.events.sort((a,b)=>a.id.localeCompare(b.id)))
  if(process.env.STRAP_PROOF_DIR) {const {leadsBrowser}=await import('./leads-browser.mjs');await leadsBrowser(h,{ana,ben,ownerId,lead})}
}))
