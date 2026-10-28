import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { clientSeed, clientAccept, clientConfirm, clientRefused } from './client-appointment-cases.mjs';

export async function clientAppointmentSeries(h) {
  const {coach,ana}=await clientSeed(h,'SeriesClient');
  const sourceInput={requestId:randomUUID(),service:'Private Pilates',instructorId:coach.id,room:'Standing private',startDate:'2090-10-22',endDate:'2090-11-26',time:'09:00',minutes:50,
    choices:[{date:'2090-11-05',skip:true,reason:'Member away this week'}]};
  const source=await h.cmd('appointment.series.offer.save',sourceInput);
  assert.equal(source.occurrences.length,6);
  const before=await h.state();
  const invitation=await h.cmd('appointment.client.deliver',{personId:ana.id,offerId:source.id,requestId:randomUUID()});
  assert.deepEqual((await h.state()).packCreditEvents,before.packCreditEvents);
  const saved=await clientAccept(h,invitation,ana.cookie);await clientAccept(h,invitation,ana.cookie);
  assert.deepEqual(saved.occurrences.map(o=>o.status),['booked','booked','skipped','booked','booked','booked']);
  assert.ok(saved.occurrences.every(o=>new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date(o.start))==='09:00'));
  assert.equal(Date.parse(saved.occurrences[2].start)-Date.parse(saved.occurrences[1].start),169*3600000,'weekly wall time survives the fall DST transition');
  let state=await h.state();assert.equal(state.bookings.length,5);assert.equal(state.packs.find(p=>p.personId===ana.id).remaining,5);
  assert.equal(saved.occurrences[2].bookingId,undefined);assert.ok(!state.classes.some(c=>c.id===saved.occurrences[2].id));
  assert.ok((await h.send('/app',undefined,ana.cookie)).text.includes('Member away this week'));
  const visit=saved.occurrences[0];
  const past=new Date(Date.now()-7200000).toISOString();
  await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.start',?,'$.end',?) WHERE id=?").bind(past,new Date(Date.parse(past)+3000000).toISOString(),visit.id).run();
  const move=await h.cmd('appointment.client.move.prepare',{reservationId:saved.id,classId:saved.occurrences[1].id,startDate:'2090-10-30',time:'11:00'},ana.cookie);
  await clientConfirm(h,move,ana.cookie);
  assert.equal((await h.state()).packs.find(p=>p.personId===ana.id).remaining,5);
  const cancel=await h.cmd('appointment.client.cancel.prepare',{reservationId:saved.id,classId:saved.occurrences[1].id,scope:'future',reason:'Future schedule changed'},ana.cookie);
  assert.deepEqual(cancel.occurrences.map(o=>o.id),[saved.occurrences[1].id,...saved.occurrences.slice(3).map(o=>o.id)]);
  await clientConfirm(h,cancel,ana.cookie);await clientConfirm(h,cancel,ana.cookie);
  state=await h.state();assert.equal(state.bookings.find(b=>b.id===visit.bookingId).status,'booked');
  assert.equal(state.packs.find(p=>p.personId===ana.id).remaining,9);
  assert.equal(state.packCreditEvents.filter(e=>e.type==='restore').length,4);
  assert.equal((await h.state(ana.cookie)).notices.filter(n=>n.appointmentReservationId===saved.id).length,3);
  const oversized=await h.cmd('appointment.series.offer.save',{...sourceInput,requestId:randomUUID(),startDate:'2091-01-07',endDate:'2091-03-18',choices:[]});
  await clientRefused(h,'appointment.client.deliver',{personId:ana.id,offerId:oversized.id,requestId:randomUUID()},h.owner,409);
  const rule=await h.cmd('bookingRule.save',{opensHoursBefore:24});
  await clientRefused(h,'appointment.client.deliver',{personId:ana.id,offerId:source.id,requestId:randomUUID()},h.owner,409);
  assert.ok(rule);
}
