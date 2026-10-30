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

// Calendar approvals use public doors. Persisted history fixtures exercise due clock boundaries without a production clock override.
test('PLAN-006/011: exact member and direct freezes, original funding, earlier resumption and real revised renewal invoices once',{timeout:240_000},async()=>{const sent=[];await run(async h=>{
  await h.confirmSetup(h.owner)
  await h.cmd('studio.save',{location:'Park Slope',timeZone:'America/New_York'})
  const instructor=await h.person('Maya','instructor'),member=await h.person('Ana'),direct=await h.person('Lena'),stranger=await h.person('Noah')
  const type=await h.cmd('freeze.type.save',{name:'Medical',reason:'Agreed time away',feeCents:1000,defaultLengthDays:30,maxLengthDays:366,allowedStartDays:[1,2,3,4,5,6,7],allowOpenEnded:true})
  const refused=async(name,input,cookie,status,error)=>{const before=(await h.state()).version,r=await h.send('/api/strap/command',{name,input},cookie);assert.equal(r.status,status,r.text);if(error)assert.match(r.value.error,error);assert.equal((await h.state()).version,before,'refused commands write nothing');return r}
  const sale=async(person,expiresAt)=>{const approved=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:person.id,credits:5,amountCents:12000,expiresAt,guestTerms:{passes:1,period:'month',rollover:0,services:[],perGuest:1,windowDays:365,excess:'refuse',priceCents:0}})).id});return(await h.state()).packs.find(p=>p.id===approved.id)}
  // Every automatic invoice needs a source-checked proposal and the member's own consent.
  const day=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date());
  const midnight=date=>{for(const hours of [4,5]){const value=new Date(Date.parse(date+'T00:00:00Z')+hours*3600000).toISOString();const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));if(`${parts.year}-${parts.month}-${parts.day}`===date&&parts.hour==='00')return value;}throw new Error('NY midnight fixture');};
  const expiry=second(90*86400000),pack=await sale(member,expiry),directPack=await sale(direct,expiry)
  const recurring=async(person,p,requestId)=>{const proposal=await h.cmd('plan.recurring.prepare',{packId:p.id,intervalMonths:1,requestId});await refused('plan.recurring.accept',{id:proposal.id,key:proposal.key},h.owner,403);await refused('plan.recurring.accept',{id:proposal.id,key:proposal.key},person.id===stranger.id?member.cookie:stranger.cookie,404);return h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},person.cookie)}
  const terms=await recurring(member,pack,'synthetic-strap-recurring-1'),directTerms=await recurring(direct,directPack,'synthetic-strap-recurring-2')
  const stoppedPack=await sale(stranger,second(30_000))
  const stoppedTerms=await recurring(stranger,stoppedPack,'synthetic-strap-stopped-agreement')
  await refused('plan.recurring.stop',{id:stoppedTerms.id,reason:'Withdraw future invoice consent',requestId:'synthetic-strap-stop-denied'},member.cookie,404)
  const stop={id:stoppedTerms.id,requestId:'synthetic-strap-stop'}
  await h.cmd('plan.recurring.stop',stop,stranger.cookie); await h.cmd('plan.recurring.stop',stop,stranger.cookie)
  const startAt=day(today,2),endAt=day(today,5),classAt=startAt+'T12:00:00.000Z',outsideAt=endAt+'T12:00:00.000Z'
  function plus(at,ms){return new Date(Date.parse(at)+ms).toISOString()}
  const publish=async(title,start)=>{return(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:weekOf(start),classes:[{title,room:title,start,end:plus(start,500),capacity:5,instructorId:instructor.id}]})).id})).classes[0]}
  const inside=await publish('Morning Mat',classAt),outside=await publish('Evening Flow',outsideAt),extra=await publish('Reformer practice',startAt+'T13:00:00.000Z')
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
  assert.equal(stale.effects.durationDays,3);
  assert.equal(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(stale.effects.revisedRenewalAt)),day(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(expiry)),3))
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
  await refused('freeze.confirm',{id:preview.id,key:preview.key,requestId:'synthetic-strap-unaccepted'},h.owner,409,/freeze_member_acceptance_required/);
  await h.cmd('freeze.accept',{id:preview.id,key:preview.key},member.cookie);
  const confirm={id:preview.id,key:preview.key,requestId:'synthetic-strap-freeze-confirm',channel:'phone'}
  const confirmed=await h.cmd('freeze.confirm',confirm)
  assert.deepEqual(await h.cmd('freeze.confirm',confirm),confirmed)
  let state=await h.state(),changed=state.packs.find(p=>p.id===pack.id)
  assert.equal(changed.remaining,4,'only the retained outside booking still uses credit')
  assert.equal(changed.expiresAt,preview.effects.revisedExpiresAt)
  assert.equal(state.bookings.find(b=>b.id===kept.id).status,'booked')
  assert.equal(state.bookings.find(b=>b.id===cancelled.id).cancellation,'freeze');
  assert.equal(state.bookings.find(b=>b.id===guestSeat.id).cancellation,'freeze');
  assert.ok((await h.state(stranger.cookie)).notices.some(n=>n.subject==='Guest booking cancelled for a membership freeze'));
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
  const directStart=day(today,2),directEnd=day(today,4)
  const directPreview=await h.cmd('freeze.prepare',{packId:directPack.id,freezeTypeId:type.id,startAt:directStart,endAt:null,reason:'Travel leave agreed at the desk',requestId:'synthetic-strap-direct',channel:'desk'})
  assert.equal(directPreview.freezeRequestId,null);assert.equal(directPreview.effects.revisedRenewalAt,null)
  await h.cmd('freeze.accept',{id:directPreview.id,key:directPreview.key},direct.cookie);
  await h.cmd('freeze.confirm',{id:directPreview.id,key:directPreview.key,requestId:'synthetic-strap-direct-confirm',channel:'desk'})
  const end=await h.cmd('freeze.end.prepare',{id:directPreview.id,endAt:directEnd,reason:'Member is returning earlier',requestId:'synthetic-strap-early-end',channel:'desk'})
  assert.equal(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(end.revisedRenewalAt)),day(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(expiry)),2))
  await refused('freeze.end.confirm',{id:end.id,key:end.key,requestId:'member-end'},direct.cookie,403)
  await refused('freeze.end.confirm',{id:end.id,key:end.key,requestId:'synthetic-strap-end-unaccepted'},h.owner,409,/freeze_member_acceptance_required/);
  await h.cmd('freeze.end.accept',{id:end.id,key:end.key},direct.cookie);
  await h.cmd('freeze.end.confirm',{id:end.id,key:end.key,requestId:'synthetic-strap-end-confirm',channel:'desk'})
  // A retained approved calendar history, not a mocked application clock. The
  // public scheduler sees each real date behind now, then the actual due instant.
  await h.cmd('booking.cancel',{id:kept.id},member.cookie);
  const due=plus(midnight(today),5000);
  for(const [freezeId,termId,packId,days] of [[preview.id,terms.id,pack.id,3],[directPreview.id,directTerms.id,directPack.id,2]]) {
    const all=await h.state(),f=all.freezes.freezes.find(f=>f.id===freezeId),t=all.recurring.terms.find(t=>t.id===termId),p=all.packs.find(p=>p.id===packId);
    const historicalStart=midnight(day(today,-days)),originalExpiry=plus(historicalStart,5000),approvedAt=plus(historicalStart,-3600000);
    const rows=[{...f,startAt:historicalStart,endAt:midnight(today),createdAt:approvedAt,confirmedAt:approvedAt,acceptedAt:approvedAt,effects:{...f.effects,originalExpiresAt:originalExpiry,originalRenewalAt:originalExpiry,revisedExpiresAt:due,revisedRenewalAt:due,durationDays:days}},
      {...t,nextRenewalAt:due,acceptedAt:approvedAt},{...p,termStartAt:midnight(day(today,-30)),createdAt:midnight(day(today,-30)),expiresAt:due,allowanceExpiresAt:originalExpiry}];
    for(const row of rows)await h.db.prepare('UPDATE st_records SET data=? WHERE id=?').bind(JSON.stringify(row),row.id).run();
  }
  await until(due);
  for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled({cron:'* * * * *'});
  state=await h.state()
  for(const freezeId of [preview.id,directPreview.id]){const freeze=state.freezes.freezes.find(f=>f.id===freezeId);assert.equal(freeze.status,'resumed');assert.equal(freeze.resumptionCount,1)}
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
  // Timetable edits cannot carry a retained allocation into its frozen interval.
  const sofia=await h.person('Sofia'),sofiaPack=await sale(sofia,'2099-12-31T00:00:00.000Z');
  const series=(await h.cmd('series.publish',{id:(await h.cmd('series.prepare',{startDate:'2098-01-06',endDate:'2098-01-06',time:'09:00',minutes:30,intervalWeeks:1,title:'Morning Pilates',service:'Mat',room:'Timetable studio',capacity:4,instructorId:instructor.id})).id}));
  await h.cmd('booking.book',{classId:series.classes[0].id},sofia.cookie);
  const seriesFreeze=await h.cmd('freeze.prepare',{packId:sofiaPack.id,freezeTypeId:type.id,startAt:'2098-01-07',endAt:'2098-01-08',reason:'Planned absence',requestId:'synthetic-strap-series-freeze'});
  await h.cmd('freeze.accept',{id:seriesFreeze.id,key:seriesFreeze.key},sofia.cookie);
  await h.cmd('freeze.confirm',{id:seriesFreeze.id,key:seriesFreeze.key,requestId:'synthetic-strap-series-confirm'});
  await refused('series.change.prepare',{classId:series.classes[0].id,scope:'this',reason:'Move into frozen day',change:{startDate:'2098-01-07'}},h.owner,409,/series_booking_membership_frozen/);
  await scopedFreezes(h,{member:stranger,type,day,today,midnight});
  if(process.env.STRAP_PROOF_DIR)await(await import('./freezes-browser.mjs')).freezesBrowser(h,{member,direct,stranger,typeId:type.id})
},{auth:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'synthetic-strap-21'},outbound:async request=>{assert.equal(request.url,'https://api.resend.com/emails');sent.push(await request.json());return Response.json({id:'synthetic-strap-'+sent.length})}})})


