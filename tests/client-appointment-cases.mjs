import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function clientSeed(h, label='Client') {
  await h.confirmSetup(h.owner);
  await h.cmd('studio.save',{location:'Brooklyn',timeZone:'America/New_York'});
  const coach=await h.person(label+'Coach','instructor'),ana=await h.person(label+'Ana'),ben=await h.person(label+'Ben');
  for(const member of [ana,ben]) await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:10,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z',eligibleServices:['Private Pilates']})).id});
  const offer=async(member,{date='2091-10-22',time='09:00',room='Private reformer',depositCents=2500}={})=>{
    const source=await h.cmd('appointment.series.offer.save',{requestId:randomUUID(),service:'Private Pilates',instructorId:coach.id,room,equipment:['Reformer 1'],bufferBeforeMinutes:10,bufferAfterMinutes:10,startDate:date,endDate:date,time,minutes:50});
    return h.cmd('appointment.client.deliver',{offerId:source.id,personId:member.id,depositCents,requestId:randomUUID()});
  };
  return {coach,ana,ben,offer};
}
export async function clientRefused(h,name,input,cookie,status=403) {
  const before=(await h.state()).version,response=await h.send('/api/strap/command',{name,input},cookie);
  assert.equal(response.status,status,JSON.stringify(response.value));assert.equal((await h.state()).version,before);return response;
}
export const clientAccept=(h,offer,cookie,extra={})=>h.cmd('appointment.client.accept',{id:offer.id,key:offer.key,confirm:true,...extra},cookie);
export const clientConfirm=(h,preview,cookie,extra={})=>h.cmd('appointment.client.change.confirm',{id:preview.id,key:preview.key,...extra},cookie);

