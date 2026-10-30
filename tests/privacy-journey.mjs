import assert from 'node:assert/strict';

export async function privacyRequests(h) {
  await h.cmd('studio.save',{name:'Synthetic studio',location:'Synthetic room',timeZone:'America/New_York'});
  const member=await h.person('PrivacyMember');
  const manager=await h.person('PrivacyManager');
  await h.cmd('manager.grant',{id:manager.id,locationIds:['studio']});
  manager.cookie=await h.signIn(manager.email);await h.enroll(manager.cookie);
  await h.cmd('profile.save.staff',{personId:member.id,phone:'2125550198',emergencyName:'Synthetic contact',emergencyPhone:'2125550197',channel:'phone',requestId:'synthetic-strap-privacy-profile'});
  await h.cmd('member.note.add',{personId:member.id,text:'Synthetic private note',alert:true});
  const input={personId:member.id,type:'access',channel:'phone',sourceReference:'synthetic-strap-privacy-source',requestId:'synthetic-strap-privacy-request'};
  const request=await h.cmd('privacy.request.record',input);
  assert.equal(request.channel,'phone');assert.equal(request.status,'requested');
  assert.deepEqual(await h.cmd('privacy.request.record',input),request,'a replay records one request');
  assert.equal((await h.cmd('privacy.access.export',{id:request.id,requestId:'synthetic-strap-unverified'},h.owner,409)).error,'privacy_identity_verification_required');
  const version=(await h.state()).version;
  for(const name of ['privacy.request.record','privacy.request.verify','privacy.access.export','privacy.access.fulfill']) {
    assert.equal((await h.send('/api/strap/command',{name,input:{...input,id:request.id}},member.cookie)).status,403,'member credentials cannot exercise owner privacy authority');
    assert.equal((await h.send('/api/strap/command',{name,input:{...input,id:request.id}},manager.cookie)).status,403,'a manager has no privacy right');
  }
  assert.equal((await h.state()).version,version,'denials change nothing');
  await h.cmd('privacy.request.verify',{id:request.id,verificationReference:'synthetic-strap-identity-review',confirm:true,channel:'phone',requestId:'synthetic-strap-privacy-verify'});
  await h.cmd('person.save',{id:member.id,name:'Updated privacy member',email:member.email,active:true});
  assert.equal((await h.cmd('privacy.access.export',{id:request.id,requestId:'synthetic-strap-stale'},h.owner,409)).error,'privacy_identity_changed_reverify');
  await h.cmd('privacy.request.verify',{id:request.id,verificationReference:'synthetic-strap-identity-review-2',confirm:true,channel:'phone',requestId:'synthetic-strap-privacy-reverify'});
  const exportInput={id:request.id,channel:'phone',requestId:'synthetic-strap-privacy-export'};
  const exported=await h.cmd('privacy.access.export',exportInput);
  assert.equal(exported.bundle.profile.name,'Updated privacy member');
  assert.equal(exported.bundle.profile.emergencyContact.name,'Synthetic contact');
  assert.ok(exported.bundle.records.some(r=>r.kind==='memberNote'&&r.data.text==='Synthetic private note'));
  assert.ok(!JSON.stringify(exported.bundle).includes('token_hash'));
  const replay=await h.cmd('privacy.access.export',exportInput);
  assert.equal(replay.export.id,exported.export.id);assert.ok(!('bundle' in replay),'replay returns only a receipt, never a retained export copy');
  assert.equal((await h.cmd('privacy.access.fulfill',{id:request.id,exportId:'synthetic-strap-wrong',confirm:true,deliveryReference:'synthetic-strap-delivery',requestId:'synthetic-strap-wrong-delivery'},h.owner,409)).error,'privacy_export_review_required');
  const fulfilled=await h.cmd('privacy.access.fulfill',{id:request.id,exportId:exported.export.id,confirm:true,deliveryReference:'synthetic-strap-delivery',channel:'phone',requestId:'synthetic-strap-delivery'});
  assert.equal(fulfilled.status,'fulfilled');assert.equal(fulfilled.delivery.digest,exported.export.digest);
  const response=await h.send('/api/strap/staff-history?person='+member.id,undefined,h.owner);
  assert.equal(response.status,200);
  const history=response.value.rows.filter(r=>r.right==='privacy');
  assert.deepEqual(history.map(r=>r.command).sort(),['privacy.request.record','privacy.request.verify','privacy.request.verify','privacy.access.export','privacy.access.fulfill'].sort());
  assert.ok(history.every(r=>r.actorRole==='owner'&&r.actorId&&r.channel==='phone'));
  assert.ok(!history.some(r=>r.after?.bundle||r.result?.bundle),'the durable audit does not duplicate personal exports');
  return member;
}