test('PLAN-006 / BILL-005: calendar freezes retain paid allowances, caps and exact consent while recurring terms remind, stop and reconnect safely',()=>run(async h=>{
  await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Pasadena',timeZone:'America/New_York'});
  const member=await h.person('Nora'),guest=await h.person('Ari'),payer=await h.person('Sam'),coach=await h.person('Sage','instructor');
  const sell=async(person,input={})=>{const r=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:person.id,credits:5,amountCents:10000,expiresAt:'2098-07-01T04:00:00.000Z',...input})).id});return(await h.state()).packs.find(p=>p.id===r.id)};
  const publish=async(title,start)=>{const d=new Date(start),week=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10);return(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[{title,service:'Mat',room:title,start,end:new Date(Date.parse(start)+1800000).toISOString(),capacity:5,instructorId:coach.id}]})).id})).classes[0]};
  const pack=await sell(member,{kind:'visits',credits:undefined,visits:2,period:'month',rollover:0,guestTerms:{passes:1,period:'month',rollover:0,services:['Mat'],perGuest:10,windowDays:365,excess:'charge',priceCents:2500}});
  const proposal=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:12,requestId:'synthetic-strap-501'});
  assert.match(proposal.consent,/until stopped/);assert.ok(proposal.consent.includes('100.00'));assert.ok(proposal.consent.includes(proposal.nextRenewalAt));assert.ok(proposal.consent.includes(proposal.stopPath));
  const agreed=await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie);assert.ok(agreed.acknowledgement);assert.ok(agreed.retention);assert.match(proposal.consent,/every 12 calendar month/);assert.deepEqual([agreed.acknowledgement.text,agreed.acknowledgement.amountCents,agreed.acknowledgement.intervalMonths,agreed.acknowledgement.firstDueAt,agreed.acknowledgement.stopPath],[proposal.consent,10000,12,proposal.firstDueAt,proposal.stopPath]);
  assert.equal((await h.cmd('plan.change.prepare',{packId:pack.id,mode:'renewal',credits:7,amountCents:11000,expiresAt:'2099-12-31T00:00:00.000Z',requestId:'synthetic-strap-499'},h.owner,409)).error,'stop_recurring_invoices_before_plan_change');
  const type=await h.cmd('freeze.type.save',{name:'Travel',reason:'Agreed travel',feeCents:1000,defaultLengthDays:30,maxLengthDays:60,allowedStartDays:[1,2,3,4,5,6,7],allowOpenEnded:false,maxFreezes:1,maxDays:30});
  const input={packId:pack.id,freezeTypeId:type.id,startAt:'2098-03-01',endAt:'2098-03-31',reason:'Travel confirmed',requestId:'synthetic-strap-502'};
  const preview=await h.cmd('freeze.prepare',input);assert.equal(preview.effects.durationDays,30);assert.equal(preview.effects.revisedExpiresAt,'2098-07-31T04:00:00.000Z','billing stays at midnight through the March DST change');
  const autumn=await sell(guest,{expiresAt:'2098-10-20T04:00:00.000Z'});const fall=await h.cmd('freeze.prepare',{packId:autumn.id,freezeTypeId:type.id,startAt:'2098-09-01',endAt:'2098-10-01',reason:'Autumn travel',requestId:'synthetic-strap-497'});assert.equal(fall.effects.revisedExpiresAt,'2098-11-19T05:00:00.000Z','expiry crosses November DST at studio midnight');
  const before=(await h.state()).version;assert.equal((await h.cmd('freeze.confirm',{id:preview.id,key:preview.key,requestId:'synthetic-strap-503'},h.owner,409)).error,'freeze_member_acceptance_required');assert.equal((await h.state()).version,before);
  await h.cmd('freeze.accept',{id:preview.id,key:preview.key},member.cookie);await h.cmd('freeze.confirm',{id:preview.id,key:preview.key,requestId:'synthetic-strap-504'});
  const first=await publish('Late June Mat','2098-06-29T13:00:00.000Z'),second=await publish('Extra July Mat','2098-07-03T13:00:00.000Z'),third=await publish('Another July Mat','2098-07-04T13:00:00.000Z');
  await h.cmd('booking.book',{classId:first.id},member.cookie);await h.cmd('booking.book',{classId:second.id},member.cookie);assert.equal((await h.cmd('booking.book',{classId:third.id},member.cookie,409)).error,'plan_visits_used','the extension adds no July allowance');
  await h.cmd('guest.consent.save',{sponsorEmail:member.email,consent:true},guest.cookie);await h.cmd('guest.consent.save',{sponsorEmail:member.email,kind:'payer',consent:true,maxChargeCents:2500},payer.cookie);
  const one=await h.cmd('guest.preview',{sponsorId:member.id,packId:pack.id,guestId:guest.id,classId:first.id},member.cookie);await h.cmd('guest.book',{id:one.id,confirm:true},member.cookie);
  const extra=await h.cmd('guest.preview',{sponsorId:member.id,packId:pack.id,guestId:guest.id,classId:second.id,payerId:payer.id},member.cookie);assert.equal(extra.funding,'paid','the extension adds no guest pass');await h.cmd('guest.book',{id:extra.id,confirm:true},member.cookie);
  const end=await h.cmd('freeze.end.prepare',{id:preview.id,endAt:'2098-03-21',reason:'Return earlier',requestId:'synthetic-strap-505'});await h.cmd('freeze.end.accept',{id:end.id,key:end.key},member.cookie);await h.cmd('freeze.end.confirm',{id:end.id,key:end.key,requestId:'synthetic-strap-506'});
  const other=await sell(member,{expiresAt:'2099-12-31T00:00:00.000Z'});assert.equal((await h.cmd('freeze.prepare',{packId:other.id,freezeTypeId:type.id,startAt:'2098-05-01',endAt:'2098-05-02',reason:'Another trip',requestId:'synthetic-strap-507'},h.owner,409)).error,'freeze_count_cap_reached');
  const dayCap=await h.cmd('freeze.type.save',{name:'Short leave',reason:'At most one day per year',feeCents:0,defaultLengthDays:1,maxLengthDays:2,maxDays:1,allowedStartDays:[1,2,3,4,5,6,7]});assert.equal((await h.cmd('freeze.prepare',{packId:other.id,freezeTypeId:dayCap.id,startAt:'2098-05-01',endAt:'2098-05-03',requestId:'synthetic-strap-498'},h.owner,409)).error,'freeze_day_cap_reached');
  const askFree=await h.cmd('freeze.request',{packId:other.id,freezeTypeId:dayCap.id,startAt:'2098-06-01',endAt:'2098-06-02',reason:'One quiet day',requestId:'synthetic-strap-496'},member.cookie);const movedFree=await h.cmd('freeze.prepare',{packId:other.id,freezeRequestId:askFree.id,freezeTypeId:dayCap.id,startAt:'2098-06-02',endAt:'2098-06-03',exceptionReason:'Studio closed that day',requestId:'synthetic-strap-495'});const v=(await h.state()).version;assert.equal((await h.cmd('freeze.confirm',{id:movedFree.id,key:movedFree.key,requestId:'synthetic-strap-494'},h.owner,409)).error,'freeze_member_acceptance_required');assert.equal((await h.state()).version,v);
  const current=(await h.state()).freezes.freezes.find(f=>f.id===preview.id);const withdrawn=await h.cmd('freeze.withdraw',{id:current.id,withdrawKey:current.withdrawal.key,requestId:'synthetic-strap-508'},member.cookie);assert.equal(withdrawn.status,'withdrawn');
  const fee=(await h.state()).charges.find(c=>c.freezeId===preview.id&&c.amountCents===1000);assert.equal((await h.state()).charges.filter(c=>c.reversesChargeId===fee.id&&c.personId===member.id&&c.amountCents===-1000).length,1);
  const reversed=(await h.state()).charges.filter(c=>c.bookingId&&c.reason==='guest_drop_in_reversal');assert.equal(reversed.length,1);assert.equal(reversed[0].personId,payer.id);assert.equal(reversed[0].amountCents,-2500);
  assert.ok((await h.state(guest.cookie)).notices.some(n=>n.subject==='Guest booking cancelled after a freeze withdrawal'));
  const after=(await h.state()).freezes.freezes.find(f=>f.id===preview.id);assert.equal(after.status,'withdrawn');assert.equal((await h.state()).packs.find(p=>p.id===pack.id).expiresAt,pack.expiresAt);
  const retained=(await h.state()).recurring.terms.find(t=>t.id===agreed.id);assert.equal(retained.nextRenewalAt,pack.expiresAt);
  await h.cmd('plan.recurring.stop',{id:agreed.id,requestId:'synthetic-strap-509'},member.cookie);assert.equal((await h.state()).packs.find(p=>p.id===pack.id).expiresAt,pack.expiresAt,'reasonless stop keeps access through the paid term');
  // A rolling day cap counts the overlap, rather than every day of an old freeze.
  const rollingMember=await h.person('Reina'),historicPack=await sell(rollingMember,{expiresAt:'2099-12-31T00:00:00.000Z'}),newPack=await sell(rollingMember,{expiresAt:'2099-12-31T00:00:00.000Z'});
  const rollingType=await h.cmd('freeze.type.save',{name:'Rolling leave',reason:'Agreed leave',feeCents:0,defaultLengthDays:20,maxLengthDays:30,maxDays:30,allowedStartDays:[1,2,3,4,5,6,7]});
  const historical=await h.cmd('freeze.prepare',{packId:historicPack.id,freezeTypeId:rollingType.id,startAt:'2098-01-01',endAt:'2098-01-21',requestId:'synthetic-strap-490'});await h.cmd('freeze.confirm',{id:historical.id,key:historical.key,requestId:'synthetic-strap-491'});
  const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date()),civil=days=>new Date(Date.parse(localDay+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
  const midnight=date=>{const nominal=Date.parse(date+'T00:00:00Z');let at=nominal;for(let i=0;i<2;i++){const offset=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'}).formatToParts(new Date(at)).find(p=>p.type==='timeZoneName').value;at=nominal-Number(offset.replace('GMT',''))*3600000;}return new Date(at).toISOString()};
  await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.startAt',?,'$.endAt',?,'$.status','resumed','$.confirmedAt',?,'$.resumedAt',?) WHERE id=?").bind(midnight(civil(-358)),midnight(civil(-338)),midnight(civil(-359)),midnight(civil(-338)),historical.id).run();
  await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.createdAt',?,'$.termStartAt',?) WHERE id=?").bind(midnight(civil(-400)),midnight(civil(-400)),historicPack.id).run();
  const rolled=await h.cmd('freeze.prepare',{packId:newPack.id,freezeTypeId:rollingType.id,startAt:civil(2),endAt:civil(32),requestId:'synthetic-strap-492'});assert.equal(rolled.effects.durationDays,30,'old days age out while new days accrue, staying within each rolling window');
  // These are accepted historical agreements, not a production clock override.
  const saveRecord=async(kind,value)=>h.db.prepare('UPDATE st_records SET data=? WHERE kind=? AND id=?').bind(JSON.stringify(value),kind,value.id).run();
  const invoiceMember=await h.person('Inez'),oldMember=await h.person('Mateo');
  const invoicePack=await sell(invoiceMember),oldPack=await sell(oldMember);
  const agree=async(pack,who,months)=>{const p=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:months,requestId:'synthetic-strap-'+pack.id});return h.cmd('plan.recurring.accept',{id:p.id,key:p.key},who.cookie)};
  const annual=await agree(invoicePack,invoiceMember,12),old=await agree(oldPack,oldMember,1);
  const at=new Date(),due=new Date(at.getTime()+20*86400000).toISOString(),accepted=new Date(at);accepted.setUTCFullYear(accepted.getUTCFullYear()-1);accepted.setUTCDate(accepted.getUTCDate()+20);
  await saveRecord('recurringTerms',{...annual,acceptedAt:accepted.toISOString(),nextRenewalAt:due});await saveRecord('pack',{...invoicePack,expiresAt:due});
  const overdue=new Date(at);overdue.setUTCMonth(overdue.getUTCMonth()-3);await saveRecord('recurringTerms',{...old,nextRenewalAt:overdue.toISOString()});await saveRecord('pack',{...oldPack,expiresAt:overdue.toISOString()});
  await h.mf.getWorker().then(w=>w.scheduled());await h.mf.getWorker().then(w=>w.scheduled());
  let billing=(await h.state()).recurring;
  const reminders=billing.reminders.filter(r=>r.recurringTermsId===annual.id);assert.ok(reminders.some(r=>r.kinds.includes('annual')));assert.ok(reminders.some(r=>r.kinds.includes('renewal')));
  assert.equal(new Set(reminders.map(r=>r.id)).size,reminders.length);assert.ok(reminders.every(r=>r.body.includes(annual.stopPath)&&r.body.includes('until stopped')));
  assert.equal(billing.terms.find(r=>r.id===old.id).failure,'billing_period_already_ended');assert.equal(billing.invoices.filter(r=>r.recurringTermsId===old.id).length,0,'ended periods create no backlog debt');
  assert.equal((await h.state()).charges.filter(c=>c.recurringTermsId===old.id).length,0);
  const connection=billing.connection,previousOrigin='https://prior-studio.example';
  await h.db.prepare("UPDATE st_contract_connections SET origin=? WHERE id='billing'").bind(previousOrigin).run();
  for(const term of billing.terms.filter(r=>r.acceptedAt&&['active','needs_review'].includes(r.status)))await saveRecord('recurringTerms',{...term,billingOrigin:previousOrigin});
  const reconnect={previousOrigin,connectionId:connection.connectionId,requestId:'synthetic-strap-510'};
  assert.equal((await h.cmd('plan.recurring.reconnect',reconnect,invoiceMember.cookie,403)).error,'owner_required');
  const moved=await h.cmd('plan.recurring.reconnect',reconnect);assert.ok(moved.agreementIds.includes(annual.id));assert.deepEqual(await h.cmd('plan.recurring.reconnect',reconnect),moved);
  billing=(await h.state()).recurring;const currentAgreement=billing.terms.find(r=>r.id===annual.id);assert.deepEqual(currentAgreement.acknowledgement,annual.acknowledgement);assert.equal(currentAgreement.billingOrigin,h.origin);assert.equal(currentAgreement.nextRenewalAt,due);
  assert.ok((await h.state(invoiceMember.cookie)).notices.some(n=>n.subject==='Recurring invoices moved to the new studio address'));
  await h.db.prepare("DELETE FROM st_contract_connections WHERE id='billing'").run();
  assert.equal((await h.cmd('plan.recurring.reconnect',{...reconnect,requestId:'synthetic-strap-511'},h.owner,409)).error,'fresh_member_acceptance_required');

}))


