import assert from 'node:assert/strict'
import {readFile,writeFile,rename} from 'node:fs/promises'
import {run} from './harness.mjs'
import {totp} from './mfa-helpers.mjs'
import {privacyObligations,privacyMakeup} from './privacy-obligations.mjs'
import {privacyCourses,privacySharedCourses} from './privacy-courses.mjs'
import {privacySigning} from './privacy-signing.mjs'
import {privacyShared} from './privacy-shared.mjs'
import {privacyDecision} from './privacy-journey.mjs'

await run(async h=>{
  const originalCmd=h.cmd,originalState=h.state;h.cmd=(name,input,cookie=h.owner,...rest)=>originalCmd(name,input,cookie,...rest);h.state=(cookie=h.owner,...rest)=>originalState(cookie,...rest)
  const jump=async target=>{
    const path=process.env.STRAP_RECOVERY_CLOCK,offset=Number(await readFile(path,'utf8'))
    const next=Math.ceil((Date.parse(target)-(Date.now()-offset*1000))/1000)
    await writeFile(path+'.new',String(next));await rename(path+'.new',path)
    h.owner=await h.signIn(h.auth.OWNER_EMAIL);await h.cmd('mfa.verify',{code:totp(h.mfaOwner.secret)})
  }
  await h.confirmSetup(h.owner)
  await h.cmd('studio.save',{location:'Synthetic studio',timeZone:'America/Phoenix'})
  const member=await h.person('Synthetictimedprivacy'),peer=await h.person('Synthetictimedpeer'),coach=await h.person('Synthetictimedcoach','instructor'),manager=await h.person('Synthetictimedmanager')
  const grant={personId:manager.id,role:'manager',enabled:true,rights:{'member-record':{enabled:true,scopes:[{memberIds:[member.id,peer.id],locationIds:['studio'],doors:['all']}]}}}
  await h.cmd('staff.access.grant',grant);await h.enroll(manager.cookie)
  await h.cmd('staff.access.grant',{...grant,rights:{privacy:{enabled:true,scopes:[]}}},h.owner,400)
  const waiver=await h.cmd('waiver.publish',{text:'Synthetic timed affirmation',requiresSignature:true})
  for(const who of [member,peer]) {
    await h.cmd('waiver.acknowledge',{id:waiver.id,documentHash:waiver.documentHash,signerName:who.name,confirm:true},who.cookie)
    await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:who.id,credits:2,amountCents:2000,expiresAt:'2032-12-31T00:00:00Z'})).id})
    await h.cmd('payment.record',{personId:who.id,amountCents:2000,reference:'synthetic-strap-timed-'+who.id})
  }
  await h.cmd('bookingRule.save',{cancelCutoffHours:12,lateCancelReturnsCredit:true,lateCancelFeeCents:0,noShowFeeCents:750})
  const entry=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:'2031-12-29',classes:[{title:'Synthetic privacy class',start:'2032-01-02T12:00:00Z',end:'2032-01-02T13:00:00Z',capacity:4,instructorId:coach.id}]})).id})).classes[0]
  const booking=await h.cmd('booking.book',{classId:entry.id},member.cookie),other=await h.cmd('booking.book',{classId:entry.id},peer.cookie)
  const create=async label=>{
    const response=await h.mf.dispatchFetch(h.origin+'/app/action?name=integration.create&returnTo=%2Fapp%2Fintegrations',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({label,'sc_roster:read':'true','sc_attendance:read':'true',location:'studio'}),redirect:'manual'})
    assert.equal(response.status,200)
    const token=(await response.text()).match(/<p class="token">(strap_int_[0-9a-f]{64})<\/p>/)?.[1];assert.ok(token)
    return {...(await h.state()).integrations.find(r=>r.label===label),token}
  }
  const current=await create('Synthetic current integration'),legacy=await create('Synthetic legacy integration')
  // Model an installation key issued before outcome references existed; all reads still use the public integration door.
  await h.db.prepare('UPDATE st_integrations SET member_ref_key=NULL WHERE id=?').bind(legacy.id).run()
  const read=async(key,resource)=>{
    const response=await h.mf.dispatchFetch(h.origin+'/api/strap/integration/'+resource,{headers:{authorization:'Bearer '+key.token,'strap-schema-version':'1'}})
    assert.equal(response.status,200);return response.json()
  }
  const initial=await read(current,'attendance'),ref=initial.data[0].attendance.find(r=>r.bookingId===booking.id).memberRef
  assert.ok(ref);assert.equal(initial.data[0].attendance.length,2)
  assert.equal((await read(legacy,'attendance')).data[0].attendance.length,2)
  assert.equal((await read(current,'roster')).data[0].roster.length,2)
  const request=await h.cmd('privacy.request',{personId:member.id,type:'erasure',channel:'phone',requestId:'synthetic-strap-timed-erase'})
  const version=(await h.state()).version
  for(const [command,input] of [['privacy.verify',{id:request.id,method:'callback-on-file',confirm:true}],['privacy.erase.prepare',{id:request.id,...privacyDecision}]])await h.cmd(command,input,manager.cookie,403)
  assert.equal((await h.state()).version,version)
  await h.cmd('privacy.verify',{id:request.id,method:'callback-on-file',confirm:true})
  const decision={...privacyDecision,documents:'retain',retainUntil:'2032-01-05T00:00:00Z',holdBasis:'Synthetic pending dispute',holdReviewAt:'2032-01-04T00:00:00Z',holdReleaseCondition:'Owner confirms resolution'}
  assert.equal((await h.cmd('privacy.erase.prepare',{id:request.id,...decision},h.owner,409)).error,'privacy_cancel_future_bookings_first')
  await jump('2032-01-03T12:00:00Z')
  await h.cmd('attendance.noshow',{id:booking.id})
  const fee=(await h.state()).charges.find(row=>row.bookingId===booking.id&&row.reason==='no_show_fee')
  assert.equal(fee.amountCents,750)
  await h.cmd('fee.waive',{id:fee.id,reason:'Synthetic private medical explanation'})
  const review=await h.cmd('privacy.erase.prepare',{id:request.id,...decision})
  await h.cmd('privacy.erase.confirm',{id:review.id,confirm:true})
  const report=await h.send('/api/strap/reports/revenue',undefined,h.owner)
  assert.equal(report.status,200)
  const retainedFees=report.value.sources.filter(row=>row.record.bookingId===booking.id)
  assert.deepEqual(retainedFees.map(row=>[row.kind,row.amountCents]).sort((a,b)=>a[1]-b[1]),[['fee',-750],['fee',750]],'erasure preserves assessed fees and their reversals as financial classifications')
  assert.ok(!JSON.stringify(report.value).includes('Synthetic private medical explanation'),'a retained financial classification does not retain the private waiver note')
  assert.equal((await h.state()).packCreditEvents.find(row=>row.bookingId===booking.id&&row.type==='consume').reason,'no_show')
  for(const key of [current,legacy]) {
    assert.deepEqual((await read(key,'attendance')).data[0].attendance.map(r=>r.bookingId),[other.id])
    assert.deepEqual((await read(key,'roster')).data[0].roster.map(r=>r.bookingId),[other.id])
    assert.ok(!JSON.stringify(await read(key,'attendance')).includes(ref),'the erased member reference is retired')
  }
  const staff=(await h.state()).staffAccessGrants.find(r=>r.personId===manager.id)
  assert.deepEqual(staff.rights['member-record'].scopes[0].memberIds,[peer.id],'erasure revokes the subject scope and preserves another member scope')
  const retained=(await h.state()).privacy.retained.find(r=>r.personId===member.id)
  const evidence=await h.cmd('privacy.retained',{id:retained.id});assert.equal(evidence.content.receipt.signature.signerName,member.name)
  assert.equal((await h.send('/api/strap/waiver-evidence.json?id='+retained.sourceId,undefined,peer.cookie)).status,404)
  await h.cmd('privacy.retained',{id:retained.id},peer.cookie,403)
  await jump('2032-01-06T12:00:00Z')
  h.owner=await h.signIn(h.auth.OWNER_EMAIL);await h.cmd('mfa.verify',{code:totp(h.mfaOwner.secret,1)})
  assert.equal((await h.cmd('privacy.dispose',{id:retained.id,confirm:true},h.owner,409)).error,'privacy_hold_active')
  await h.cmd('privacy.hold.release',{id:retained.id,reason:'Synthetic dispute resolved',confirm:true})
  const before=(await h.state()).version
  await h.cmd('privacy.dispose',{id:retained.id,confirm:true},peer.cookie,403)
  assert.equal((await h.state()).version,before)
  await h.cmd('privacy.dispose',{id:retained.id,confirm:true})
  assert.ok(!(await h.state()).privacy.retained.some(r=>r.id===retained.id))
  await h.cmd('privacy.retained',{id:retained.id},h.owner,404)
  const exit=await h.send('/api/strap/exit.json',undefined,h.owner)
  assert.ok(!exit.text.includes(member.name),'expiry disposal removes retained identifying evidence')
  assert.ok(exit.text.includes(peer.name),'another member is preserved')
  await h.cmd('person.save',{name:member.name,email:member.email,role:'member',active:true},h.owner,409)
  await h.cmd('integration.revoke',{id:current.id})
  const revoked=await h.mf.dispatchFetch(h.origin+'/api/strap/integration/attendance',{headers:{authorization:'Bearer '+current.token,'strap-schema-version':'1'}})
  assert.equal(revoked.status,401)
  await privacyShared(h)
  await privacyObligations(h)
  await privacyMakeup(h)
  await privacyCourses(h)
  await privacySharedCourses(h)
  await privacySigning(h)
  await jump('2032-01-08T12:00:00Z')
  await h.cmd('privacy.dispose',{id:h.sharedSigningRetention.id,confirm:true})
  const disposed=await h.send('/api/strap/exit.json',undefined,h.owner)
  for(const value of [h.sharedSigningRetention.guardian.name,h.sharedSigningRetention.guardian.email])assert.ok(!disposed.text.includes(value),'expired shared signing retention is disposed without leaving signer identities')
})
