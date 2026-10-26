import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { harness } from './harness.mjs'
import { softwarePasskey, totp } from './mfa-helpers.mjs'
import { reconstructExit } from './exit-receiver.mjs'
const exec = promisify(execFile)
const cli = resolve('node_modules/@runeditrun/rer/global/rer.mjs')
const command = async (cwd, args, expected = 0) => {
  let result
  // These commands own a separate checkout, not the parent verify operation.
  const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }
  delete env.RER_LOCAL_OPERATION
  delete env.RER_LOCAL_STATE_PATH
  try { result = { ...await exec(process.execPath, [cli, ...args], { cwd, env, maxBuffer: 2e6 }), code: 0 } }
  catch (error) { result = error }
  assert.equal(result.code, expected, `${args[0]}: ${result.stdout ?? ''} ${result.stderr ?? ''}`)
}
async function checkout(root) {
  await mkdir(root)
  for (const name of ['package.json','pnpm-lock.yaml','OPERATIONS.json','RUN-LOCALLY.md','ACCEPTANCE.md','SEED-COMMAND-CONTRACT.md','OPERATIONS.md','.node-version','wrangler.jsonc','deploy.json','rer-setup.json','scripts','src','migrations']) await cp(name, join(root,name), { recursive: true })
  await symlink(resolve('node_modules'), join(root,'node_modules'), 'dir')
}
const integrationKey = async h => (await (await h.mf.dispatchFetch(h.origin + '/app/action?name=integration.create&returnTo=%2Fapp%2Fintegrations', { method: 'POST', redirect: 'manual', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ label: 'Excluded integration', 'sc_roster:read': 'true', 'sc_attendance:read': 'true', location: 'studio', 'ev_booking.changed': 'true', 'ev_attendance.changed': 'true' }).toString() })).text()).match(/<p class="token">(strap_int_[0-9a-f]{64})<\/p>/)[1]
const integrationRead = (h, token, resource = 'roster') => h.mf.dispatchFetch(h.origin + '/api/strap/integration/' + resource, { headers: { host: new URL(h.origin).host, authorization: `Bearer ${token}`, 'strap-schema-version': '1' } })
test('MOVE-011 / ARCHIVE-001 / SCHED-001 / SCHED-014 / SCHED-005 / APP-003 / API-002 / API-003 / RPT-007: portable exit reconstruction and public CLI archive round trip refuses damaged or populated stores and respects erasure, including a member’s emergency contact and its history', { timeout: 240_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(),'strap-archive-')), source=join(temporary,'source'), restored=join(temporary,'restored'), erased=join(temporary,'erased')
  let h
  try {
    for (const path of [source,restored,erased]) await checkout(path)
    await exec(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'], { cwd:source, env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}, maxBuffer:2e6 })
    h=await harness({root:source})
    assert.equal((await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})).status,303)
    const p=await h.cmd('person.save',{name:'Temporary joiner',email:'temporary@venue.example',role:'member',active:false})
    // APP-003: a staff-entered emergency contact is the third party's personal data and follows the member.
    const contact=await h.cmd('profile.save.staff',{personId:p.id,phone:'(212) 555-0144',emergencyName:'Rita Joiner',emergencyPhone:'212-555-0188',emergencyRelationship:'Mother',channel:'phone',revision:0,requestId:'archive-profile'})
    assert.deepEqual(contact.emergencyContact,{name:'Rita Joiner',phone:'2125550188',relationship:'Mother'})
    const member = await h.person('Maya'), coach = await h.person('Priya','instructor')
    const draft = await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt:'2099-12-01T00:00:00Z'})
    await h.cmd('pack.approve',{id:draft.id})
    await h.cmd('studio.save',{location:'New York studio',timeZone:'America/New_York'})
    const week='2099-11-02', timetable=await h.cmd('classes.prepare',{week,classes:[{title:'Restored Pilates',start:week+'T10:00:00Z',end:week+'T11:00:00Z',capacity:12,instructorId:coach.id}]})
    await h.cmd('classes.publish',{id:timetable.id})
    await h.cmd('waiver.publish',{text:'Earlier studio waiver.'})
    const waiver=await h.cmd('waiver.publish',{text:'Studio waiver, "current"\nKeep your own limits.'})
    await h.cmd('waiver.acknowledge',{id:waiver.id},member.cookie)
    await h.cmd('booking.book',{classId:(await h.state()).classes[0].id},member.cookie)
    const repeating=await h.cmd('series.publish',{id:(await h.cmd('series.prepare',{startDate:'2099-11-03',endDate:'2099-11-10',time:'09:00',minutes:50,title:'Restored weekly mobility',service:'Mobility',room:'Movement',capacity:2,instructorId:coach.id})).id})
    const closedOccurrence=await h.cmd('series.cancel.prepare',{classId:repeating.classes[1].id,scope:'this',reason:'Holiday closure'})
    await h.cmd('series.cancel.confirm',{id:closedOccurrence.id,impact:closedOccurrence.impact.key})
    const reservationPreview=await h.cmd('reservation.prepare',{classId:repeating.classes[0].id,throughDate:repeating.series.endDate},member.cookie)
    const reservation=await h.cmd('reservation.confirm',{id:reservationPreview.id,key:reservationPreview.key},member.cookie)
    const seriesBooking=(await h.state(member.cookie)).bookings.find(b=>b.id===reservation.outcomes[0].bookingId)
    await h.cmd('payment.record',{personId:member.id,amountCents:5000,reference:'Processor-backup-1'})
    const csv=await readFile('tests/fixtures/members.csv','utf8'),preview=await h.cmd('import.preview',{csv})
    await h.cmd('import.apply',{csv,fingerprint:preview.fingerprint})
    const passkey = softwarePasskey(h.origin), options = await h.cmd('mfa.passkey.options', { purpose: 'register' })
    await h.cmd('mfa.passkey.register', { challenge_id: options.challenge_id, ...passkey.registration(options.publicKey.challenge) })
    const factorMaterial = (await h.db.prepare('SELECT sealed_secret,credential_id,public_key FROM st_mfa_factors').all()).results.flatMap(Object.values).filter(Boolean)
    factorMaterial.push(...(await h.db.prepare('SELECT code_hash FROM st_mfa_recovery').all()).results.map(r => r.code_hash))
    const key=await h.cmd('agent.create',{label:'Excluded secret'})
    const integration={token:await integrationKey(h)}
    assert.equal((await integrationRead(h,integration.token)).status,200)
    assert.equal((await integrationRead(h,integration.token,'attendance')).status,200,'API-002 explicitly granted attendance scope reads before archive')
    await h.cmd('mail.connect',{})
    const renewalReport=(await h.send('/api/strap/reports/renewals?lowCredits=10000',undefined,h.owner)).value
    const renewalRow=renewalReport.rows.find(r=>r.personId===member.id)
    const renewalInput={packId:renewalRow.packId,basis:renewalRow.basis,lowCredits:10000,ownerId:(await h.state()).actor.id,nextAction:'Review next pack',dueAt:'2099-11-01T00:00:00Z'}
    const renewalTask=await h.cmd('renewal.followup.create',renewalInput)
    assert.equal((await h.send('/api/strap/exit.json')).status,401)
    for(const cookie of [member.cookie,coach.cookie]) assert.equal((await h.send('/api/strap/exit.json',undefined,cookie)).status,403)
    assert.equal((await h.send('/api/strap/exit.json',undefined,'',{authorization:`Bearer ${key.token}`})).status,401)
    for (const token of [key.token,integration.token]) {
      assert.equal((await h.send('/api/strap/mfa',undefined,'',{authorization:`Bearer ${token}`})).status,401)
      assert.equal((await h.send('/api/strap/command',{name:'mfa.verify',input:{code:'synthetic-strap-1'}},'',{authorization:`Bearer ${token}`})).status,401)
    }
    const introMember=await h.person('ArchiveIntro'),introAlias=await h.person('ArchiveIntroAlias');
    await h.cmd('intro.identity.verify',{personId:introMember.id,householdChecked:true,reason:'Archive identity verified'});
    await h.cmd('intro.identity.verify',{personId:introAlias.id,samePersonAsId:introMember.id,householdChecked:true,reason:'Archive second account verified'});
    const introOffer=await h.cmd('intro.offer.save',{name:'Archived two-week intro',days:14,credits:2,amountCents:3900,eligibility:'new',limit:'person'});
    const introPreview=await h.cmd('intro.preview',{offerId:introOffer.id,requestId:'synthetic-strap-840'},introMember.cookie);
    const introSale=await h.cmd('intro.purchase',{id:introPreview.id,key:introPreview.key,confirm:true},introMember.cookie);
    const signingGuardian=await h.person('ArchiveGuardian');
    let signingFamily=await h.cmd('household.save',{name:'Archived signature family'});
    signingFamily=await h.cmd('household.guardian.link',{id:signingFamily.id,guardianId:signingGuardian.id,evidenceReference:'synthetic-strap-archive-authority'});
    signingFamily=await h.cmd('household.participant.add',{id:signingFamily.id,name:'Archived signing child'});
    const signedPolicy=await h.cmd('waiver.publish',{text:'Archived exact service policy and personal affirmation.',requiresSignature:true,service:'Evidence retention',validDays:365});
    const adultEvidence=await h.cmd('waiver.acknowledge',{id:signedPolicy.id,documentHash:signedPolicy.documentHash,signerName:member.name,confirm:true},member.cookie);
    const guardianEvidence=await h.cmd('waiver.acknowledge',{id:signedPolicy.id,documentHash:signedPolicy.documentHash,signerName:signingGuardian.name,participantId:signingFamily.participantIds[0],confirm:true},signingGuardian.cookie);
    const signedBefore=await h.send('/api/strap/waiver-evidence.json?id='+adultEvidence.id,undefined,member.cookie);
    const guardianBefore=await h.send('/api/strap/waiver-evidence.json?id='+guardianEvidence.id,undefined,h.owner);
    await h.cmd('household.guardian.remove',{id:signingFamily.id,guardianId:signingGuardian.id,reason:'Authority ended before archive'});
    const download=await h.send('/api/strap/exit.json',undefined,h.owner)
    assert.equal(download.status,200)
    assert.equal(download.headers.get('content-disposition'),'attachment; filename="strap-exit.json"')
    assert.equal(download.headers.get('cache-control'),'no-store')
    const portable=download.value
    reconstructExit(portable,csv)
    for(const value of [key.token,integration.token,'Excluded integration',h.auth.SESSION_SECRET,h.auth.SETUP_TOKEN,h.owner,...(h.mfaOwner ? [h.mfaOwner.secret,h.mfaOwner.recoveryCodes[0]] : [])]) assert.ok(!download.text.includes(value))
    assert.ok(Object.keys(portable.tables).every(name=>!name.startsWith('oa_')&&!name.includes('outbox')&&!name.includes('agent_keys')&&!name.includes('integration')),'API-002 integration keys stay out of the portable exit')
    if(process.env.STRAP_PROOF_DIR) await (await import('./exit-browser.mjs')).exitBrowser(h,portable)
    const identity={auth:h.auth,owner:h.owner,factor:h.mfaOwner}
    await h.close();h=null
    const old=join(temporary,'before.rer'),later=join(temporary,'later.rer'),again=join(temporary,'again.rer')
    await command(source,['export','--output',old,'--no-queue'])
    const bytes=await readFile(old,'utf8');assert.ok(bytes.includes('Temporary joiner'));assert.ok(bytes.includes('Rita Joiner'),'APP-003 the emergency contact and its history travel in the native archive');assert.ok(!bytes.includes('Excluded secret'));assert.ok(!bytes.includes('token_hash'));assert.ok(!bytes.includes('Excluded integration'),'API-002 integration keys never travel in the native archive')
    for (const value of [identity.factor.secret,...identity.factor.recoveryCodes,...factorMaterial]) assert.ok(!bytes.includes(value),'native archive excludes factor secrets and recovery codes')
    const archived = bytes.split('\n').filter(Boolean).map(JSON.parse)
    assert.ok(!archived.find(r=>r.kind==='manifest').tables.some(t=>t.name.startsWith('st_mfa_')),'native archive inventory excludes all factor, passkey, recovery and challenge tables')
    assert.ok(!archived.filter(r=>r.kind==='part').flatMap(r=>r.items).some(r=>r.kind==='row' && r.table.startsWith('st_mfa_')),'native archive payload excludes all factor tables')
    await command(restored,['import','--input',old,'--yes','--no-queue'])
    await command(restored,['export','--output',again,'--no-queue'])
    const rows=text=>text.split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='part')
    assert.ok(rows(bytes).length>0);assert.deepEqual(rows(await readFile(again,'utf8')),rows(bytes))
    // Recover access through native sign-in; the old session never travels.
    h=await harness({root:restored,...identity})
    assert.equal((await h.send('/api/strap/exit.json',undefined,identity.owner)).status,401)
    const restoredOwner=await h.signIn(h.auth.OWNER_EMAIL)
    assert.equal((await h.send('/api/strap/exit.json',undefined,restoredOwner)).value.error,'mfa_enrollment_required','SEC-004 second factors never restore: the owner enrolls again before any export')
    await h.enroll(restoredOwner)
    assert.equal((await integrationRead(h,integration.token)).status,401,'API-002 a restored studio refuses the old integration secret')
    assert.equal((await integrationRead(h,integration.token,'attendance')).status,401,'API-002 restored attendance scope is refused too')
    assert.deepEqual((await h.state(restoredOwner)).integrations,[],'API-002 integration keys never restore')
    const restoredDownload=await h.send('/api/strap/exit.json',undefined,restoredOwner)
    assert.equal(restoredDownload.status,200)
    assert.deepEqual(restoredDownload.value.tables,portable.tables)
    const restoredReservations=await h.state(restoredOwner)
    assert.deepEqual(restoredReservations.intros.sales.find(r=>r.id===introSale.id),{...introSale,exceptionReason:null,eligibilityFailure:null,exceptionApprovedBy:null});
    const introAliasCookie=await h.signIn(introAlias.email);
    assert.equal((await h.cmd('intro.preview',{offerId:introOffer.id,requestId:'synthetic-strap-841'},introAliasCookie,409)).error,'intro_already_used','restored aliases retain the lifetime intro fence');
    assert.equal((await h.state(restoredOwner)).packs.filter(p=>p.introSaleId===introSale.id).length,1);

    assert.deepEqual(restoredReservations.reservations.find(r=>r.id===reservation.id),reservation,'SCHED-005 native restore retains occurrence outcomes and booking identities')
    assert.equal(restoredReservations.reservationPreviews.find(r=>r.id===reservationPreview.id).status,'confirmed')
    assert.equal(restoredReservations.reservations.find(r=>r.id===reservation.id).outcomes[1].reason,'class_cancelled','SCHED-005 the member keeps the skipped date and reason after restore')
    assert.deepEqual((await h.state(restoredOwner)).people.find(row=>row.id===p.id).emergencyContact,contact.emergencyContact,'APP-003 the restored member keeps their emergency contact')
    assert.equal((await h.state(restoredOwner)).profileChanges.filter(c=>c.personId===p.id).length,1,'APP-003 the restored member keeps one profile change')
    assert.equal((await h.state(restoredOwner)).waiver.id,waiver.id)
    const restoredMember=await h.signIn(member.email),restoredGuardian=await h.signIn(signingGuardian.email);
    const adultAfter=await h.send('/api/strap/waiver-evidence.json?id='+adultEvidence.id,undefined,restoredMember);
    const guardianAfter=await h.send('/api/strap/waiver-evidence.json?id='+guardianEvidence.id,undefined,restoredOwner);
    assert.equal(adultAfter.status,200);assert.deepEqual(adultAfter.value,signedBefore.value,'MEM-005 native restore retains exact adult document, declaration and attribution');
    assert.equal(guardianAfter.status,200);assert.deepEqual(guardianAfter.value,guardianBefore.value,'MEM-005 native restore retains historical guardian evidence and authority revision');
    assert.equal((await h.send('/api/strap/waiver-evidence.json?id='+guardianEvidence.id,undefined,restoredGuardian)).status,404,'MEM-005 historical guardian provenance never restores ended access');
    reconstructExit(restoredDownload.value,csv)
    const recoveredRenewals=(await h.send('/api/strap/reports/renewals?lowCredits=10000',undefined,restoredOwner)).value
    assert.equal(recoveredRenewals.rows.find(r=>r.packId===renewalRow.packId).followup.leadId,renewalTask.leadId,'RPT-007 native restore retains the pack/task relationship')
    assert.deepEqual(await h.cmd('renewal.followup.create',renewalInput,restoredOwner),renewalTask,'RPT-007 native restore reuses the once-only task')
    assert.equal((await h.state(restoredOwner)).pipeline.leads.filter(l=>l.id===renewalTask.leadId).length,1)
    const mail=(await h.db.prepare('SELECT message FROM rer_mail_development_outbox').all()).results.map(r=>JSON.parse(r.message))
    assert.ok(mail.length>0)
    assert.ok(mail.every(m=>m.text.includes('/auth/confirm?token=')), 'restoration/download produced no studio message or collection; only fresh access mail')
    // MSG-004 under MOVE-011: member email stays paused on the restored installation until its owner reconnects it.
    assert.equal((await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:restoredOwner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})).status,303)
    const studioPage=await h.send('/app/studio',undefined,restoredOwner)
    assert.match(studioPage.text,/Member email paused[\s\S]*Reconnect member email/,`${studioPage.status} ${studioPage.headers.get('location')}`)
    const seriesEdit=await h.cmd('series.change.prepare',{classId:repeating.classes[0].id,scope:'this',reason:'Recovery studio review',change:{time:'10:00'}},restoredOwner)
    await h.cmd('series.change.approve',{id:seriesEdit.id,impact:seriesEdit.impact.key},restoredOwner)
    const recoveredSeries=await h.state(restoredOwner)
    assert.equal(recoveredSeries.series.find(row=>row.id===repeating.series.id).classIds[0],repeating.classes[0].id)
    assert.equal(recoveredSeries.bookings.find(row=>row.id===seriesBooking.id).seriesChangeId,seriesEdit.id)
    assert.equal(recoveredSeries.noticeDeliveries.find(row=>recoveredSeries.bookingActions.some(a=>a.id===row.sourceId&&a.seriesChangeId===seriesEdit.id)).status,'paused','SCHED-001 changes remain paused after native restore')
    const lee=await h.cmd('person.save',{name:'Lee',email:'lee@studio.example',role:'member',active:true},restoredOwner)
    await h.cmd('person.invite',{id:lee.id},restoredOwner);lee.cookie=await h.signIn('lee@studio.example')
    const seat=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[{title:'Restored Reformer',start:week+'T13:00:00Z',end:week+'T14:00:00Z',capacity:1,instructorId:coach.id}]},restoredOwner)).id},restoredOwner)).classes[0]
    await h.cmd('waiver.acknowledge',{id:signedPolicy.id,documentHash:signedPolicy.documentHash,signerName:'Lee',confirm:true},lee.cookie)
    await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:lee.id,credits:2,amountCents:4000,expiresAt:'2099-12-01T00:00:00Z'},restoredOwner)).id},restoredOwner)
    await h.cmd('waiver.acknowledge',{id:waiver.id},lee.cookie)
    const first=await h.cmd('booking.book',{classId:seat.id},await h.signIn('maya@studio.example'))
    assert.equal((await h.cmd('booking.book',{classId:seat.id},lee.cookie)).status,'waitlisted')
    await h.cmd('booking.cancel',{id:first.id,cancelReason:'Other'},restoredOwner)
    let restoredState=await h.state(restoredOwner)
    assert.equal(restoredState.bookings.find(b=>b.classId===seat.id&&b.personId===lee.id).status,'booked')
    assert.equal(restoredState.noticeDeliveries.find(d=>d.sourceKind==='confirmation'&&d.sourceId===first.id).status,'paused','new booking confirmations stay paused after restore')
    assert.equal(restoredState.noticeDeliveries.find(d=>d.sourceKind==='confirmation'&&d.personId===lee.id).status,'paused','waitlist confirmations also stay paused after restore')
    assert.deepEqual(restoredState.noticeDeliveries.filter(d=>d.sourceKind!=='confirmation').map(d=>[d.sourceKind,d.personId,d.status]),[['booking_action',introMember.id,'not_configured'],['booking_action',member.id,'paused'],['booking_action',member.id,'paused'],['booking',lee.id,'paused']], 'series changes, cancellation and promotion email stay paused after restore')
    assert.match((await h.state(lee.cookie)).notices.map(n=>n.subject).join(),/You're booked: Restored Reformer/)
    await h.cmd('mail.connect',{},restoredOwner)
    assert.doesNotMatch((await h.send('/app/studio',undefined,restoredOwner)).text,/Member email paused/)
    const closing=await h.cmd('closure.prepare',{scope:'class',classId:seat.id,reason:'Restored test'},restoredOwner)
    await h.cmd('closure.confirm',{id:closing.id,impact:closing.impact.key},restoredOwner)
    restoredState=await h.state(restoredOwner)
    assert.deepEqual(restoredState.noticeDeliveries.filter(d=>d.sourceKind!=='confirmation').map(d=>d.status),['not_configured','paused','paused','paused','not_configured'])
    await h.close();h=null
    await command(restored,['import','--input',old,'--yes','--no-queue'],4)
    const corrupt=join(temporary,'corrupt.rer');await writeFile(corrupt,bytes.replace('Temporary joiner','Changed joiner'),{mode:0o600})
    // Checksum damage is a transfer failure (1); restore policy conflicts remain 4.
    await command(erased,['import','--input',corrupt,'--yes','--no-queue'],1)
    h=await harness({root:source,...identity});const eraser=await h.signIn(h.auth.OWNER_EMAIL);await h.cmd('mfa.verify',{code:totp(identity.factor.secret,1)},eraser);await h.cmd('person.erase',{id:p.id,revision:1},eraser);await h.close();h=null
    await command(source,['export','--output',later,'--no-queue'])
    const erasedBytes=await readFile(later,'utf8')
    for(const value of ['Rita Joiner','2125550188','2125550144','temporary@venue.example']) assert.ok(!erasedBytes.includes(value),`APP-003 erasure removes ${value} from the later archive`)
    // APP-003: the pre-erasure archive still holds the contact, so the later journal fences it.
    await command(erased,['import','--input',old,'--journal',later,'--yes','--no-queue'],4)
    await command(erased,['import','--input',later,'--yes','--no-queue'])
    const proxy=await getPlatformProxy({configPath:join(erased,'wrangler.jsonc'),persist:{path:join(erased,'.wrangler/state/v3')},remoteBindings:false})
    try {
      assert.equal((await proxy.env.DB.prepare('SELECT name FROM st_people WHERE id=?').bind(p.id).first()).name,'Erased person')
      const kept=(await proxy.env.DB.prepare("SELECT kind,data FROM st_records WHERE kind IN ('memberProfile','profileChange','memberCheckin') AND json_extract(data,'$.personId')=?").bind(p.id).all()).results
      assert.deepEqual(kept.map(r=>r.kind),['profileChange'],'APP-003 erasure deletes the current contact and the check-in phone')
      const entry=JSON.parse(kept[0].data)
      assert.deepEqual([entry.erased,entry.changed,entry.channel,entry.staffMade,'before' in entry,'after' in entry,'requestBasis' in entry],[true,['phone','emergencyContact'],'phone',true,false,false,false],'APP-003 the change keeps who acted and when; its values are erased')
    }
    finally { await proxy.dispose() }
  } finally { if(h)await h.close();await rm(temporary,{recursive:true,force:true}) }
})