test('PLAN-007: one-step member, payer and guardian cancellation supersedes freezes, preserves exact paid-value refunds and ends once across restart', {timeout:240000},async()=>{await run(async h=>{
  await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Pasadena',timeZone:'America/New_York'});
  const nina=await h.person('Nina'),payer=await h.person('Oscar'),guest=await h.person('Mira'),guardian=await h.person('Jo'),child=await h.person('Kira'),stranger=await h.person('Noah'),coach=await h.person('Ian','instructor');
  const day=86400000,now=Date.now(),iso=ms=>new Date(ms).toISOString(),date=days=>iso(now+days*day).slice(0,10);
  const sell=async(who,extra={})=>{const ack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:who.id,credits:6,amountCents:12000,expiresAt:iso(now+90*day),...extra})).id});return(await h.state()).packs.find(p=>p.id===ack.id)};
  const agree=async(pack,who)=>{const p=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:'synthetic-strap-'+pack.id});return h.cmd('plan.recurring.accept',{id:p.id,key:p.key},who.cookie)};
  const save=async(kind,value)=>h.db.prepare('UPDATE st_records SET data=? WHERE kind=? AND id=?').bind(JSON.stringify(value),kind,value.id).run();
  const publish=async(title,start)=>{const d=new Date(start),week=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10);return(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[{title,service:'Mat',room:title,start,end:iso(Date.parse(start)+1800000),capacity:8,instructorId:coach.id}]})).id})).classes[0]};
  const pack=await sell(nina,{guestTerms:{passes:1,period:'month',rollover:0,services:['Mat'],perGuest:10,windowDays:365,excess:'charge',priceCents:2500}}),terms=await agree(pack,nina);
  const type=await h.cmd('freeze.type.save',{name:'Travel',reason:'Family travel',feeCents:1000,defaultLengthDays:2,maxLengthDays:30,allowedStartDays:[1,2,3,4,5,6,7]});
  const freeze=await h.cmd('freeze.prepare',{packId:pack.id,freezeTypeId:type.id,startAt:date(2),endAt:date(4),requestId:'synthetic-strap-601'});await h.cmd('freeze.accept',{id:freeze.id,key:freeze.key},nina.cookie);await h.cmd('freeze.confirm',{id:freeze.id,key:freeze.key,requestId:'synthetic-strap-602'});
  const later=await publish('Future Mat',iso(now+91*day)),own=await h.cmd('booking.book',{classId:later.id},nina.cookie);
  await h.cmd('guest.consent.save',{sponsorEmail:nina.email,consent:true},guest.cookie);const q=await h.cmd('guest.preview',{sponsorId:nina.id,guestId:guest.id,packId:pack.id,classId:later.id},nina.cookie),seat=await h.cmd('guest.book',{id:q.id,confirm:true},nina.cookie);
  const unrelated=await sell(stranger),unrelatedCharge=(await h.state()).charges.find(c=>c.packId===unrelated.id);
  const cancelled=await h.cmd('plan.cancellation.stop',{packId:pack.id,requestId:'synthetic-strap-603'},nina.cookie);assert.equal(cancelled.status,'scheduled');assert.equal(cancelled.effectiveAt,pack.expiresAt);
  assert.equal((await h.state()).freezes.freezes.find(f=>f.id===freeze.id).status,'withdrawn');assert.equal((await h.state()).charges.filter(c=>c.freezeId===freeze.id).reduce((n,c)=>n+c.amountCents,0),0);
  assert.deepEqual(await h.cmd('plan.cancellation.stop',{packId:pack.id,requestId:'synthetic-strap-603'},nina.cookie),cancelled);
  assert.equal((await h.state(stranger.cookie)).cancellations.cancellations.length,0);assert.ok(!JSON.stringify((await h.state(nina.cookie)).cancellations).includes(unrelatedCharge.id),'member cancellation keys and valuation disclose no unrelated debt');
  await h.cmd('plan.cancellation.withdraw.prepare',{id:cancelled.id,requestId:'synthetic-strap-604'},h.owner,403);
  const withdrawal=await h.cmd('plan.cancellation.withdraw.prepare',{id:cancelled.id,requestId:'synthetic-strap-605'},nina.cookie);await h.cmd('plan.cancellation.withdraw.confirm',{id:withdrawal.id,key:withdrawal.key,requestId:'synthetic-strap-606'},nina.cookie);
  assert.equal((await h.state()).recurring.terms.find(t=>t.id===terms.id).status,'stopped','withdrawal never restores invoice authority');
  const fresh=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:'synthetic-strap-607'});assert.equal((await h.state()).recurring.terms.find(t=>t.id===fresh.id).status,'preview');await h.cmd('plan.recurring.accept',{id:fresh.id,key:fresh.key},nina.cookie);
  const authority=await h.cmd('contract.authority.save',{personId:nina.id,delegateId:payer.id,kind:'payer',evidenceReference:'synthetic-strap-608'});assert.equal((await h.state(payer.cookie)).cancellations.authorities.some(g=>g.id===authority.id),false,'an owner proposal discloses no member identity or agreement facts to the payer before participant consent');await h.cmd('contract.authority.accept',{id:authority.id},payer.cookie,404);
  await h.cmd('plan.cancellation.stop',{packId:pack.id,requestId:'synthetic-strap-609'},payer.cookie,404);await h.cmd('contract.authority.accept',{id:authority.id},nina.cookie);await h.cmd('contract.authority.accept',{id:authority.id},payer.cookie);
  const payerCancel=await h.cmd('plan.cancellation.stop',{packId:pack.id,requestId:'synthetic-strap-610'},payer.cookie);assert.equal(payerCancel.terminatedBy,(await h.state(payer.cookie)).actor.id);
  assert.ok((await h.state(payer.cookie)).notices.some(n=>n.subject==='Cancellation confirmed'));
  const cutoff=iso(Date.now()+1800);await save('contractCancellation',{...payerCancel,effectiveAt:cutoff});await save('pack',{...(await h.state()).packs.find(p=>p.id===pack.id),expiresAt:cutoff});
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(cutoff)-Date.now()+100)));await(await h.mf.getWorker()).scheduled();await h.setAuth({});await(await h.mf.getWorker()).scheduled();
  let state=await h.state();assert.equal(state.cancellations.cancellations.find(c=>c.id===payerCancel.id).status,'applied');assert.equal(state.cancellations.statements.filter(c=>c.cancellationId===payerCancel.id).length,1);assert.ok([own.id,seat.id].every(id=>state.bookings.find(b=>b.id===id).status==='cancelled'));assert.equal(state.recurring.invoices.length,0);assert.ok((await h.state(guest.cookie)).notices.some(n=>n.subject==='Guest booking cancelled'));
  const childPack=await sell(child);await agree(childPack,child);const grant=await h.cmd('contract.authority.save',{personId:child.id,delegateId:guardian.id,kind:'minor-guardian',adultOn:date(730),evidenceReference:'synthetic-strap-611'});await h.cmd('contract.authority.accept',{id:grant.id},guardian.cookie);await h.cmd('contract.authority.revoke',{id:grant.id},child.cookie,404);
  assert.equal((await h.cmd('plan.cancellation.stop',{packId:childPack.id,requestId:'synthetic-strap-612'},guardian.cookie)).status,'scheduled');
  const prepaid=await sell(nina,{expiresAt:iso(Date.now()+30*day)});const prepaidTerms=await agree(prepaid,nina);assert.ok(!(await h.state(payer.cookie)).cancellations.contracts.some(t=>t.id===prepaidTerms.id));await h.cmd('plan.cancellation.stop',{packId:prepaid.id,requestId:'synthetic-strap-623'},payer.cookie,404);await save('pack',{...prepaid,termStartAt:iso(Date.now()-30*day)});
  const payment=await h.cmd('payment.record',{personId:nina.id,amountCents:12000,reference:'synthetic-strap-613'}),charge=(await h.state()).charges.find(c=>c.packId===prepaid.id&&c.amountCents===12000);
  const allocation={packId:prepaid.id,paymentId:payment.id,chargeId:charge.id,amountCents:12000,reference:'synthetic-strap-614'};await h.cmd('contract.prepayment.record',allocation);await h.cmd('contract.prepayment.record',{...allocation,reference:'synthetic-strap-615'},h.owner,409);
  const ended=await h.cmd('plan.cancellation.statutory',{packId:prepaid.id,reasonCode:'relocation',relocationMiles:30,documentedAt:iso(Date.now()-1000),evidenceReference:'synthetic-strap-616',requestId:'synthetic-strap-617'},nina.cookie);assert.equal(ended.status,'applied');
  state=await h.state();const refund=state.cancellations.refunds.find(r=>r.cancellationId===ended.id);assert.equal(refund.status,'refund_due');assert.equal(refund.amountCents,6000);assert.equal(refund.amountCents,Number((2n*12000n*BigInt(refund.formula.unusedMs)+BigInt(refund.formula.durationMs))/(2n*BigInt(refund.formula.durationMs))));
  const settle={id:refund.id,payerId:nina.id,amountCents:refund.amountCents,reference:'synthetic-strap-618',settledAt:iso(Date.now()-1000)};await h.cmd('plan.cancellation.refund.settle',settle);await h.cmd('plan.cancellation.refund.settle',settle);assert.equal((await h.state()).cancellations.settlements.filter(r=>r.refundId===refund.id).length,1);assert.equal((await h.state()).cancellations.refunds.find(r=>r.id===refund.id).status,'settled');
  const cooling=await sell(guest),coolingTerms=await agree(cooling,guest);await save('recurringTerms',{...coolingTerms,acceptedAt:iso(Date.now()-6*day)});assert.equal((await h.cmd('plan.cancellation.statutory',{packId:cooling.id,reasonCode:'cooling-off',documentedAt:iso(Date.now()-100),evidenceReference:'synthetic-strap-619',requestId:'synthetic-strap-620'},guest.cookie)).status,'applied','weekends do not consume the protective business-day window');
  const lateTerms=await agree(unrelated,stranger);await save('recurringTerms',{...lateTerms,acceptedAt:iso(Date.now()-30*day)});const lateCopy=(await h.state()).cancellations.contracts.find(t=>t.id===lateTerms.id).copy;await h.cmd('contract.copy.delivery.record',{termsId:lateTerms.id,digest:lateCopy.digest,deliveredAt:iso(Date.now()-30*day),evidenceReference:'synthetic-strap-624',requestId:'synthetic-strap-625'});assert.equal((await h.cmd('plan.cancellation.statutory',{packId:unrelated.id,reasonCode:'cooling-off',documentedAt:iso(Date.now()-100),evidenceReference:'synthetic-strap-621',requestId:'synthetic-strap-622'},stranger.cookie,409)).error,'cooling_off_window_ended');
  if(process.env.STRAP_PROOF_DIR)await(await import('./cancellations-browser.mjs')).cancellationsBrowser(h,{nina,payer,guardian,child,stranger});
});await run(async h=>{await h.confirmSetup(h.owner);await(await import('./contract-authority-cases.mjs')).authorityCases(h);});})


