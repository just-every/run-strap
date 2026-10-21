import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const weekOf = at => {const d=new Date(at);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)}
const second = ms => new Date(Math.ceil((Date.now()+ms)/1000)*1000).toISOString()
const until = at => new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(at)-Date.now()+100)))
// Independent check of the published rule: elapsed UTC seconds, half-up cents.
const prorate = (difference,start,end,effective) => {
  const s=at=>BigInt(Math.floor(Date.parse(at)/1000)),total=s(end)-s(start),left=s(end)-s(effective),n=BigInt(difference)*left
  const sign=n<0n?-1n:1n;return Number(sign*((2n*n*sign+total)/(2n*total)))
}
test('PLAN-005: mid-term upgrade, renewal downgrade, member-accepted exact preview, stale and racing changes refused, staff door audited',{timeout:120_000},()=>run(async h=>{
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'})
  const maya=await h.person('Maya','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben')
  await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:ana.id,credits:10,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z'})).id})
  await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:ben.id,credits:5,amountCents:6000,expiresAt:second(14_000)})).id})
  const packs=(await h.state()).packs,pack=packs.find(p=>p.personId===ana.id),benPack=packs.find(p=>p.personId===ben.id)
  const publish=async(title,hours)=>{const start=new Date(Date.now()+hours*3600_000).toISOString();return (await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:weekOf(start),classes:[{title,room:title,start,end:new Date(Date.parse(start)+3600_000).toISOString(),capacity:4,instructorId:maya.id}]})).id})).classes[0]}
  await h.cmd('booking.book',{classId:(await publish('Mat one',24)).id},ana.cookie)
  const refused=async(name,input,cookie,status,error)=>{const before=(await h.state()).version,r=await h.send('/api/strap/command',{name,input},cookie);assert.equal(r.status,status,r.text);if(error)assert.match(r.value.error,error);assert.equal((await h.state()).version,before,'refused commands write nothing');return r}

  // The member asks; the request alone changes nothing.
  const ask={packId:pack.id,note:'I would like twenty classes',requestId:'ana-ask'}
  const request=await h.cmd('plan.change.request',ask,ana.cookie)
  assert.deepEqual(await h.cmd('plan.change.request',ask,ana.cookie),request)
  await refused('plan.change.request',{...ask,note:'Different'},ana.cookie,409,/plan_request_changed/)
  await refused('plan.change.request',{...ask,requestId:'ben-ask'},ben.cookie,404)
  assert.equal((await h.state(ben.cookie)).planChanges.requests.length,0)

  // Staff door: the owner previews under the contract-change right, audited once as staff-made.
  const upgrade=(requestId,effectiveAt,extra={})=>({packId:pack.id,mode:'now',credits:20,amountCents:18000,effectiveAt,requestId,channel:'phone',...extra})
  let effectiveAt=second(5000),first=await h.cmd('plan.change.prepare',upgrade('upgrade-1',effectiveAt,{planRequestId:request.id}))
  assert.deepEqual(await h.cmd('plan.change.prepare',upgrade('upgrade-1',effectiveAt,{planRequestId:request.id})),first,'staff replay returns the same preview')
  const audit=(await h.state()).staffActions.filter(a=>a.command==='plan.change.prepare'&&a.requestId==='upgrade-1')
  assert.equal(audit.length,1);assert.deepEqual([audit[0].right,audit[0].channel,audit[0].personId,audit[0].staffMade,audit[0].before.id,audit[0].after.id],['contract-change','phone',ana.id,true,pack.id,first.id])
  assert.equal((await h.state(ana.cookie)).planChanges.requests[0].status,'previewed')
  const profile=await h.send('/app/people?person='+ana.id,undefined,h.owner)
  assert.equal(profile.status,200,profile.text);assert.match(profile.text,/Preview plan change/);assert.match(profile.text,/Change this member’s plan/)
  for(const [cookie,status] of [[ana.cookie,403],[maya.cookie,403]])await refused('plan.change.prepare',upgrade('denied',effectiveAt),cookie,status)
  const key=await h.cmd('agent.create',{label:'Plan change agent'})
  for(const [name,input] of [['plan.change.prepare',upgrade('agent',effectiveAt)],['plan.change.accept',{id:first.id,key:first.key}]])
    assert.equal((await h.send('/api/strap/agent/command',{name,input},'',{authorization:'Bearer '+key.token})).status,403)
  await refused('plan.change.prepare',upgrade('downgrade',effectiveAt,{credits:8,amountCents:9000}),h.owner,400,/exception_reason_required/)
  await refused('plan.change.prepare',upgrade('past',new Date(Date.now()-60_000).toISOString().replace(/\.\d+Z$/,'.000Z')),h.owner,400,/effective_at_must_be_future/)

  // The exact preview: effective instant, credits, prorated charge with its formula, no automatic renewal.
  assert.equal(first.chargeCents,prorate(8000,pack.createdAt,pack.expiresAt,effectiveAt))
  assert.deepEqual([first.effectiveAt,first.creditsDelta,first.remainingAfter,first.expiresAt,first.exception],[effectiveAt,10,19,pack.expiresAt,false])
  assert.deepEqual([first.formula.differenceCents,first.formula.totalSeconds],[8000,Math.floor(Date.parse(pack.expiresAt)/1000)-Math.floor(Date.parse(pack.createdAt)/1000)])
  const own=(await h.state(ana.cookie)).planChanges.changes.find(c=>c.id===first.id)
  assert.deepEqual(own,(await h.state()).planChanges.changes.find(c=>c.id===first.id),'member and staff read the same preview')
  const page=await h.send('/app/packs',undefined,ana.cookie)
  assert.equal(page.status,200);assert.match(page.text,/rounded half-up to the cent/);assert.match(page.text,/Accept this exact change/)
  assert.equal((await h.state(maya.cookie)).planChanges.changes.length,0);assert.equal((await h.state(ben.cookie)).planChanges.changes.length,0)
  await refused('plan.change.accept',{id:first.id,key:first.key},ben.cookie,404)
  await refused('plan.change.accept',{id:first.id,key:first.key},h.owner,403,/member_acceptance_required/)

  // Changed source facts make the preview stale: a new booking moves the pack.
  await h.cmd('booking.book',{classId:(await publish('Mat two',26)).id},ana.cookie)
  assert.equal((await h.state(ana.cookie)).planChanges.changes.find(c=>c.id===first.id).stale,true)
  await refused('plan.change.accept',{id:first.id,key:first.key},ana.cookie,409,/plan_changed/)
  effectiveAt=second(5000)
  const fresh=await h.cmd('plan.change.prepare',upgrade('upgrade-2',effectiveAt))
  const racing=await h.cmd('plan.change.prepare',upgrade('upgrade-3',effectiveAt,{credits:30,amountCents:25000}))
  assert.equal(fresh.remainingAfter,18)
  await refused('plan.change.accept',{id:fresh.id,key:'changed'},ana.cookie,409,/preview_changed/)
  const accepted=await h.cmd('plan.change.accept',{id:fresh.id,key:fresh.key},ana.cookie)
  assert.equal(accepted.status,'accepted');assert.equal(accepted.acceptedBy,(await h.state(ana.cookie)).actor.id)
  assert.deepEqual(await h.cmd('plan.change.accept',{id:fresh.id,key:fresh.key},ana.cookie),accepted,'acceptance replays once')
  await refused('plan.change.accept',{id:racing.id,key:racing.key},ana.cookie,409,/plan_change_pending/)
  await refused('plan.change.prepare',upgrade('upgrade-4',effectiveAt),h.owner,409,/plan_change_pending/)
  const untouched=(await h.state()).packs.find(p=>p.id===pack.id)
  assert.deepEqual([untouched.credits,untouched.amountCents,untouched.remaining],[10,10000,8],'nothing changes before the effective instant')

  // Applied once at the effective instant; charge and entitlement equal the accepted preview.
  await until(effectiveAt)
  for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled({cron:'* * * * *'})
  let s=await h.state(),changed=s.packs.find(p=>p.id===pack.id),charges=s.charges.filter(c=>c.planChangeId===fresh.id)
  assert.deepEqual([changed.credits,changed.amountCents,changed.remaining,changed.expiresAt],[20,18000,18,pack.expiresAt])
  assert.equal(charges.length,1);assert.equal(charges[0].amountCents,fresh.chargeCents)
  assert.equal(s.balances.find(b=>b.personId===ana.id).balanceCents,10000+fresh.chargeCents)
  assert.equal(s.packCreditEvents.filter(e=>e.packId===pack.id&&e.type==='change').length,1)
  assert.equal(s.planChanges.changes.find(c=>c.id===fresh.id).status,'applied')
  assert.equal(s.planChanges.changes.find(c=>c.id===racing.id).stale,true)
  await refused('plan.change.accept',{id:racing.id,key:racing.key},ana.cookie,409)

  // A mid-term reduction is a studio-approved exception and becomes a balance credit.
  const lower=await h.cmd('plan.change.prepare',upgrade('lower',second(60_000),{credits:18,amountCents:15000,exceptionReason:'Injury accommodation'}))
  assert.equal(lower.exception,true);assert.equal(lower.approvedExceptionBy,s.actor.id)
  assert.equal(lower.chargeCents,prorate(-3000,pack.createdAt,pack.expiresAt,lower.effectiveAt));assert.ok(lower.chargeCents<0)
  await refused('plan.change.prepare',upgrade('too-low',second(60_000),{credits:1,amountCents:1000,exceptionReason:'Below allocations'}),h.owner,409,/allocations_exceed_new_credits/)

  // Downgrade at renewal: a new term at full price starting at the current expiry.
  const renewal=await h.cmd('plan.change.prepare',{packId:benPack.id,mode:'renewal',credits:3,amountCents:4000,expiresAt:'2099-06-30T00:00:00.000Z',requestId:'ben-renewal'})
  assert.deepEqual([renewal.effectiveAt,renewal.chargeCents,renewal.expiringCredits,renewal.exception],[benPack.expiresAt,4000,5,false])
  await h.cmd('plan.change.accept',{id:renewal.id,key:renewal.key},ben.cookie)
  const late=await h.cmd('plan.change.prepare',upgrade('late',second(2000),{credits:22,amountCents:19000}))
  await until(late.effectiveAt)
  await refused('plan.change.accept',{id:late.id,key:late.key},ana.cookie,409,/preview_expired/)
  await until(benPack.expiresAt)
  for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled({cron:'* * * * *'})
  s=await h.state()
  const next=s.packs.filter(p=>p.renewedFromPackId===benPack.id)
  assert.equal(next.length,1);assert.deepEqual([next[0].credits,next[0].remaining,next[0].amountCents,next[0].termStartAt,next[0].expiresAt],[3,3,4000,benPack.expiresAt,'2099-06-30T00:00:00.000Z'])
  assert.deepEqual(s.packs.find(p=>p.id===benPack.id).credits,5,'the ended term keeps its own terms')
  assert.equal(s.charges.filter(c=>c.planChangeId===renewal.id).length,1)
  assert.equal(s.balances.find(b=>b.personId===ben.id).balanceCents,10000)
  const records=(await h.send('/api/strap/exit.json',undefined,h.owner)).value.tables.st_records.map(r=>({kind:r.kind,data:JSON.parse(r.data)}))
  for(const id of [fresh.id,renewal.id])assert.ok(records.some(r=>r.kind==='planChange'&&r.data.id===id))
  assert.ok(records.some(r=>r.kind==='planChangeRequest'&&r.data.id===request.id))
  if(process.env.STRAP_PROOF_DIR)await(await import('./plan-changes-browser.mjs')).planChangesBrowser(h,{member:ana})
}))

