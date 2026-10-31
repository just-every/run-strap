import assert from 'node:assert/strict'
import { parseCsv } from './report-downloads.mjs'

export async function auditDownload(h,query,cookie=h.owner) {
  const json=await h.send('/api/strap/staff-history?'+query,undefined,cookie)
  assert.equal(json.status,200,json.text)
  const csv=await h.send('/api/strap/staff-history.csv?'+query,undefined,cookie)
  assert.equal(csv.status,200)
  const [columns,...data]=parseCsv(csv.text)
  assert.deepEqual(data.map(values=>Object.fromEntries(columns.map((key,i)=>[key,
    ['before','after'].includes(key)&&values[i]!==null ? JSON.parse(values[i]) : values[i]
  ]))),json.value.rows,'every filtered CSV fact matches the JSON projection')
  return json.value.rows
}

export async function studioAuditCases(h) {
  const staff=await h.person('AuditDesk'),member=await h.person('AuditScope')
  const scope={memberIds:[member.id],locationIds:['studio'],doors:['all']}
  const input={personId:staff.id,role:'front-desk',enabled:true,rights:{'member-record':{enabled:true,scopes:[scope]}},reason:'Cover the morning desk'}
  const first=await h.cmd('staff.access.grant',input)
  const cookie=await h.signIn(staff.email);await h.enroll(cookie)
  const version=(await h.state()).version
  for(const path of ['/api/strap/staff-history','/api/strap/staff-history.csv']) {
    assert.equal((await h.send(path,undefined,cookie)).status,403)
    assert.equal((await h.send(path,{sourceId:first.id,after:{}},cookie)).status,403)
  }
  assert.equal((await h.send('/api/strap/command',{name:'staff.access.grant',input:{...input,rights:{},enabled:false}},cookie)).status,403)
  assert.ok(!(await h.state(cookie)).studioAudit?.length,'staff state exposes no studio audit records')
  assert.ok(!(await h.state(member.cookie)).studioAudit?.length,'member state exposes no studio audit records')
  assert.equal((await h.state()).version,version,'staff cannot read or rewrite access history')
  const second=await h.cmd('staff.access.grant',{...input,rights:{},reason:'End the morning assignment'})
  const revoked=await h.cmd('staff.access.grant',{...input,enabled:false,rights:{},reason:'Staff access revoked'})
  const query=new URLSearchParams({person:staff.id,auditRight:'access',auditCommand:'staff.access.grant'})
  const changes=await auditDownload(h,query)
  assert.equal(changes.length,3)
  const grants=[...changes].sort((a,b)=>a.version-b.version)
  assert.deepEqual(grants.map(row=>row.version),[first.version,second.version,revoked.version])
  assert.deepEqual(grants.map(row=>row.reason),['Cover the morning desk','End the morning assignment','Staff access revoked'])
  assert.deepEqual(grants[0].after,first);assert.deepEqual(grants[1].before,first)
  assert.deepEqual(grants[1].after,second);assert.deepEqual(grants[2].before,second)
  assert.deepEqual(grants[2].after,revoked)
  for(const row of grants)assert.deepEqual([row.actorId,row.actorRole,row.sourceKind,row.sourceId,row.id],[(await h.state()).actor.id,'owner','staffAccessEvent',row.id,row.id])
  const sources=(await h.send('/api/strap/exit.json',undefined,h.owner)).value.tables.st_records.filter(row=>row.kind==='staffAccessEvent'&&JSON.parse(row.data).personId===staff.id)
  assert.deepEqual(new Set(changes.map(row=>row.sourceId)),new Set(sources.map(row=>row.id)))
  const sourceDays=sources.map(row=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(JSON.parse(row.data).at))).sort()
  const dated=new URLSearchParams(query);dated.set('auditFrom',sourceDays[0]);dated.set('auditTo',sourceDays.at(-1))
  assert.deepEqual(await auditDownload(h,dated),changes)
  for(const [key,value] of [['person',member.id],['auditRight','drawer'],['auditCommand','drawer.adjust'],['auditActor','unrecorded-actor'],['auditChannel','phone']]) {
    const excluded=new URLSearchParams(query);excluded.set(key,value)
    assert.equal((await auditDownload(h,excluded)).length,0,key+' excludes unrelated sources')
  }
  // Seed the retained historical format. Its omitted provenance must not be
  // manufactured from the current owner or the person's latest access grant.
  const old=JSON.parse(sources.find(row=>JSON.parse(row.data).version===first.version).data)
  delete old.actorRole;delete old.command;delete old.reason
  await h.db.prepare('UPDATE st_records SET data=? WHERE id=?').bind(JSON.stringify(old),old.id).run()
  const historical=(await auditDownload(h,new URLSearchParams({person:staff.id,auditCommand:'staff.access.change'})))[0]
  assert.equal(historical.actorRole,null);assert.equal(historical.reason,null)
  assert.deepEqual(historical.after,first,'later revocation cannot replace historical grant facts')
  const key=await h.cmd('agent.create',{label:'Audit read refusal'})
  const afterKey=(await h.state()).version
  for(const path of ['/api/strap/staff-history','/api/strap/staff-history.csv']) {
    assert.equal((await h.send(path,undefined,'',{authorization:'Bearer '+key.token})).status,401)
    assert.equal((await h.send(path,{id:old.id,after:{}},h.owner)).status,404)
  }
  assert.equal((await h.state()).version,afterKey)
  return {staff,query}
}

