import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rightsSeed } from './staff-rights-cases.mjs';

const local=(instant,part)=>new Intl.DateTimeFormat(part==='date'?'en-CA':'en-GB',{timeZone:'America/New_York',...(part==='date'?{year:'numeric',month:'2-digit',day:'2-digit'}:{hourCycle:'h23',hour:'2-digit',minute:'2-digit'})}).format(new Date(instant));
const at=hours=>new Date(Math.ceil((Date.now()+hours*3600000)/60000)*60000).toISOString();
const confirm=(h,d,cookie)=>h.cmd(d.operation==='save'?'appointment.reservation.confirm':'appointment.change.confirm',{id:d.id,key:d.key,channel:d.channel,requestId:'synthetic-strap-'+d.id},cookie);

export async function privatePolicy(h) {
  const {desk,ana,coach,grant,refuse}=await rightsSeed(h),rights=['member-record','booking'];
  await grant(desk,'front-desk',rights,[ana.id],['studio']);await h.enroll(desk.cookie);
  const input=(hours,room)=>({personId:ana.id,service:'Private policy',instructorId:coach.id,room,startDate:local(at(hours),'date'),endDate:local(at(hours),'date'),time:local(at(hours),'time'),minutes:50,channel:'phone'});
  let saved=await confirm(h,await h.cmd('appointment.reservation.prepare',input(8,'Policy room'),desk.cookie),desk.cookie);
  const initial=(await h.state()).packs.find(p=>p.id===ana.pack.id).remaining;
  const moving=await h.cmd('appointment.move.prepare',{reservationId:saved.id,classId:saved.occurrences[0].id,startDate:local(at(16),'date'),time:local(at(16),'time'),channel:'phone'},desk.cookie);
  assert.deepEqual(moving.policy.map(p=>[p.effect.feeCents,p.feeCents,p.mode]),[[1500,1500,'late']]);
  assert.equal((await h.state()).charges.filter(c=>c.reason==='late_move_fee').length,0,'a policy preview creates no fee');
  saved=await confirm(h,moving,desk.cookie);await confirm(h,moving,desk.cookie);
  let state=await h.state();assert.equal(state.packs.find(p=>p.id===ana.pack.id).remaining,initial,'move carries its original allocation');
  assert.deepEqual(state.charges.filter(c=>c.reason==='late_move_fee').map(c=>c.amountCents),[1500]);
  let second=await confirm(h,await h.cmd('appointment.reservation.prepare',input(9,'Policy second'),desk.cookie),desk.cookie);
  const change={reservationId:second.id,classId:second.occurrences[0].id,scope:'this',reason:'Sick',channel:'phone'};
  await refuse('appointment.cancel.prepare',{...change,mode:'early'},desk.cookie);
  await refuse('appointment.cancel.prepare',{...change,suppressNotice:true,suppressionReason:'Unsafe late suppression'},desk.cookie);
  const late=await h.cmd('appointment.cancel.prepare',change,desk.cookie);assert.equal(late.policy[0].creditReturned,false);assert.equal(late.policy[0].feeCents,1500);
  second=await confirm(h,late,desk.cookie);const afterLate=await h.state();
  assert.equal(afterLate.packs.find(p=>p.id===ana.pack.id).remaining,initial-1);
  assert.equal(afterLate.bookings.find(b=>b.id===second.occurrences[0].bookingId).cancellation,'late');
  const restore=await h.cmd('appointment.restore.prepare',{reservationId:second.id,classId:second.occurrences[0].id,reason:'Member can attend',channel:'phone'},desk.cookie);
  second=await confirm(h,restore,desk.cookie);await confirm(h,restore,desk.cookie);
  state=await h.state();assert.equal(state.packs.find(p=>p.id===ana.pack.id).remaining,initial-1,'restoring a retained late allocation spends no second credit');
  assert.deepEqual(state.charges.filter(c=>c.bookingId===second.occurrences[0].bookingId).map(c=>c.amountCents).sort((a,b)=>a-b),[-1500,1500]);
  await grant(desk,'front-desk',[...rights,'fee-waiver'],[ana.id],['studio']);
  const waiver=await h.cmd('appointment.cancel.prepare',{...change,mode:'early',waiverReason:'Sick courtesy',suppressNotice:true,suppressionReason:'Member confirmed personally at the desk'},desk.cookie);
  assert.deepEqual([waiver.policy[0].effect.feeCents,waiver.policy[0].feeCents,waiver.policy[0].creditReturned],[1500,0,true]);
  await grant(desk,'front-desk',rights,[ana.id],['studio']);await refuse('appointment.change.confirm',{id:waiver.id,key:waiver.key,channel:'phone'},desk.cookie);
  await grant(desk,'front-desk',[...rights,'fee-waiver'],[ana.id],['studio']);
  await confirm(h,waiver,desk.cookie);state=await h.state();assert.equal(state.packs.find(p=>p.id===ana.pack.id).remaining,initial);
  assert.equal(state.charges.filter(c=>c.bookingId===second.occurrences[0].bookingId).reduce((n,c)=>n+c.amountCents,0),0);
  assert.equal(state.bookings.find(b=>b.id===second.occurrences[0].bookingId).waiver.right,'fee-waiver');
  const suppressed=state.staffActions.find(a=>a.command==='appointment.change.confirm'&&a.action==='appointment.cancel'&&a.notice.status==='suppressed');assert.equal(suppressed.notice.suppressionReason,'Member confirmed personally at the desk');
  assert.equal(state.staffActions.filter(a=>a.command==='appointment.change.confirm'&&a.after?.id===second.id).length,3);
  assert.equal((await h.state(ana.cookie)).notices.filter(n=>n.appointmentReservationId===second.id).length,3,'one notice for save, cancellation and restoration; explicit courtesy suppression emits none');
}