// Invoice agreement and freeze clocks use real instants; no test-only production clock.
test('PLAN-006/011: exact member and direct freezes, original funding, earlier resumption and real revised renewal invoices once',{timeout:240_000},async()=>{const sent=[];await run(async h=>{
  await h.confirmSetup(h.owner)
  await h.cmd('studio.save',{location:'Park Slope',timeZone:'America/New_York'})
  const instructor=await h.person('Maya','instructor'),member=await h.person('Ana'),direct=await h.person('Lena'),stranger=await h.person('Noah')
  const type=await h.cmd('freeze.type.save',{name:'Medical',reason:'Agreed time away',feeCents:1000,defaultLengthDays:30,maxLengthDays:366,allowedStartDays:[1,2,3,4,5,6,7],allowOpenEnded:true})
  const refused=async(name,input,cookie,status,error)=>{const before=(await h.state()).version,r=await h.send('/api/strap/command',{name,input},cookie);assert.equal(r.status,status,r.text);if(error)assert.match(r.value.error,error);assert.equal((await h.state()).version,before,'refused commands write nothing');return r}
  const sale=async(person,expiresAt)=>{const approved=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:person.id,credits:5,amountCents:12000,expiresAt,guestTerms:{passes:1,period:'month',rollover:0,services:[],perGuest:1,windowDays:365,excess:'refuse',priceCents:0}})).id});return(await h.state()).packs.find(p=>p.id===approved.id)}
  // Every automatic invoice needs a source-checked proposal and the member's own consent.
  const expiry=second(110_000),pack=await sale(member,expiry),directPack=await sale(direct,expiry)
  const recurring=async(person,p,requestId)=>{const proposal=await h.cmd('plan.recurring.prepare',{packId:p.id,intervalMonths:1,requestId});await refused('plan.recurring.accept',{id:proposal.id,key:proposal.key},h.owner,403);await refused('plan.recurring.accept',{id:proposal.id,key:proposal.key},person.id===stranger.id?member.cookie:stranger.cookie,404);return h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},person.cookie)}
  const terms=await recurring(member,pack,'synthetic-strap-recurring-1'),directTerms=await recurring(direct,directPack,'synthetic-strap-recurring-2')
  const stoppedPack=await sale(stranger,second(30_000))
  const stoppedTerms=await recurring(stranger,stoppedPack,'synthetic-strap-stopped-agreement')
  await refused('plan.recurring.stop',{id:stoppedTerms.id,reason:'Withdraw future invoice consent',requestId:'synthetic-strap-stop-denied'},member.cookie,404)
  const stop={id:stoppedTerms.id,reason:'Withdraw future invoice consent',requestId:'synthetic-strap-stop'}
  await h.cmd('plan.recurring.stop',stop,stranger.cookie); await h.cmd('plan.recurring.stop',stop,stranger.cookie)
  const startAt=second(80_000),endAt=second(86_000),classAt=plus(startAt,1000),outsideAt=plus(endAt,2000)
  function plus(at,ms){return new Date(Date.parse(at)+ms).toISOString()}
  const publish=async(title,start)=>{return(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:weekOf(start),classes:[{title,room:title,start,end:plus(start,500),capacity:5,instructorId:instructor.id}]})).id})).classes[0]}
  const inside=await publish('Morning Mat',classAt),outside=await publish('Evening Flow',outsideAt),extra=await publish('Reformer practice',plus(startAt,2000))
  const cancelled=await h.cmd('booking.book',{classId:inside.id},member.cookie),kept=await h.cmd('booking.book',{classId:outside.id},member.cookie)
  await h.cmd('guest.consent.save',{sponsorEmail:member.email,consent:true},stranger.cookie);
  const guestQuote=await h.cmd('guest.preview',{sponsorId:member.id,guestId:stranger.id,packId:pack.id,classId:inside.id},member.cookie);
  const guestSeat=await h.cmd('guest.book',{id:guestQuote.id,confirm:true},member.cookie);
  const ask={packId:pack.id,freezeTypeId:type.id,startAt,endAt,reason:'Planned family leave',requestId:'synthetic-strap-freeze-request'}
  const request=await h.cmd('freeze.request',ask,member.cookie)
  assert.deepEqual(await h.cmd('freeze.request',ask,member.cookie),request)
  await refused('freeze.request',{...ask,reason:'changed'},member.cookie,409,/freeze_request_changed/)
  await refused('freeze.request',{...ask,requestId:'foreign'},stranger.cookie,404)
  assert.equal((await h.state(stranger.cookie)).freezes.requests.length,0)
  const prepare={packId:pack.id,freezeRequestId:request.id,requestId:'synthetic-strap-freeze-preview-1',channel:'phone'}
  const stale=await h.cmd('freeze.prepare',prepare)
  assert.equal(stale.effects.originalRenewalAt,expiry);assert.equal(stale.effects.renewalAmountCents,12000)
  assert.equal(stale.effects.revisedRenewalAt,plus(expiry,Date.parse(endAt)-Date.parse(startAt)))
  assert.deepEqual(stale.effects.bookings.map(b=>b.bookingId).sort(),[cancelled.id,guestSeat.id].sort());assert.equal(stale.effects.bookings[0].feeCents,0)
  await refused('freeze.prepare',{...prepare,requestId:'synthetic-strap-fee-exception',feeCents:0},h.owner,400,/exception_reason_required/)
  await h.cmd('booking.book',{classId:extra.id},member.cookie)
  await refused('freeze.confirm',{id:stale.id,key:stale.key,requestId:'stale-confirm'},h.owner,409,/freeze_source_changed/)
  const preview=await h.cmd('freeze.prepare',{...prepare,requestId:'synthetic-strap-freeze-preview-2'})
  assert.deepEqual((await h.state(member.cookie)).freezes.freezes.find(f=>f.id===preview.id), (await h.state()).freezes.freezes.find(f=>f.id===preview.id),'owner and member read the same effects')
  for(const [cookie,status] of [[member.cookie,403],[instructor.cookie,403]])await refused('freeze.confirm',{id:preview.id,key:preview.key,requestId:'denied'},cookie,status)
  const agent=await h.cmd('agent.create',{label:'synthetic-strap-freeze-agent'})
  assert.equal((await h.send('/api/strap/agent/command',{name:'freeze.confirm',input:{id:preview.id,key:preview.key,requestId:'agent'}},'',{authorization:'Bearer '+agent.token})).status,403)
  await refused('freeze.confirm',{id:preview.id,key:'different',requestId:'changed-key'},h.owner,409,/preview_changed/)
  const confirm={id:preview.id,key:preview.key,requestId:'synthetic-strap-freeze-confirm',channel:'phone'}
  const confirmed=await h.cmd('freeze.confirm',confirm)
  assert.deepEqual(await h.cmd('freeze.confirm',confirm),confirmed)
  let state=await h.state(),changed=state.packs.find(p=>p.id===pack.id)
  assert.equal(changed.remaining,4,'only the retained outside booking still uses credit')
  assert.equal(changed.expiresAt,preview.effects.revisedExpiresAt)
  assert.equal(state.bookings.find(b=>b.id===kept.id).status,'booked')
  assert.equal(state.bookings.find(b=>b.id===cancelled.id).cancellation,'freeze');
  assert.equal(state.bookings.find(b=>b.id===guestSeat.id).cancellation,'freeze');
  assert.equal(state.guests.events.filter(e=>e.bookingId===guestSeat.id&&e.type==='return').length,1,'the frozen plan’s separate guest allocation returns once');
  assert.equal(state.packCreditEvents.filter(e=>e.type==='restore'&&e.bookingId===cancelled.id).length,1)
  assert.equal(state.charges.filter(c=>c.freezeId===preview.id).length,1)
  await refused('booking.book',{classId:inside.id},member.cookie,409,/frozen|freeze/)
  const separate = await h.cmd('booking.desk',{personId:member.id,classId:inside.id,pay:'unpaid',requestId:'synthetic-strap-unpaid',channel:'desk'});
  assert.equal(separate.unpaid,true,'a freeze pauses its plan, not an independently authorized unpaid visit');
  await h.cmd('booking.cancel',{id:separate.id,cancelReason:'Other',channel:'desk'});
  const alternative=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:2,amountCents:4000,expiresAt:'2099-12-31T00:00:00Z'})).id});
  const independentlyFunded=await h.cmd('booking.book',{classId:inside.id},member.cookie);
  assert.equal(independentlyFunded.packId,alternative.id,'another paid plan retains visit access during this plan’s freeze');
  const action=state.staffActions.filter(a=>a.command==='freeze.confirm'&&a.after.id===preview.id)
  assert.equal(action.length,1);assert.deepEqual([action[0].right,action[0].channel,action[0].personId],['contract-change','phone',member.id])
  assert.equal(state.staffActions.filter(a=>a.parentActionId===action[0].id).length,0,'child booking actions do not duplicate the canonical freeze action')
  const memberState=await h.state(member.cookie)
  assert.ok(memberState.notices.some(n=>n.id==='notice:freeze-confirm:'+preview.id));
  assert.equal(sent.filter(m=>m.to.includes(member.email)&&m.subject==='Membership freeze confirmed').length,1,'the network edge accepts the member’s once-only confirmation');
  assert.equal((await h.state(stranger.cookie)).freezes.freezes.length,0)
  assert.equal((await h.state(instructor.cookie)).freezes.freezes.length,0)

  // Direct staff freeze needs no self-service request and supports open-ended and an exact early-end preview.
  const directStart=second(6000),directEnd=plus(directStart,6000)
  const directPreview=await h.cmd('freeze.prepare',{packId:directPack.id,freezeTypeId:type.id,startAt:directStart,endAt:null,reason:'Travel leave agreed at the desk',requestId:'synthetic-strap-direct',channel:'desk'})
  assert.equal(directPreview.freezeRequestId,null);assert.equal(directPreview.effects.revisedRenewalAt,null)
  await h.cmd('freeze.confirm',{id:directPreview.id,key:directPreview.key,requestId:'synthetic-strap-direct-confirm',channel:'desk'})
  const end=await h.cmd('freeze.end.prepare',{id:directPreview.id,endAt:directEnd,reason:'Member is returning earlier',requestId:'synthetic-strap-early-end',channel:'desk'})
  assert.equal(end.revisedRenewalAt,plus(expiry,6000))
  await refused('freeze.end.confirm',{id:end.id,key:end.key,requestId:'member-end'},direct.cookie,403)
  await h.cmd('freeze.end.confirm',{id:end.id,key:end.key,requestId:'synthetic-strap-end-confirm',channel:'desk'})
  // Both agreed dates pass; repeat the scheduler without repeating either resumption or charge.
  await until([endAt,directEnd].sort().at(-1))
  for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled({cron:'* * * * *'})
  state=await h.state()
  for(const freezeId of [preview.id,directPreview.id]){const freeze=state.freezes.freezes.find(f=>f.id===freezeId);assert.equal(freeze.status,'resumed');assert.equal(freeze.resumptionCount,1)}
  assert.equal(state.recurring.invoices.length,0,'invoice does not appear at resumption before its revised due date')
  await until([preview.effects.revisedRenewalAt,end.revisedRenewalAt].sort().at(-1))
  for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled({cron:'* * * * *'})
  state=await h.state()
  for(const [p,t] of [[member,terms],[direct,directTerms]]){
    const invoices=state.recurring.invoices.filter(i=>i.recurringTermsId===t.id)
    assert.equal(invoices.length,1);assert.equal(invoices[0].amountCents,12000)
    assert.equal(state.charges.filter(c=>c.invoiceId===invoices[0].id).length,1,'real persisted balance charge')
    assert.equal(state.balances.find(b=>b.personId===p.id).balanceCents,p.id===member.id?29000:25000)
    assert.equal(state.packs.filter(p=>p.recurringTermsId===t.id).length,1)
    assert.equal(state.packs.find(p=>p.recurringTermsId===t.id).remaining,5)
  }
  assert.equal(state.recurring.invoices.filter(i=>i.recurringTermsId===stoppedTerms.id).length,0)
  assert.equal(state.balances.find(b=>b.personId===stranger.id).balanceCents,12000)
  const deliveries=(await h.db.prepare("SELECT source_id,status,COUNT(*) AS count FROM st_notice_deliveries WHERE source_id LIKE 'freeze-resume:%' GROUP BY source_id,status").all()).results
  assert.equal(deliveries.length,2);assert.ok(deliveries.every(d=>d.count===1&&d.status==='accepted'));assert.equal(sent.filter(m=>m.subject==='Membership resumed').length,2)
  if(process.env.STRAP_PROOF_DIR)await(await import('./freezes-browser.mjs')).freezesBrowser(h,{member,direct,stranger,typeId:type.id})
},{auth:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'synthetic-strap-21'},outbound:async request=>{assert.equal(request.url,'https://api.resend.com/emails');sent.push(await request.json());return Response.json({id:'synthetic-strap-'+sent.length})}})})