export async function seedStudioAuditArchive(h) {
  const staff=await h.person('ArchivedAuditStaff')
  const grant={personId:staff.id,role:'front-desk',enabled:true,rights:{},reason:'Retained original access decision'}
  await h.cmd('staff.access.grant',grant)
  await h.cmd('staff.access.grant',{...grant,enabled:false,reason:'Retained revocation'})
  const drawer=await h.cmd('drawer.open',{locationId:'studio',register:'Archive audit register',floatCents:1000,requestId:'audit-open'})
  await h.cmd('drawer.close',{sessionId:drawer.id,denominations:[{cents:100,count:9}],reason:'Original counted shortage',requestId:'audit-close'})
  const adjust={sessionId:drawer.id,countedCents:1000,reason:'Retained correction',requestId:'audit-adjust'}
  const adjustment=await h.cmd('drawer.adjust',adjust)
  const reopen={sessionId:drawer.id,reason:'Retained reviewed reopen',requestId:'audit-reopen'}
  const reopened=await h.cmd('drawer.reopen',reopen)
  const all=(await h.send('/api/strap/staff-history',undefined,h.owner)).value.rows
  const rows=all.filter(row=>row.sourceKind==='staffAccessEvent'&&row.personId===staff.id||row.sourceKind==='drawerAdjustment'&&row.sessionId===drawer.id)
  assert.equal(rows.length,4)
  const sourceIds=new Set(rows.map(row=>row.sourceId))
  const records=(await h.send('/api/strap/exit.json',undefined,h.owner)).value.tables.st_records.filter(row=>sourceIds.has(row.id)).sort((a,b)=>a.id.localeCompare(b.id))
  const native=await nativeAuditSources(h)
  return {staff,drawer,rows,records,adjust,adjustment,reopen,reopened,native}
}