test('PLAN-007: delivered contract copies and state-specific cooling clocks preserve the longest right and refund timely NY renewals',async()=>{await run(async h=>{
  await h.confirmSetup(h.owner);const cases=await(await import('./cooling-off-cases.mjs')).coolingOffCases(h);
  if(process.env.STRAP_PROOF_DIR)await(await import('./cooling-off-browser.mjs')).coolingOffBrowser(h,cases);
});await run(async h=>{await h.confirmSetup(h.owner);const cases=await(await import('./cooling-refund-cases.mjs')).coolingRefundCases(h);if(process.env.STRAP_PROOF_DIR)await(await import('./cooling-refunds-browser.mjs')).coolingRefundsBrowser(h,cases);});
  // Keep the extra real sign-ins within the same per-installation auth limits.
  if(process.env.STRAP_PROOF_DIR)await run(async h=>{await h.confirmSetup(h.owner);await(await import('./cooling-refunds-browser.mjs')).coolingRefundsBrowser(h,null,{fixOnly:true});});})

test('PLAN-008: scheduled annual and price disclosures retain accepted terms, deliver once through Base mail and cancel without renewal invoices',async()=>{
  if(process.env.STRAP_DISCLOSURE_TIMING==='1'){await(await import('./renewal-disclosure-timing.mjs')).disclosureTiming();return;}
  const sent=[];let failDisclosure=false,failedAttempts=0
  await run(async h=>{
    await h.confirmSetup(h.owner)
    const member=await h.person('DisclosureMember'),other=await h.person('DisclosureOther'),day=86400000,base=Date.now(),at=d=>new Date(base+d*day).toISOString()
    const buy=async()=>h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt:at(60)})).id})
    const pack=await buy(),p=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:12,requestId:'synthetic-strap-annual'})
    const terms=await h.cmd('plan.recurring.accept',{id:p.id,key:p.key},member.cookie)
    const input={termsId:terms.id,leadDays:30,proposedAmountCents:12000,requestId:'synthetic-strap-disclosure',channel:'desk'}
    assert.equal(terms.noticeLeadDays,30);assert.match(terms.consent,/at least 30 elapsed days/);
    await h.cmd('mail.preference.save',{optedOut:true,requestId:'synthetic-strap-optout'},member.cookie);
    await h.cmd('plan.disclosure.schedule',{...input,leadDays:15,requestId:'synthetic-strap-short-notice'},h.owner,409);
    const d=await h.cmd('plan.disclosure.schedule',input)
    assert.deepEqual(await h.cmd('plan.disclosure.schedule',input),d)
    await h.cmd('plan.disclosure.schedule',{...input,requestId:'synthetic-strap-denied'},member.cookie,403)
    await h.cmd('plan.disclosure.schedule',{...input,proposedAmountCents:13000},h.owner,409)
    assert.equal(d.sendAt,new Date(Date.parse(d.dueAt)-30*day).toISOString())
    assert.equal((await h.state(other.cookie)).renewalDisclosures.length,0)
    assert.equal((await h.state(member.cookie)).renewalDisclosures[0].acceptedTermsKey,terms.key)
    await(await h.mf.getWorker()).scheduled();assert.equal(sent.length,0,'not before configured lead time')
    // A retained scheduled record crosses its agreed notice clock; no production clock override.
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.sendAt',?) WHERE id=?").bind(at(-1),d.id).run()
    await(await h.mf.getWorker()).scheduled();await(await h.mf.getWorker()).scheduled()
    const delivered=(await h.state(member.cookie)).renewalDisclosures.find(r=>r.id===d.id)
    assert.equal(delivered.status,'delivered');assert.equal(delivered.delivery.status,'accepted')
    assert.equal(sent.length,1);assert.deepEqual(sent[0].to,[member.email]);assert.match(sent[0].text,/100.00/);assert.match(sent[0].text,/120.00/);assert.ok(sent[0].text.includes(d.dueAt));assert.ok(sent[0].text.includes(d.acceptByAt));assert.ok(sent[0].text.includes(h.origin+terms.stopPath))
    assert.ok((await h.state(member.cookie)).notices.some(n=>n.id===delivered.noticeId))
    assert.equal((await h.state()).recurring.terms.find(t=>t.id===terms.id).amountCents,10000,'proposed price never rewrites agreement')
    if(process.env.STRAP_PROOF_DIR)await(await import('./renewal-disclosures-browser.mjs')).disclosuresBrowser(h,{member,disclosure:delivered,terms})
    await h.cmd('plan.recurring.stop',{id:terms.id,requestId:'synthetic-strap-stop'},member.cookie)
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.nextRenewalAt',?) WHERE id=?").bind(at(-1),terms.id).run()
    await(await h.mf.getWorker()).scheduled()
    assert.equal((await h.state()).recurring.invoices.filter(i=>i.recurringTermsId===terms.id).length,0)
    assert.equal((await h.state()).charges.filter(c=>c.recurringTermsId===terms.id).length,0)
    const pricedPack=await buy(),priceProposal=await h.cmd('plan.recurring.prepare',{packId:pricedPack.id,intervalMonths:12,requestId:'synthetic-strap-price-agreement'});
    const priceTerms=await h.cmd('plan.recurring.accept',{id:priceProposal.id,key:priceProposal.key},member.cookie);
    const priceNotice=await h.cmd('plan.disclosure.schedule',{termsId:priceTerms.id,leadDays:30,proposedAmountCents:12000,requestId:'synthetic-strap-price-notice'});
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.sendAt',?) WHERE id=?").bind(at(-1),priceNotice.id).run();await(await h.mf.getWorker()).scheduled();
    await h.cmd('plan.disclosure.accept',{id:priceNotice.id,key:priceNotice.key},h.owner,403);
    await h.cmd('plan.disclosure.accept',{id:priceNotice.id,key:priceNotice.key},other.cookie,404);
    await h.cmd('plan.disclosure.accept',{id:priceNotice.id,key:'changed'},member.cookie,409);
    const shown=(await h.state()).renewalDisclosures.find(d=>d.id===priceNotice.id);
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.deliveredAt',?) WHERE id=?").bind(new Date(Date.parse(shown.dueAt)-29*day).toISOString(),shown.id).run();
    await h.cmd('plan.disclosure.accept',{id:shown.id,key:shown.key},member.cookie,409);
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.deliveredAt',?) WHERE id=?").bind(shown.deliveredAt,shown.id).run();
    if(process.env.STRAP_PROOF_DIR)await(await import('./renewal-disclosures-browser.mjs')).priceAcceptanceBrowser(h,{member,terms:priceTerms,disclosure:priceNotice});
    const price=await h.cmd('plan.disclosure.accept',{id:priceNotice.id,key:priceNotice.key},member.cookie);
    assert.deepEqual(await h.cmd('plan.disclosure.accept',{id:priceNotice.id,key:priceNotice.key},member.cookie),price);
    assert.equal((await h.state()).recurring.terms.find(t=>t.id===priceTerms.id).amountCents,10000,'accepted future price is not charged early');
    assert.equal(price.acceptanceText,price.consent);assert.equal(price.acceptanceKey,price.key);
    // The retained accepted fixtures cross their next due instant together, as with the existing freeze calendar journey.
    const due=new Date(Date.now()+1500).toISOString(),consent=price.consent.replaceAll(price.dueAt,due);
    const key=JSON.stringify([price.id,priceTerms.id,priceTerms.key,pricedPack.id,due,10000,12000,consent]);
    const current=(await h.state()).packs.find(p=>p.id===pricedPack.id);
    for(const [kind,row] of [['renewalDisclosure',{...price,dueAt:due,acceptByAt:due,deliveredAt:new Date(Date.parse(due)-31*day).toISOString(),acceptedAtPrice:new Date(Date.parse(due)-day).toISOString(),consent,key,acceptanceKey:key,acceptanceText:consent}],['recurringTerms',{...priceTerms,nextRenewalAt:due}],['pack',{...current,expiresAt:due}]])await h.db.prepare('UPDATE st_records SET data=? WHERE kind=? AND id=?').bind(JSON.stringify(row),kind,row.id).run();
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(due)-Date.now()+30)));await(await h.mf.getWorker()).scheduled();await(await h.mf.getWorker()).scheduled();
    const applied=await h.state(),invoices=applied.recurring.invoices.filter(i=>i.recurringTermsId===priceTerms.id);
    assert.equal(invoices.length,1);assert.equal(invoices[0].amountCents,12000);assert.equal(invoices[0].priceDisclosureId,price.id);
    assert.equal(applied.charges.filter(c=>c.invoiceId===invoices[0].id).length,1);assert.equal(applied.packs.find(p=>p.id===invoices[0].packId).amountCents,12000);
    assert.equal(applied.recurring.terms.find(t=>t.id===priceTerms.id).amountCents,12000);
    assert.deepEqual(applied.recurring.terms.find(t=>t.id===priceTerms.id).acknowledgement,priceTerms.acknowledgement,'original agreement acceptance is retained verbatim');
    assert.equal(applied.cancellations.contracts.find(t=>t.id===priceTerms.id).copy.document.priceCents,10000,'the original contract copy keeps the originally accepted price');
    const stalePack=await buy(),staleProposal=await h.cmd('plan.recurring.prepare',{packId:stalePack.id,intervalMonths:12,requestId:'synthetic-strap-stale-agreement'});
    const staleTerms=await h.cmd('plan.recurring.accept',{id:staleProposal.id,key:staleProposal.key},member.cookie);
    const staleNotice=await h.cmd('plan.disclosure.schedule',{termsId:staleTerms.id,leadDays:30,proposedAmountCents:15000,requestId:'synthetic-strap-stale-price'});
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.sendAt',?) WHERE id=?").bind(at(-1),staleNotice.id).run();await(await h.mf.getWorker()).scheduled();
    await h.cmd('plan.disclosure.accept',{id:staleNotice.id,key:staleNotice.key},member.cookie);
    const changedDue=new Date(Date.now()+1200).toISOString();
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.nextRenewalAt',?) WHERE id=?").bind(changedDue,staleTerms.id).run();
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.expiresAt',?) WHERE id=?").bind(changedDue,stalePack.id).run();
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(changedDue)-Date.now()+30)));await(await h.mf.getWorker()).scheduled();
    assert.equal((await h.state()).recurring.terms.find(t=>t.id===staleTerms.id).failure,'accepted_price_source_changed');
    assert.equal((await h.state()).recurring.invoices.filter(i=>i.recurringTermsId===staleTerms.id).length,0,'a changed due date cannot reuse an accepted price silently');
    const finite=await buy(),expiryNotice=await h.cmd('plan.disclosure.schedule',{packId:finite.id,leadDays:7,requestId:'synthetic-strap-expiry'});
    assert.equal(expiryNotice.purchaseBasis.draftId,(await h.state()).packs.find(p=>p.id===finite.id).draftId);
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.sendAt',?) WHERE id=?").bind(at(-1),expiryNotice.id).run();await(await h.mf.getWorker()).scheduled();await(await h.mf.getWorker()).scheduled();
    const expiry=(await h.state(member.cookie)).renewalDisclosures.find(d=>d.id===expiryNotice.id);assert.equal(expiry.status,'delivered');assert.equal(expiry.delivery.status,'accepted');assert.match(expiry.body,/No renewal has been accepted/);
    assert.equal((await h.state()).recurring.invoices.filter(i=>i.previousPackId===finite.id).length,0);
    if(process.env.STRAP_PROOF_DIR)await(await import('./renewal-disclosures-browser.mjs')).expiryDisclosureBrowser(h,{member,disclosure:expiry});
    // A restore cannot recover authority to dispatch pending disclosures, even at the same origin.
    const second=await buy(),q=await h.cmd('plan.recurring.prepare',{packId:second.id,intervalMonths:12,requestId:'synthetic-strap-restore'})
    const accepted=await h.cmd('plan.recurring.accept',{id:q.id,key:q.key},member.cookie)
    const pending=await h.cmd('plan.disclosure.schedule',{termsId:accepted.id,leadDays:30,requestId:'synthetic-strap-pending'})
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.sendAt',?) WHERE id=?").bind(at(-1),pending.id).run()
    await h.db.prepare("DELETE FROM st_contract_connections WHERE id='billing'").run()
    await h.db.prepare('DELETE FROM st_disclosure_connections').run()
    await(await h.mf.getWorker()).scheduled();assert.equal(sent.length,3)
    assert.equal((await h.state()).renewalDisclosures.find(r=>r.id===pending.id).status,'stale')
    // A failed mandatory email remains visible in both accounts, never suppressed or retried.
    const failurePack=await buy(),failureProposal=await h.cmd('plan.recurring.prepare',{packId:failurePack.id,intervalMonths:12,requestId:'synthetic-strap-failure-terms'});
    const failureTerms=await h.cmd('plan.recurring.accept',{id:failureProposal.id,key:failureProposal.key},member.cookie);
    const failureNotice=await h.cmd('plan.disclosure.schedule',{termsId:failureTerms.id,leadDays:30,proposedAmountCents:17000,requestId:'synthetic-strap-failure-notice'});
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.sendAt',?) WHERE id=?").bind(at(-1),failureNotice.id).run();
    failDisclosure=true;await(await h.mf.getWorker()).scheduled();await(await h.mf.getWorker()).scheduled();
    assert.equal(failedAttempts,1);
    for(const cookie of [h.owner,member.cookie]){
      assert.equal((await h.state(cookie)).renewalDisclosures.find(d=>d.id===failureNotice.id).delivery.status,'uncertain');
      assert.match((await h.send('/app/packs',undefined,cookie)).text,/Email: uncertain/);
    }
    if(process.env.STRAP_PROOF_DIR)await(await import('./renewal-disclosures-browser.mjs')).failedDisclosureBrowser(h,{member,disclosure:failureNotice});
    // Expiry without acceptance invoices only the original amount; the old offer cannot be accepted late.
    const fallbackDue=new Date(Date.now()+1200).toISOString();
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.nextRenewalAt',?) WHERE id=?").bind(fallbackDue,failureTerms.id).run();
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.expiresAt',?) WHERE id=?").bind(fallbackDue,failurePack.id).run();
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.dueAt',?,'$.acceptByAt',?) WHERE id=?").bind(fallbackDue,fallbackDue,failureNotice.id).run();
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(fallbackDue)-Date.now()+30)));await(await h.mf.getWorker()).scheduled();await(await h.mf.getWorker()).scheduled();
    const fallback=(await h.state()).recurring.invoices.filter(i=>i.recurringTermsId===failureTerms.id);assert.equal(fallback.length,1);assert.equal(fallback[0].amountCents,10000);assert.equal(fallback[0].priceDisclosureId,null);
    await h.cmd('plan.disclosure.accept',{id:failureNotice.id,key:failureNotice.key},member.cookie,409);

  },{auth:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'synthetic-strap-1',MAIL_FROM:'studio@studio.example'},outbound:async request=>{
    assert.equal(request.url,'https://api.resend.com/emails');const message=await request.json()
    if(message.subject==='Proposed price change disclosure'){if(failDisclosure){failedAttempts++;throw new Error('synthetic-strap-transport-failure')}sent.push(message)}
    return Response.json({id:'synthetic-strap-mail-'+sent.length})
  }})
})


