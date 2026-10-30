import {seedAutomationArchive} from './automation-archive.mjs';
import assert from 'node:assert/strict'
import {privacyDecision} from './privacy-journey.mjs'

export async function seedPrivacyArchive(h,waiver) {
  const native=await h.person('Syntheticarchiveprivacy')
  await h.cmd('waiver.acknowledge',{id:waiver.id,documentHash:waiver.documentHash,signerName:native.name,confirm:true},native.cookie)
  const email='synthetic-strap-archive-import'+String.fromCharCode(64)+'studio.example'
  const csv='MemberId,FirstName,LastName,Email\nsynthetic-strap-private-archive,Synthetic,Archiveimport,'+email+'\n'
  const preview=await h.cmd('import.preview',{csv}),job=await h.cmd('import.apply',{csv,fingerprint:preview.fingerprint})
  const imported=(await h.state()).people.find(p=>p.email===email)
  for(const member of [native,imported]) {
    await h.cmd('profile.save.staff',{personId:member.id,phone:'2025550166',emergencyName:'Synthetic archive contact',emergencyPhone:'2025550167',emergencyRelationship:'Friend',channel:'phone',requestId:'synthetic-strap-archive-contact-'+member.id})
    await h.cmd('member.note.add',{personId:member.id,text:'Synthetic archive restricted note',alert:true})
  }
  const participant=await h.person('Syntheticarchivecourseparticipant')
  const home=await h.cmd('household.save',{name:'Synthetic archive course family'})
  await h.cmd('household.participant.add',{id:home.id,personId:participant.id})
  await h.cmd('household.payer.propose',{id:home.id,payerId:native.id});await h.cmd('household.payer.accept',{id:home.id},native.cookie)
  const at=days=>new Date(Date.now()+days*86400000).toISOString()
  const course=await h.cmd('course.publish',{name:'Synthetic archive course',capacity:2,depositCents:1000,installments:[{dueAt:at(2),amountCents:3000}],sessions:[{start:at(3),end:at(4)}],confirmPolicy:true})
  for(const document of (await h.state()).waivers.filter(w=>!w.service || w.service===course.name))await h.cmd('waiver.acknowledge',{id:document.id,documentHash:document.documentHash,signerName:participant.name,confirm:true},participant.cookie)
  const enrollment=await h.cmd('course.enrollment.prepare',{courseId:course.id,personId:participant.id,requestId:'synthetic-strap-archive-shared-course'})
  await h.cmd('course.accept',{id:enrollment.id,key:enrollment.key,confirm:true},native.cookie)
  const enrolled=await h.cmd('course.enrollment.confirm',{id:enrollment.id,key:enrollment.key,confirm:true,requestId:'synthetic-strap-archive-shared-enroll'})
  await h.cmd('course.payment.record',{id:enrolled.id,installmentId:'deposit',amountCents:1000,reference:'synthetic-strap-archive-shared-payment'})
  const withdrawal=await h.cmd('course.withdraw.prepare',{id:enrolled.id,reason:'Synthetic archive course withdrawal',requestId:'synthetic-strap-archive-shared-withdraw'})
  const sharedCourse=await h.cmd('course.withdraw.confirm',{id:withdrawal.id,key:withdrawal.key,confirm:true,requestId:'synthetic-strap-archive-shared-withdraw-confirm'})
  await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:native.id,kind:'unlimited',planName:'Private review eligibility',amountCents:0,expiresAt:new Date(Date.now()+20*86400000).toISOString()})).id});
  const automation=await seedAutomationArchive(h,native);
  return {members:[native,imported],jobId:job.job.id,csv,sharedCourse,participant,automation}

}
export async function erasePrivacyArchive(h,owner,fixture) {
  for(const member of [...fixture.members,...(fixture.retained?[fixture.retained]:[]),...(fixture.guardian?[fixture.guardian]:[])]) {
    const request=await h.cmd('privacy.request',{personId:member.id,type:'erasure',channel:'phone',requestId:'synthetic-strap-archive-erase-'+member.id},owner)
    await h.cmd('privacy.verify',{id:request.id,method:'callback-on-file',confirm:true},owner)
    const review=await h.cmd('privacy.erase.prepare',{id:request.id,...privacyDecision,...([fixture.retained?.id,fixture.guardian?.id].includes(member.id)?{documents:'retain',holdBasis:'Synthetic archive document hold',holdReviewAt:'2099-06-01T00:00:00Z',holdReleaseCondition:'Owner confirms dispute resolved'}:{})},owner)
    await h.cmd('privacy.erase.confirm',{id:review.id,confirm:true},owner)
  }
  await h.state(fixture.members[0].cookie,401)
  const journal=await h.cmd('import.journal',{jobId:fixture.jobId},owner)
  for(const member of fixture.members)assert.ok(!JSON.stringify(journal).includes(member.email))
}
export function assertPrivacyArchive(bytes,fixture) {
  for(const value of [...fixture.members.flatMap(p=>[p.email,p.name]),'2025550166','2025550167','Synthetic archive contact','Synthetic archive restricted note'])assert.ok(!bytes.includes(value),'the later native archive removes used and imported personal values')
  const parts=bytes.split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='part').flatMap(r=>r.items)
  assert.ok(parts.length,'the erasure check reads a populated archive')
}
export async function assertPrivacyRestored(db,fixture) {
  const automationTask=JSON.parse((await db.prepare("SELECT data FROM st_records WHERE id=? AND kind='automationTask'").bind(fixture.automation.task.id).first()).data);
  assert.equal(automationTask.status,'suppressed');assert.equal(automationTask.reason,'member_erased');assert.equal(automationTask.erased,true);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM st_automation_connections').first()).n,0,'restored erasure history has no execution authority');
  const shared=JSON.parse((await db.prepare("SELECT data FROM st_records WHERE kind='courseEnrollment' AND id=?").bind(fixture.sharedCourse.id).first()).data)
  for(const key of ['personId','payerId','amountCents','status','installments','acceptedAt','acceptedBy','previewId','withdrawalId'])assert.deepEqual(shared[key],fixture.sharedCourse[key],'restored shared course keeps original '+key)
  assert.equal(shared.erased,true)
  assert.equal((await db.prepare('SELECT name FROM st_people WHERE id=?').bind(fixture.participant.id).first()).name,fixture.participant.name)
  const guardian=JSON.parse((await db.prepare("SELECT data FROM st_records WHERE kind='privacyRetention' AND json_extract(data,'$.sourceId')=?").bind(fixture.guardianEvidence.id).first()).data)
  assert.deepEqual(guardian.content.receipt,fixture.guardianEvidence)
  assert.deepEqual(guardian.content.document,fixture.guardianDocument)
  assert.equal(guardian.hold.basis,'Synthetic archive document hold')
  assert.equal((await db.prepare("SELECT count(*) AS n FROM st_records WHERE kind='acknowledgement' AND id=?").bind(fixture.guardianEvidence.id).first()).n,0)
  assert.equal((await db.prepare('SELECT name FROM st_people WHERE id=?').bind(fixture.guardian.id).first()).name,'Erased person')
  assert.equal((await db.prepare('SELECT erased_at FROM st_people WHERE id=?').bind(fixture.guardianChildId).first()).erased_at,null)

  const held=JSON.parse((await db.prepare("SELECT data FROM st_records WHERE kind='privacyRetention' AND json_extract(data,'$.personId')=?").bind(fixture.retained.id).first()).data)
  assert.deepEqual(held.content.receipt.signature,fixture.retainedEvidence.receipt.signature,'native restore keeps exact restricted signing evidence')
  assert.equal(held.hold.basis,'Synthetic archive document hold');assert.equal(held.hold.scope,'member-documents');assert.ok(held.hold.actorId)
  assert.deepEqual(held.content.personalCopies.map(copy=>copy.delivery_status),['accepted'])
  assert.ok(!JSON.stringify(held).includes(fixture.copyToken),'retained copy metadata is never reusable copy authority')
  assert.equal((await db.prepare("SELECT count(*) AS n FROM st_records WHERE kind='acknowledgement' AND json_extract(data,'$.personId')=?").bind(fixture.retained.id).first()).n,0)
  for(const member of fixture.members) {
    assert.equal((await db.prepare('SELECT name FROM st_people WHERE id=?').bind(member.id).first()).name,'Erased person')
    const rows=(await db.prepare("SELECT kind,data FROM st_records WHERE json_extract(data,'$.personId')=?").bind(member.id).all()).results
    assert.ok(rows.some(r=>r.kind==='privacyReceipt'),'the restored studio keeps the attributed erasure receipt')
    assert.ok(!rows.some(r=>['memberProfile','memberNote','acknowledgement'].includes(r.kind)))
    const history=rows.filter(r=>r.kind==='profileChange').map(r=>JSON.parse(r.data))
    assert.ok(history.length>0)
    for(const event of history)assert.deepEqual([event.erased,event.changed,'before' in event,'after' in event,'requestBasis' in event],[true,['phone','emergencyContact'],false,false,false])
  }
}