export async function restoredStudioAudit(h,seed,owner,memberCookie) {
  const native=await auditDownload(h,new URLSearchParams({person:seed.native.member.id}),owner)
  assert.deepEqual(native.filter(row=>seed.native.rows.some(original=>original.id===row.id)),seed.native.rows,'restore retains native correction, entitlement and refund identities and facts')
  const all=(await h.send('/api/strap/staff-history',undefined,owner)).value.rows
  const rows=all.filter(row=>row.sourceKind==='staffAccessEvent'&&row.personId===seed.staff.id||row.sourceKind==='drawerAdjustment'&&row.sessionId===seed.drawer.id)
  assert.deepEqual(rows,seed.rows,'native restore preserves original audit identities and every recorded fact')
  const ids=new Set(rows.map(row=>row.sourceId))
  const records=(await h.send('/api/strap/exit.json',undefined,owner)).value.tables.st_records.filter(row=>ids.has(row.id)).sort((a,b)=>a.id.localeCompare(b.id))
  assert.deepEqual(records,seed.records)
  assert.deepEqual(await auditDownload(h,new URLSearchParams({person:seed.staff.id,auditRight:'access'}),owner),seed.rows.filter(row=>row.personId===seed.staff.id))
  const version=(await h.state(owner)).version
  for(let attempt=0;attempt<2;attempt++) {
    assert.deepEqual(await h.cmd('drawer.adjust',seed.adjust,owner),seed.adjustment)
    assert.deepEqual(await h.cmd('drawer.reopen',seed.reopen,owner),seed.reopened)
  }
  for(const path of ['/api/strap/staff-history','/api/strap/staff-history.csv'])assert.equal((await h.send(path,undefined,memberCookie)).status,403)
  assert.equal((await h.state(owner)).version,version,'restored reads, denials and committed replay create no events or money effects')
  const replayed=(await h.send('/api/strap/staff-history?auditRight=drawer',undefined,owner)).value.rows
  assert.deepEqual(replayed.filter(row=>row.sessionId===seed.drawer.id),seed.rows.filter(row=>row.sessionId===seed.drawer.id))
}