export async function clientCampaign(h) {
  const {coach,ana,ben,offer}=await clientSeed(h);
  const baseline=await h.state(),first=await offer(ana),second=await offer(ben,{time:'09:30'});
  let state=await h.state();
  assert.deepEqual(state.bookings,baseline.bookings);assert.deepEqual(state.packCreditEvents,baseline.packCreditEvents);
  assert.deepEqual(state.payments,baseline.payments);assert.deepEqual(state.charges,baseline.charges);
  const own=await h.state(ana.cookie),other=await h.state(ben.cookie);
  assert.deepEqual(own.clientAppointmentOffers.map(o=>o.id),[first.id]);assert.deepEqual(other.clientAppointmentOffers.map(o=>o.id),[second.id]);
  assert.deepEqual(own.appointmentSeriesOffers,[]);assert.ok(!JSON.stringify(own.clientAppointmentOffers).includes('requestBasis'));
  assert.equal(own.notices.filter(n=>n.clientAppointmentOfferId===first.id).length,1);
  await clientRefused(h,'appointment.client.accept',{id:first.id,key:first.key,confirm:true},ben.cookie);
  await clientRefused(h,'appointment.client.accept',{id:first.id,key:'changed',confirm:true},ana.cookie,409);
  await clientRefused(h,'appointment.client.accept',{id:first.id,key:first.key,confirm:false},ana.cookie,409);
  const responses=await Promise.all([[first,ana],[second,ben]].map(([o,m])=>h.send('/api/strap/command',{name:'appointment.client.accept',input:{id:o.id,key:o.key,confirm:true}},m.cookie)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  state=await h.state();assert.equal(state.appointments.length,1);assert.equal(state.bookings.length,1);
  const saved=state.appointments[0],member=saved.personId===ana.id?ana:ben,accepted=member.id===ana.id?first:second,loser=member.id===ana.id?ben:ana;
  assert.equal(state.packs.find(p=>p.personId===member.id).remaining,9);assert.equal(state.packs.find(p=>p.personId===loser.id).remaining,10);
  await clientAccept(h,accepted,member.cookie);assert.equal((await h.state()).bookings.length,1);
  const receipt={reservationId:saved.id,amountCents:2500,reference:'synthetic-strap-deposit-1',requestId:randomUUID()};
  await clientRefused(h,'appointment.client.deposit.record',receipt,member.cookie);
  await clientRefused(h,'appointment.client.deposit.record',{...receipt,amountCents:2501},h.owner,409);
  const beforeReceipt=await h.state();await h.cmd('appointment.client.deposit.record',receipt);await h.cmd('appointment.client.deposit.record',receipt);
  state=await h.state();assert.equal(state.payments.length,beforeReceipt.payments.length+1);
  const payment=state.payments.find(p=>p.appointmentReservationId===saved.id);
  assert.deepEqual([payment.personId,payment.amountCents,payment.reference],[member.id,2500,'synthetic-strap-deposit-1']);
  assert.equal(state.balances.find(b=>b.personId===member.id).balanceCents,7500);
  await clientRefused(h,'appointment.client.deposit.record',{...receipt,reference:'synthetic-strap-deposit-2',requestId:randomUUID()},h.owner,409);
  const move=await h.cmd('appointment.client.move.prepare',{reservationId:saved.id,classId:saved.occurrences[0].id,startDate:'2091-10-23',time:'11:00'},member.cookie);
  assert.equal(move.policy[0].feeCents,0);assert.equal((await h.state()).classes.find(c=>c.id===saved.occurrences[0].id).start,saved.occurrences[0].start);
  let moved=await clientConfirm(h,move,member.cookie);await clientConfirm(h,move,member.cookie);
  state=await h.state();assert.deepEqual([moved.occurrences[0].id,moved.occurrences[0].bookingId,moved.occurrences[0].packId],[saved.occurrences[0].id,saved.occurrences[0].bookingId,saved.occurrences[0].packId]);
  assert.equal(moved.occurrences[0].start,'2091-10-23T15:00:00.000Z');assert.equal(state.packs.find(p=>p.personId===member.id).remaining,9);assert.deepEqual(state.payments,[payment]);
  assert.equal((await h.state(member.cookie)).notices.filter(n=>n.appointmentReservationId===saved.id).length,2);
  const cancel=await h.cmd('appointment.client.cancel.prepare',{reservationId:saved.id,classId:saved.occurrences[0].id,reason:'Schedule changed'},member.cookie);
  assert.equal(cancel.policy[0].creditReturned,true);
  moved=await clientConfirm(h,cancel,member.cookie);await clientConfirm(h,cancel,member.cookie);
  state=await h.state();assert.equal(moved.occurrences[0].status,'cancelled');assert.equal(state.packs.find(p=>p.personId===member.id).remaining,10);assert.deepEqual(state.payments,[payment]);
  const history=state.bookingActions.filter(a=>a.bookingId===saved.occurrences[0].bookingId&&a.action==='cancel');
  assert.equal(history.length,1);assert.deepEqual([history[0].actorRole,history[0].channel,history[0].reason],['member','online','Schedule changed']);
  const restore=await h.cmd('appointment.restore.prepare',{reservationId:saved.id,classId:saved.occurrences[0].id,reason:'Requested restoration'});
  await h.cmd('appointment.change.confirm',{id:restore.id,key:restore.key,requestId:randomUUID()});
  assert.equal((await h.state()).packs.find(p=>p.personId===member.id).remaining,9);
  const exit=(await h.send('/api/strap/exit.json',undefined,h.owner)).value.tables.st_records.map(r=>({kind:r.kind,...JSON.parse(r.data)}));
  assert.equal(exit.find(r=>r.id===saved.id).deposit.paymentId,payment.id);assert.equal(exit.find(r=>r.id===accepted.id).status,'accepted');
  if(process.env.STRAP_PROOF_DIR) await (await import('./client-appointments-browser.mjs')).clientAppointmentsBrowser(h,{coach});
}

/** Extends the existing dispatch-derived STAFF-006 registration, not a second catalogue. */
export function clientAppointmentPairs(h,coach,checkAudit,existing) {
  let member,staffMember,own,desk,ownPreview,deskPreview;
  const extra=()=>({personId:staffMember.id,channel:'phone',requestId:randomUUID()});
  return {
    'appointment.client.accept':async name=>{
      member=existing.member;staffMember=existing.staffMember;
      const invitations=[];
      for(const [i,m] of [member,staffMember].entries()) {
        await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:m.id,credits:2,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z'})).id});
        const waiver=(await h.state()).waiver;
        if(waiver) await h.cmd('waiver.acknowledge',{id:waiver.id},m.cookie);
        const source=await h.cmd('appointment.series.offer.save',{requestId:randomUUID(),service:'Pair private',instructorId:coach.id,room:'Pair private',startDate:`2092-01-${10+i}`,endDate:`2092-01-${10+i}`,time:'09:00',minutes:50});
        invitations.push(await h.cmd('appointment.client.deliver',{personId:m.id,offerId:source.id,requestId:randomUUID()}));
      }
      own=await clientAccept(h,invitations[0],member.cookie);
      const input={id:invitations[1].id,key:invitations[1].key,confirm:true,...extra()};
      desk=(await checkAudit(name,input)).result;
      assert.deepEqual([own.occurrences[0].status,desk.occurrences[0].status],['booked','booked']);
    },
    'appointment.client.move.prepare':async name=>{
      ownPreview=await h.cmd(name,{reservationId:own.id,classId:own.occurrences[0].id,startDate:'2092-01-12',time:'11:00'},member.cookie);
      deskPreview=(await checkAudit(name,{reservationId:desk.id,classId:desk.occurrences[0].id,startDate:'2092-01-13',time:'11:00',...extra()})).result;
      assert.deepEqual(ownPreview.policy.map(p=>p.feeCents),deskPreview.policy.map(p=>p.feeCents));
    },
    'appointment.client.cancel.prepare':async name=>{
      await clientConfirm(h,ownPreview,member.cookie);await checkAudit('appointment.client.change.confirm',{id:deskPreview.id,key:deskPreview.key,...extra()});
      ownPreview=await h.cmd(name,{reservationId:own.id,classId:own.occurrences[0].id,reason:'Requested cancellation'},member.cookie);
      deskPreview=(await checkAudit(name,{reservationId:desk.id,classId:desk.occurrences[0].id,reason:'Requested cancellation',...extra()})).result;
      assert.deepEqual(ownPreview.policy.map(p=>p.creditReturned),deskPreview.policy.map(p=>p.creditReturned));
    },
    'appointment.client.change.confirm':async name=>{
      own=await clientConfirm(h,ownPreview,member.cookie);
      desk=(await checkAudit(name,{id:deskPreview.id,key:deskPreview.key,...extra()})).result;
      assert.deepEqual([own.occurrences[0].status,desk.occurrences[0].status],['cancelled','cancelled']);
    },
  };
}

export async function clientRights(h) {
  const {coach,ana,ben,offer}=await clientSeed(h,'ScopedClient'),desk=await h.person('ClientFrontDesk');
  const grant=async rights=>h.cmd('staff.access.grant',{personId:desk.id,role:'front-desk',enabled:true,rights:Object.fromEntries(rights.map(right=>[right,{enabled:true,scopes:[{memberIds:[ana.id],locationIds:['studio'],doors:['all']}]}]))});
  const invitation=await offer(ana,{date:'2094-02-15',depositCents:0}),foreign=await offer(ben,{date:'2094-02-16',depositCents:0});
  await grant(['member-record']);desk.cookie=await h.signIn(desk.email);await h.enroll(desk.cookie);
  const input={id:invitation.id,key:invitation.key,confirm:true,personId:ana.id,channel:'phone',requestId:randomUUID()};
  await clientRefused(h,'appointment.client.accept',input,desk.cookie);
  await grant(['booking']);await clientRefused(h,'appointment.client.accept',input,desk.cookie);
  await grant(['member-record','booking']);
  await clientRefused(h,'appointment.client.accept',{...input,id:foreign.id,key:foreign.key,personId:ben.id},desk.cookie);
  const saved=await h.cmd('appointment.client.accept',input,desk.cookie);await h.cmd('appointment.client.accept',input,desk.cookie);
  const actions=(await h.state()).staffActions.filter(a=>a.command==='appointment.client.accept');
  assert.equal(actions.length,1);assert.deepEqual([actions[0].actorRole,actions[0].right,actions[0].channel,actions[0].personId],['front-desk','booking','phone',ana.id]);
  assert.equal(actions[0].before,null);assert.equal(actions[0].after.id,saved.id);
  const move=await h.cmd('appointment.client.move.prepare',{personId:ana.id,reservationId:saved.id,classId:saved.occurrences[0].id,startDate:'2094-02-17',time:'11:00',channel:'phone',requestId:randomUUID()},desk.cookie);
  await grant(['member-record']);
  await clientRefused(h,'appointment.client.change.confirm',{id:move.id,key:move.key,personId:ana.id,channel:'phone',requestId:randomUUID()},desk.cookie);
  await clientRefused(h,'appointment.client.accept',input,desk.cookie);
  assert.deepEqual((await h.state(desk.cookie)).clientAppointmentOffers,[]);
  assert.deepEqual((await h.state(ben.cookie)).clientAppointmentPreviews,[]);
  await clientRefused(h,'appointment.client.change.confirm',{id:move.id,key:move.key},ana.cookie);
  const changed=await h.cmd('appointment.client.move.prepare',{reservationId:saved.id,classId:saved.occurrences[0].id,startDate:'2094-02-18',time:'11:00'},ana.cookie);
  const intake=await h.cmd('intake.form.publish',{title:'Private preparation',scope:'service',service:'Private Pilates',required:true,questions:[{label:'Experience',required:true,sensitive:false}],requestId:randomUUID()});
  await clientRefused(h,'appointment.client.change.confirm',{id:changed.id,key:changed.key},ana.cookie,409);
  await h.cmd('intake.submit',{formId:intake.id,answers:{q0:'New'},requestId:randomUUID()},ana.cookie);
  await clientConfirm(h,changed,ana.cookie);
  const agent=await h.cmd('agent.create',{label:'Client appointment preparation'});
  const response=await h.send('/api/strap/agent/command',{name:'appointment.client.accept',input},'',{authorization:'Bearer '+agent.token});assert.equal(response.status,403);
  // Existing unused-person erasure refuses records linked to an actual reservation.
  await clientRefused(h,'person.erase',{id:ana.id},h.owner,409);
  const previous=(await h.state()).people.find(p=>p.id===ana.id);
  await h.cmd('person.save',{...previous,active:false});
  const denied=await h.send('/api/strap/command',{name:'appointment.client.change.confirm',input:{id:changed.id,key:changed.key}},ana.cookie);
  assert.equal(denied.status,403);
  assert.deepEqual((await h.state()).clientAppointmentOffers.filter(o=>o.personId===ana.id),[]);
}