// Same origin is deliberate: restored owner IDs and an unchanged hostname are
// insufficient authority to restart billing. Only the excluded live epoch is.
test('BILL-005 / MOVE-011: native restore at the same origin leaves recurring invoice authority disconnected', { timeout: 180_000 }, async () => {
  const temporary=await mkdtemp(join(tmpdir(),'strap-billing-archive-')),source=join(temporary,'source'),restored=join(temporary,'restored')
  let h
  try {
    for(const path of [source,restored])await checkout(path)
    await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:2e6})
    h=await harness({root:source})
    await h.confirmSetup(h.owner)
    await h.cmd('studio.save',{location:'synthetic-strap-1',timeZone:'America/New_York'})
    const member=await h.person('synthetic-strap-2')
    const dueAt=new Date(Math.ceil((Date.now()+25_000)/1000)*1000).toISOString()
    const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:12000,expiresAt:dueAt})).id})
    const proposal=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:'synthetic-strap-3'})
    const agreed=await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie)
    const expiryPack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:2,amountCents:3000,expiresAt:new Date(Date.now()+60*86400000).toISOString()})).id});
    const expiryDisclosure=await h.cmd('plan.disclosure.schedule',{packId:expiryPack.id,leadDays:7,requestId:'synthetic-strap-expiry-archive'});
    const deliveredPack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:2,amountCents:3000,expiresAt:new Date(Date.now()+60*86400000).toISOString()})).id});
    const deliveredTermsProposal=await h.cmd('plan.recurring.prepare',{packId:deliveredPack.id,intervalMonths:12,requestId:'synthetic-strap-delivered-terms'});
    const deliveredTerms=await h.cmd('plan.recurring.accept',{id:deliveredTermsProposal.id,key:deliveredTermsProposal.key},member.cookie);
    const deliveredDisclosure=await h.cmd('plan.disclosure.schedule',{termsId:deliveredTerms.id,leadDays:30,proposedAmountCents:5000,requestId:'synthetic-strap-delivered-archive'});
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.sendAt',?) WHERE id=?").bind(new Date(Date.now()-1000).toISOString(),deliveredDisclosure.id).run();
    await(await h.mf.getWorker()).scheduled();
    assert.equal((await h.state()).renewalDisclosures.find(d=>d.id===deliveredDisclosure.id).delivery.status,'not_configured');
    // Model interruption after the committed reservation and before provider dispatch.
    await h.db.prepare("UPDATE st_notice_deliveries SET status='queued' WHERE source_id=?").bind('renewal-disclosure:'+deliveredDisclosure.id).run();
    assert.equal((await h.state()).renewalDisclosures.find(d=>d.id===deliveredDisclosure.id).delivery.status,'queued');

    const before=await h.state(),sourceOrigin=h.origin,identity={auth:{...h.auth},owner:h.owner,port:Number(new URL(h.origin).port)}
    assert.equal(agreed.status,'active')
    assert.equal(agreed.billingOrigin,sourceOrigin)
    assert.equal(before.recurring.invoices.length,0)
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM st_contract_connections').first()).count,1)
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM st_disclosure_connections').first()).count,1);
    await h.close();h=null
    const archive=join(temporary,'billing.rer')
    await command(source,['export','--output',archive,'--no-queue'])
    const archived=(await readFile(archive,'utf8')).split('\n').filter(Boolean).map(JSON.parse)
    assert.ok(!archived.find(r=>r.kind==='manifest').tables.some(t=>t.name==='st_contract_connections'))
    assert.ok(!archived.filter(r=>r.kind==='part').flatMap(r=>r.items).some(r=>r.kind==='row'&&r.table==='st_contract_connections'))
    assert.ok(!archived.find(r=>r.kind==='manifest').tables.some(t=>t.name==='st_disclosure_connections'));
    await command(restored,['import','--input',archive,'--yes','--no-queue'])
    h=await harness({root:restored,...identity})
    const restoredOwner=await h.signIn(h.auth.OWNER_EMAIL)
    await h.confirmSetup(restoredOwner);await h.enroll(restoredOwner)
    // Reuse the actual listening origin, not a rewritten request URL.
    assert.equal(h.origin,sourceOrigin)
    const state=()=>h.state(restoredOwner)
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM st_disclosure_connections').first()).count,0);
    assert.equal((await state()).renewalDisclosures.find(d=>d.id===expiryDisclosure.id).status,'scheduled');
    const restoredDisclosure=(await state()).renewalDisclosures.find(d=>d.id===deliveredDisclosure.id);
    assert.equal(restoredDisclosure.status,'delivered','the retained in-app notice survives restore');
    assert.equal(restoredDisclosure.delivery.status,'paused','old delivery intent never claims a live dispatch queue');
    assert.equal(restoredDisclosure.canAccept,false,'a restored price proposal cannot revive excluded dispatch authority');
    const restoredMember=await h.signIn(member.email);
    await h.cmd('plan.disclosure.accept',{id:deliveredDisclosure.id,key:deliveredDisclosure.key},restoredMember,409);
    if(process.env.STRAP_PROOF_DIR)await(await import('./renewal-disclosures-browser.mjs')).restoredDisclosureBrowser(h,{owner:restoredOwner,member:restoredMember,disclosure:restoredDisclosure});

    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.sendAt',?) WHERE id=?").bind(new Date(Date.now()-1000).toISOString(),expiryDisclosure.id).run();
    const retained=(await state()).recurring.terms.find(t=>t.id===agreed.id)
    assert.equal(retained.status,'active','the native archive retains the accepted agreement')
    assert.equal(retained.billingOrigin,sourceOrigin,'origin mismatch is not the reason billing stops')
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM st_contract_connections').first()).count,0,'live invoice authority never restores')
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(dueAt)-Date.now()+100)))
    for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled({cron:'* * * * *'})
    const after=await state()
    assert.equal(after.renewalDisclosures.find(d=>d.id===expiryDisclosure.id).status,'stale','restored expiry notice has no dispatch authority');
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS count FROM st_notice_deliveries WHERE source_id LIKE 'renewal-disclosure:%'").first()).count,1,'only retained intent, no new dispatch reservation');
    assert.equal(after.recurring.terms.find(t=>t.id===agreed.id).status,'needs_reconnection')
    assert.equal(after.recurring.invoices.length,0)
    assert.deepEqual([...after.charges].sort((a,b)=>a.id.localeCompare(b.id)),[...before.charges].sort((a,b)=>a.id.localeCompare(b.id)),'no restored balance charge')
    assert.deepEqual(after.packs.map(p=>p.id).sort(),before.packs.map(p=>p.id).sort(),'no restored renewal entitlement')
    assert.equal(after.staffNotices.filter(n=>n.id.startsWith('notice:invoice:')).length,0,'no renewal notice')
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS count FROM st_notice_deliveries WHERE source_id LIKE 'invoice:%'").first()).count,0,'no renewal delivery reservation')
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM st_contract_connections').first()).count,0,'the scheduler cannot reconnect billing')
    const mail=(await h.db.prepare('SELECT message FROM rer_mail_development_outbox').all()).results.map(r=>JSON.parse(r.message))
    assert.ok(mail.every(m=>m.text.includes('/auth/confirm?token=')),'only fresh authentication mail, no studio billing mail')
  } finally {if(h)await h.close();await rm(temporary,{recursive:true,force:true})}
})