// The owner opens real retained money and attendance sources, then erases the
// used identity through the existing reviewed privacy door.
export async function nativeAuditSources(h,{erase=false}={}) {
  const member=await h.person('SyntheticAuditMember'),coach=await h.person('SyntheticAuditCoach','instructor')
  for(const waiver of (await h.state()).waivers.filter(w=>!w.service||w.service==='Synthetic audit class'))
    await h.cmd('waiver.acknowledge',{id:waiver.id,...(waiver.requiresSignature?{documentHash:waiver.documentHash,signerName:member.name,confirm:true}:{})},member.cookie)
  const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:3,amountCents:0,expiresAt:'2099-12-31T00:00:00Z'})).id})
  await h.cmd('bookingRule.save',{service:'Synthetic audit class',cancelCutoffHours:12,lateCancelReturnsCredit:false,lateCancelFeeCents:1500})
  const start=new Date(Math.ceil((Date.now()+3600000)/60000)*60000),week=new Date(start)
  week.setUTCDate(week.getUTCDate()-(week.getUTCDay()+6)%7)
  const entry=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:week.toISOString().slice(0,10),classes:[{title:'Synthetic audit class',service:'Synthetic audit class',room:'Synthetic audit room',start:start.toISOString(),end:new Date(+start+3600000).toISOString(),capacity:3,instructorId:coach.id}]})).id})).classes[0]
  const booked=await h.cmd('booking.book',{classId:entry.id},member.cookie)
  const terms=(await h.state(member.cookie)).bookings.find(row=>row.id===booked.id).cancelEffect.key
  await h.cmd('booking.cancel',{id:booked.id,terms},member.cookie)
  await h.cmd('payment.record',{personId:member.id,amountCents:1500,reference:'synthetic-strap-audit-fee'})
  const correction={id:booked.id,outcome:'early_cancel',reason:'Synthetic private correction',refundReference:'synthetic-strap-audit-refund'}
  const baseline=await h.state()
  for(const cookie of [member.cookie,coach.cookie])await h.cmd('attendance.correct',correction,cookie,403)
  assert.equal((await h.state()).version,baseline.version,'unsafe attendance correction changes neither money nor audit')
  const corrected=await h.cmd('attendance.correct',correction)
  await h.cmd('attendance.correct',correction,h.owner,409)
  const current=(await h.state()).packs.find(row=>row.id===pack.id)
  const adjustment={id:pack.id,revision:current.creditRevision,creditsDelta:1,reason:'Synthetic private entitlement reason',requestId:'synthetic-strap-audit-credit'}
  const adjusted=await h.cmd('pack.adjust',adjustment)
  await h.cmd('pack.adjust',adjustment)
  const query=new URLSearchParams({person:member.id})
  const all=await auditDownload(h,query)
  const rows=all.filter(row=>['attendanceCorrection','packCreditEvent','payment'].includes(row.sourceKind))
  assert.equal(rows.length,3,'one correction, one adjustment and one external refund source')
  assert.equal(new Set(rows.map(row=>row.sourceId)).size,3)
  const change=rows.find(row=>row.command==='attendance.correct')
  assert.equal(change.id,corrected.corrections[0].id)
  assert.deepEqual([change.before.cancellation,change.after.to,change.after.feeReversedCents,change.after.creditRestored],['late','early_cancel',1500,true])
  assert.equal(change.reason,correction.reason);assert.equal(change.version,corrected.corrections[0].version)
  const credit=rows.find(row=>row.command==='pack.adjust')
  assert.deepEqual([credit.sourceId,credit.before.remaining,credit.after.remaining,credit.version],[adjusted.id,3,4,adjusted.revision])
  const refund=rows.find(row=>row.command==='payment.refund.recorded')
  assert.deepEqual([refund.sourceId,refund.after.amountCents,refund.after.collection],[change.after.refundId,-1500,'external-record-only'])
  assert.ok(!JSON.stringify(rows).includes(correction.refundReference),'private settlement references stay outside audit exports')
  const actor=(await h.state()).actor
  for(const row of rows)assert.deepEqual([row.actorId,row.actorRole],[actor.id,'owner'])
  for(const command of rows.map(row=>row.command)) {
    const selected=await auditDownload(h,new URLSearchParams({person:member.id,auditCommand:command}))
    assert.equal(selected.length,1);assert.equal(selected[0].command,command)
    const page=await h.send('/app/people?'+new URLSearchParams({person:member.id,auditCommand:command}),undefined,h.owner)
    assert.equal(page.status,200);assert.ok(page.text.includes('data-staff-command="'+command+'"'))
  }
  const state=await h.state()
  assert.equal(state.balances.find(row=>row.personId===member.id).balanceCents,0)
  assert.equal(state.packs.find(row=>row.id===pack.id).remaining,4)
  const seed={member,rows,query,correction,adjustment}
  if(erase)await eraseNativeAudit(h,seed)
  return seed
}

export async function eraseNativeAudit(h,{member,rows,query,correction,adjustment}) {
    const {verifiedPrivacyRequest,privacyDecision}=await import('./privacy-journey.mjs')
    const access=await verifiedPrivacyRequest(h,member,'access','-audit')
    const copy=await h.cmd('privacy.export',{id:access.id})
    assert.ok(copy.records.some(row=>row.kind==='payment'&&row.data.id===rows.find(event=>event.command==='payment.refund.recorded').sourceId))
    const request=await verifiedPrivacyRequest(h,member,'erasure','-audit')
    const review=await h.cmd('privacy.erase.prepare',{id:request.id,...privacyDecision})
    await h.cmd('privacy.erase.confirm',{id:review.id,confirm:true})
    const redacted=(await auditDownload(h,query)).filter(row=>rows.some(original=>original.id===row.id))
    assert.equal(redacted.length,3,'redaction preserves the original source identities')
    for(const row of redacted)assert.deepEqual([row.erased,row.reason,row.before,row.after],[true,null,null,null])
    for(const value of [member.email,member.name,correction.reason,adjustment.reason,correction.refundReference])assert.ok(!JSON.stringify(await auditDownload(h,query)).includes(value))
    const erasedVersion=(await h.state()).version
    await h.cmd('attendance.correct',correction,h.owner,409)
    await h.state(member.cookie,401)
    assert.equal((await h.state()).version,erasedVersion,'captured correction and retired sign-in cannot restore data')
}