export async function privatePayment(h) {
  const {desk,ana,coach,grant,refuse}=await rightsSeed(h),rights=['member-record','booking'];
  await grant(desk,'front-desk',rights,[ana.id],['studio']);await h.enroll(desk.cookie);
  const first=await h.cmd('appointment.price.save',{service:'Priced private',locationId:'studio',amountCents:8500});
  const date=new Date(Date.now()+20*86400000).toISOString().slice(0,10),end=new Date(Date.parse(date)+7*86400000).toISOString().slice(0,10);
  const input={personId:ana.id,service:'Priced private',instructorId:coach.id,locationId:'studio',room:'Priced studio',startDate:date,endDate:end,time:'13:00',minutes:50,channel:'phone',funding:{kind:'pay-per-visit',priceId:first.id}};
  await refuse('appointment.reservation.prepare',input,desk.cookie);
  await grant(desk,'front-desk',[...rights,'sale'],[ana.id],['studio']);
  const stale=await h.cmd('appointment.reservation.prepare',input,desk.cookie);
  const price=await h.cmd('appointment.price.save',{service:'Priced private',locationId:'studio',amountCents:9000});
  await refuse('appointment.reservation.confirm',{id:stale.id,key:stale.key,channel:'phone'},desk.cookie,409);
  const before=await h.state(),preview=await h.cmd('appointment.reservation.prepare',{...input,funding:{kind:'pay-per-visit',priceId:price.id}},desk.cookie);
  assert.equal(preview.funding.amountCents,9000);assert.equal(preview.occurrences.length,2);
  let saved=await confirm(h,preview,desk.cookie);await confirm(h,preview,desk.cookie);
  let state=await h.state(),charges=state.charges.filter(c=>c.appointmentReservationId===saved.id);
  assert.deepEqual(charges.map(c=>c.amountCents),[9000,9000]);assert.ok(charges.every(c=>c.priceId===price.id));assert.ok(saved.occurrences.every(o=>!o.packId));
  assert.deepEqual(state.packCreditEvents,before.packCreditEvents,'pay-per-visit consumes no pack credit');assert.deepEqual(state.payments,before.payments,'a priced booking collects no money');
  const cancel=await h.cmd('appointment.cancel.prepare',{reservationId:saved.id,classId:saved.occurrences[0].id,scope:'future',reason:'Travel changed',channel:'phone'},desk.cookie);
  saved=await confirm(h,cancel,desk.cookie);await confirm(h,cancel,desk.cookie);
  state=await h.state();charges=state.charges.filter(c=>c.appointmentReservationId===saved.id);assert.equal(charges.length,4);assert.equal(charges.reduce((n,c)=>n+c.amountCents,0),0);
  await h.cmd('appointment.price.save',{service:'Priced private',locationId:'studio',amountCents:9900});
  const restoring=await h.cmd('appointment.restore.prepare',{reservationId:saved.id,classId:saved.occurrences[0].id,scope:'future',reason:'Member returns',channel:'phone'},desk.cookie);
  await grant(desk,'front-desk',rights,[ana.id],['studio']);await refuse('appointment.change.confirm',{id:restoring.id,key:restoring.key,channel:'phone'},desk.cookie);
  await grant(desk,'front-desk',[...rights,'sale'],[ana.id],['studio']);
  saved=await confirm(h,restoring,desk.cookie);await confirm(h,restoring,desk.cookie);
  state=await h.state();charges=state.charges.filter(c=>c.appointmentReservationId===saved.id);assert.equal(charges.length,6);assert.equal(charges.reduce((n,c)=>n+c.amountCents,0),18000);assert.ok(charges.every(c=>Math.abs(c.amountCents)===9000),'restoration keeps the original accepted catalog price');
  assert.deepEqual(state.payments,before.payments);assert.deepEqual(state.packCreditEvents,before.packCreditEvents);
}