test('First-term join preview retains exact prorated debt and original receipt after later price changes',async()=>{
  if(process.env.STRAP_PRORATION_TIMING==='1'){await combinedProration();return;}
  await run(async h=>{
  await h.confirmSetup(h.owner);
  await h.cmd('studio.save',{location:'Synthetic studio',timeZone:'America/New_York'});
  const member=await h.person('Prorated'),other=await h.person('ProrationOther');
  const input={personId:member.id,credits:10,amountCents:31000,cycleStartAt:'2099-01-01T00:00:00Z',joinAt:'2099-01-16T00:00:00Z',expiresAt:'2099-02-01T00:00:00Z'};
  const draft=await h.cmd('pack.prepare',input);
  assert.equal(draft.amountCents,16000);
  assert.deepEqual([draft.proration.totalSeconds,draft.proration.remainingSeconds],[31*86400,16*86400]);
  const before=(await h.state()).version;
  await h.cmd('pack.approve',{id:draft.id},member.cookie,403);
  assert.equal((await h.state()).version,before);
  const approved=await h.cmd('pack.approve',{id:draft.id});
  const state=await h.state(),pack=state.packs.find(p=>p.id===approved.id);
  assert.equal(pack.termStartAt,'2099-01-16T00:00:00.000Z');
  assert.deepEqual(pack.proration,draft.proration);
  assert.equal(state.charges.filter(c=>c.packId===pack.id).length,1);
  assert.equal(state.charges.find(c=>c.packId===pack.id).amountCents,draft.amountCents);
  // A later plan price must never rewrite the retained purchase receipt.
  await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.amountCents',?) WHERE kind='pack' AND id=?").bind(50000,pack.id).run();
  for(const cookie of [h.owner,member.cookie]){
    const page=await h.send('/app/packs',undefined,cookie);
    assert.equal(page.status,200);assert.match(page.text,/First-term calculation/);
    const receipt=page.text.split('id="receipt-'+pack.id+'"')[1].split('</article>')[0];
    assert.match(receipt,/160\.00/);assert.doesNotMatch(receipt,/500\.00/);
  }
  assert.ok(!(await h.send('/app/packs',undefined,other.cookie)).text.includes('receipt-'+pack.id));
  await h.cmd('pack.prepare',{...input,joinAt:input.expiresAt},h.owner,400);
  await h.cmd('pack.prepare',{...input,joinAt:'2099-01-16T00:00:00.500Z'},h.owner,400);
  const stale=await h.cmd('pack.prepare',input);
  await h.cmd('person.save',{id:member.id,name:'Changed proration member',email:member.email,role:'member',active:true});
  await h.cmd('pack.approve',{id:stale.id},h.owner,409);
  const rounded=await h.cmd('pack.prepare',{...input,amountCents:1,cycleStartAt:'2099-01-01T00:00:00Z',joinAt:'2099-01-02T00:00:00Z',expiresAt:'2099-01-03T00:00:00Z'});
  assert.equal(rounded.amountCents,1,'half a cent rounds up');
  if(process.env.STRAP_PROOF_DIR)await(await import('./campaign-browser.mjs')).prorationBrowser(h,{member});
});
});

