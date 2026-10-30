import assert from 'node:assert/strict'
import {privacyDecision,verifiedPrivacyRequest} from './privacy-journey.mjs'

export async function privacyCourses(h) {
  const member=await h.person('Syntheticcourseprivacy'),peer=await h.person('Syntheticcoursepeer')
  const course=await h.cmd('course.publish',{name:'Synthetic private course',capacity:3,depositCents:1000,installments:[{dueAt:'2032-01-09T00:00:00Z',amountCents:3000}],sessions:[10,17].map(day=>({start:'2032-01-'+day+'T12:00:00Z',end:'2032-01-'+day+'T13:00:00Z'})),confirmPolicy:true})
  const enroll=async who=>{
    for(const waiver of (await h.state()).waivers.filter(w=>!w.service || w.service===course.name))await h.cmd('waiver.acknowledge',{id:waiver.id,documentHash:waiver.documentHash,signerName:who.name,confirm:true},who.cookie)
    const preview=await h.cmd('course.enrollment.prepare',{courseId:course.id,personId:who.id,requestId:'synthetic-strap-course-'+who.id})
    await h.cmd('course.accept',{id:preview.id,key:preview.key,confirm:true},who.cookie)
    return h.cmd('course.enrollment.confirm',{id:preview.id,key:preview.key,confirm:true,requestId:'synthetic-strap-course-confirm-'+who.id})
  }
  const enrollment=await enroll(member),other=await enroll(peer),reference='synthetic-strap-private-course-receipt'
  await h.cmd('course.payment.record',{id:enrollment.id,installmentId:'deposit',amountCents:1000,reference})
  const request=await verifiedPrivacyRequest(h,member,'erasure','-course')
  const before=(await h.state()).version
  assert.equal((await h.cmd('privacy.erase.prepare',{id:request.id,...privacyDecision,obligations:'retain'},h.owner,409)).error,'privacy_withdraw_future_course_first')
  assert.equal((await h.state()).version,before,'privacy cannot silently cancel an enrolled course')
  const withdraw=await h.cmd('course.withdraw.prepare',{id:enrollment.id,reason:'Synthetic private withdrawal',requestId:'synthetic-strap-private-course-withdraw'})
  assert.equal(withdraw.creditCents,3000)
  await h.cmd('course.withdraw.confirm',{id:withdraw.id,key:withdraw.key,confirm:true,requestId:'synthetic-strap-private-course-close'})
  const review=await h.cmd('privacy.erase.prepare',{id:request.id,...privacyDecision})
  const receipt=await h.cmd('privacy.erase.confirm',{id:review.id,confirm:true})
  assert.equal(receipt.balanceAfterCents,0)
  const after=await h.state(),saved=after.courseTuition.enrollments.find(r=>r.id===enrollment.id)
  assert.equal(saved.status,'withdrawn');assert.deepEqual(saved.installments.map(r=>[r.paidCents,r.creditedCents]),[[1000,0],[0,3000]])
  assert.equal(after.courseTuition.enrollments.find(r=>r.id===other.id).status,'enrolled')
  const frozen=after.version
  assert.equal((await h.cmd('course.payment.record',{id:other.id,installmentId:'deposit',amountCents:1000,reference},h.owner,409)).error,'payment_reference_used')
  assert.equal((await h.state()).version,frozen,'a retired receipt cannot be recaptured through another payment door')
  await h.cmd('course.payment.record',{id:other.id,installmentId:'deposit',amountCents:1000,reference:'synthetic-strap-peer-course-receipt'})
  await h.cmd('course.payment.record',{id:enrollment.id,installmentId:'1',amountCents:100,reference:'synthetic-strap-erased-course-payment'},h.owner,409)
  const exit=await h.send('/api/strap/exit.json',undefined,h.owner)
  for(const value of [member.name,member.email,'Synthetic private withdrawal',reference])assert.ok(!exit.text.includes(value),'course evidence retains amounts without erased personal text')
  assert.ok(exit.text.includes(peer.name))
  const records=exit.value.tables.st_records.map(r=>JSON.parse(r.data)),stored=records.find(r=>r.id===enrollment.id)
  for(const id of [stored.previewId,stored.withdrawalId])assert.ok(records.some(r=>r.id===id),'retained course chronology keeps redacted source records')
  const page=await h.send('/app/courses',undefined,h.owner);assert.equal(page.status,200);assert.ok(!page.text.includes(member.name))
}
