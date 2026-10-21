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

test('RPT-005: first-source inquiries reconcile to retained stages and corrected visits without invented sales',{timeout:120000},()=>run(async h=>{
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  const coach=await h.person('Elena','instructor'),ana=await h.person('Priya'),ben=await h.person('Jules'),cy=await h.person('Morgan')
  const ownerId=(await h.state()).actor.id
  const create=async(person,requestId,source)=>h.cmd('lead.create',{personId:person.id,ownerId,requestId,source,nextAction:'Call after first class',dueAt:new Date(Date.now()-3600000).toISOString()})
  const lead=await create(ana,'source-one','Community event'),other=await create(ben,'source-two','Phone'),unknown=await create(cy,'unknown')
  assert.equal(lead.source,'Community event')
  const duplicate=await create(ana,'second-inquiry','Phone')
  await h.cmd('lead.update',{id:other.id,version:other.version,requestId:'lost',stage:'lost',lostReason:'Chose another studio'})
  await h.cmd('lead.update',{id:lead.id,version:lead.version,requestId:'change-source',source:'Paid campaign'},h.owner,409)
  const start=new Date(Date.now()+10000).toISOString(),d=new Date(start)
  const week=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)
  const classes=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[0,1,2].map(i=>({title:['First Mat','Second Mat','Future Mat'][i],room:'Room '+i,start:new Date(Date.parse(start)+(i===2?3600000:i*1000)).toISOString(),end:new Date(Date.parse(start)+(i===2?7200000:(i+1)*1000)).toISOString(),capacity:4,instructorId:coach.id}))})).id})).classes
  for(const person of [ana,ben]) await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:person.id,credits:4,amountCents:6000,expiresAt:'2099-12-31T00:00:00Z'})).id})
  const visits=[]
  for(const c of classes) visits.push(await h.cmd('booking.book',{classId:c.id},ana.cookie))
  const noShow=await h.cmd('booking.book',{classId:classes[0].id},ben.cookie)
  let l=await h.cmd('lead.update',{id:lead.id,version:lead.version,requestId:'intro',stage:'intro-booked',bookingId:visits[0].id,nextAction:'Meet at first class',dueAt:new Date(Date.now()+86400000).toISOString()})
  await h.cmd('attendance.checkin',{id:visits[0].id},coach.cookie)
  await h.cmd('attendance.checkin',{id:visits[2].id},coach.cookie)
  l=await h.cmd('lead.update',{id:l.id,version:l.version,requestId:'first',stage:'first-visit',bookingId:visits[0].id,nextAction:'Ask about ongoing classes',dueAt:new Date(Date.now()+86400000).toISOString()})
  await h.cmd('lead.update',{id:l.id,version:l.version,requestId:'external',stage:'membership',externalMembershipReference:'EXTERNAL-PRIYA',note:'Owner checked the external agreement'})
  const read=async(query='')=>{const r=await h.send('/api/strap/reports/leads'+query,undefined,h.owner);assert.equal(r.status,200,r.text);return r.value}
  assert.equal((await read()).totals.firstVisits,0,'future check-ins are not completed visits')
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(start)+1000-Date.now()+30)))
  await h.cmd('attendance.noshow',{id:noShow.id},coach.cookie)
  await h.cmd('attendance.noshow',{id:visits[1].id},coach.cookie)
  let report=await read(),row=report.rows.find(r=>r.personId===ana.id)
  assert.deepEqual([report.totals.members,report.totals.inquiries,report.totals.firstVisits,report.totals.repeatAttendance,report.totals.externalOutcomes],[3,4,1,0,1])
  assert.deepEqual(new Set(row.leadIds),new Set([lead.id,duplicate.id]))
  assert.deepEqual(row.attendedBookingIds,[visits[0].id])
  assert.equal(report.sources.find(r=>r.source==='Phone').members,1,'later inquiries do not reattribute a member')
  assert.equal(report.sources.find(r=>r.source===null).members,1)
  assert.deepEqual([report.totals.incompleteFollowUps,report.totals.overdueFollowUps,report.totals.lostInquiries],[2,2,1])
  assert.equal(report.totals.recordedIntroBookings,1)
  assert.ok(Object.values(report.unavailable).every(value=>value===null))
  await h.cmd('attendance.correct',{id:visits[1].id,outcome:'attended',reason:'Signed the paper roster'})
  report=await read();row=report.rows.find(r=>r.personId===ana.id)
  assert.deepEqual([row.attendedVisits,row.repeatAttendance,report.totals.repeatAttendance],[2,true,1])
  const state=await h.state()
  assert.deepEqual(new Set(row.attendedBookingIds),new Set(visits.slice(0,2).map(v=>v.id)))
  for(const id of row.eventIds) assert.ok(state.pipeline.events.some(event=>event.id===id&&row.leadIds.includes(event.leadId)))
  for(const id of row.externalOutcomeEventIds) assert.equal(state.pipeline.events.find(e=>e.id===id).after.externalMembershipReference,'EXTERNAL-PRIYA')
  for(const url of [row.leadUrl,...row.visitUrls]) assert.equal((await h.send(url,undefined,h.owner)).status,200)
  const filtered=await read('?funnelSource='+encodeURIComponent('Community event'))
  assert.deepEqual(filtered.rows.map(r=>r.personId),[ana.id]);assert.deepEqual(filtered.totals.firstVisits,1)
  assert.equal((await read('?funnelSource=Missing')).totals.members,0)
  assert.equal((await h.send('/api/strap/reports/leads?funnelSource='+('x'.repeat(101)),undefined,h.owner)).status,400)
  const before=(await h.state()).version
  await read();await read();assert.equal((await h.state()).version,before,'report reads have no business effects')
  for(const actor of [ana,coach]) assert.equal((await h.send('/api/strap/reports/leads',undefined,actor.cookie)).status,403)
  assert.equal((await h.send('/api/strap/reports/leads')).status,401)
  const key=await h.cmd('agent.create',{label:'Funnel reader refused'})
  assert.equal((await h.send('/api/strap/reports/leads',undefined,'',{authorization:'Bearer '+key.token})).status,401)
  const exit=await h.send('/api/strap/exit.json',undefined,h.owner)
  assert.equal(JSON.parse(exit.value.tables.st_records.find(r=>r.id===lead.id).data).source,'Community event')
  if(process.env.STRAP_PROOF_DIR) await (await import('./lead-report-browser.mjs')).leadReportBrowser(h,{ana,unknown,ownerId})
}))
