import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { harness } from './harness.mjs';
import { clientSeed, clientAccept, clientConfirm } from './client-appointment-cases.mjs';

export async function clientAppointmentArchive({checkout,archive,exec}) {
  const temp=await mkdtemp(join(tmpdir(),'strap-client-archive-')),source=join(temp,'source'),restored=join(temp,'restored'),file=join(temp,'studio.rer');
  let h;
  try {
    await checkout(source);await checkout(restored);
    await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:2e6});
    h=await harness({root:source});
    const {ana,offer}=await clientSeed(h,'ArchiveClient');
    const invitation=await offer(ana,{date:'2096-03-01'}),accepted=await clientAccept(h,invitation,ana.cookie);
    const deposit={reservationId:accepted.id,amountCents:2500,reference:'synthetic-strap-archive-deposit',requestId:'synthetic-strap-archive-receipt'};
    await h.cmd('appointment.client.deposit.record',deposit);
    const preview=await h.cmd('appointment.client.move.prepare',{reservationId:accepted.id,classId:accepted.occurrences[0].id,startDate:'2096-03-02',time:'11:00'},ana.cookie);
    const moved=await clientConfirm(h,preview,ana.cookie);
    const select=rows=>rows.map(r=>({id:r.id,kind:r.kind,data:JSON.parse(r.data)})).filter(r=>r.data.personId===ana.id||r.data.privatePersonId===ana.id||r.data.appointmentReservationId===accepted.id).sort((a,b)=>a.id.localeCompare(b.id));
    const original=await h.state(),portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value;
    const records=select(portable.tables.st_records),ownerCookie=h.owner,memberCookie=ana.cookie;
    await h.close();h=null;
    await archive(source,['export','--output',file]);await archive(restored,['import','--input',file,'--yes']);
    h=await harness({root:restored,owner:ownerCookie});
    assert.equal((await h.send('/api/strap/state',undefined,memberCookie)).status,401);
    assert.equal((await h.send('/api/strap/state',undefined,ownerCookie)).status,401);
    const owner=await h.signIn(h.auth.OWNER_EMAIL);await h.confirmSetup(owner);await h.enroll(owner);
    const member=await h.signIn(ana.email),state=await h.state(owner);
    assert.deepEqual(select((await h.send('/api/strap/exit.json',undefined,owner)).value.tables.st_records),records);
    assert.deepEqual(state.appointments.find(r=>r.id===accepted.id).occurrences.map(o=>[o.id,o.bookingId,o.packId,o.start]),moved.occurrences.map(o=>[o.id,o.bookingId,o.packId,o.start]));
    const ledger=rows=>rows.slice().sort((a,b)=>a.packId.localeCompare(b.packId)||a.revision-b.revision);
    assert.deepEqual(state.payments,original.payments);assert.deepEqual(ledger(state.packCreditEvents),ledger(original.packCreditEvents));
    const notices=(await h.state(member)).notices;
    await clientAccept(h,invitation,member);
    await h.cmd('appointment.client.deposit.record',{...deposit,requestId:'synthetic-strap-archive-replay'},owner);
    const replayed=await h.state(owner);
    assert.deepEqual(replayed.payments,state.payments);assert.deepEqual(replayed.packCreditEvents,state.packCreditEvents);assert.deepEqual(replayed.staffActions,state.staffActions);
    assert.deepEqual((await h.state(member)).notices,notices);
    const after=await h.cmd('appointment.client.move.prepare',{reservationId:accepted.id,classId:accepted.occurrences[0].id,startDate:'2096-03-03',time:'11:00'},member);
    await clientConfirm(h,after,member);
    assert.equal((await h.state(member)).appointments.find(r=>r.id===accepted.id).occurrences[0].start,'2096-03-03T16:00:00.000Z');
    assert.equal((await h.state(owner)).payments.length,1);
  } finally {if(h)await h.close();await rm(temp,{recursive:true,force:true});}
}
