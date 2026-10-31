import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unstable_splitSqlQuery } from 'wrangler';

const iso = hours => new Date(Math.ceil((Date.now()+hours*3600000)/60000)*60000).toISOString();
const monday = value => {const d=new Date(value);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
export async function rightsSeed(h) {
  await h.confirmSetup(h.owner);
  await h.cmd('studio.save',{location:'Brooklyn',timeZone:'America/New_York'});
  const west=await h.cmd('location.save',{name:'Westside',timeZone:'America/Los_Angeles'});
  const coach=await h.person('Maya','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben'),desk=await h.person('Casey'),manager=await h.person('Morgan'),finance=await h.person('Faye');
  for(const p of [ana,ben]) {
    const draft=await h.cmd('pack.prepare',{personId:p.id,credits:12,amountCents:12000,eligibleLocations:'all',expiresAt:iso(2000)});
    p.pack=await h.cmd('pack.approve',{id:draft.id});
  }
  await h.cmd('bookingRule.save',{cancelCutoffHours:12,lateCancelReturnsCredit:false,lateCancelFeeCents:1500});
  const publish=async(title,hours,locationId='studio',capacity=2)=>{
    const start=iso(hours),draft=await h.cmd('classes.prepare',{week:monday(start),classes:[{title,room:title,service:'Fitness',start,end:new Date(Date.parse(start)+3600000).toISOString(),capacity,instructorId:coach.id,locationId}]});
    return (await h.cmd('classes.publish',{id:draft.id})).classes[0];
  };
  const full=await publish('Evening Pilates',6,'studio',1),open=await publish('Morning Mat',28),other=await publish('Westside Pilates',30,west.id);
  const grant=async(p,role,names,memberIds=[ana.id,ben.id],locationIds=['studio'])=>h.cmd('staff.access.grant',{personId:p.id,role,enabled:true,rights:Object.fromEntries(names.map(right=>[right,{enabled:true,scopes:[{memberIds,locationIds,doors:['all']}]}]))});
  const refuse=async(name,input,cookie,status=403)=>{
    const before=await h.state(),r=await h.send('/api/strap/command',{name,input},cookie);
    assert.equal(r.status,status,JSON.stringify(r.value));
    const after=await h.state();assert.equal(after.version,before.version,'denial writes nothing');assert.deepEqual(after.staffNotices,before.staffNotices,'denial sends no notice');
    return r;
  };
  return {west,coach,ana,ben,desk,manager,finance,full,open,other,grant,refuse,publish};
}

export async function staffBookingRights(h) {
  const s=await rightsSeed(h),{desk,manager,finance,ana,ben,full,open,other,grant,refuse}=s;
  const base=['booking','member-record','check-in'];
  await grant(desk,'front-desk',base);await h.enroll(desk.cookie);
  const otherBooking=await h.cmd('booking.book',{classId:full.id},ben.cookie);
  const request={personId:ana.id,classId:full.id,pay:'auto',channel:'phone',requestId:randomUUID()};
  await refuse('booking.desk',{...request,override:'Member requested a capacity exception'},desk.cookie);
  await refuse('booking.desk',request,desk.cookie,409);
  await grant(desk,'front-desk',[...base,'override']);
  const booked=await h.cmd('booking.desk',{...request,override:'Member requested a capacity exception'},desk.cookie);
  assert.equal(booked.status,'booked');assert.equal(booked.override.right,'override');assert.equal(booked.override.by,(await h.state(desk.cookie)).actor.id);
  assert.equal((await h.state()).bookings.filter(b=>b.classId===full.id&&b.status==='booked').length,2);
  const cancel={id:booked.id,channel:'phone',cancelReason:'Sick',mode:'early',reason:'Sick waiver',requestId:randomUUID()};
  await refuse('booking.cancel',cancel,desk.cookie);
  await grant(desk,'front-desk',[...base,'override','fee-waiver']);
  const cancelled=await h.cmd('booking.cancel',cancel,desk.cookie);
  assert.deepEqual([cancelled.feeCents,cancelled.refunded,cancelled.waiver.right],[0,true,'fee-waiver']);
  assert.deepEqual(await h.cmd('booking.cancel',cancel,desk.cookie),cancelled);
  const state=await h.state();assert.equal(state.staffActions.filter(a=>a.requestId===cancel.requestId).length,1);
  await refuse('booking.desk',{...request,classId:other.id,requestId:randomUUID()},desk.cookie);
  await grant(desk,'front-desk',['member-record','check-in']);
  await refuse('booking.cancel',{id:otherBooking.id,mode:'late',cancelReason:'Other'},desk.cookie);
  await grant(desk,'front-desk',base);
  const deskBook=await h.cmd('booking.desk',{personId:ana.id,classId:open.id,channel:'desk',requestId:randomUUID()},desk.cookie);
  const checked=await h.cmd('attendance.checkin',{id:deskBook.id,personId:ana.id,requestId:randomUUID()},desk.cookie);assert.equal(checked.attendance,'attended');
  for(const path of ['/api/strap/exit.json','/api/strap/reports/revenue.csv','/api/strap/teaching-pay.csv','/api/strap/staff-history.csv'])assert.equal((await h.send(path,undefined,desk.cookie)).status,403,path);
  const view=await h.state(desk.cookie);assert.deepEqual(view.charges,[]);assert.deepEqual(view.payments,[]);assert.ok(!view.classes.some(c=>c.id===other.id));
  assert.ok(view.people.some(p=>p.id===ana.id));assert.equal(view.staffPermissions.includes('booking'),true);
  // Delegated weekly classes retain full and closed dates in an eight-week review.
  const startDate=new Date(Date.now()+14*86400000).toISOString().slice(0,10),throughDate=new Date(Date.parse(startDate)+49*86400000).toISOString().slice(0,10);
  const seriesDraft=await h.cmd('series.prepare',{title:'Standing evening Pilates',room:'Standing class room',service:'Fitness',startDate,endDate:throughDate,time:'18:00',minutes:50,capacity:1,instructorId:s.coach.id,intervalWeeks:1});
  const series=await h.cmd('series.publish',{id:seriesDraft.id}),occurrences=series.classes;
  assert.equal(occurrences.length,8);
  await h.cmd('booking.book',{classId:occurrences[1].id},ben.cookie);
  const holiday=await h.cmd('closure.prepare',{scope:'class',seriesScope:'this',classId:occurrences[3].id,reason:'Holiday closure'});await h.cmd('closure.confirm',{id:holiday.id,impact:holiday.impact.key});
  const standing=await h.cmd('reservation.prepare',{personId:ana.id,classId:occurrences[0].id,throughDate,channel:'phone'},desk.cookie);
  assert.deepEqual(standing.outcomes.map(o=>o.status),['booked','waitlisted','booked','skipped','booked','booked','booked','booked']);
  const standingSaved=await h.cmd('reservation.confirm',{id:standing.id,key:standing.key,channel:'phone',requestId:randomUUID()},desk.cookie);
  assert.equal(standingSaved.outcomes.filter(o=>o.status==='booked').length,6);
  assert.equal((await h.state()).packs.find(p=>p.id===ana.pack.id).summary.reserved,6);
  await grant(desk,'front-desk',['member-record']);
  await refuse('reservation.confirm',{id:standing.id,key:standing.key,channel:'phone',requestId:randomUUID()},desk.cookie);
  await grant(desk,'front-desk',base);
  const futureCancel=await h.cmd('reservation.cancel.prepare',{reservationId:standingSaved.id,personId:ana.id,channel:'phone'},desk.cookie);
  await grant(desk,'front-desk',['member-record']);
  await refuse('reservation.cancel.confirm',{id:futureCancel.id,key:futureCancel.key,channel:'phone',cancelReason:'Other'},desk.cookie);
  await grant(desk,'front-desk',base);
  await h.cmd('reservation.cancel.confirm',{id:futureCancel.id,key:futureCancel.key,channel:'phone',cancelReason:'Other'},desk.cookie);
  assert.equal((await h.state()).packs.find(p=>p.id===ana.pack.id).summary.reserved,0);
  // A manager uses the same explicitly granted operational scope.
  await grant(manager,'manager',base,[ana.id],['studio']);await h.enroll(manager.cookie);
  await refuse('booking.desk',{personId:ben.id,classId:open.id},manager.cookie);
  assert.equal((await h.state(manager.cookie)).actor.role,'manager');
  assert.equal((await h.send('/api/strap/reports/revenue.csv',undefined,manager.cookie)).status,403,'report downloads need the separate export right');
  const managerClass=await s.publish('Manager appointment desk',60);const managerBooking=await h.cmd('booking.desk',{personId:ana.id,classId:managerClass.id,channel:'phone'},manager.cookie);assert.equal(managerBooking.status,'booked');
  await grant(finance,'finance',['exports'],[ana.id],['studio']);await h.enroll(finance.cookie);
  const financeDownload=await h.send('/api/strap/reports/revenue.csv',undefined,finance.cookie);assert.equal(financeDownload.status,200);
  const financeReport=await h.send('/api/strap/reports/revenue',undefined,finance.cookie);assert.equal(financeReport.status,200);
  assert.deepEqual([...new Set(financeReport.value.sources.map(row=>row.personId))],[ana.id],'finance report includes exactly the selected member');
  assert.ok(!financeDownload.text.includes(ben.id),'another member is absent from the download');
  await refuse('booking.desk',{personId:ana.id,classId:other.id},finance.cookie);
  assert.equal((await h.send('/api/strap/exit.json',undefined,finance.cookie)).status,403);
  await grant(desk,'front-desk',base,[ana.id],[s.west.id]);
  await refuse('booking.desk',request,desk.cookie);
  const changed=await h.state(desk.cookie);assert.ok(!changed.classes.some(c=>c.id===full.id));
  // Disabled grants are authoritative even for existing sessions and replayed requests.
  await h.cmd('staff.access.grant',{personId:desk.id,role:'front-desk',enabled:false,rights:{}});
  await refuse('booking.desk',request,desk.cookie);
  assert.equal((await h.send('/api/strap/member-history?personId='+ana.id,undefined,desk.cookie)).status,403);
  if(process.env.STRAP_RIGHTS_PROOF_DIR || process.env.STRAP_PROOF_DIR)await (await import('./staff-rights-browser.mjs')).staffRightsBrowser(h,s);
}

export async function staffContractRights(h) {
  const s=await rightsSeed(h),{desk,ana,grant,refuse}=s;
  await grant(desk,'front-desk',['member-record']);await h.enroll(desk.cookie);
  const input={packId:ana.pack.id,intervalMonths:1,requestId:randomUUID(),channel:'phone'};
  await refuse('plan.recurring.prepare',input,desk.cookie);
  await grant(desk,'front-desk',['member-record','membership-sale']);
  const preview=await h.cmd('plan.recurring.prepare',input,desk.cookie);
  assert.equal(preview.personId,ana.id);assert.equal(preview.createdBy,(await h.state(desk.cookie)).actor.id);assert.equal(preview.status,'preview');
  await refuse('plan.recurring.accept',{id:preview.id,key:preview.key},desk.cookie);
  const terms=await h.cmd('plan.recurring.accept',{id:preview.id,key:preview.key},ana.cookie);assert.equal(terms.status,'active');
  const reason=await h.cmd('plan.cancellation.reason.save',{code:'moved-away',label:'Moved away',active:true,revision:0});
  for(const who of [desk,s.manager,s.finance,s.coach,ana])await refuse('plan.cancellation.reason.save',{code:'price',label:'Price',active:true,revision:0},who.cookie);
  const cancel={reasonCode:reason.code,packId:terms.currentPackId,effectiveAt:iso(1000),reason:'Moving out of town',channel:'phone',requestId:randomUUID()};
  await refuse('plan.cancellation.prepare',cancel,desk.cookie);
  await grant(desk,'front-desk',['member-record','contract-change']);
  const proposed=await h.cmd('plan.cancellation.prepare',cancel,desk.cookie);assert.equal(proposed.status,'preview');
  const confirm={id:proposed.id,key:proposed.key,channel:'phone',requestId:randomUUID()};
  await grant(desk,'front-desk',['member-record']);await refuse('plan.cancellation.confirm',confirm,desk.cookie);
  await grant(desk,'front-desk',['member-record','contract-change']);
  const saved=await h.cmd('plan.cancellation.confirm',confirm,desk.cookie);assert.equal(saved.status,'scheduled');assert.equal(saved.terminatedRole,'front-desk');assert.equal(saved.channel,'phone');
  assert.deepEqual(await h.cmd('plan.cancellation.confirm',confirm,desk.cookie),saved);
  const history=(await h.state()).staffActions;assert.equal(history.filter(a=>a.command==='plan.cancellation.confirm'&&a.personId===ana.id).length,1);
  const event=history.find(a=>a.command==='plan.cancellation.confirm'&&a.personId===ana.id);assert.deepEqual([event.after.reasonCode,event.after.reasonLabel],['moved-away','Moved away']);
  if(process.env.STRAP_PROOF_DIR||process.env.STRAP_RIGHTS_PROOF_DIR)await(await import('./cancellations-browser.mjs')).staffTerminationsBrowser(h,s);
  // Contract-change eligibility is independent of role titles and location scope.
  for(const actor of [s.finance,s.coach]) {
    const role=actor===s.coach?'instructor':'finance',version=(await h.state()).version;
    const denied=await h.send('/api/strap/command',{name:'staff.access.grant',input:{personId:actor.id,role,enabled:true,rights:{'contract-change':{enabled:true,scopes:[{memberIds:[ana.id],locationIds:['studio'],doors:['all']}]}}}},h.owner);
    assert.equal(denied.status,400);assert.equal(denied.value.error,'staff_role_right_forbidden');assert.equal((await h.state()).version,version);
    await refuse('plan.cancellation.prepare',cancel,actor.cookie);
  }
  await grant(s.manager,'manager',['member-record']);await h.enroll(s.manager.cookie);
  for(const [actor,role] of [[desk,'front-desk'],[s.manager,'manager']])for(const locationId of ['studio',s.west.id]) {
    const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:s.ben.id,credits:4,amountCents:8000,locationId,eligibleLocations:'all',expiresAt:iso(2000)})).id});
    const proposal=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:randomUUID()});
    const accepted=await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},s.ben.cookie);
    const input={reasonCode:reason.code,packId:accepted.currentPackId,effectiveAt:iso(1000),reason:'Moving out of town',channel:'phone',requestId:randomUUID()};
    await grant(actor,role,['member-record'],[s.ben.id],[locationId]);
    await refuse('plan.cancellation.prepare',input,actor.cookie);
    await grant(actor,role,['member-record','contract-change'],[ana.id],[locationId]);
    await refuse('plan.cancellation.prepare',input,actor.cookie);
    await grant(actor,role,['member-record','contract-change'],[s.ben.id],[locationId==='studio'?s.west.id:'studio']);
    await refuse('plan.cancellation.prepare',input,actor.cookie);
    await grant(actor,role,['member-record','contract-change'],[s.ben.id],[locationId]);
    const preview=await h.cmd('plan.cancellation.prepare',input,actor.cookie);
    assert.equal(preview.personId,s.ben.id);assert.equal(preview.status,'preview');
    const confirm={id:preview.id,key:preview.key,channel:'phone',requestId:randomUUID()};
    await grant(actor,role,['member-record'],[s.ben.id],[locationId]);
    await refuse('plan.cancellation.confirm',confirm,actor.cookie);
    await grant(actor,role,['member-record','contract-change'],[s.ben.id],[locationId]);
    const committed=await h.cmd('plan.cancellation.confirm',confirm,actor.cookie);
    assert.equal(committed.status,'scheduled');assert.equal(committed.terminatedRole,role);
    assert.deepEqual(await h.cmd('plan.cancellation.confirm',confirm,actor.cookie),committed);
    const actions=(await h.state()).staffActions.filter(a=>a.command==='plan.cancellation.confirm'&&a.requestId===confirm.requestId);
    assert.equal(actions.length,1);assert.equal(actions[0].right,'contract-change');assert.equal(actions[0].actorRole,role);assert.equal(actions[0].personId,s.ben.id);
    await grant(actor,role,['member-record'],[s.ben.id],[locationId]);await refuse('plan.cancellation.confirm',confirm,actor.cookie);
    const reportBefore=await h.send('/api/strap/reports/renewals?days=366&lowCredits=10000',undefined,h.owner);assert.equal(reportBefore.status,200,reportBefore.text);assert.ok(reportBefore.value.rows.some(r=>r.terminationId===committed.id));
    const prepareWithdrawal={id:committed.id,channel:'phone',reason:'Member changed their departure plan',requestId:randomUUID()};
    await refuse('plan.cancellation.withdraw.prepare',prepareWithdrawal,actor.cookie);
    for(const [names,memberIds,locations] of [[['contract-change'],[s.ben.id],[locationId]],[['member-record','contract-change'],[ana.id],[locationId]],[['member-record','contract-change'],[s.ben.id],[locationId==='studio'?s.west.id:'studio']]]) {
      await grant(actor,role,names,memberIds,locations);await refuse('plan.cancellation.withdraw.prepare',prepareWithdrawal,actor.cookie);
    }
    await grant(actor,role,['member-record','contract-change'],[s.ben.id],[locationId]);
    const other=actor===desk?s.manager:desk,otherRole=actor===desk?'manager':'front-desk';
    await grant(other,otherRole,['member-record','contract-change'],[s.ben.id],[locationId]);
    await refuse('plan.cancellation.withdraw.prepare',prepareWithdrawal,other.cookie);
    await refuse('plan.cancellation.withdraw.prepare',prepareWithdrawal,h.owner);
    const withdrawal=await h.cmd('plan.cancellation.withdraw.prepare',prepareWithdrawal,actor.cookie);
    assert.equal(withdrawal.requiresFreshAcceptance,true);
    const withdraw={id:withdrawal.id,key:withdrawal.key,channel:'phone',requestId:randomUUID()};
    await grant(actor,role,['member-record'],[s.ben.id],[locationId]);await refuse('plan.cancellation.withdraw.confirm',withdraw,actor.cookie);
    await grant(actor,role,['member-record','contract-change'],[s.ben.id],[locationId]);
    const withdrawn=await h.cmd('plan.cancellation.withdraw.confirm',withdraw,actor.cookie);assert.equal(withdrawn.status,'confirmed');
    assert.deepEqual(await h.cmd('plan.cancellation.withdraw.confirm',withdraw,actor.cookie),withdrawn);
    let current=await h.state();
    assert.equal(current.cancellations.cancellations.find(c=>c.id===committed.id).status,'withdrawn');
    assert.equal(current.recurring.terms.find(t=>t.id===accepted.id).status,'stopped');
    assert.equal(current.recurring.terms.find(t=>t.id===accepted.id).requiresFreshAcceptance,true);
    assert.equal(current.recurring.invoices.filter(i=>i.recurringTermsId===accepted.id).length,0);
    const reportAfter=await h.send('/api/strap/reports/renewals?days=366&lowCredits=10000',undefined,h.owner);assert.equal(reportAfter.status,200,reportAfter.text);assert.equal(reportAfter.value.rows.some(r=>r.terminationId===committed.id),false);
    for(const [command,requestId] of [['plan.cancellation.withdraw.prepare',prepareWithdrawal.requestId],['plan.cancellation.withdraw.confirm',withdraw.requestId]]) {
      const events=current.staffActions.filter(a=>a.command===command&&a.requestId===requestId);
      assert.equal(events.length,1);assert.deepEqual([events[0].actorRole,events[0].personId,events[0].right,events[0].channel],[role,s.ben.id,'contract-change','phone']);
      assert.ok(events[0].before&&events[0].after);
    }
    await grant(actor,role,['member-record'],[s.ben.id],[locationId]);await refuse('plan.cancellation.withdraw.confirm',withdraw,actor.cookie);
    await grant(actor,role,['member-record','contract-change'],[s.ben.id],[locationId]);
    const renewal=await h.cmd('plan.recurring.prepare',{packId:accepted.currentPackId,intervalMonths:1,requestId:randomUUID()});
    await refuse('plan.recurring.accept',{id:renewal.id,key:renewal.key},actor.cookie);
    const resumed=await h.cmd('plan.recurring.accept',{id:renewal.id,key:renewal.key},s.ben.cookie);assert.equal(resumed.status,'active');
    await h.cmd('plan.recurring.accept',{id:renewal.id,key:renewal.key},s.ben.cookie);
    current=await h.state();assert.equal(current.recurring.invoices.filter(i=>i.recurringTermsId===resumed.id).length,0);
  }

  {
    const lifecycleMember=await h.person('TerminationLifecycle');
    await grant(desk,'front-desk',['member-record','contract-change'],[lifecycleMember.id],['studio']);
    const lifecyclePack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:lifecycleMember.id,credits:4,amountCents:8000,expiresAt:iso(2000)})).id});
    const lifecycleProposal=await h.cmd('plan.recurring.prepare',{packId:lifecyclePack.id,intervalMonths:1,requestId:randomUUID()});
    await h.cmd('plan.recurring.accept',{id:lifecycleProposal.id,key:lifecycleProposal.key},lifecycleMember.cookie);
    const later=await s.publish('Termination later class',24),seat=await h.cmd('booking.book',{classId:later.id},lifecycleMember.cookie);
    assert.equal(seat.packId,lifecyclePack.id);
    const effectiveAt=new Date(Date.now()+10000).toISOString(),preview=await h.cmd('plan.cancellation.prepare',{packId:lifecyclePack.id,effectiveAt,reasonCode:reason.code,reason:'Moved away as agreed',channel:'phone',requestId:randomUUID()},desk.cookie);
    assert.deepEqual(preview.effects.bookings.map(b=>b.id),[seat.id]);assert.equal(preview.effects.finalChargeCents,0);
    const scheduled=await h.cmd('plan.cancellation.confirm',{id:preview.id,key:preview.key,channel:'phone',requestId:randomUUID()},desk.cookie);
    await h.setAuth({});await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(effectiveAt)-Date.now()+100)));
    for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled({cron:'* * * * *'});
    const ended=await h.state(),endedPack=ended.packs.find(p=>p.id===lifecyclePack.id),endedSeat=ended.bookings.find(b=>b.id===seat.id);
    assert.equal(ended.cancellations.cancellations.find(c=>c.id===scheduled.id).status,'applied');assert.equal(endedPack.expiresAt,effectiveAt);
    assert.deepEqual([endedSeat.status,endedSeat.refunded,endedSeat.feeCents],['cancelled',true,0]);
    assert.equal(ended.packCreditEvents.filter(e=>e.bookingId===seat.id&&e.type==='restore').length,1);
    assert.equal(ended.cancellations.statements.filter(s=>s.cancellationId===scheduled.id&&s.additionalChargeCents===0).length,1);
    assert.equal(ended.recurring.invoices.filter(i=>i.recurringTermsId===lifecycleProposal.id).length,0);
    assert.equal(ended.charges.filter(c=>c.personId===lifecycleMember.id).length,1,'termination adds no native charge');
    const child=ended.bookingActions.find(a=>a.parentActionId===scheduled.staffActionId);
    assert.ok(child);assert.deepEqual([child.actorRole,child.staffMade,child.right],['front-desk',true,'contract-change']);
    assert.ok((await h.state(lifecycleMember.cookie)).notices.some(n=>n.subject==='Membership ended'));
    await refuse('plan.cancellation.withdraw.prepare',{id:scheduled.id,requestId:randomUUID()},desk.cookie,409);
    await refuse('booking.book',{classId:later.id},lifecycleMember.cookie,409);
    console.log('PROBE PLAN-012 native effective date: scoped front desk confirms a reason-coded termination with future booking, runtime restarts and two scheduler sweeps -> access ends, original credit returns once, one final statement and staff-made history, no invoice or extra charge; late withdrawal and rebooking refused.');
  }
  console.log('PROBE PLAN-012 staff withdrawal: manager and front desk at two locations -> own scheduled termination withdrawn once with canonical audit, invoices stay stopped until personal fresh acceptance; other terminator, wrong scope, missing right and revoked replay refused without writes.');
}

