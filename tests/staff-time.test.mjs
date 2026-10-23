import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

test('Staff clock two shifts, record breaks, correct a missed clock-out and export only owner-approved hours with original entries retained',{timeout:120000},()=>run(async h=>{
  await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Brooklyn',timeZone:'America/New_York'});const coach=await h.person('Coach','instructor'),other=await h.person('Other','instructor'),manager=await h.person('Manager'),annex=await h.cmd('location.save',{name:'Annex',timeZone:'America/Los_Angeles'});
  const first=await h.cmd('clock.in',{locationId:'studio',job:'Teaching',requestId:'first-in'},coach.cookie);let shift=await h.cmd('clock.break.start',{shiftId:first.id,revision:0,requestId:'break-start'},coach.cookie);shift=await h.cmd('clock.break.end',{shiftId:first.id,revision:shift.revision,requestId:'break-end'},coach.cookie);shift=await h.cmd('clock.out',{shiftId:first.id,revision:shift.revision,requestId:'first-out'},coach.cookie);
  const second=await h.cmd('clock.in',{locationId:'studio',job:'Front desk',requestId:'second-in'},coach.cookie),endAt=new Date(Date.now()-3600000).toISOString(),startAt=new Date(Date.parse(endAt)-9*3600000).toISOString();
  const correction=await h.cmd('clock.correction.request',{shiftId:second.id,revision:0,startAt,endAt,breakMinutes:30,reason:'Forgot clock-out after desk shift',requestId:'correction'},coach.cookie);assert.equal(correction.original.endAt,null);
  const version=(await h.state()).version;assert.equal((await h.send('/api/strap/command',{name:'clock.approve',input:{shiftId:second.id,revision:1,requestId:'self-approval'}},coach.cookie)).status,403);assert.equal((await h.state()).version,version);
  await h.cmd('manager.grant',{id:manager.id,locationIds:[annex.id]});manager.cookie=await h.signIn(manager.email);await h.enroll(manager.cookie);assert.equal((await h.send('/api/strap/command',{name:'clock.approve',input:{shiftId:second.id,revision:1,exceptionReason:'Outside location',requestId:'other-location'}},manager.cookie)).status,403);
  assert.equal((await h.send('/api/strap/command',{name:'clock.approve',input:{shiftId:second.id,revision:1,requestId:'no-overtime-reason'}},h.owner)).status,400);
  assert.equal((await h.send('/api/strap/time-clock.csv',undefined,h.owner)).text.trim().split('\n').length,1);
  const input={shiftId:second.id,revision:1,exceptionReason:'Reviewed extra desk coverage',requestId:'approve'},approval=await h.cmd('clock.approve',input);assert.deepEqual(await h.cmd('clock.approve',input),approval);assert.equal(approval.minutes,510);assert.equal(approval.reviewThresholdExceeded,true);
  const clock=(await h.send('/api/strap/time-clock',undefined,coach.cookie)).value;assert.equal(clock.shifts.length,2);assert.equal(clock.shifts.find(r=>r.id===second.id).endAt,null);assert.equal(clock.shifts.find(r=>r.id===second.id).effective.endAt,endAt);assert.equal(clock.corrections[0].status,'approved');assert.ok(clock.events.some(e=>e.shiftId===first.id&&e.action==='break.end'));
  assert.equal((await h.send('/api/strap/time-clock',undefined,other.cookie)).value.shifts.length,0);assert.equal((await h.send('/api/strap/time-clock.csv',undefined,coach.cookie)).status,403);
  const csv=(await h.send('/api/strap/time-clock.csv',undefined,h.owner)).text;assert.equal(csv.trim().split('\n').length,2);assert.ok(csv.includes(second.id));assert.ok(!csv.includes(first.id));assert.ok(csv.includes('510'));
  const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value;for(const kind of ['clockShift','clockEvent','clockCorrection','clockApproval','clockRequest'])assert.ok(portable.tables.st_records.some(r=>r.kind===kind));
  if(process.env.STRAP_PROOF_DIR)await(await import('./staff-time-browser.mjs')).staffTimeBrowser(h,coach);
}))
