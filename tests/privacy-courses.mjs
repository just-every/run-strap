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

export async function privacySharedCourses(h) {
  const payer=await h.person('Syntheticcoursepayer'),member=await h.person('Syntheticcoursechild'),peer=await h.person('Syntheticcoursesibling'),outside=await h.person('Syntheticcourseoutside'),observer=await h.person('Syntheticcourseobserver')
  const home=await h.cmd('household.save',{name:'Synthetic shared course family'})
  for(const who of [member,peer])await h.cmd('household.participant.add',{id:home.id,personId:who.id})
  await h.cmd('household.payer.propose',{id:home.id,payerId:payer.id});await h.cmd('household.payer.accept',{id:home.id},payer.cookie)
  const course=await h.cmd('course.publish',{name:'Synthetic shared tuition course',capacity:4,depositCents:1000,installments:[{dueAt:'2032-01-09T00:00:00Z',amountCents:3000}],sessions:[10,17].map(day=>({start:'2032-01-'+day+'T15:00:00Z',end:'2032-01-'+day+'T16:00:00Z'})),confirmPolicy:true})
  const acceptedPreviews=new Map()
  const enroll=async(who,debtor)=>{
    for(const waiver of (await h.state()).waivers.filter(w=>!w.service || w.service===course.name))await h.cmd('waiver.acknowledge',{id:waiver.id,documentHash:waiver.documentHash,signerName:who.name,confirm:true},who.cookie)
    const preview=await h.cmd('course.enrollment.prepare',{courseId:course.id,personId:who.id,requestId:'synthetic-strap-shared-course-'+who.id})
    const accepted=await h.cmd('course.accept',{id:preview.id,key:preview.key,confirm:true},debtor.cookie)
    const enrollment=await h.cmd('course.enrollment.confirm',{id:preview.id,key:preview.key,confirm:true,requestId:'synthetic-strap-shared-course-confirm-'+who.id})
    const {key,...copy}={...accepted,status:'enrolled',enrollmentId:enrollment.id}
    acceptedPreviews.set(enrollment.id,copy)
    return enrollment
  }
  const enrollment=await enroll(member,payer),sibling=await enroll(peer,payer),unrelated=await enroll(outside,outside)
  const before=(await h.state()).courseTuition.enrollments
  const reference='Synthetic shared tuition private receipt'
  const paid=await h.cmd('course.payment.record',{id:enrollment.id,installmentId:'deposit',amountCents:1000,reference})
  await h.cmd('profile.save.staff',{personId:member.id,phone:'2025550162',emergencyName:'Synthetic shared course emergency',emergencyPhone:'2025550163',emergencyRelationship:'Friend',channel:'phone',requestId:'synthetic-strap-shared-course-profile'})
  const privateNote='Synthetic shared course private health note'
  await h.cmd('member.note.add',{personId:member.id,text:privateNote,alert:false})
  const accessRequests=new Map()
  const exportFor=async who=>{
    if(!accessRequests.has(who.id))accessRequests.set(who.id,await verifiedPrivacyRequest(h,who,'access','-shared-course-'+who.id))
    return h.cmd('privacy.export',{id:accessRequests.get(who.id).id})
  }
  const payerCopy=await exportFor(payer),participantCopy=await exportFor(member),unrelatedCopy=await exportFor(observer)
  const originals=(await h.send('/api/strap/exit.json',undefined,h.owner)).value.tables.st_records.map(row=>JSON.parse(row.data))
  const {key,...participantPreview}=originals.find(row=>row.id===enrollment.previewId)
  for(const expected of [paid,sibling]) {
    assert.deepEqual(payerCopy.records.find(r=>r.kind==='courseEnrollment'&&r.data.id===expected.id)?.data,expected,'the payer receives the original enrollment, installment amounts and personal acceptance')
    const {payerBasis,...preview}=acceptedPreviews.get(expected.id)
    assert.deepEqual(payerCopy.records.find(r=>r.kind==='courseEnrollmentPreview'&&r.data.id===preview.id)?.data,preview,'the payer receives exact accepted terms and attribution without replay keys or household authority snapshots')
  }
  // The pre-fix public probe contained these same two complete participant course records.
  // Expected records come from the actual public acceptance and payment results, never a pinned snapshot.
  assert.deepEqual(participantCopy.records.filter(r=>['courseEnrollment','courseEnrollmentPreview','courseWithdrawalPreview'].includes(r.kind)),[
    {kind:'courseEnrollmentPreview',data:participantPreview},
    {kind:'courseEnrollment',data:paid}
  ],'the participant keeps the pre-fix records and shape, including their own acceptance history')
  assert.equal(participantCopy.person.emergencyContact.name,'Synthetic shared course emergency')
  assert.ok(participantCopy.records.some(r=>r.kind==='memberNote'&&r.data.text===privateNote))
  for(const value of [member.email,peer.email,privateNote,'Synthetic shared course emergency','2025550162','2025550163'])assert.ok(!JSON.stringify(payerCopy).includes(value),'paying confers no access to participant profiles, emergency contacts or notes')
  const sharedIds=[enrollment.id,sibling.id,...[enrollment,sibling].map(e=>e.previewId)]
  for(const value of [...sharedIds,member.id,peer.id,payer.id])assert.ok(!JSON.stringify(unrelatedCopy).includes(value),'a non-payer and non-participant receives none of the shared course records')
  assert.deepEqual(unrelatedCopy.records.filter(r=>['courseEnrollment','courseEnrollmentPreview','courseWithdrawalPreview','charge','payment'].includes(r.kind)),[])
  assert.ok(!payerCopy.records.some(r=>r.data.id===unrelated.id||r.data.id===unrelated.previewId),'another enrollment on the same course remains private')
  const withdraw=async e=>{
    const preview=await h.cmd('course.withdraw.prepare',{id:e.id,reason:'Synthetic shared course withdrawal '+e.personId,requestId:'synthetic-strap-shared-withdraw-'+e.id})
    return h.cmd('course.withdraw.confirm',{id:preview.id,key:preview.key,confirm:true,requestId:'synthetic-strap-shared-withdraw-confirm-'+e.id})
  }
  const withdrawn=await withdraw(enrollment)
  const withdrawnCopy=await exportFor(payer)
  assert.deepEqual(withdrawnCopy.records.find(r=>r.kind==='courseEnrollment'&&r.data.id===enrollment.id)?.data,withdrawn)
  const withdrawal=withdrawnCopy.records.find(r=>r.kind==='courseWithdrawalPreview'&&r.data.id===withdrawn.withdrawalId)?.data
  assert.ok(withdrawal,'payer access follows a withdrawal back to its enrollment')
  assert.equal(withdrawal.enrollmentId,enrollment.id);assert.equal(withdrawal.status,'applied')
  assert.equal(withdrawal.creditCents,withdrawn.installments.reduce((n,row)=>n+row.creditedCents,0))
  assert.ok(!('key' in withdrawal)&&!('basis' in withdrawal),'shared withdrawal history contains no replay capability')
  const request=await verifiedPrivacyRequest(h,member,'erasure','-shared-course-member')
  const review=await h.cmd('privacy.erase.prepare',{id:request.id,...privacyDecision})
  await h.cmd('privacy.erase.confirm',{id:review.id,confirm:true})
  let state=await h.state()
  const saved=state.courseTuition.enrollments.find(e=>e.id===enrollment.id)
  assert.equal(saved.payerId,payer.id);assert.equal(saved.personId,member.id)
  assert.deepEqual(saved.installments.map(r=>[r.amountCents,r.paidCents,r.creditedCents]),[[1000,1000,0],[3000,0,3000]])
  const balance=()=>h.state().then(s=>s.charges.filter(r=>r.personId===payer.id).reduce((n,r)=>n+r.amountCents,0)-s.payments.filter(r=>r.personId===payer.id).reduce((n,r)=>n+r.amountCents,0))
  assert.equal(await balance(),4000,'participant erasure preserves the shared payer debt and the sibling allocation')
  assert.deepEqual(state.courseTuition.enrollments.find(e=>e.id===sibling.id),before.find(e=>e.id===sibling.id))
  assert.deepEqual(state.courseTuition.enrollments.find(e=>e.id===unrelated.id),before.find(e=>e.id===unrelated.id))
  const exit=await h.send('/api/strap/exit.json',undefined,h.owner)
  for(const value of [member.name,member.email,reference])assert.ok(!exit.text.includes(value),'shared course custody redacts the erased participant and private receipt')
  const version=state.version
  assert.equal((await h.cmd('course.payment.record',{id:unrelated.id,installmentId:'deposit',amountCents:1000,reference},h.owner,409)).error,'payment_reference_used')
  assert.equal((await h.state()).version,version)
  const payerRequest=await verifiedPrivacyRequest(h,payer,'erasure','-shared-course-payer')
  assert.equal((await h.cmd('privacy.erase.prepare',{id:payerRequest.id,...privacyDecision,obligations:'retain'},h.owner,409)).error,'privacy_withdraw_future_course_first')
  await withdraw(sibling)
  assert.equal(await balance(),1000)
  const payerReview=await h.cmd('privacy.erase.prepare',{id:payerRequest.id,...privacyDecision,obligations:'retain'})
  const erased=await h.cmd('privacy.erase.confirm',{id:payerReview.id,confirm:true})
  assert.equal(erased.balanceBeforeCents,1000);assert.equal(erased.balanceAfterCents,1000)
  state=await h.state()
  assert.deepEqual(state.courseTuition.enrollments.find(e=>e.id===unrelated.id),before.find(e=>e.id===unrelated.id))
  const retainedSibling=state.courseTuition.enrollments.find(e=>e.id===sibling.id)
  assert.deepEqual(retainedSibling.installments.map(r=>[r.amountCents,r.paidCents,r.creditedCents]),[[1000,0,0],[3000,0,3000]])
  assert.equal(retainedSibling.personId,peer.id);assert.equal(retainedSibling.payerId,payer.id)
  assert.ok(state.people.some(p=>p.id===peer.id&&p.name===peer.name))
  const frozen=state.version
  assert.equal((await h.cmd('course.payment.record',{id:unrelated.id,installmentId:'deposit',amountCents:1000,reference},h.owner,409)).error,'payment_reference_used','successive participant and payer erasures preserve the original receipt fence')
  assert.equal((await h.state()).version,frozen)
  const final=await h.send('/api/strap/exit.json',undefined,h.owner)
  for(const value of [payer.name,payer.email,member.name,member.email])assert.ok(!final.text.includes(value))
  await h.state(payer.cookie,401)
  await h.cmd('course.payment.record',{id:sibling.id,installmentId:'deposit',amountCents:1000,reference:'synthetic-strap-erased-shared-payer'},h.owner,409)
  const page=await h.send('/app/courses',undefined,peer.cookie);assert.equal(page.status,200);assert.ok(!page.text.includes(payer.name))
}
