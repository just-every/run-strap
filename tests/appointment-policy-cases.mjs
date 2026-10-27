import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rightsSeed } from './staff-rights-cases.mjs';

const local=(instant,part)=>new Intl.DateTimeFormat(part==='date'?'en-CA':'en-GB',{timeZone:'America/New_York',...(part==='date'?{year:'numeric',month:'2-digit',day:'2-digit'}:{hourCycle:'h23',hour:'2-digit',minute:'2-digit'})}).format(new Date(instant));
const at=hours=>new Date(Math.ceil((Date.now()+hours*3600000)/60000)*60000).toISOString();
const confirm=(h,d,cookie)=>h.cmd(d.operation==='save'?'appointment.reservation.confirm':'appointment.change.confirm',{id:d.id,key:d.key,channel:d.channel,requestId:'synthetic-strap-'+d.id},cookie);

export async function privatePolicy(h) {
  const {desk,manager,ana,ben,coach,grant,refuse}=await rightsSeed(h),rights=['member-record','booking'];
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
  const query='classId='+second.occurrences[0].id+'&type=late';
  const history=(await h.state()).bookingActions.filter(a=>a.action==='cancel'&&a.bookingId===second.occurrences[0].bookingId);
  assert.equal(history.length,1);
  assert.equal((await h.state()).staffActions.filter(a=>a.parentActionId===history[0].parentActionId).length,0,'linked occurrence history adds no duplicate canonical staff entries');
  assert.deepEqual([history[0].actorRole,history[0].right,history[0].channel,history[0].reason,history[0].feeCents,history[0].creditReturned],['front-desk','booking','phone','Sick',1500,false]);
  const csv=await h.send('/api/strap/cancellations.csv?'+query,undefined,h.owner);assert.equal(csv.status,200);
  const rows=csv.text.trimEnd().split('\r\n').map((line,index)=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m=>index?JSON.parse(m[1].replace(/""/g,'"')):m[1]));
  assert.equal(rows.length,2);const exported=Object.fromEntries(rows[0].map((key,i)=>[key,rows[1][i]]));
  assert.deepEqual([exported.bookingId,exported.actorRole,exported.channel,exported.reason,exported.type,exported.feeCents],[second.occurrences[0].bookingId,'front-desk','phone','Sick','late',1500]);
  await (await import('./report-downloads.mjs')).assertCancellationDownload(h,[query],['',desk.cookie,ana.cookie,coach.cookie]);
  assert.equal(exported.actorId,(await h.state(desk.cookie)).actor.id);assert.equal(exported.creditReturned,false);assert.equal(exported.notice,'in_app');assert.equal(exported.mail,'not_configured');assert.equal(exported.restoredAt,null);

  const screen=(await h.send('/app/people?'+query,undefined,h.owner)).text;assert.match(screen,/1 cancellations · 1 late/);assert.match(screen,/Sick/);assert.match(screen,/Preview appointment restoration/);

  const restore=await h.cmd('appointment.restore.prepare',{reservationId:second.id,classId:second.occurrences[0].id,reason:'Member can attend',channel:'phone'},desk.cookie);
  second=await confirm(h,restore,desk.cookie);await confirm(h,restore,desk.cookie);
  state=await h.state();assert.equal(state.packs.find(p=>p.id===ana.pack.id).remaining,initial-1,'restoring a retained late allocation spends no second credit');
  assert.deepEqual(state.charges.filter(c=>c.bookingId===second.occurrences[0].bookingId).map(c=>c.amountCents).sort((a,b)=>a-b),[-1500,1500]);
  const restoredHistory=state.bookingActions.filter(a=>a.action==='cancel'&&a.bookingId===second.occurrences[0].bookingId);
  assert.equal(restoredHistory.length,1);assert.ok(restoredHistory[0].restoredAt);assert.equal(restoredHistory[0].feeCents,1500,'history keeps the original fee after reversal');
  assert.match((await h.send('/app/people?'+query,undefined,h.owner)).text,/1 cancellations · 1 late/);
  assert.match((await h.send('/app/people?'+query,undefined,h.owner)).text,/Restored /);

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
  await h.cmd('bookingRule.save',{cancelCutoffHours:12,lateCancelReturnsCredit:false,lateCancelFeeCents:1500,noShowFeeCents:2000});
  const absent=await confirm(h,await h.cmd('appointment.reservation.prepare',input(10,'Private no-show room'),desk.cookie),desk.cookie),visit=absent.occurrences[0];
  await h.cmd('bookingRule.save',{noShowFeeCents:9000});
  const held=await h.state(),past=new Date(Date.now()-7200000).toISOString();
  await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.start',?,'$.end',?) WHERE id=?").bind(past,new Date(Date.parse(past)+3000000).toISOString(),visit.id).run();
  await h.cmd('attendance.noshow',{id:visit.bookingId},coach.cookie);
  await refuse('attendance.noshow',{id:visit.bookingId},coach.cookie,409);
  const noShow=await h.state();assert.equal(noShow.bookings.find(b=>b.id===visit.bookingId).attendance,'no_show');
  assert.deepEqual(noShow.charges.filter(c=>c.bookingId===visit.bookingId).map(c=>[c.reason,c.amountCents]),[['no_show_fee',2000]],'private no-show retains the booked terms and assesses once');
  assert.equal(noShow.packs.find(p=>p.id===ana.pack.id).remaining,held.packs.find(p=>p.id===ana.pack.id).remaining,'no-show consumes the held allocation without another debit');
  for (const [staff,role,hours] of [[manager,'manager',100],[coach,'instructor',148]]) {
    const source=input(hours,'Delegated private '+role),beforeRole=await h.state(),remaining=beforeRole.packs.find(p=>p.id===ana.pack.id).remaining;
    await grant(staff,role,['member-record'],[ana.id],['studio']);await h.enroll(staff.cookie);
    await refuse('appointment.reservation.prepare',source,staff.cookie);
    await grant(staff,role,['booking'],[ana.id],['studio']);await refuse('appointment.reservation.prepare',source,staff.cookie);
    await grant(staff,role,rights,[ana.id],['studio']);
    await refuse('appointment.reservation.prepare',{...source,personId:ben.id},staff.cookie);
    if(role==='instructor') {
      const otherCoach=await h.person('DelegatedOtherCoach','instructor');
      await refuse('appointment.reservation.prepare',{...source,instructorId:otherCoach.id},staff.cookie);
    }
    const preview=await h.cmd('appointment.reservation.prepare',source,staff.cookie);
    let delegated=await confirm(h,preview,staff.cookie);const original=delegated.occurrences[0];
    await confirm(h,preview,staff.cookie);
    const move=await h.cmd('appointment.move.prepare',{reservationId:delegated.id,classId:original.id,startDate:local(at(hours+24),'date'),time:local(at(hours+24),'time'),channel:'phone'},staff.cookie);
    await grant(staff,role,['member-record'],[ana.id],['studio']);await refuse('appointment.change.confirm',{id:move.id,key:move.key,channel:'phone'},staff.cookie);
    await grant(staff,role,rights,[ana.id],['studio']);delegated=await confirm(h,move,staff.cookie);await confirm(h,move,staff.cookie);
    const cancel=await h.cmd('appointment.cancel.prepare',{reservationId:delegated.id,classId:original.id,scope:'this',reason:'Member requested change',channel:'phone'},staff.cookie);
    delegated=await confirm(h,cancel,staff.cookie);await confirm(h,cancel,staff.cookie);
    assert.equal((await h.state()).packs.find(p=>p.id===ana.pack.id).remaining,remaining);
    const restoration=await h.cmd('appointment.restore.prepare',{reservationId:delegated.id,classId:original.id,reason:'Member requested original session',channel:'phone'},staff.cookie);
    delegated=await confirm(h,restoration,staff.cookie);await confirm(h,restoration,staff.cookie);
    assert.deepEqual([delegated.occurrences[0].id,delegated.occurrences[0].bookingId,delegated.occurrences[0].packId],[original.id,original.bookingId,original.packId]);
    const result=await h.state(),actions=result.staffActions.filter(a=>a.after?.id===delegated.id);
    assert.deepEqual(actions.map(a=>a.action).sort(),['appointment.cancel','appointment.move','appointment.restore','appointment.save']);
    const actor=(await h.state(staff.cookie)).actor.id;
    assert.ok(actions.every(a=>a.actorId===actor&&a.actorRole===role&&a.right==='booking'&&a.personId===ana.id&&a.channel==='phone'));
    assert.equal(result.packs.find(p=>p.id===ana.pack.id).remaining,remaining-1);
    assert.equal((await h.state(ana.cookie)).notices.filter(n=>n.appointmentReservationId===delegated.id).length,4);
    if(process.env.STRAP_PROOF_DIR) await (await import('./reservations-browser.mjs')).delegatedPrivateBrowser(h,{staff,role,member:ana,reservation:delegated});
    await grant(staff,role,['booking'],[ana.id],['studio']);
    await refuse('appointment.change.confirm',{id:restoration.id,key:restoration.key,channel:'phone',requestId:'synthetic-strap-'+restoration.id},staff.cookie);
  }


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
  const currentPrice=(await h.state()).appointmentPrices.find(p=>p.service==='Priced private');
  const reviewed=await h.cmd('appointment.reservation.prepare',{...input,startDate:end,endDate:end,time:'16:00',funding:{kind:'pay-per-visit',priceId:currentPrice.id}},desk.cookie);
  const home=await h.cmd('household.save',{name:'Private participant household'});
  await h.cmd('household.participant.add',{id:home.id,personId:ana.id});
  const staleHousehold=await refuse('appointment.reservation.confirm',{id:reviewed.id,key:reviewed.key,channel:'phone'},desk.cookie);
  assert.equal(staleHousehold.value.error,'appointment_household_payment_authorization_required','becoming a household participant invalidates previously reviewed individual-price authority');

  const householdInput={...input,startDate:end,endDate:end,funding:{kind:'pay-per-visit',priceId:(await h.state()).appointmentPrices.find(p=>p.service==='Priced private').id}};
  const denied=await refuse('appointment.reservation.prepare',householdInput,desk.cookie);
  assert.equal(denied.value.error,'appointment_household_payment_authorization_required');
  const payer=await h.person('PrivatePayer');
  await h.cmd('household.payer.propose',{id:home.id,payerId:payer.id});
  await h.cmd('household.payer.accept',{id:home.id},payer.cookie);
  const genericConsent=await refuse('appointment.reservation.prepare',householdInput,desk.cookie);
  assert.equal(genericConsent.value.error,'appointment_household_payment_authorization_required','general household responsibility is not exact private-price authorization');
  const unchanged=await h.state();assert.deepEqual(unchanged.charges,state.charges);assert.deepEqual(unchanged.payments,state.payments);
}
