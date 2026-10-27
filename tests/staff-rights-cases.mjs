import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

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
  const holiday=await h.cmd('closure.prepare',{scope:'class',classId:occurrences[3].id,reason:'Holiday closure'});await h.cmd('closure.confirm',{id:holiday.id,key:holiday.impact.key});
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
  await grant(finance,'finance',['exports'],[ana.id],['studio']);await h.enroll(finance.cookie);
  assert.equal((await h.send('/api/strap/reports/revenue.csv',undefined,finance.cookie)).status,200);
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
  const {desk,ana,grant,refuse}=await rightsSeed(h);
  await grant(desk,'front-desk',['member-record']);await h.enroll(desk.cookie);
  const input={packId:ana.pack.id,intervalMonths:1,requestId:randomUUID(),channel:'phone'};
  await refuse('plan.recurring.prepare',input,desk.cookie);
  await grant(desk,'front-desk',['member-record','membership-sale']);
  const preview=await h.cmd('plan.recurring.prepare',input,desk.cookie);
  assert.equal(preview.personId,ana.id);assert.equal(preview.createdBy,(await h.state(desk.cookie)).actor.id);assert.equal(preview.status,'preview');
  await refuse('plan.recurring.accept',{id:preview.id,key:preview.key},desk.cookie);
  const terms=await h.cmd('plan.recurring.accept',{id:preview.id,key:preview.key},ana.cookie);assert.equal(terms.status,'active');
  const cancel={packId:terms.currentPackId,effectiveAt:iso(1000),reason:'Moving out of town',channel:'phone',requestId:randomUUID()};
  await refuse('plan.cancellation.prepare',cancel,desk.cookie);
  await grant(desk,'front-desk',['member-record','contract-change']);
  const proposed=await h.cmd('plan.cancellation.prepare',cancel,desk.cookie);assert.equal(proposed.status,'preview');
  const confirm={id:proposed.id,key:proposed.key,channel:'phone',requestId:randomUUID()};
  await grant(desk,'front-desk',['member-record']);await refuse('plan.cancellation.confirm',confirm,desk.cookie);
  await grant(desk,'front-desk',['member-record','contract-change']);
  const saved=await h.cmd('plan.cancellation.confirm',confirm,desk.cookie);assert.equal(saved.status,'scheduled');assert.equal(saved.terminatedRole,'front-desk');assert.equal(saved.channel,'phone');
  assert.deepEqual(await h.cmd('plan.cancellation.confirm',confirm,desk.cookie),saved);
  const history=(await h.state()).staffActions;assert.equal(history.filter(a=>a.command==='plan.cancellation.confirm'&&a.personId===ana.id).length,1);
}
