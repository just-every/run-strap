import assert from 'node:assert/strict'
import {privacyDecision,verifiedPrivacyRequest} from './privacy-journey.mjs'

export async function privacyObligations(h) {
  const member=await h.person('Syntheticcanceldebt'),waiver=(await h.state()).waiver
  await h.cmd('waiver.acknowledge',{id:waiver.id,documentHash:waiver.documentHash,signerName:member.name,confirm:true},member.cookie)
  await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:2,amountCents:1100,expiresAt:'2032-12-31T00:00:00Z'})).id})
  const access=await verifiedPrivacyRequest(h,member,'access','-changed')
  await h.cmd('profile.save',{name:'Synthetic corrected identity',requestId:'synthetic-strap-privacy-identity-change'},member.cookie)
  await h.cmd('privacy.export',{id:access.id},h.owner,409)
  const changedEmail='synthetic-strap-renamed'+String.fromCharCode(64)+'studio.example'
  await h.cmd('person.save',{id:member.id,name:'Synthetic corrected identity',email:changedEmail,role:'member',active:true})
  await h.cmd('person.invite',{id:member.id})
  const changedSession=await h.signIn(changedEmail)
  const request=await verifiedPrivacyRequest(h,member,'erasure','-cancel')
  const decision={id:request.id,...privacyDecision,obligations:'cancel'}
  const stale=await h.cmd('privacy.erase.prepare',decision)
  await h.cmd('member.note.add',{personId:member.id,text:'Synthetic late private note',alert:false})
  const version=(await h.state()).version
  await h.cmd('privacy.erase.confirm',{id:stale.id,confirm:true},h.owner,409)
  assert.equal((await h.state()).version,version)
  const review=await h.cmd('privacy.erase.prepare',decision)
  const receipt=await h.cmd('privacy.erase.confirm',{id:review.id,confirm:true})
  assert.deepEqual([receipt.balanceBeforeCents,receipt.balanceAfterCents],[1100,0])
  const after=await h.state(),charges=after.charges.filter(r=>r.personId===member.id)
  assert.deepEqual(charges.map(r=>r.amountCents).sort((a,b)=>a-b),[-1100,1100])
  assert.equal(charges.filter(r=>r.privacyReceiptId===receipt.id&&r.kind==='privacy-obligation-cancellation').length,1)
  await h.cmd('privacy.erase.confirm',{id:review.id,confirm:true},h.owner,404)
  await h.state(member.cookie,401);await h.state(changedSession,401)
  for(const email of [member.email,changedEmail])await h.cmd('person.save',{name:'Synthetic retired identity',email,role:'member',active:true},h.owner,409)
  const privateState=await h.state()
  for(const entry of privateState.privacy.requests.filter(r=>r.personId===member.id))assert.deepEqual([entry.status,entry.requestId,entry.identityBasis],['erased',null,null])
  const ownerPerson=await h.cmd('person.save',{name:'Synthetic owner membership',email:h.auth.OWNER_EMAIL,role:'member',active:true})
  const ownerRequest=await verifiedPrivacyRequest(h,ownerPerson,'erasure','-owner')
  const ownerVersion=(await h.state()).version
  assert.equal((await h.cmd('privacy.erase.prepare',{id:ownerRequest.id,...privacyDecision},h.owner,409)).error,'privacy_owner_identity_refused')
  assert.equal((await h.state()).version,ownerVersion,'member privacy cannot retire the studio owner')
  const credit=await h.person('Syntheticrefundowed')
  await h.cmd('payment.record',{personId:credit.id,amountCents:100,reference:'synthetic-strap-privacy-credit'})
  const creditRequest=await verifiedPrivacyRequest(h,credit,'erasure','-credit')
  const pending=(await h.state()).version
  assert.equal((await h.cmd('privacy.erase.prepare',{id:creditRequest.id,...privacyDecision,obligations:'cancel'},h.owner,409)).error,'privacy_refund_requires_settlement')
  assert.equal((await h.state()).version,pending)
  const newOwner=await h.signIn(h.auth.OWNER_EMAIL)
  const input={personId:credit.id,type:'access',channel:'phone',requestId:'synthetic-strap-privacy-no-factor'}
  assert.equal((await h.cmd('privacy.request',input,newOwner,403)).error,'mfa_required')
  assert.equal((await h.mf.dispatchFetch(h.origin+'/app/action?name=session.signout',{method:'POST',headers:{origin:h.origin,cookie:newOwner,'content-type':'application/x-www-form-urlencoded'},body:'',redirect:'manual'})).status,303)
  await h.cmd('privacy.request',input,newOwner,401)
  assert.equal((await h.state()).version,pending,'factor and revoked-session refusals leave the product unchanged')
}

export async function privacyMakeup(h) {
  const member=await h.person('Syntheticmakeuperase'),other=await h.person('Syntheticmakeupother'),coach=await h.person('Syntheticmakeupcoach','instructor')
  const waiver=(await h.state()).waiver
  for(const who of [member,other])await h.cmd('waiver.acknowledge',{id:waiver.id,documentHash:waiver.documentHash,signerName:who.name,confirm:true},who.cookie)
  const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:3,amountCents:4500,expiresAt:'2032-12-31T00:00:00Z',eligibleServices:['Synthetic makeup']})).id})
  await h.cmd('payment.record',{personId:member.id,amountCents:4500,reference:'synthetic-strap-makeup-payment'})
  const classes=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:'2032-01-05',classes:[7,8].map(day=>({title:'Synthetic makeup',service:'Synthetic makeup',start:'2032-01-0'+day+'T12:00:00Z',end:'2032-01-0'+day+'T13:00:00Z',capacity:4,instructorId:coach.id}))})).id})).classes
  const booking=await h.cmd('booking.book',{classId:classes[0].id},member.cookie)
  await h.cmd('absence.policy.save',{service:'Synthetic makeup',noticeHours:1,expiryDays:30})
  const input={id:booking.id,reason:'Synthetic private absence',requestId:'synthetic-strap-private-absence'}
  const absence=await h.cmd('absence.report',input,member.cookie)
  const before=await h.state(),remaining=before.packs.find(r=>r.id===pack.id).remaining
  const request=await verifiedPrivacyRequest(h,member,'erasure','-makeup')
  await h.cmd('privacy.erase.confirm',{id:(await h.cmd('privacy.erase.prepare',{id:request.id,...privacyDecision})).id,confirm:true})
  const exit=await h.send('/api/strap/exit.json',undefined,h.owner),records=exit.value.tables.st_records.map(r=>({kind:r.kind,data:JSON.parse(r.data)}))
  const credits=records.filter(r=>r.kind==='makeupCredit'&&r.data.personId===member.id)
  assert.equal(credits.length,1);assert.equal(credits[0].data.originalBookingId,booking.id);assert.ok(credits[0].data.voidedAt)
  assert.equal(records.find(r=>r.kind==='pack'&&r.data.id===pack.id).data.remaining,remaining,'erasure does not return the original used visit')
  assert.equal(records.find(r=>r.kind==='absence'&&r.data.id===absence.id).data.reason,null)
  await h.cmd('makeup.book',{creditId:credits[0].data.id,classId:classes[1].id,requestId:'synthetic-strap-erased-makeup'},h.owner,404)
  await h.cmd('absence.report',input,member.cookie,401)
  assert.ok(!(await h.state(other.cookie)).makeups.credits.some(r=>r.id===credits[0].data.id),'another person sees no erased makeup history')
}