export async function staffAppointmentRoles(h) {
  const s=await rightsSeed(h),{coach,manager,ana,west,grant,refuse}=s;
  const rights=['booking','member-record'];
  await grant(manager,'manager',rights,[ana.id],['studio']);await h.enroll(manager.cookie);
  await grant(coach,'instructor',rights,[ana.id],['studio']);await h.enroll(coach.cookie);
  const date=new Date(Date.now()+20*86400000).toISOString().slice(0,10),last=new Date(Date.parse(date)+14*86400000).toISOString().slice(0,10);
  const source={personId:ana.id,service:'Private coached session',instructorId:coach.id,locationId:'studio',room:'Coaching room',startDate:date,endDate:last,time:'10:00',minutes:50,channel:'phone'};
  const prepared=await h.cmd('appointment.reservation.prepare',source,coach.cookie);
  assert.equal(prepared.occurrences.length,3);
  const saved=await h.cmd('appointment.reservation.confirm',{id:prepared.id,key:prepared.key,channel:'phone',requestId:randomUUID()},coach.cookie);
  assert.equal(saved.occurrences.length,3);assert.equal((await h.state(coach.cookie)).appointments.length,1);
  assert.equal((await h.send('/app/teaching-pay',undefined,coach.cookie)).status,200,'instructor keeps own pay screen');
  assert.equal((await h.send('/api/strap/exit.json',undefined,coach.cookie)).status,403);
  const other=await h.person('OtherPrivateCoach','instructor');
  await refuse('appointment.reservation.prepare',{...source,instructorId:other.id,room:'Other room',time:'14:00'},coach.cookie);
  await refuse('appointment.reservation.prepare',{...source,locationId:west.id,room:'West coaching room',time:'14:00'},manager.cookie);
  const moved=await h.cmd('appointment.move.prepare',{reservationId:saved.id,classId:saved.occurrences[0].id,scope:'future',startDate:date,time:'12:00',channel:'phone'},manager.cookie);
  await grant(manager,'manager',['member-record'],[ana.id],['studio']);
  await refuse('appointment.change.confirm',{id:moved.id,key:moved.key,channel:'phone'},manager.cookie);
  await grant(manager,'manager',rights,[ana.id],['studio']);
  await h.cmd('appointment.change.confirm',{id:moved.id,key:moved.key,channel:'phone',requestId:randomUUID()},manager.cookie);
  await grant(coach,'instructor',['member-record'],[ana.id],['studio']);
  await refuse('appointment.reservation.confirm',{id:prepared.id,key:prepared.key,channel:'phone'},coach.cookie);
  assert.equal((await h.state(coach.cookie)).appointments.length,0);
  await h.cmd('staff.access.grant',{personId:coach.id,role:'instructor',enabled:false,rights:{}});
  await refuse('attendance.checkin',{id:saved.occurrences[0].bookingId},coach.cookie);
  await populatedLegacyRights(h,s);
}

