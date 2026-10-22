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
  const agreed=await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie);assert.ok(agreed.acknowledgement);assert.ok(agreed.retention);
  const type=await h.cmd('freeze.type.save',{name:'Travel',reason:'Agreed travel',feeCents:1000,defaultLengthDays:30,maxLengthDays:60,allowedStartDays:[1,2,3,4,5,6,7],allowOpenEnded:false,maxFreezes:1,maxDays:30});
  const input={packId:pack.id,freezeTypeId:type.id,startAt:'2098-03-01',endAt:'2098-03-31',reason:'Travel confirmed',requestId:'synthetic-strap-502'};
  const preview=await h.cmd('freeze.prepare',input);assert.equal(preview.effects.durationDays,30);assert.equal(preview.effects.revisedExpiresAt,'2098-07-31T04:00:00.000Z','billing stays at midnight through the March DST change');
  const before=(await h.state()).version;assert.equal((await h.cmd('freeze.confirm',{id:preview.id,key:preview.key,requestId:'synthetic-strap-503'},h.owner,409)).error,'freeze_member_acceptance_required');assert.equal((await h.state()).version,before);
  await h.cmd('freeze.accept',{id:preview.id,key:preview.key},member.cookie);await h.cmd('freeze.confirm',{id:preview.id,key:preview.key,requestId:'synthetic-strap-504'});
  const first=await publish('Late June Mat','2098-06-29T13:00:00.000Z'),second=await publish('Extra July Mat','2098-07-03T13:00:00.000Z'),third=await publish('Another July Mat','2098-07-04T13:00:00.000Z');
  await h.cmd('booking.book',{classId:first.id},member.cookie);await h.cmd('booking.book',{classId:second.id},member.cookie);assert.equal((await h.cmd('booking.book',{classId:third.id},member.cookie,409)).error,'plan_visits_used','the extension adds no July allowance');
  await h.cmd('guest.consent.save',{sponsorEmail:member.email,consent:true},guest.cookie);await h.cmd('guest.consent.save',{sponsorEmail:member.email,kind:'payer',consent:true,maxChargeCents:2500},payer.cookie);
  const one=await h.cmd('guest.preview',{sponsorId:member.id,packId:pack.id,guestId:guest.id,classId:first.id},member.cookie);await h.cmd('guest.book',{id:one.id,confirm:true},member.cookie);
  const extra=await h.cmd('guest.preview',{sponsorId:member.id,packId:pack.id,guestId:guest.id,classId:second.id,payerId:payer.id},member.cookie);assert.equal(extra.funding,'paid','the extension adds no guest pass');await h.cmd('guest.book',{id:extra.id,confirm:true},member.cookie);
  const end=await h.cmd('freeze.end.prepare',{id:preview.id,endAt:'2098-03-21',reason:'Return earlier',requestId:'synthetic-strap-505'});await h.cmd('freeze.end.accept',{id:end.id,key:end.key},member.cookie);await h.cmd('freeze.end.confirm',{id:end.id,key:end.key,requestId:'synthetic-strap-506'});
  const other=await sell(member,{expiresAt:'2099-12-31T00:00:00.000Z'});assert.equal((await h.cmd('freeze.prepare',{packId:other.id,freezeTypeId:type.id,startAt:'2098-05-01',endAt:'2098-05-02',reason:'Another trip',requestId:'synthetic-strap-507'},h.owner,409)).error,'freeze_count_cap_reached');
  const current=(await h.state()).freezes.freezes.find(f=>f.id===preview.id);const withdrawn=await h.cmd('freeze.withdraw',{id:current.id,withdrawKey:current.withdrawal.key,requestId:'synthetic-strap-508'},member.cookie);assert.equal(withdrawn.status,'withdrawn');
  const fee=(await h.state()).charges.find(c=>c.freezeId===preview.id&&c.amountCents===1000);assert.equal((await h.state()).charges.filter(c=>c.reversesChargeId===fee.id&&c.personId===member.id&&c.amountCents===-1000).length,1);
  const reversed=(await h.state()).charges.filter(c=>c.bookingId&&c.reason==='guest_drop_in_reversal');assert.equal(reversed.length,1);assert.equal(reversed[0].personId,payer.id);assert.equal(reversed[0].amountCents,-2500);
  assert.ok((await h.state(guest.cookie)).notices.some(n=>n.subject==='Guest booking cancelled after a freeze withdrawal'));
  const after=(await h.state()).freezes.freezes.find(f=>f.id===preview.id);assert.equal(after.status,'withdrawn');assert.equal((await h.state()).packs.find(p=>p.id===pack.id).expiresAt,pack.expiresAt);
  const retained=(await h.state()).recurring.terms.find(t=>t.id===agreed.id);assert.equal(retained.nextRenewalAt,pack.expiresAt);
  await h.cmd('plan.recurring.stop',{id:agreed.id,requestId:'synthetic-strap-509'},member.cookie);assert.equal((await h.state()).packs.find(p=>p.id===pack.id).expiresAt,pack.expiresAt,'reasonless stop keeps access through the paid term');
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
  assert.equal((await h.cmd('plan.recurring.reconnect',reconnect,invoiceMember.cookie,403)).error,'forbidden');
  const moved=await h.cmd('plan.recurring.reconnect',reconnect);assert.ok(moved.agreementIds.includes(annual.id));assert.deepEqual(await h.cmd('plan.recurring.reconnect',reconnect),moved);
  billing=(await h.state()).recurring;const currentAgreement=billing.terms.find(r=>r.id===annual.id);assert.deepEqual(currentAgreement.acknowledgement,annual.acknowledgement);assert.equal(currentAgreement.billingOrigin,h.origin);assert.equal(currentAgreement.nextRenewalAt,due);
  assert.ok((await h.state(invoiceMember.cookie)).notices.some(n=>n.subject==='Recurring invoices moved to the new studio address'));
  await h.db.prepare("DELETE FROM st_contract_connections WHERE id='billing'").run();
  assert.equal((await h.cmd('plan.recurring.reconnect',{...reconnect,requestId:'synthetic-strap-511'},h.owner,409)).error,'fresh_member_acceptance_required');

}))
