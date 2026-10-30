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
  return {members:[native,imported],jobId:job.job.id,csv}
}
export async function erasePrivacyArchive(h,owner,fixture) {
  for(const member of [...fixture.members,...(fixture.retained?[fixture.retained]:[])]) {
    const request=await h.cmd('privacy.request',{personId:member.id,type:'erasure',channel:'phone',requestId:'synthetic-strap-archive-erase-'+member.id},owner)
    await h.cmd('privacy.verify',{id:request.id,method:'callback-on-file',confirm:true},owner)
    const review=await h.cmd('privacy.erase.prepare',{id:request.id,...privacyDecision,...(member.id===fixture.retained?.id?{documents:'retain',holdBasis:'Synthetic archive document hold',holdReviewAt:'2099-06-01T00:00:00Z',holdReleaseCondition:'Owner confirms dispute resolved'}:{})},owner)
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