// Upgrade a populated installation: public legacy grant doors create the source
// records, then the actual forward migration must preserve each independent scope.
async function populatedLegacyRights(h,s) {
  const staff=await h.person('LegacyDesk');
  await h.cmd('member.record.grant',{personId:staff.id,enabled:true,canCreate:false,memberIds:[s.ana.id,s.ben.id]});
  await h.cmd('appointment.booking.grant',{personId:staff.id,enabled:true,memberIds:[s.ben.id],locationIds:[s.west.id]});
  await h.cmd('attendance.booking.grant',{personId:staff.id,enabled:false,memberIds:[s.ana.id],locationIds:['studio']});
  await h.cmd('retail.staff.grant',{personId:staff.id,enabled:true,sale:true,refund:false,memberIds:[s.ana.id],locationIds:['studio']});
  const canonical=(await h.state()).staffAccessGrants.find(g=>g.personId===staff.id);
  assert.ok(canonical);assert.deepEqual(Object.keys(canonical.legacyGrants).sort(),['appointment','attendance-plan','member-record','retail']);
  const kinds={'member-record':'memberRecordGrant',appointment:'appointmentBookingGrant','attendance-plan':'attendanceBookingGrant',retail:'retailStaffGrant'};
  // Recreate the pre-upgrade storage shape from the product-created grant facts.
  const operations=[h.db.prepare("DELETE FROM st_records WHERE kind='staffAccess'")];
  for(const [door,grant] of Object.entries(canonical.legacyGrants))operations.push(h.db.prepare('INSERT INTO st_records(id,kind,data,version) VALUES(?,?,?,?)').bind(grant.id,kinds[door],JSON.stringify(grant),1));
  await h.db.batch(operations);
  await h.db.batch(unstable_splitSqlQuery(await readFile('migrations/core/0040-staff-rights.sql','utf8')).map(sql=>h.db.prepare(sql)));
  staff.cookie=await h.signIn(staff.email);await h.enroll(staff.cookie);
  const migrated=(await h.state()).staffAccessGrants.find(g=>g.personId===staff.id);
  assert.equal(migrated.role,'front-desk');assert.equal(migrated.enabled,true);
  assert.deepEqual(migrated.rights['member-record'].scopes,[{memberIds:[s.ana.id,s.ben.id].sort(),locationIds:[],doors:['member-record']}]);
  assert.equal(migrated.rights['member-record'].canCreate,false);
  assert.deepEqual(migrated.rights.booking.scopes,[{memberIds:[s.ben.id],locationIds:[s.west.id],doors:['appointment']}]);
  assert.deepEqual(migrated.rights.sale.scopes,[{memberIds:[s.ana.id],locationIds:['studio'],doors:['retail']}]);
  assert.equal(migrated.rights.refund.enabled,false);assert.deepEqual(migrated.rights.refund.scopes,[]);
  assert.deepEqual(migrated.legacyGrants,canonical.legacyGrants);
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM st_records WHERE kind IN ('memberRecordGrant','appointmentBookingGrant','attendanceBookingGrant','retailStaffGrant')").first()).n,0);
  const edited=await h.cmd('profile.save.staff',{personId:s.ana.id,phone:'5125550101',channel:'phone',requestId:randomUUID()},staff.cookie);
  assert.equal(edited.phone,'5125550101');
  await s.refuse('profile.save.staff',{personId:s.manager.id,phone:'5125550102',requestId:randomUUID()},staff.cookie);
  await s.refuse('member.record.create',{name:'Unscoped',email:'unscoped@studio.example',requestId:randomUUID()},staff.cookie);
  await s.refuse('booking.desk',{personId:s.ben.id,classId:s.other.id},staff.cookie);
  const source={personId:s.ben.id,service:'Fitness',instructorId:s.coach.id,locationId:s.west.id,room:'Legacy private room',startDate:new Date(Date.now()+40*86400000).toISOString().slice(0,10),endDate:new Date(Date.now()+54*86400000).toISOString().slice(0,10),time:'10:00',minutes:50,channel:'phone'};
  const proposal=await h.cmd('appointment.reservation.prepare',source,staff.cookie);
  assert.equal(proposal.occurrences.length,3);
  await s.refuse('appointment.reservation.prepare',{...source,personId:s.ana.id},staff.cookie);
  await s.refuse('appointment.reservation.prepare',{...source,locationId:'studio'},staff.cookie);
  assert.equal((await h.send('/api/strap/reports/revenue.csv',undefined,staff.cookie)).status,403);
}