// Exact-date public-door journey. Run with the existing process clock helper,
// STRAP_PRORATION_TIMING=1 and a private STRAP_RECOVERY_CLOCK offset file.
async function combinedProration(){
  const {readFile,writeFile,rename}=await import('node:fs/promises'),{totp}=await import('./mfa-helpers.mjs');
  const path=process.env.STRAP_RECOVERY_CLOCK,original=await readFile(path,'utf8');let offset=Number(original);
  try{await run(async h=>{
    let owner=h.owner,member;
    const originalState=h.state;h.state=(cookie=owner,...rest)=>originalState(cookie,...rest);
    const cmd=(name,input,cookie=owner,status=200)=>h.cmd(name,input,cookie,status);
    const jump=async target=>{
      offset=Math.ceil((Date.parse(target)-(Date.now()-offset*1000))/1000);
      await writeFile(path+'.new',String(offset));await rename(path+'.new',path);
      await new Promise(resolve=>setTimeout(resolve,50));
      owner=await h.signIn('owner@studio.example');h.owner=owner;
      await cmd('mfa.verify',{code:totp(h.mfaOwner.secret)});
      if(member)member.cookie=await h.signIn(member.email);
    };
    await h.confirmSetup(owner);
    await cmd('studio.save',{location:'Synthetic studio',timeZone:'America/New_York'});
    member=await h.person('CombinedProration');
    await jump('2099-01-16T12:00:00Z');
    const draft=await cmd('pack.prepare',{personId:member.id,credits:10,amountCents:31000,cycleStartAt:'2099-01-01T00:00:00Z',joinAt:'2099-01-16T00:00:00Z',expiresAt:'2099-02-01T00:00:00Z'});
    assert.equal(draft.amountCents,16000);
    if(process.env.STRAP_PROOF_DIR)await(await import('./campaign-browser.mjs')).prorationStageBrowser(h,{cookie:owner,selector:'#draft-'+draft.id,name:'join-preview',amount:'$160.00'});
    const pack=await cmd('pack.approve',{id:draft.id});
    const prepare=requestId=>cmd('plan.change.prepare',{packId:pack.id,mode:'now',credits:20,amountCents:32001,effectiveAt:'2099-01-20T00:00:00Z',requestId,channel:'desk'});
    const stale=await prepare('synthetic-strap-stale-combined');
    const upgrade=await cmd('plan.change.prepare',{packId:pack.id,mode:'now',credits:15,amountCents:24001,effectiveAt:'2099-01-18T00:00:00Z',requestId:'synthetic-strap-combined-upgrade',channel:'desk'});
    assert.equal(upgrade.chargeCents,7001,'8001 cents times 14 of 16 days rounds half-up');
    if(process.env.STRAP_PROOF_DIR)await(await import('./campaign-browser.mjs')).prorationStageBrowser(h,{cookie:member.cookie,selector:'[data-plan-change="'+upgrade.id+'"]',name:'upgrade-preview',amount:'$70.01'});
    await cmd('plan.change.accept',{id:upgrade.id,key:upgrade.key},member.cookie);
    await jump('2099-01-18T00:01:00Z');
    for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled();
    const before=await h.state(owner);
    const denied=await cmd('plan.change.accept',{id:stale.id,key:stale.key},member.cookie,409);
    assert.equal(denied.error,'plan_changed');
    const after=await h.state(owner);
    assert.equal(after.version,before.version,'stale approval makes no writes');
    for(const key of ['packs','charges','payments','balances','packCreditEvents','planChanges','staffActions'])assert.deepEqual(after[key],before[key],key+' unchanged');
    const type=await cmd('freeze.type.save',{name:'Medical',reason:'Agreed absence',feeCents:1000,defaultLengthDays:3,maxLengthDays:30});
    const freeze=await cmd('freeze.prepare',{packId:pack.id,freezeTypeId:type.id,startAt:'2099-01-22',endAt:'2099-01-25',requestId:'synthetic-strap-combined-freeze',channel:'desk'});
    assert.equal(freeze.feeCents,1000);assert.equal(freeze.effects.durationDays,3);
    assert.equal(freeze.effects.revisedExpiresAt,'2099-02-04T00:00:00.000Z');
    if(process.env.STRAP_PROOF_DIR)await(await import('./campaign-browser.mjs')).prorationStageBrowser(h,{cookie:member.cookie,selector:'[data-freeze="'+freeze.id+'"]',name:'freeze-preview',amount:'$10.00'});
    await cmd('freeze.accept',{id:freeze.id,key:freeze.key},member.cookie);
    const confirm={id:freeze.id,key:freeze.key,requestId:'synthetic-strap-combined-confirm',channel:'desk'};
    await cmd('freeze.confirm',confirm);await cmd('freeze.confirm',confirm);
    await jump('2099-01-25T06:01:00Z');
    for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled();
    const state=await h.state(owner),charges=state.charges.filter(c=>c.packId===pack.id);
    assert.equal(charges.length,3);
    assert.deepEqual(charges.map(c=>c.amountCents).sort((a,b)=>a-b),[1000,7001,16000]);
    assert.equal(charges.find(c=>c.planChangeId===upgrade.id).amountCents,upgrade.chargeCents);
    assert.equal(charges.find(c=>c.freezeId===freeze.id).amountCents,freeze.feeCents);
    assert.equal(state.balances.find(b=>b.personId===member.id).balanceCents,24001);
    const current=state.packs.find(p=>p.id===pack.id);
    assert.equal(current.purchaseAmountCents,draft.amountCents);assert.equal(current.amountCents,24001);
    assert.equal(current.expiresAt,freeze.effects.revisedExpiresAt);
    assert.equal(state.freezes.freezes.find(f=>f.id===freeze.id).resumptionCount,1);
    for(const cookie of [owner,member.cookie]){
      const page=await h.send('/app/packs',undefined,cookie);
      const receipt=page.text.split('id="receipt-'+pack.id+'"')[1].split('</article>')[0];
      for(const value of ['160.00','70.01','10.00','Itemized adjustments'])assert.ok(receipt.includes(value),value);
      for(const charge of charges.filter(c=>c.planChangeId||c.freezeId))assert.ok(receipt.includes('data-charge-id="'+charge.id+'"'));
    }
    if(process.env.STRAP_PROOF_DIR)await(await import('./campaign-browser.mjs')).combinedProrationBrowser(h,{member,pack,upgrade,freeze});
    console.log('BILL-006 exact dates: join Jan 16 16000 cents; upgrade Jan 18 7001 cents; freeze Jan 22–25 1000 cents; total 24001 cents; stale approval no writes; replay once.');
  })}finally{await writeFile(path+'.new',original);await rename(path+'.new',path);}
}

