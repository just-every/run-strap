import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
const day = 86_400_000, plus = (date,n) => new Date(Date.parse(date+'T12:00:00Z')+n*day).toISOString().slice(0,10)
const local = at => new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date(at))
function dstDates() {
  let year = new Date().getUTCFullYear();
  for (;;) {
    const first = new Date(Date.UTC(year,10,1)), transition = new Date(first.getTime()+((7-first.getUTCDay())%7)*day).toISOString().slice(0,10), start = plus(transition,-7);
    if (Date.parse(start) > Date.now()+day) return {start,end:plus(start,35)};
    year++;
  }
}
async function studio(h) {
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'});
  await h.cmd('studio.save',{location:'Brooklyn',timeZone:'America/New_York'});
  const coach = await h.person('Maya','instructor'), ana = await h.person('Ana'), ben = await h.person('Ben'), cy = await h.person('Cy');
  return {coach,ana,ben,cy};
}
async function pack(h,p,terms={}) { return h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits:10,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z',...terms})).id}); }
async function series(h,coach,dates,room='Main',time='09:00',capacity=1) {
  return h.cmd('series.publish',{id:(await h.cmd('series.prepare',{startDate:dates.start,endDate:dates.end,time,minutes:50,intervalWeeks:1,title:'Sunday Flow',service:'Yoga',room,capacity,onlineCapacity:capacity,instructorId:coach.id})).id});
}
async function refused(h,name,input,cookie,code,status=409) {
  const before=(await h.state()).version,r=await h.send('/api/strap/command',{name,input},cookie);
  assert.equal(r.status,status,JSON.stringify(r.value)); if(code) assert.equal(r.value.error,code);
  assert.equal((await h.state()).version,before,'refused command changes nothing');
}
const confirm = (h,draft,cookie=h.owner,extra={}) => h.cmd(draft.operation === 'cancel' ? 'reservation.cancel.confirm' : 'reservation.confirm',{id:draft.id,key:draft.key,...extra},cookie);
// Advance only the stored occurrence's clock, as in the existing attendance
// journeys. All reservations, entitlements, cancellations and no-shows use HTTP.
const backdate = (h,id,start) => h.db.prepare("UPDATE st_records SET data=json_set(data,'$.start',?,'$.end',?) WHERE id=?").bind(start,new Date(Date.parse(start)+50*60_000).toISOString(),id).run();

test('SCHED-005: DST class reservations retain booked/waitlisted/skipped outcomes, own occurrence entitlements, FIFO and once-only cancellation/move/restore/no-show effects',()=>run(async h=>{
  const {coach,ana,ben,cy}=await studio(h),dates=dstDates(),published=await series(h,coach,dates),[c0,c1,c2,c3,c4,c5]=published.classes;
  assert.ok(published.classes.every(c=>local(c.start)==='09:00'));
  assert.equal(Date.parse(c1.start)-Date.parse(c0.start),7*day+3_600_000,'DST keeps the studio clock hour');
  const first=await pack(h,ana,{credits:1,eligibleServices:['Yoga'],expiresAt:c4.start}),later=await pack(h,ana,{credits:2,eligibleServices:['Yoga']});
  await pack(h,ben);await pack(h,cy);
  const occupied=await h.cmd('booking.book',{classId:c1.id},ben.cookie),earlierWaiter=await h.cmd('booking.book',{classId:c1.id},cy.cookie);
  const close=await h.cmd('series.cancel.prepare',{classId:c2.id,scope:'this',reason:'Holiday closure'});
  await h.cmd('series.cancel.confirm',{id:close.id,impact:close.impact.key});
  const change=await h.cmd('series.change.prepare',{classId:c3.id,scope:'this',reason:'Special equipment class',change:{service:'Reformer'}});
  await h.cmd('series.change.approve',{id:change.id,impact:change.impact.key});
  const input={classId:c0.id,throughDate:dates.end};
  const before=(await h.state()).bookings.length,draft=await h.cmd('reservation.prepare',input,ana.cookie);
  assert.deepEqual(draft.outcomes.map(o=>[o.status,o.reason]),[['booked',null],['waitlisted',null],['skipped','class_cancelled'],['skipped','no_eligible_entitlement'],['booked',null],['booked',null]]);
  assert.ok(draft.outcomes.every(o=>!o.bookingId),'preview never publishes simulated booking identities');
  assert.equal((await h.state()).bookings.length,before,'preview spends and books nothing');
  await refused(h,'reservation.confirm',{id:draft.id,key:draft.key},ben.cookie,'forbidden',403);
  await refused(h,'reservation.prepare',{...input,personId:ben.id},ana.cookie,'forbidden',403);
  await refused(h,'reservation.prepare',input,coach.cookie,'member_or_owner_required',403);
  const saved=await confirm(h,draft,ana.cookie),booked=saved.outcomes.filter(o=>o.bookingId);
  assert.deepEqual(booked.map(o=>o.packId),[first.id,null,later.id,later.id]);
  assert.equal((await h.state()).packs.find(p=>p.id===later.id).remaining,0);
  await confirm(h,draft,ana.cookie);
  assert.equal((await h.state()).bookings.filter(b=>b.reservationId===saved.id).length,4,'confirm replay makes no duplicate');
  assert.equal((await h.state(ben.cookie)).reservations.length,0,'another member cannot read the series');
  assert.equal((await h.state(coach.cookie)).reservations.length,0,'instructor cannot read private reservations');
  const own=(await h.state(ana.cookie)).notices.filter(n=>n.id.startsWith('notice:confirmation:'));
  assert.equal(own.length,4);
  await h.cmd('booking.cancel',{id:occupied.id},ben.cookie);
  let state=await h.state();
  assert.equal(state.bookings.find(b=>b.id===earlierWaiter.id).status,'booked','earlier waitlist member gets the vacancy');
  assert.equal(state.bookings.find(b=>b.id===saved.outcomes[1].bookingId).status,'waitlisted','recurring reservation never jumps FIFO');
  await h.cmd('booking.cancel',{id:saved.outcomes[0].bookingId},ana.cookie);
  // A member can move a series occurrence using the ordinary door; the series
  // cancellation follows the booking identity to its new class.
  const extra=await series(h,coach,{start:plus(dates.end,7),end:plus(dates.end,7)},'Annex','11:00',2);
  const moved=await h.cmd('booking.move',{id:saved.outcomes[5].bookingId,classId:extra.classes[0].id},ana.cookie);
  assert.equal(moved.reservationId,saved.id);
  const past=new Date(Date.now()-day).toISOString();await backdate(h,c4.id,past);
  const started=(await h.state()).bookings.find(b=>b.id===saved.outcomes[4].bookingId);
  const cancellation=await h.cmd('reservation.cancel.prepare',{reservationId:saved.id},ana.cookie);
  assert.deepEqual(cancellation.outcomes.map(o=>o.id),[saved.outcomes[1].bookingId,saved.outcomes[5].bookingId]);
  assert.ok(cancellation.outcomes.every(o=>!o.effect.feeCents));
  const cancelled=await confirm(h,cancellation,ana.cookie),snapshot=await h.state();
  await confirm(h,cancellation,ana.cookie);state=await h.state();
  assert.deepEqual(state.packs,snapshot.packs);assert.equal(state.packCreditEvents.length,snapshot.packCreditEvents.length);
  assert.deepEqual(state.bookings.find(b=>b.id===started.id),started,'past/started occurrence is untouched');
  assert.equal(state.packs.find(p=>p.id===first.id).remaining,1,'single cancellation returns the first pack credit only once');
  assert.equal(state.packs.find(p=>p.id===later.id).remaining,1,'future cancellation returns only the future pack credit');
  assert.equal(cancelled.cancelledBookingIds.length,2);
  await h.cmd('attendance.noshow',{id:started.id},coach.cookie);
  assert.equal((await h.state()).bookings.find(b=>b.id===started.id).attendance,'no_show');
  await h.cmd('booking.restore',{id:moved.id,reason:'Member asked to return',channel:'phone'});
  assert.equal((await h.state()).bookings.find(b=>b.id===moved.id).reservationId,saved.id,'ordinary staff restore retains series provenance');
  const exported=(await h.send('/api/strap/exit.json',undefined,h.owner)).value;
  const records=exported.tables.st_records.map(r=>({kind:r.kind,...JSON.parse(r.data)}));
  assert.equal(records.find(r=>r.kind==='reservation'&&r.id===saved.id).outcomes[2].reason,'class_cancelled');
  assert.ok(records.some(r=>r.kind==='reservationPreview'&&r.id===draft.id));
  if(process.env.STRAP_PROOF_DIR) await (await import('./reservations-browser.mjs')).reservationsBrowser(h,{coach,ana,ben,start:plus(dates.end,28)});
}));

test('SCHED-005: horizon and plan-overdraw refusals are atomic; stale previews recheck capacity, waiver and rules; late-cancel/no-show terms are per occurrence',()=>run(async h=>{
  const {coach,ana,ben}=await studio(h),dates=dstDates(),published=await series(h,coach,{start:dates.start,end:plus(dates.start,14)},'Main','09:00',2),[c0,c1,c2]=published.classes;
  await pack(h,ana,{credits:2});
  const input={classId:c0.id,throughDate:plus(dates.start,14)};
  await refused(h,'reservation.prepare',input,ana.cookie,'series_would_overdraw_entitlement');
  assert.equal((await h.state(ana.cookie)).bookings.length,0);
  const weekly=await pack(h,ben,{kind:'visits',credits:undefined,planName:'Two monthly',visits:2,period:'month',rollover:0});
  // All three occurrences can be put in the same month for the explicit visit
  // bound without fabricating a plan balance or booking result.
  const month=plus(dates.end,40).slice(0,8);
  const sameMonth=await series(h,coach,{start:month+'08',end:month+'22'},'Visits','11:00',2);
  await refused(h,'reservation.prepare',{classId:sameMonth.classes[0].id,throughDate:month+'22'},ben.cookie,'series_would_overdraw_entitlement');
  assert.equal((await h.state()).packs.find(p=>p.id===weekly.id).remaining,0);
  await h.cmd('bookingRule.save',{opensHoursBefore:1});
  await refused(h,'reservation.prepare',{...input,throughDate:dates.start},ana.cookie,'booking_window_not_open');
  await h.cmd('bookingRule.save',{});
  const short={...input,throughDate:dates.start},draft=await h.cmd('reservation.prepare',short,ana.cookie);
  await h.cmd('booking.book',{classId:c0.id},ben.cookie);
  await refused(h,'reservation.confirm',{id:draft.id,key:draft.key},ana.cookie,'reservation_facts_changed');
  const waiver=await h.cmd('waiver.publish',{text:'Current participation waiver'}),pending=await h.cmd('reservation.prepare',short,ana.cookie);
  assert.equal(pending.outcomes[0].reason,'waiver_acknowledgement_required');
  await h.cmd('waiver.acknowledge',{id:waiver.id},ana.cookie);
  await refused(h,'reservation.confirm',{id:pending.id,key:pending.key},ana.cookie,'reservation_facts_changed');
  // Retain an explicit late rule on each booked occurrence, then move its clock
  // into the cutoff window. Changing the studio rule does not rewrite it.
  await h.cmd('bookingRule.save',{cancelCutoffHours:24,lateCancelReturnsCredit:false,lateCancelFeeCents:1500,noShowFeeCents:2000});
  const lateDraft=await h.cmd('reservation.prepare',{classId:c1.id,throughDate:plus(dates.start,14)},ana.cookie),saved=await confirm(h,lateDraft,ana.cookie);
  await h.cmd('bookingRule.save',{});
  await backdate(h,c1.id,new Date(Date.now()+3_600_000).toISOString());
  await backdate(h,c2.id,new Date(Date.now()-3_600_000).toISOString());
  const cancelled=await h.cmd('reservation.cancel.prepare',{reservationId:saved.id},ana.cookie);
  assert.equal(cancelled.outcomes.length,1);assert.equal(cancelled.outcomes[0].effect.feeCents,1500);assert.equal(cancelled.outcomes[0].effect.creditReturned,false);
  await confirm(h,cancelled,ana.cookie);await confirm(h,cancelled,ana.cookie);
  await h.cmd('attendance.noshow',{id:saved.outcomes[1].bookingId},coach.cookie);
  const state=await h.state();
  assert.deepEqual(state.charges.filter(c=>c.bookingId===saved.outcomes[0].bookingId).map(c=>[c.reason,c.amountCents]),[['late_cancel_fee',1500]]);
  assert.deepEqual(state.charges.filter(c=>c.bookingId===saved.outcomes[1].bookingId).map(c=>[c.reason,c.amountCents]),[['no_show_fee',2000]]);
  assert.equal(state.packs.find(p=>p.personId===ana.id).remaining,0);
  const key=await h.cmd('agent.create',{label:'No series authority'});
  assert.equal((await h.send('/api/strap/agent/command',{name:'reservation.prepare',input:short},'',{authorization:`Bearer ${key.token}`})).status,403);
}));

test('SCHED-005: concurrent series confirmations share the seat/credit fence and a revoked member cannot reuse a reviewed series',()=>run(async h=>{
  const {coach,ana,ben,cy}=await studio(h),dates=dstDates(),published=await series(h,coach,{start:dates.start,end:plus(dates.start,7)});
  for(const p of [ana,ben,cy]) await pack(h,p,{credits:2});
  const input={classId:published.classes[0].id,throughDate:plus(dates.start,7)},a=await h.cmd('reservation.prepare',input,ana.cookie),b=await h.cmd('reservation.prepare',input,ben.cookie);
  const confirmations=await Promise.all([[a,ana],[b,ben]].map(([d,p])=>h.send('/api/strap/command',{name:'reservation.confirm',input:{id:d.id,key:d.key}},p.cookie)));
  assert.equal(confirmations.filter(r=>r.status===200).length,1);
  assert.ok(confirmations.filter(r=>r.status!==200).every(r=>r.status===409));
  const loser=confirmations[0].status===200?ben:ana,waiting=await h.cmd('reservation.prepare',input,loser.cookie);
  assert.ok(waiting.outcomes.every(o=>o.status==='waitlisted'));
  await confirm(h,waiting,loser.cookie);
  let state=await h.state();
  for(const c of published.classes) assert.equal(state.bookings.filter(b=>b.classId===c.id&&b.status==='booked').length,1);
  assert.equal(state.packs.find(p=>p.personId===loser.id).remaining,2,'waitlisting reserves no credit');
  const pending=await h.cmd('reservation.prepare',input,cy.cookie),person=state.people.find(p=>p.id===cy.id);
  await h.cmd('person.save',{id:person.id,name:person.name,email:person.email,role:'member',active:false,version:person.version});
  await refused(h,'reservation.confirm',{id:pending.id,key:pending.key},cy.cookie,'active_person_required',403);
  state=await h.state();assert.ok(state.packs.every(p=>p.remaining>=0));
  assert.ok(state.reservationPreviews.every(p=>/^[a-f0-9]{64}$/.test(p.basis)),'opaque review fingerprints expose no other member waiver history');
}));

test('SCHED-013: private ten-week appointment offers retain dated conflicts, recheck chosen alternatives and never reserve or send',()=>run(async h=>{
  await h.cmd('studio.save',{location:'Brooklyn',timeZone:'America/New_York'});
  const coach=await h.person('Priya','instructor'),member=await h.person('Alex'),desk=await h.person('Desk'),manager=await h.person('Manager'),finance=await h.person('Finance');
  await h.cmd('member.record.grant',{personId:desk.id,memberIds:[member.id],enabled:true,canCreate:false});
  await h.cmd('manager.grant',{id:manager.id,locationIds:['studio']});
  await h.cmd('finance.grant',{id:finance.id});
  for (const staff of [desk,manager,finance]) { staff.cookie=await h.signIn(staff.email); await h.enroll(staff.cookie); }
  const memberPack=await pack(h,member,{credits:10,eligibleServices:['Private Mat']});
  const start='2096-10-23',end=plus(start,63),conflictDate=plus(start,21);
  // Fixed civil dates cross fall DST independently of the clock running the test.
  const at=(date,hour=14)=>date+'T'+hour+':00:00.000Z';
  const exception=await h.cmd('scheduling.unavailable.save',{resourceKind:'instructor',resourceId:coach.id,start:at(conflictDate),end:at(conflictDate,15),reason:'Private time off'});
  const input={service:'Private Mat',room:'Main',instructorId:coach.id,startDate:start,endDate:end,time:'09:00',minutes:50,bufferAfterMinutes:15,requestId:'synthetic-strap-series-1'};
  const records=async()=> (await h.db.prepare("SELECT id,kind,data FROM st_records WHERE kind!='appointmentSeriesOffer' ORDER BY id").all()).results;
  const baseline=await records(),delivery=await h.db.prepare('SELECT COUNT(*) AS n FROM st_notice_deliveries').first(),outbox=await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first();
  const offer=await h.cmd('appointment.series.offer.save',input);
  assert.equal(offer.occurrences.length,10);
  assert.deepEqual(offer.occurrences.map(o=>o.occurrenceDate),Array.from({length:10},(_,i)=>plus(start,7*i)));
  assert.ok(offer.occurrences.every(o=>local(o.start)==='09:00'));
  assert.equal(Date.parse(offer.occurrences[2].start)-Date.parse(offer.occurrences[1].start),7*day+3_600_000);
  assert.equal(offer.occurrences[3].availabilityAtCreation.blockers.find(b=>b.id===exception.id).reason,'Private time off');
  assert.deepEqual(await h.cmd('appointment.series.offer.save',input),offer);
  const preview=await h.cmd('appointment.series.offer.preview',{id:offer.id});
  assert.equal(preview.available,false);
  assert.deepEqual(preview.occurrences.map(o=>o.available),[true,true,true,false,true,true,true,true,true,true]);
  const wednesday=preview.occurrences[3].alternatives.find(o=>o.localDate===plus(conflictDate,1));
  assert.ok(wednesday);
  assert.equal(local(wednesday.start),'09:00');
  const chosenInput={...input,choices:[{date:conflictDate,start:wednesday.start}],requestId:'synthetic-strap-series-2'};
  const chosen=await h.cmd('appointment.series.offer.save',chosenInput);
  assert.equal(chosen.occurrences.length,10);
  assert.equal(chosen.occurrences[3].start,wednesday.start);
  assert.equal(chosen.occurrences[3].originalStart,offer.occurrences[3].start);
  assert.equal(chosen.occurrences[3].chosenAlternative,true);
  assert.equal((await h.cmd('appointment.series.offer.preview',{id:chosen.id})).available,true);
  for(const proposal of [offer,chosen]) {
    assert.deepEqual([proposal.reserved,proposal.bookingAvailable,proposal.paymentCollected],[false,false,false]);
    assert.ok(proposal.occurrences.every(o=>!o.availabilityAtCreation.reserved));
  }
  for(const cookie of [member.cookie,coach.cookie,desk.cookie,manager.cookie,finance.cookie,'']) {
    await h.cmd('appointment.series.offer.save',input,cookie,cookie?403:401);
    await h.cmd('appointment.series.offer.preview',{id:offer.id},cookie,cookie?403:401);
    await h.cmd('appointment.offer.save',{...input,start:offer.occurrences[0].start,durationMinutes:50},cookie,cookie?403:401);
    await h.cmd('appointment.offer.preview',{id:offer.id},cookie,cookie?403:401);
    if(cookie) assert.ok(!(await h.send('/api/strap/state',undefined,cookie)).text.includes('Private time off'));
  }
  assert.deepEqual(await records(),baseline,'offer save, read, replay and all refusals change no entitlement, financial, booking or notice record');
  assert.deepEqual(await h.db.prepare('SELECT COUNT(*) AS n FROM st_notice_deliveries').first(),delivery);
  assert.deepEqual(await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first(),outbox);
  assert.equal((await h.state()).packs.find(p=>p.id===memberPack.id).remaining,10);
  const key=await h.cmd('agent.create',{label:'No private series access'});
  for(const name of ['appointment.series.offer.save','appointment.series.offer.preview']) {
    assert.equal((await h.send('/api/strap/agent/command',{name,input:{id:offer.id}},'',{authorization:`Bearer ${key.token}`})).status,403);
  }
  const allocated=await h.cmd('series.publish',{id:(await h.cmd('series.prepare',{...input,title:'Later class',startDate:plus(conflictDate,1),endDate:plus(conflictDate,1),time:'09:00',capacity:1})).id});
  assert.equal(allocated.classes.length,1,'an offer never holds its chosen alternative against a real publication');
  const changed=await h.cmd('appointment.series.offer.preview',{id:chosen.id});
  assert.equal(changed.occurrences[3].available,false);
  const count=await h.db.prepare("SELECT COUNT(*) AS n FROM st_records WHERE kind='appointmentSeriesOffer'").first();
  await h.cmd('appointment.series.offer.save',{...chosenInput,requestId:'synthetic-strap-series-stale'},h.owner,409);
  await h.cmd('appointment.series.offer.save',{...input,choices:[{date:conflictDate,start:offer.occurrences[4].start}],requestId:'synthetic-strap-series-outside'},h.owner,400);
  await h.cmd('appointment.series.offer.save',{...chosenInput,choices:[...chosenInput.choices,...chosenInput.choices],requestId:'synthetic-strap-series-duplicate'},h.owner,400);
  await h.cmd('appointment.series.offer.save',{...input,time:'10:00'},h.owner,409);
  assert.deepEqual(await h.db.prepare("SELECT COUNT(*) AS n FROM st_records WHERE kind='appointmentSeriesOffer'").first(),count);
  await h.cmd('scheduling.unavailable.remove',{id:exception.id});
  const retained=await h.cmd('appointment.series.offer.preview',{id:offer.id});
  assert.equal(retained.occurrences[3].available,true);
  assert.equal(retained.offer.occurrences[3].availabilityAtCreation.blockers.find(b=>b.id===exception.id).reason,'Private time off');
  const roomClosure=await h.cmd('closure.prepare',{scope:'room',room:' MAIN ',start:offer.occurrences[6].start,end:offer.occurrences[6].end,reason:'Room maintenance'});
  await h.cmd('closure.confirm',{id:roomClosure.id,impact:roomClosure.impact.key});
  const roomPreview=await h.cmd('appointment.series.offer.preview',{id:offer.id});
  assert.equal(roomPreview.occurrences[6].blockers.find(b=>b.id===roomClosure.id).reason,'Room maintenance');
  assert.equal(roomPreview.occurrences[6].blockers.find(b=>b.id===roomClosure.id).kind,'room_closed');
  const exported=(await h.send('/api/strap/exit.json',undefined,h.owner)).value;
  assert.equal(JSON.parse(exported.tables.st_records.find(r=>r.id===offer.id).data).occurrences[3].availabilityAtCreation.blockers.find(b=>b.id===exception.id).reason,'Private time off');
}));
