import assert from 'node:assert/strict';

export async function privacyRequests(h) {
  assert.equal((await h.confirmSetup(h.owner)).status,303);
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

export async function erasureRequest(h,personId,suffix) {
  const request=await h.cmd('privacy.request.record',{personId,type:'erasure',channel:'phone',sourceReference:'synthetic-strap-'+suffix,requestId:'synthetic-strap-request-'+suffix});
  await h.cmd('privacy.request.verify',{id:request.id,confirm:true,verificationReference:'synthetic-strap-verify-'+suffix,channel:'phone',requestId:'synthetic-strap-verification-'+suffix});
  return request;
}
export const erasureReview=(requestId,suffix,financialDecision='resolved')=>({id:requestId,financialDecision,retentionReason:'Retain original studio financial chronology for owner review',retainUntil:'2099-01-01T00:00:00Z',channel:'phone',requestId:'synthetic-strap-review-'+suffix});

export async function privacyErasure(h,member) {
  const draft=await h.cmd('pack.prepare',{personId:member.id,credits:3,amountCents:12000,expiresAt:'2098-12-01T00:00:00Z'});
  const pack=await h.cmd('pack.approve',{id:draft.id});
  const waiver=await h.cmd('waiver.publish',{text:'Synthetic retained studio briefing'});
  await h.cmd('waiver.acknowledge',{id:waiver.id},member.cookie);
  const coach=await h.person('PrivacyCoach','instructor'),start='2097-01-07T12:00:00Z',end='2097-01-07T13:00:00Z';
  const classes=await h.cmd('classes.prepare',{week:'2097-01-07',classes:[{title:'Synthetic historical class',start,end,capacity:4,instructorId:coach.id}]});
  const session=(await h.cmd('classes.publish',{id:classes.id})).classes[0];
  const booking=await h.cmd('booking.book',{classId:session.id},member.cookie);
  // Seed the recorded class in the past; assertions use the ordinary integration doors.
  await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.start','2000-01-03T12:00:00Z','$.end','2000-01-03T13:00:00Z') WHERE id=?").bind(session.id).run();
  const key=async(label,roster)=>{
    const response=await h.mf.dispatchFetch(h.origin+'/app/action?name=integration.create&returnTo=%2Fapp%2Fintegrations',{method:'POST',redirect:'manual',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({label,location:'studio','sc_attendance:read':'true',...(roster?{'sc_roster:read':'true'}:{})}).toString()});
    assert.equal(response.status,200);const html=await response.text(),token=html.match(/<p class="token">(strap_int_[0-9a-f]{64})<\/p>/)?.[1];assert.ok(token,'the ordinary Integrations form issues the proof key');
    return {...(await h.state()).integrations.find(r=>r.label===label),token};
  };
  const integration=await key('Synthetic privacy proof',true),legacy=await key('Synthetic legacy privacy proof',false);
  // A pre-outcome key retains the boolean resource; the public key still authenticates.
  await h.db.prepare('UPDATE st_integrations SET member_ref_key=NULL WHERE id=?').bind(legacy.id).run();
  const api=async(key,resource)=>{
    const response=await h.mf.dispatchFetch(h.origin+'/api/strap/integration/'+resource,{headers:{host:new URL(h.origin).host,authorization:'Bearer '+key.token,'strap-schema-version':'1'}});
    assert.equal(response.status,200);return response.json();
  };
  const roster=await api(integration,'roster'),outcomes=await api(integration,'attendance'),boolean=await api(legacy,'attendance');
  assert.ok(roster.data.find(r=>r.id===session.id).roster.some(r=>r.bookingId===booking.id));
  const memberRef=outcomes.data.find(r=>r.id===session.id).attendance.find(r=>r.bookingId===booking.id).memberRef;
  assert.ok(memberRef);assert.ok(boolean.data.find(r=>r.id===session.id).attendance.some(r=>r.bookingId===booking.id));
  const acknowledgement=(await h.state()).acknowledgements.find(r=>r.personId===member.id);
  const hold=await h.cmd('privacy.retention.record',{id:acknowledgement.id,personId:member.id,confirm:true,hold:true,
    reason:'Synthetic signing record review',holdBasis:'Synthetic pending dispute',releaseConditions:'Owner records the dispute resolution',retainUntil:'2099-01-01T00:00:00Z',requestId:'synthetic-strap-hold'});
  const request=await erasureRequest(h,member.id,'native-used');
  const before=(await h.state()).version;
  assert.equal((await h.cmd('privacy.erasure.prepare',erasureReview(request.id,'unresolved'),h.owner,409)).error,'resolve_or_explicitly_retain_obligations');
  assert.equal((await h.state()).version,before);
  const retained=await h.cmd('privacy.erasure.prepare',erasureReview(request.id,'retain','retain'));
  assert.equal(retained.balanceCents,12000);assert.equal(retained.financialDecision,'retain');
  await h.cmd('payment.record',{personId:member.id,amountCents:12000,reference:'synthetic-strap-privacy-payment'});
  const preview=await h.cmd('privacy.erasure.prepare',erasureReview(request.id,'paid'));
  assert.deepEqual(preview.unsupported,[]);
  await h.cmd('member.note.add',{personId:member.id,text:'Synthetic note added after preview',alert:false});
  const staleBefore=(await h.state()).version;
  assert.equal((await h.cmd('privacy.erasure.confirm',{id:preview.id,basis:preview.basis,confirm:true,requestId:'synthetic-strap-stale-erasure'},h.owner,409)).error,'privacy_erasure_scope_changed');
  assert.equal((await h.state()).version,staleBefore);
  const current=await h.cmd('privacy.erasure.prepare',erasureReview(request.id,'current'));
  const confirm={id:current.id,basis:current.basis,confirm:true,channel:'phone',requestId:'synthetic-strap-confirm-erasure'};
  const receipt=await h.cmd('privacy.erasure.confirm',confirm);
  assert.equal(receipt.balanceCents,0);assert.equal(receipt.financialDecision,'resolved');assert.equal(receipt.externalCopies,'not_erased');
  assert.deepEqual(await h.cmd('privacy.erasure.confirm',confirm),receipt,'erasure replay returns the same receipt');
  const state=await h.state(),bytes=JSON.stringify(state);
  for(const value of [member.email,'Synthetic private note','Synthetic note added after preview','Synthetic contact','2125550197','2125550198'])assert.ok(!bytes.includes(value),'unnecessary private values are absent from ordinary state');
  assert.equal(state.charges.find(r=>r.personId===member.id).amountCents,12000);
  assert.equal(state.payments.find(r=>r.personId===member.id).amountCents,12000);
  assert.equal(state.packs.find(r=>r.id===pack.id).credits,3);
  assert.ok(!state.acknowledgements.some(r=>r.personId===member.id));
  assert.ok(!(await api(integration,'roster')).data.some(r=>r.roster.some(entry=>entry.bookingId===booking.id)));
  assert.ok(!(await api(integration,'attendance')).data.some(r=>r.attendance.some(entry=>entry.memberRef===memberRef)));
  assert.ok(!(await api(legacy,'attendance')).data.some(r=>r.attendance.some(entry=>entry.bookingId===booking.id)));
  assert.equal((await h.send('/api/strap/state',undefined,member.cookie)).status,401,'erasure revokes the existing native session');
  assert.equal((await h.cmd('person.save',{name:'Recreated member',email:member.email,active:true},h.owner,409)).error,'erased_identity');
  const protectedCopy=await h.cmd('privacy.retention.read',{id:hold.id,requestId:'synthetic-strap-read-retained'});
  assert.equal(protectedCopy.bundle.waiverId,waiver.id);assert.equal(protectedCopy.holdBasis,'Synthetic pending dispute');
  assert.equal((await h.cmd('privacy.retention.dispose',{id:hold.id,confirm:true,reason:'Synthetic disposal',requestId:'synthetic-strap-dispose-held'},h.owner,409)).error,'privacy_document_on_hold');
  await h.cmd('privacy.retention.release',{id:hold.id,confirm:true,reason:'Synthetic dispute resolved',requestId:'synthetic-strap-release-held'});
  assert.equal((await h.cmd('privacy.retention.dispose',{id:hold.id,confirm:true,reason:'Synthetic disposal',requestId:'synthetic-strap-dispose-early'},h.owner,409)).error,'privacy_retention_not_elapsed');
  // A seeded historical retention date exercises disposal without a timing wait.
  await h.db.prepare("UPDATE st_privacy_retained SET retain_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(hold.id).run();
  const disposed=await h.cmd('privacy.retention.dispose',{id:hold.id,confirm:true,reason:'Synthetic expired retention reviewed',requestId:'synthetic-strap-dispose-expired'});
  assert.ok(disposed.disposedAt);
  assert.equal((await h.cmd('privacy.retention.read',{id:hold.id,requestId:'synthetic-strap-read-disposed'},h.owner,410)).error,'privacy_document_disposed');
  assert.equal((await h.db.prepare('SELECT data FROM st_privacy_retained WHERE id=?').bind(hold.id).first()).data,'{}');
}

export async function importedPrivacyErasure(h) {
  const email=['imported-privacy','studio.example'].join('@');
  const csv='MemberId,FirstName,LastName,Email\nsynthetic-strap-privacy-import,Imported,Privacy,'+email+'\n';
  const preview=await h.cmd('import.preview',{csv});
  const applied=await h.cmd('import.apply',{csv,fingerprint:preview.fingerprint});
  let job=applied.job;while(job.state==='applying')job=(await h.cmd('import.resume',{jobId:job.id})).job;
  const member=(await h.state()).people.find(p=>p.email===email);
  assert.ok(member);
  const changedEmail=['changed-imported-privacy','studio.example'].join('@');
  await h.cmd('person.save',{id:member.id,name:member.name,email:changedEmail,active:false});
  const request=await erasureRequest(h,member.id,'imported');
  const review=await h.cmd('privacy.erasure.prepare',erasureReview(request.id,'imported'));
  assert.deepEqual(review.unsupported,[]);
  await h.cmd('privacy.erasure.confirm',{id:review.id,basis:review.basis,confirm:true,requestId:'synthetic-strap-confirm-imported'});
  const exported=await h.send('/api/strap/exit.json',undefined,h.owner);
  assert.equal(exported.status,200);assert.ok(!JSON.stringify(exported.value).includes(email),'original import custody is redacted with the native member');
  assert.equal((await h.cmd('import.apply',{csv,fingerprint:preview.fingerprint},h.owner,409)).error,'An erased member identity cannot be imported again');
  for(const address of [email,changedEmail])assert.equal((await h.cmd('person.save',{name:'Synthetic recreated import',email:address,active:true},h.owner,409)).error,'erased_identity','both original import and current identity addresses stay fenced');
  const journal=await h.cmd('import.journal',{jobId:job.id});
  assert.ok(!JSON.stringify(journal).includes(email),'the original source and undo journal cannot disclose erased data');
}

export async function seedArchivePrivacy(h) {
  const email=['privacy-archive','studio.example'].join('@');
  const csv='MemberId,FirstName,LastName,Email\nsynthetic-strap-archive-private,Archive,Private,'+email+'\n';
  const preview=await h.cmd('import.preview',{csv});let job=(await h.cmd('import.apply',{csv,fingerprint:preview.fingerprint})).job;
  while(job.state==='applying')job=(await h.cmd('import.resume',{jobId:job.id})).job;
  let member=(await h.state()).people.find(p=>p.email===email);
  member=await h.cmd('person.save',{id:member.id,name:member.name,email,active:true});
  await h.cmd('person.invite',{id:member.id});member.cookie=await h.signIn(email);
  await h.cmd('profile.save.staff',{personId:member.id,phone:'2125550165',emergencyName:'Synthetic archive contact',emergencyPhone:'2125550166',channel:'phone',requestId:'synthetic-strap-archive-private-profile'});
  await h.cmd('member.note.add',{personId:member.id,text:'Synthetic archive private note',alert:true});
  const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:3,amountCents:7300,expiresAt:'2099-12-01T00:00:00Z'})).id});
  const waiver=await h.cmd('waiver.publish',{text:'Synthetic archive retained briefing'});
  await h.cmd('waiver.acknowledge',{id:waiver.id},member.cookie);
  const acknowledgement=(await h.state()).acknowledgements.find(r=>r.personId===member.id);
  const hold=await h.cmd('privacy.retention.record',{id:acknowledgement.id,personId:member.id,confirm:true,hold:true,
    reason:'Synthetic archive signing review',holdBasis:'Synthetic archive pending dispute',releaseConditions:'Owner reviews dispute resolution',retainUntil:'2099-01-01T00:00:00Z',requestId:'synthetic-strap-archive-private-hold'});
  const request=await erasureRequest(h,member.id,'archive-private');
  return {member,packId:pack.id,holdId:hold.id,requestId:request.id};
}
export async function eraseArchivePrivacy(h,cookie,fixture) {
  const before=await h.db.prepare('SELECT epoch FROM rer_portability_state WHERE id=1').first();
  const preview=await h.cmd('privacy.erasure.prepare',erasureReview(fixture.requestId,'archive-private','retain'),cookie);
  assert.deepEqual(preview.unsupported,[]);
  const receipt=await h.cmd('privacy.erasure.confirm',{id:preview.id,basis:preview.basis,confirm:true,channel:'phone',requestId:'synthetic-strap-archive-private-confirm'},cookie);
  assert.equal(receipt.balanceCents,7300);assert.equal(receipt.financialDecision,'retain');
  const after=await h.db.prepare('SELECT epoch FROM rer_portability_state WHERE id=1').first();assert.ok(after.epoch>before.epoch,'used imported erasure commits its own restore checkpoint');
}
export async function assertArchivedPrivacy(db,fixture) {
  const member=await db.prepare('SELECT * FROM st_people WHERE id=?').bind(fixture.member.id).first();
  assert.equal(member.name,'Erased person');assert.equal(member.active,0);assert.ok(member.erased_at);
  const records=(await db.prepare('SELECT kind,data FROM st_records').all()).results.map(r=>({kind:r.kind,data:JSON.parse(r.data)}));
  const charge=records.find(r=>r.kind==='charge'&&r.data.personId===member.id);assert.equal(charge.data.amountCents,7300);
  assert.equal(records.find(r=>r.kind==='pack'&&r.data.id===fixture.packId).data.credits,3);
  assert.ok(!records.some(r=>['memberNote','memberProfile','memberCheckin','acknowledgement'].includes(r.kind)&&r.data.personId===member.id));
  const changes=records.filter(r=>r.kind==='profileChange'&&r.data.personId===member.id);
  assert.equal(changes.length,1);assert.ok(changes[0].data.erased);assert.ok(!('before' in changes[0].data)&&!('after' in changes[0].data));
  const held=await db.prepare('SELECT * FROM st_privacy_retained WHERE id=?').bind(fixture.holdId).first();
  assert.equal(held.hold_basis,'Synthetic archive pending dispute');assert.ok(JSON.parse(held.data).waiverId);assert.equal(held.disposed_at,null);
  const source=(await db.prepare('SELECT data FROM st_records').all()).results.map(r=>r.data).join('');
  for(const value of [fixture.member.email,'Synthetic archive contact','Synthetic archive private note','2125550165','2125550166'])assert.ok(!source.includes(value));
}