// Delegated freezes use the real command and profile doors, including current
// member and location authority before preview, confirmation and committed replay.
async function scopedFreezes(h,{member,type,day,today,midnight}) {
  const {randomUUID}=await import('node:crypto');
  const west=await h.cmd('location.save',{name:'Freeze West',timeZone:'America/Los_Angeles'});
  const desk=await h.person('FreezeDesk'),manager=await h.person('FreezeManager'),other=await h.person('FreezeOther');
  const grant=(actor,role,rights,members=[member.id],places=['studio'])=>h.cmd('staff.access.grant',{personId:actor.id,role,enabled:true,rights:Object.fromEntries(rights.map(right=>[right,{enabled:true,scopes:[{memberIds:members,locationIds:places,doors:['all']}]}]))});
  const rights=['member-record','contract-change'];
  const refused=async(name,input,cookie,status=403,error)=>{
    const retained=async()=>{const rows=await h.db.batch([h.db.prepare('SELECT version FROM st_meta WHERE id=1'),h.db.prepare('SELECT id,kind,data,version FROM st_records ORDER BY id'),h.db.prepare('SELECT source_id,status FROM st_notice_deliveries ORDER BY source_id')]);return rows.map(row=>row.results);};
    const before=await retained(),r=await h.send('/api/strap/command',{name,input},cookie);assert.equal(r.status,status,r.text);if(error)assert.equal(r.value.error,error);
    assert.deepEqual(await retained(),before,'refusal changes no records or notice deliveries');return r;
  };
  const captures=[];
  for(const [actor,role] of [[desk,'front-desk'],[manager,'manager']]) {
    await grant(actor,role,rights);
    const preMfa={packId:(await h.state()).packs.find(p=>p.personId===member.id).id,freezeTypeId:type.id,startAt:day(today,2),endAt:day(today,32),requestId:randomUUID()};
    await refused('freeze.prepare',preMfa,actor.cookie,403,'mfa_enrollment_required');
    await h.enroll(actor.cookie);
    const actorId=(await h.state(actor.cookie)).actor.id;
    const fresh=await h.signIn(actor.email);await refused('freeze.prepare',preMfa,fresh,403,'mfa_required');
    for(const locationId of ['studio',west.id]) {
      const approved=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:6,amountCents:12000,locationId,expiresAt:midnight(day(today,90))})).id});
      const pack=(await h.state()).packs.find(p=>p.id===approved.id);
      const proposal=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:randomUUID()});
      const terms=await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie);
      const input={packId:pack.id,freezeTypeId:type.id,startAt:day(today,2),endAt:day(today,32),reason:'Medical leave agreed with the member',channel:'phone',requestId:randomUUID()};
      for(const [names,members,places] of [[['member-record'],[member.id],[locationId]],[['contract-change'],[member.id],[locationId]],[rights,[other.id],[locationId]],[rights,[member.id],[locationId==='studio'?west.id:'studio']]]) {
        await grant(actor,role,names,members,places);await refused('freeze.prepare',input,actor.cookie);
        const scoped=await h.state(actor.cookie);assert.equal(scoped.freezes.freezes.some(f=>f.packId===pack.id),false);
        assert.equal(scoped.freezePacks.some(p=>p.id===pack.id),false);
        assert.equal((await h.send('/app/people?person='+member.id,undefined,actor.cookie)).text.includes('<option value="'+pack.id+'">'),false);
      }
      await grant(actor,role,rights,[member.id],[locationId]);
      await refused('freeze.type.save',{...type,revision:type.revision,name:'Unapproved type change'},actor.cookie);
      const stale=await h.cmd('freeze.prepare',{...input,requestId:randomUUID()},actor.cookie);
      const staleLaunch={id:stale.id,requestId:randomUUID(),channel:'phone'};await h.cmd('freeze.accept.launch',staleLaunch,actor.cookie);
      await h.cmd('person.save',{id:member.id,name:member.name+' '+randomUUID(),email:member.email,role:'member',active:true});
      await refused('freeze.accept.launch',staleLaunch,actor.cookie,409,'freeze_source_changed');
      await refused('freeze.confirm',{id:stale.id,key:stale.key,requestId:randomUUID()},actor.cookie,409,'freeze_source_changed');
      const preview=await h.cmd('freeze.prepare',input,actor.cookie);
      assert.equal(preview.freezeRequestId,null);assert.equal(preview.typeName,'Medical');assert.equal(preview.feeCents,1000);assert.equal(preview.effects.durationDays,30);
      assert.equal(preview.effects.revisedExpiresAt,midnight(day(today,120)));assert.equal(preview.effects.revisedRenewalAt,midnight(day(today,120)));
      const launch={id:preview.id,requestId:randomUUID(),channel:'phone'};
      assert.equal((await h.cmd('freeze.accept.launch',launch,actor.cookie)).status,'member_action_required');
      await h.cmd('freeze.accept.launch',launch,actor.cookie);
      await refused('freeze.accept',{id:preview.id,key:preview.key},actor.cookie);
      await refused('freeze.accept',{id:preview.id,key:preview.key},other.cookie,404);
      const confirm={id:preview.id,key:preview.key,requestId:randomUUID(),channel:'phone'};
      await refused('freeze.confirm',confirm,actor.cookie,409,'freeze_member_acceptance_required');
      await h.cmd('freeze.accept',{id:preview.id,key:preview.key},member.cookie);
      for(const [members,places] of [[[other.id],[locationId]],[[member.id],[locationId==='studio'?west.id:'studio']]]) {
        await grant(actor,role,rights,members,places);await refused('freeze.confirm',confirm,actor.cookie);await refused('freeze.accept.launch',launch,actor.cookie);
      }
      await grant(actor,role,['member-record'],[member.id],[locationId]);await refused('freeze.confirm',confirm,actor.cookie);
      await grant(actor,role,rights,[member.id],[locationId]);
      const committed=await h.cmd('freeze.confirm',confirm,actor.cookie);assert.equal(committed.status,'scheduled');assert.deepEqual(await h.cmd('freeze.confirm',confirm,actor.cookie),committed);
      await grant(actor,role,['contract-change'],[member.id],[locationId]);await refused('freeze.confirm',confirm,actor.cookie);
      await grant(actor,role,rights,[member.id],[locationId]);
      const end=await h.cmd('freeze.end.prepare',{id:preview.id,endAt:day(today,22),reason:'Member returns on day twenty',requestId:randomUUID(),channel:'phone'},actor.cookie);
      assert.equal(end.revisedRenewalAt,midnight(day(today,110)));assert.equal(end.feeCents,0);assert.deepEqual(end.bookingsRestored,[]);
      const endLaunch={id:end.id,requestId:randomUUID(),channel:'phone'};
      await h.cmd('freeze.end.accept.launch',endLaunch,actor.cookie);await h.cmd('freeze.end.accept.launch',endLaunch,actor.cookie);
      await refused('freeze.end.accept',{id:end.id,key:end.key},actor.cookie);
      const endConfirm={id:end.id,key:end.key,requestId:randomUUID(),channel:'phone'};
      await refused('freeze.end.confirm',endConfirm,actor.cookie,409,'freeze_member_acceptance_required');
      await h.cmd('freeze.end.accept',{id:end.id,key:end.key},member.cookie);
      await grant(actor,role,['member-record'],[member.id],[locationId]);await refused('freeze.end.confirm',endConfirm,actor.cookie);await refused('freeze.end.accept.launch',endLaunch,actor.cookie);
      await grant(actor,role,rights,[member.id],[locationId]);
      await h.cmd('freeze.end.confirm',endConfirm,actor.cookie);await h.cmd('freeze.end.confirm',endConfirm,actor.cookie);
      let state=await h.state();
      assert.equal(state.packs.find(p=>p.id===pack.id).expiresAt,end.revisedExpiresAt);assert.equal(state.recurring.terms.find(t=>t.id===terms.id).nextRenewalAt,end.revisedRenewalAt);
      assert.equal(state.charges.filter(c=>c.freezeId===preview.id).length,1);assert.equal(state.charges.find(c=>c.freezeId===preview.id).amountCents,1000);
      for(const [name,requestId] of [['freeze.prepare',input.requestId],['freeze.accept.launch',launch.requestId],['freeze.confirm',confirm.requestId],['freeze.end.accept.launch',endLaunch.requestId],['freeze.end.confirm',endConfirm.requestId]]) {
        const events=state.staffActions.filter(a=>a.command===name&&a.requestId===requestId);assert.equal(events.length,1,name);
        assert.deepEqual([events[0].actorId,events[0].actorRole,events[0].personId,events[0].right,events[0].channel],[actorId,role,member.id,'contract-change','phone']);assert.ok(events[0].before&&events[0].after);
      }
      await grant(actor,role,['member-record'],[member.id],[locationId]);await refused('freeze.end.confirm',endConfirm,actor.cookie);
      await grant(actor,role,rights,[member.id],[locationId]);
      captures.push({actor,role,locationId,pack,terms,freeze:preview,end});
    }
  }
  await h.cmd('person.save',{id:member.id,name:member.name,email:member.email,role:'member',active:false});
  const retired=captures.at(-1);await refused('freeze.end.confirm',{id:retired.end.id,key:retired.end.key,requestId:crypto.randomUUID()},manager.cookie,404,'person_not_found');
  assert.equal((await h.state(manager.cookie)).freezes.freezes.length,0,'retired member records are absent from delegated freeze reads');
  await h.cmd('person.save',{id:member.id,name:member.name,email:member.email,role:'member',active:true});
  // Existing due-date fixture technique retains public approvals, then crosses
  // the real scheduler boundary; both sweeps must preserve one invoice and fee.
  const due=new Date(Date.now()-1000).toISOString();
  for(const entry of captures) {
    const state=await h.state(),freeze=state.freezes.freezes.find(f=>f.id===entry.freeze.id),terms=state.recurring.terms.find(t=>t.id===entry.terms.id),pack=state.packs.find(p=>p.id===entry.pack.id);
    for(const record of [{...freeze,startAt:new Date(Date.now()-21*86400000).toISOString(),endAt:due},{...terms,nextRenewalAt:due},{...pack,expiresAt:due}])await h.db.prepare('UPDATE st_records SET data=? WHERE id=?').bind(JSON.stringify(record),record.id).run();
  }
  for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled({cron:'* * * * *'});
  const state=await h.state();
  for(const entry of captures) {
    const invoices=state.recurring.invoices.filter(i=>i.recurringTermsId===entry.terms.id);assert.equal(invoices.length,1);assert.equal(invoices[0].amountCents,12000);
    assert.equal(state.charges.filter(c=>c.invoiceId===invoices[0].id).length,1);assert.equal(state.charges.filter(c=>c.freezeId===entry.freeze.id).length,1);assert.equal(state.freezes.freezes.find(f=>f.id===entry.freeze.id).resumptionCount,1);
  }
  console.log('PROBE PLAN-011 scoped authority: manager and front desk at two locations -> 30-day Medical freeze, one 1000-cent fee, exact personal acceptance, day-20 end, one native renewal invoice; wrong member, location, missing MFA and revoked previews or replays -> refused with no writes or notices.');
  if(process.env.STRAP_RIGHTS_PROOF_DIR||process.env.STRAP_PROOF_DIR)await(await import('./freezes-browser.mjs')).scopedFreezesBrowser(h,{member,desk,manager,type,grant,rights,day,today,midnight,west});
}