/** Current retail authority is checked before reading, writing or returning a saved result. */
export async function staffRetailRights(h) {
  const buyer=await h.person('RetailBuyer'),other=await h.person('RetailOther');
  const manager=await h.person('RetailManager'),desk=await h.person('RetailDesk');
  const finance=await h.person('RetailFinance'),coach=await h.person('RetailCoach','instructor');
  const west=await h.cmd('location.save',{name:'Retail West',timeZone:'America/Los_Angeles'});
  const supplier=await h.cmd('retail.supplier.add',{name:'Retail rights supplier',reference:'synthetic-strap-201',requestId:'rights-supplier'});
  const sku=await h.cmd('retail.sku.add',{supplierId:supplier.id,sku:'RIGHTS',barcode:'synthetic-strap-202',name:'Rights shirt',variant:'Medium',priceCents:2000,lowStock:1,requestId:'rights-sku'});
  const places=['studio',west.id],sessions={};
  for(const locationId of places) {
    await h.cmd('retail.receive',{skuId:sku.id,locationId,quantity:20,reference:'synthetic-strap-stock-'+locationId,requestId:'rights-stock-'+locationId});
    sessions[locationId]=await h.cmd('drawer.open',{locationId,register:'Rights drawer',floatCents:10000,requestId:'rights-drawer-'+locationId});
  }
  const grant=async(p,role,names,memberIds=[buyer.id],locationIds=['studio'])=>h.cmd('staff.access.grant',{personId:p.id,role,enabled:true,rights:Object.fromEntries(names.map(right=>[right,{enabled:true,scopes:[{memberIds,locationIds,doors:['all']}]}]))});
  const refuse=async(name,input,cookie,status=403)=>{
    const before=await h.state();
    const r=await h.send('/api/strap/command',{name,input},cookie);
    assert.equal(r.status,status,JSON.stringify(r.value));
    const after=await h.state();
    assert.equal(after.version,before.version,'refusal changes no stock, tender, gift or audit');
    assert.deepEqual(after.staffActions,before.staffActions);
  };
  const read=async(cookie=h.owner)=>(await h.send('/api/strap/retail',undefined,cookie)).value;
  const ownerGift=await h.cmd('retail.gift.issue',{personId:other.id,recipientId:other.id,locationId:west.id,amountCents:7000,tender:'external',reference:'synthetic-strap-203',requestId:'rights-hidden-gift'});
  const foreignPurchaser=await h.cmd('retail.gift.issue',{personId:other.id,recipientId:buyer.id,amountCents:3000,tender:'external',reference:'synthetic-strap-204',requestId:'rights-foreign-purchaser'});
  const sales=[];
  for(const [staff,role] of [[manager,'manager'],[desk,'front-desk']]) {
    for(const locationId of places) {
      const suffix=role+'-'+locationId,otherLocation=places.find(l=>l!==locationId);
      await grant(staff,role,['sale'],[buyer.id],[locationId]);
      if(locationId==='studio')await h.enroll(staff.cookie);
      assert.equal((await h.send('/app/retail',undefined,staff.cookie)).status,200);
      const view=await read(staff.cookie);
      assert.deepEqual(view.retailLocations.map(l=>l.id),[locationId]);
      assert.ok(view.retail.stock.every(s=>s.locationId===locationId));
      assert.deepEqual(view.retailPeople.map(p=>p.id),[buyer.id]);
      assert.ok(!JSON.stringify(view).includes(ownerGift.id));
      assert.deepEqual(view.retail.movements,[]);
      assert.ok(view.drawers.sessions.every(s=>s.locationId===locationId && !('expectedCents' in s)));
      for(const path of ['/api/strap/retail/day?date=2026-10-01','/api/strap/retail/day.csv?date=2026-10-01','/api/strap/staff-history.csv','/api/strap/exit.json'])assert.equal((await h.send(path,undefined,staff.cookie)).status,403,path);
      const input={personId:buyer.id,skuId:sku.id,locationId,quantity:1,expectedCents:2000,tender:'external',reference:'synthetic-strap-sale-'+suffix,requestId:'rights-sale-'+suffix,channel:'phone'};
      await refuse('retail.sell',{...input,personId:other.id},staff.cookie);
      await refuse('retail.sell',{...input,locationId:otherLocation},staff.cookie);
      await refuse('retail.sell',{...input,expectedCents:1999},staff.cookie,409);
      const requests=await Promise.all([h.send('/api/strap/command',{name:'retail.sell',input},staff.cookie),h.send('/api/strap/command',{name:'retail.sell',input},staff.cookie)]);
      assert.ok(requests.some(r=>r.status===200));
      assert.ok(requests.every(r=>r.status===200 || r.status===409));
      const sale=await h.cmd('retail.sell',input,staff.cookie);sales.push(sale);
      assert.deepEqual(await h.cmd('retail.sell',input,staff.cookie),sale);
      await refuse('retail.sell',{...input,quantity:2},staff.cookie,409);
      const returnInput={saleId:sale.id,quantity:1,restock:true,reason:'Unused merchandise',requestId:'rights-return-'+suffix,channel:'phone'};
      await refuse('retail.return',returnInput,staff.cookie);
      const issue={personId:buyer.id,recipientId:buyer.id,locationId,amountCents:6000,tender:'external',reference:'synthetic-strap-gift-'+suffix,requestId:'rights-gift-'+suffix,channel:'phone'};
      await refuse('retail.gift.issue',{...issue,personId:other.id},staff.cookie);
      await refuse('retail.gift.issue',{...issue,recipientId:other.id},staff.cookie);
      const card=await h.cmd('retail.gift.issue',issue,staff.cookie);
      assert.deepEqual(await h.cmd('retail.gift.issue',issue,staff.cookie),card);
      const redeem={...input,tender:'gift',giftCardId:card.id,reference:'synthetic-strap-redeem-'+suffix,requestId:'rights-redeem-'+suffix};
      await refuse('retail.sell',{...redeem,giftCardId:ownerGift.id},staff.cookie);
      const redeemed=await h.cmd('retail.sell',redeem,staff.cookie);
      assert.deepEqual(await h.cmd('retail.sell',redeem,staff.cookie),redeemed);
      const adjust={giftCardId:card.id,amountCents:100,reason:'Approved correction',requestId:'rights-adjust-'+suffix,channel:'phone'};
      const refund={giftCardId:card.id,amountCents:1000,reason:'Recorded external refund',reference:'synthetic-strap-refund-'+suffix,requestId:'rights-refund-'+suffix,channel:'phone'};
      await refuse('retail.gift.adjust',adjust,staff.cookie);
      await refuse('retail.gift.refund',refund,staff.cookie);
      await grant(staff,role,['refund'],[buyer.id],[locationId]);
      await refuse('retail.sell',{...input,requestId:'refund-only-sale'},staff.cookie);
      await refuse('retail.gift.issue',{...issue,requestId:'refund-only-issue'},staff.cookie);
      const returned=await h.cmd('retail.return',returnInput,staff.cookie);
      assert.deepEqual([returned.tender,returned.amountCents,returned.restock],['external',2000,true]);
      assert.deepEqual(await h.cmd('retail.return',returnInput,staff.cookie),returned);
      const giftReturnInput={...returnInput,saleId:redeemed.id,restock:false,requestId:'rights-gift-return-'+suffix};
      const giftReturn=await h.cmd('retail.return',giftReturnInput,staff.cookie);
      assert.deepEqual([giftReturn.tender,giftReturn.amountCents,giftReturn.restock],['gift',2000,false]);
      assert.deepEqual(await h.cmd('retail.return',giftReturnInput,staff.cookie),giftReturn);
      const adjusted=await h.cmd('retail.gift.adjust',adjust,staff.cookie);
      assert.deepEqual([adjusted.before,adjusted.after],[6000,6100]);
      assert.deepEqual(await h.cmd('retail.gift.adjust',adjust,staff.cookie),adjusted);
      const refunded=await h.cmd('retail.gift.refund',{...refund,tender:'cash',personId:other.id,locationId:otherLocation},staff.cookie);
      assert.deepEqual([refunded.personId,refunded.locationId,refunded.tender,refunded.amountCents],[buyer.id,locationId,'external',1000],'refund resolves the saved original, never body overrides');
      const actualRefund={...refund,tender:'cash',personId:other.id,locationId:otherLocation};
      assert.deepEqual(await h.cmd('retail.gift.refund',actualRefund,staff.cookie),refunded);
      if(locationId==='studio')await refuse('retail.gift.refund',{...refund,giftCardId:foreignPurchaser.id,requestId:'foreign-funding-'+role},staff.cookie);
      for(const [name,body] of [['retail.return',{...returnInput,saleId:sales.find(s=>s.locationId!==locationId)?.id ?? 'missing'}],['retail.gift.adjust',{...adjust,giftCardId:ownerGift.id}],['retail.gift.refund',{...refund,giftCardId:ownerGift.id}]])await refuse(name,{...body,personId:buyer.id,locationId},staff.cookie);
      const r=await read(),state=await h.state();
      assert.equal(r.gifts.cards.find(c=>c.id===card.id).balanceCents,5100);
      assert.equal(state.payments.filter(p=>p.retailSaleId===sale.id).length,1);
      assert.equal(state.payments.filter(p=>p.retailReturnId===returned.id).length,1);
      for(const [name,body,result,right] of [['retail.sell',input,sale,'sale'],['retail.gift.issue',issue,card,'sale'],['retail.sell',redeem,redeemed,'sale'],['retail.return',returnInput,returned,'refund'],['retail.return',giftReturnInput,giftReturn,'refund'],['retail.gift.adjust',adjust,adjusted,'refund'],['retail.gift.refund',actualRefund,refunded,'refund']]) {
        const audit=state.staffActions.filter(a=>a.command===name&&a.after.id===result.id);
        assert.equal(audit.length,1);assert.equal(audit[0].actorRole,role);assert.equal(audit[0].channel,'phone');assert.equal(audit[0].right,right);
        await grant(staff,role,[],[buyer.id],[locationId]);
        await refuse(name,body,staff.cookie);
        await refuse(name,{...body,requestId:'new-revoked-'+body.requestId},staff.cookie);
      }
      assert.equal((await h.send('/api/strap/retail',undefined,staff.cookie)).status,403);
      assert.equal((await h.send('/app/retail',undefined,staff.cookie)).status,403);
    }
  }
  for(const [p,role] of [[finance,'finance'],[coach,'instructor']]) {
    await grant(p,role,['staff-pay']);await h.enroll(p.cookie);
    for(const path of ['/app/retail','/api/strap/retail'])assert.equal((await h.send(path,undefined,p.cookie)).status,403);
    for(const name of ['retail.sell','retail.return','retail.gift.issue','retail.gift.adjust','retail.gift.refund'])await refuse(name,{},p.cookie);
  }
  await grant(manager,'manager',['sale','refund'],[buyer.id],places);
  await grant(desk,'front-desk',['sale','refund'],[buyer.id],places);
  // Cash is recorded through an existing open drawer; staff receive no drawer totals.
  const cash={personId:buyer.id,skuId:sku.id,locationId:west.id,quantity:1,expectedCents:2000,tender:'cash',sessionId:sessions[west.id].id,reference:'synthetic-strap-cash',requestId:'rights-cash'};
  const cashSale=await h.cmd('retail.sell',cash,manager.cookie);
  const cashReturn={saleId:cashSale.id,quantity:1,restock:true,sessionId:sessions[west.id].id,reason:'Original cash return',requestId:'rights-cash-return'};
  const returnedCash=await h.cmd('retail.return',cashReturn,manager.cookie);
  assert.equal(returnedCash.tender,'cash');assert.equal(returnedCash.amountCents,2000);
  assert.deepEqual(await h.cmd('retail.return',cashReturn,manager.cookie),returnedCash);
  const drawer=(await read()).sessions.find(s=>s.id===sessions[west.id].id);
  assert.equal(drawer.expectedCents,10000);assert.equal(drawer.entries.filter(e=>e.sourceId===cashSale.id||e.sourceId===returnedCash.id).length,2);
  if(process.env.STRAP_RIGHTS_PROOF_DIR || process.env.STRAP_PROOF_DIR)await (await import('./retail-browser.mjs')).staffRetailBrowser(h,{manager,desk,buyer,sku,west});
}
