import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp,mkdir,mkdtemp,rm,symlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { harness } from './harness.mjs'
const exec=promisify(execFile)
async function checkout(root) {
  await mkdir(root)
  for(const name of ['package.json','pnpm-lock.yaml','OPERATIONS.json','RUN-LOCALLY.md','ACCEPTANCE.md','SEED-COMMAND-CONTRACT.md','OPERATIONS.md','.node-version','wrangler.jsonc','deploy.json','rer-setup.json','scripts','src','migrations'])await cp(name,join(root,name),{recursive:true})
  await symlink(resolve('node_modules'),join(root,'node_modules'),'dir')
}
async function archive(root,args) {
  const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'};delete env.RER_LOCAL_OPERATION;delete env.RER_LOCAL_STATE_PATH
  await exec(process.execPath,[resolve('node_modules/@runeditrun/rer/global/rer.mjs'),...args,'--no-queue'],{cwd:root,env,maxBuffer:2e6})
}
const setup=async(h,cookie)=>assert.equal((await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})).status,303)

test('Client appointment acceptance, linked external deposit and original funding survive native restore while old sessions and capture replay have no authority',{timeout:240_000},async()=>{
  await (await import('./client-appointments-archive.mjs')).clientAppointmentArchive({checkout,archive,exec});
});

test('SEC-002 / MSG-002 / ATT-002 / SCHED-004 / LEAD-002 / LEAD-006 / STAFF-002 / STAFF-006 / MOVE-011: native restore carries waiver launch history without dispatch authority, pauses new staff links until explicit reconnect, and preserves member-owned sign-in', {timeout:240_000},async()=>{
  const temp=await mkdtemp(join(tmpdir(),'strap-staff-restore-')),source=join(temp,'source'),restored=join(temp,'restored'),file=join(temp,'studio.rer')
  let h
  try {
    await checkout(source);await checkout(restored)
    await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:2e6})
    h=await harness({root:source});await setup(h,h.owner)
    const member=await h.person('Maya'),waiver=await h.cmd('waiver.publish',{text:'Only Maya can acknowledge this current studio waiver.'})
    await h.cmd('waiver.launch',{personId:member.id,waiverId:waiver.id,requestId:'source-link',channel:'phone'})
    assert.equal((await h.state()).memberMail.origin,h.origin,'the first explicit member link records its source installation')
    const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
    assert.ok(!('st_waiver_launch_dispatches'in portable.tables))
    const coach=await h.person('Leo','instructor')
    const effectiveAt=new Date(Date.now()+3000).toISOString(),start=new Date(Date.now()+60_000).toISOString(),d=new Date(start)
    const week=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)
    const payRule=await h.cmd('pay.rule.save',{effectiveAt,mode:'flat-class',rateCents:4500,minimumCents:0,cancellation:{treatment:'flat',amountCents:1500}})
    const payClass=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[{title:'Morning Flow',start,end:new Date(Date.parse(start)+3600_000).toISOString(),capacity:10,instructorId:coach.id}]})).id})).classes[0]
    const closure=await h.cmd('closure.prepare',{scope:'class',classId:payClass.id,reason:'Studio holiday'})
    await h.cmd('closure.confirm',{id:closure.id,impact:closure.impact.key})
    const payAdjustment=await h.cmd('pay.adjust',{classId:payClass.id,amountCents:500,reason:'Agreed holiday preparation',requestId:'holiday-preparation'})
    const originalPay=(await h.send('/api/strap/teaching-pay',undefined,h.owner)).value
    assert.equal(originalPay.totalCents,2000)
    await h.cmd('recognition.milestone.save',{threshold:1,label:'First visit',enabled:true})
    await h.cmd('recognition.preference.save',{optedIn:true,version:0},member.cookie)
    await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:1,amountCents:2000,expiresAt:'2099-12-31T00:00:00Z'})).id})
    const visitStart=new Date(Date.now()+86400_000).toISOString(),visitDate=new Date(visitStart)
    const visitWeek=new Date(Date.UTC(visitDate.getUTCFullYear(),visitDate.getUTCMonth(),visitDate.getUTCDate()-(visitDate.getUTCDay()+6)%7)).toISOString().slice(0,10)
    const visit=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:visitWeek,classes:[{title:'Flow',start:visitStart,end:new Date(Date.parse(visitStart)+3600_000).toISOString(),capacity:10,instructorId:coach.id}]})).id})).classes[0]
    assert.equal((await h.state()).acknowledgements.length,0,'staff waiver launch alone never acknowledges')
    await h.cmd('waiver.acknowledge',{id:waiver.id},member.cookie)
    const originalAcknowledgements=(await h.state()).acknowledgements
    assert.equal(originalAcknowledgements[0].actorId,(await h.state(member.cookie)).actor.id,'the booked visit uses the member-owned waiver step')
    const reservation=await h.cmd('booking.book',{classId:visit.id},member.cookie)
    await h.cmd('attendance.checkin',{id:reservation.id},coach.cookie)
    const originalRecognition=(await h.state()).recognition
    const inquiry={requestId:'archive-inquiry',personId:member.id,ownerId:(await h.state()).actor.id,nextAction:'Call after the first visit',dueAt:new Date(Date.now()+86400000).toISOString(),note:'Member asked about ongoing classes.'}
    const lead=await h.cmd('lead.create',inquiry)
    await h.cmd('lead.update',{id:lead.id,version:lead.version,requestId:'archive-first-visit',stage:'first-visit',bookingId:reservation.id,nextAction:'Discuss a membership offer',dueAt:inquiry.dueAt})
    const originalPipeline=(await h.state()).pipeline
    const substitute=await h.person('Noor','instructor')
    await h.cmd('substitution.qualification.save',{instructorId:substitute.id,service:visit.service,qualified:true,requestId:'archive-qualification'})
    const cover=await h.cmd('substitution.request',{classId:visit.id,reason:'Coverage for a workshop',requestId:'archive-coverage'},coach.cookie)
    const substitution=await h.cmd('substitution.prepare',{requestId:cover.id,instructorId:substitute.id})
    const approvedSubstitution=await h.cmd('substitution.approve',{id:substitution.id,impact:substitution.impact.key})
    const originalSubstitutions=(await h.state()).substitutions
    const originalAssignment=(await h.state()).classes.find(c=>c.id===visit.id)
    assert.equal(originalRecognition.recognitions.length,1)
    // ATT-002: explicit receipts and reasoned reversals are retained data, never collection instructions.
    await h.cmd('bookingRule.save',{service:'Fee rehearsal',cancelCutoffHours:12,lateCancelFeeCents:1500,noShowGraceMinutes:10})
    await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:2,amountCents:0,expiresAt:'2099-12-31T00:00:00Z'})).id})
    const feeStart=new Date(Date.now()+3*3600_000).toISOString(),feeDate=new Date(feeStart)
    const feeWeek=new Date(Date.UTC(feeDate.getUTCFullYear(),feeDate.getUTCMonth(),feeDate.getUTCDate()-(feeDate.getUTCDay()+6)%7)).toISOString().slice(0,10)
    const feeClass=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:feeWeek,classes:[{title:'Fee rehearsal',service:'Fee rehearsal',start:feeStart,end:new Date(Date.parse(feeStart)+3600_000).toISOString(),capacity:5,instructorId:coach.id}]})).id})).classes[0]
    for(const action of ['collect','waive']) {
      const seat=await h.cmd('booking.book',{classId:feeClass.id},member.cookie)
      const effect=(await h.state(member.cookie)).bookings.find(b=>b.id===seat.id).cancelEffect
      await h.cmd('booking.cancel',{id:seat.id,terms:effect.key},member.cookie)
      const charge=(await h.state()).fees.find(f=>f.bookingId===seat.id)
      await h.cmd('fee.'+action,{id:charge.id,reference:'ARCHIVE-FEE-RECEIPT',reason:'Courtesy fee waiver',requestId:'archive-fee-'+action})
    }
    const originalFees=(await h.state()).fees,originalFeeAudit=(await h.state()).staffActions.filter(a=>a.command?.startsWith('fee.'))
    await h.cmd('mail.templates.save',{prefix:'Brooklyn Studio booking',suffix:'Please contact the studio for help.',requestId:'archive-message-template'})
    const messagePreference=await h.cmd('mail.preference.save',{optedOut:true,requestId:'archive-message-optout'},member.cookie)
    const messagePortable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
    const originalMessageRecords=messagePortable.tables.st_records.filter(r=>r.kind.startsWith('message')).map(r=>JSON.parse(r.data)).sort((a,b)=>a.id.localeCompare(b.id))
    const identity={auth:h.auth,owner:h.owner};await h.close();h=null
    await archive(source,['export','--output',file]);await archive(restored,['import','--input',file,'--yes'])
    h=await harness({root:restored,...identity})
    assert.equal((await h.send('/api/strap/state',undefined,identity.owner)).status,401)
    const owner=await h.signIn(h.auth.OWNER_EMAIL);await setup(h,owner);await h.enroll(owner)
    const memberCookie=await h.signIn(member.email)
    assert.equal((await h.send('/app',undefined,memberCookie)).status,200,'ordinary member-owned native sign-in still works')
    await h.cmd('recognition.process',{},owner)
    assert.deepEqual(await h.cmd('lead.create',inquiry,owner),lead,'LEAD-002 restore preserves request identity and never duplicates inquiry')
    assert.deepEqual(await h.cmd('substitution.approve',{id:substitution.id,impact:substitution.impact.key},owner),approvedSubstitution,'SCHED-004 restore replays the approved identity without repeating notices')
    const before=await h.state(owner),mailCount=(await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n
    assert.deepEqual(before.fees,originalFees,'ATT-002 linked external receipts, grace terms and waived fee reversals survive native restore')
    assert.deepEqual(before.staffActions.filter(a=>a.command?.startsWith('fee.')),originalFeeAudit,'ATT-002 canonical collection and waiver audits survive')
    const restoredHistory=(await h.send('/api/strap/staff-history?auditRight=fee-waiver',undefined,owner)).value
    assert.ok(restoredHistory.rows.some(a=>a.command==='fee.waive'&&a.after.status==='waived'),'SEC-002 restored audit search retains the reasoned fee waiver')
    const restoredHistoryCsv=await h.send('/api/strap/staff-history.csv?auditRight=fee-waiver',undefined,owner)
    assert.equal(restoredHistoryCsv.status,200);assert.match(restoredHistoryCsv.text,/fee.waive/)

    for(const fee of originalFees) assert.equal(before.bookings.find(b=>b.id===fee.bookingId).cancelTerms.noShowGraceMinutes,10,'ATT-002 booked grace survives native restore')
    const receipt=originalFees.find(f=>f.status==='collected')
    const receiptCount=before.payments.length
    await h.cmd('fee.collect',{id:receipt.id,reference:'ARCHIVE-FEE-RECEIPT',reason:'Courtesy fee waiver',requestId:'archive-fee-collect'},owner)
    assert.equal((await h.state(owner)).payments.length,receiptCount,'ATT-002 replay after restore records no second receipt')
    assert.deepEqual(before.substitutions,originalSubstitutions,'SCHED-004 qualifications, requests and exact approved preview survive native restore')
    assert.deepEqual(before.classes.find(c=>c.id===visit.id),originalAssignment,'SCHED-004 roster assignment, pay provenance and history survive native restore')
    assert.deepEqual(before.pipeline.leads,originalPipeline.leads,'LEAD-002 linked lead, assignment, stage and next action survive native restore')
    assert.deepEqual(before.pipeline.events,originalPipeline.events,'LEAD-002 conversation and stage provenance survive native restore')
    assert.deepEqual(before.recognition,originalRecognition,'LEAD-006 consent, milestones, source evidence and permanent issuance identities survive native restore')
    assert.equal(before.recognition.recognitions.length,1,'restored processing cannot repeat recognition')
    assert.deepEqual(before.payRules,[payRule],'STAFF-002 immutable rate versions survive native restore')
    assert.deepEqual(before.teachingPay.rows,originalPay.rows,'STAFF-002 pay sources, arithmetic and adjustment history survive native restore')
    assert.equal(before.teachingPay.rows[0].adjustments[0].id,payAdjustment.id)
    assert.deepEqual((await h.state(memberCookie)).messagePreference,messagePreference,'MSG-002 member opt-out and source survive native restore')
    const restoredMessageRecords=(await h.send('/api/strap/exit.json',undefined,owner)).value.tables.st_records.filter(r=>r.kind.startsWith('message')).map(r=>JSON.parse(r.data)).sort((a,b)=>a.id.localeCompare(b.id))
    assert.deepEqual(restoredMessageRecords,originalMessageRecords,'MSG-002 templates and immutable member/owner choice provenance survive native restore')
    assert.equal(before.waiverLaunches.length,1);assert.equal(before.staffActions.filter(a=>a.command==='waiver.launch').length,1)
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM st_waiver_launch_dispatches').first()).n,0,'restore has no dispatch authority')
    const input={personId:member.id,waiverId:waiver.id,requestId:'restored-link',channel:'phone'}
    const refused=await h.send('/api/strap/command',{name:'waiver.launch',input},owner)
    assert.equal(refused.status,409);assert.equal(refused.value.error,'member_email_reconnect_required')
    assert.equal((await h.state(owner)).version,before.version,'refusal creates no launch or audit')
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n,mailCount,'refusal sends no email')
    const profile=(await h.send('/app/people?person='+member.id,undefined,owner)).text
    assert.match(profile,/Review and reconnect in Studio/);assert.doesNotMatch(profile,/name=waiver.launch/)
    if(process.env.STRAP_PROOF_DIR)await(await import('./staff-actions-browser.mjs')).pausedWaiverBrowser(h,member.id,owner)
    await h.cmd('mail.connect',{},owner)
    assert.equal((await h.cmd('waiver.launch',input,owner)).status,'requested')
    assert.equal((await h.cmd('waiver.launch',input,owner)).status,'requested')
    const after=await h.state(owner)
    assert.equal(after.waiverLaunches.length,2);assert.equal(after.staffActions.filter(a=>a.command==='waiver.launch').length,2)
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM st_waiver_launch_dispatches').first()).n,1)
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n,mailCount+1,'explicit reconnect permits one new send, never a replay of history')
    assert.deepEqual(after.acknowledgements,originalAcknowledgements,'restored staff requests never add or rewrite the member-owned acknowledgement')
  } finally {if(h)await h.close();await rm(temp,{recursive:true,force:true})}
})

test('MEM-001 / MEM-006 / MSG-008 / MOVE-011: native restore preserves original member links, preference sources and queued suppression data without automatic marketing execution or restored staff sessions',{timeout:240000},async()=>{
  const temp=await mkdtemp(join(tmpdir(),'strap-consent-restore-')),source=join(temp,'source'),restored=join(temp,'restored'),file=join(temp,'studio.rer')
  let h
  try {
    await checkout(source);await checkout(restored)
    await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:2e6})
    h=await harness({root:source});await setup(h,h.owner);await h.cmd('studio.save',{location:'Austin',timeZone:'America/Chicago'})
    const member=await h.person('ArchiveConsent'),duplicate=await h.person('ArchiveDuplicate'),desk=await h.person('ArchiveDesk')
    const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:3,amountCents:6000,expiresAt:new Date(Date.now()+20*86400000).toISOString()})).id})
    const preference=await h.cmd('preferences.save',{revision:0,marketingInApp:true,marketingSms:false,accessibility:'Restricted archived preference',consentStatement:'I request native renewal messages',requestId:'synthetic-strap-archive-preference'},member.cookie)
    await h.cmd('member.record.grant',{personId:desk.id,enabled:true,canCreate:true,memberIds:[member.id]})
    await h.cmd('member.message.send',{text:'Original duplicate source message',requestId:'synthetic-strap-archive-message'},duplicate.cookie)
    const review=await h.cmd('member.merge.prepare',{sourceId:duplicate.id,targetId:member.id,reason:'Reviewed duplicate history',requestId:'synthetic-strap-archive-merge'})
    const merged=await h.cmd('member.merge.confirm',{id:review.id,key:review.key,requestId:'synthetic-strap-archive-confirm'})
    const preview=await h.cmd('renewal.sequence.prepare',{name:'Archived native renewal',channel:'inApp',text:'Review renewal options',maxMessages:5})
    const rule=await h.cmd('renewal.sequence.approve',{id:preview.id,key:preview.key})
    const row=(await h.send('/api/strap/reports/renewals',undefined,h.owner)).value.rows.find(r=>r.packId===pack.id)
    const queued=await h.cmd('renewal.sequence.enroll',{packId:pack.id,sequenceId:rule.id,basis:row.basis})
    const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
    assert.ok(portable.tables.st_records.some(r=>r.kind==='memberPreferenceEvent'))
    assert.ok(portable.manifest.relationships.some(r=>r.from==='st_records.data.sourceId'&&r.to==='st_people.id'))
    const child=await h.person('ArchiveTuitionChild'),household=await h.cmd('household.save',{name:'Archived tuition family'});
    await h.cmd('household.participant.add',{id:household.id,personId:child.id});await h.cmd('household.payer.propose',{id:household.id,payerId:member.id});await h.cmd('household.payer.accept',{id:household.id},member.cookie);
    const tuition=await h.cmd('family.tuition.save',{householdId:household.id,name:'Archived tuition',service:'Mat',startsMonth:'2098-01',endsMonth:'2098-03',discountBps:1000,rows:[{personId:child.id,amountCents:10000,credits:4}],requestId:'synthetic-strap-archive-tuition'});
    const tuitionPreview=await h.cmd('family.bill.preview',{id:tuition.id,month:'2098-01',requestId:'synthetic-strap-archive-bill'});
    const tuitionBill=await h.cmd('family.bill.accept',{id:tuitionPreview.id,key:tuitionPreview.key,confirm:true},member.cookie);
    const intakeForm=await h.cmd('intake.form.publish',{title:'Archived intake',scope:'signup',required:false,questions:[{label:'Private request',required:true,sensitive:true}],requestId:'synthetic-strap-archive-intake'})
    const intakeAnswer=await h.cmd('intake.submit',{formId:intakeForm.id,answers:{q0:'Restricted original intake source'},requestId:'synthetic-strap-archive-answer'},member.cookie)
    const tabletLaunch=await h.cmd('intake.tablet.launch',{personId:member.id,formId:intakeForm.id,requestId:'synthetic-strap-archive-tablet'})

    // Private appointments and canonical booking scope travel as retained data;
    // neither a source session nor its second factor grants restored access.
    const privateMember=await h.person('ArchivePrivateMember'),privateCoach=await h.person('ArchivePrivateCoach','instructor')
    const privatePack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:privateMember.id,credits:3,amountCents:24000,expiresAt:'2099-12-31T00:00:00Z',eligibleServices:['Archived private Pilates']})).id})
    const privateScope={memberIds:[member.id,privateMember.id],locationIds:['studio'],doors:['all']}
    const privateGrantInput={personId:desk.id,role:'front-desk',enabled:true,rights:{booking:{enabled:true,scopes:[privateScope]},'member-record':{enabled:true,canCreate:true,scopes:[privateScope]}}}
    const privateGrant=await h.cmd('staff.access.grant',privateGrantInput)
    const sourceStaff=await h.signIn(desk.email);await h.enroll(sourceStaff)
    const privateSource={personId:privateMember.id,service:'Archived private Pilates',instructorId:privateCoach.id,room:'Archived private room',startDate:'2097-10-01',endDate:'2097-10-15',time:'09:00',minutes:50,channel:'phone'}
    const privateSave=await h.cmd('appointment.reservation.prepare',privateSource,sourceStaff)
    const privateSaveInput={id:privateSave.id,key:privateSave.key,channel:'phone',requestId:'synthetic-strap-archive-private-save'}
    let privateSeries=await h.cmd('appointment.reservation.confirm',privateSaveInput,sourceStaff)
    const privateIdentities=privateSeries.occurrences.map(o=>[o.id,o.bookingId,o.packId])
    const privateMove=await h.cmd('appointment.move.prepare',{reservationId:privateSeries.id,classId:privateSeries.occurrences[0].id,scope:'future',startDate:'2097-10-02',time:'09:00',channel:'phone'},sourceStaff)
    const privateMoveInput={id:privateMove.id,key:privateMove.key,channel:'phone',requestId:'synthetic-strap-archive-private-move'}
    const movedPrivateSeries=await h.cmd('appointment.change.confirm',privateMoveInput,sourceStaff)
    const privateCancel=await h.cmd('appointment.cancel.prepare',{reservationId:privateSeries.id,classId:privateSeries.occurrences[1].id,scope:'future',reason:'Travel plans',channel:'phone'},sourceStaff)
    await h.cmd('appointment.change.confirm',{id:privateCancel.id,key:privateCancel.key,channel:'phone',requestId:'synthetic-strap-archive-private-cancel'},sourceStaff)
    const releasedPrivatePack=(await h.state()).packs.find(p=>p.id===privatePack.id)
    assert.deepEqual([releasedPrivatePack.summary.remaining,releasedPrivatePack.summary.reserved,releasedPrivatePack.summary.consumed],[2,1,0])
    const privateRestore=await h.cmd('appointment.restore.prepare',{reservationId:privateSeries.id,classId:privateSeries.occurrences[1].id,scope:'future',reason:'Member can attend after all',channel:'phone'})
    const privateRestoreInput={id:privateRestore.id,key:privateRestore.key,channel:'phone',requestId:'synthetic-strap-archive-private-restore'}
    privateSeries=await h.cmd('appointment.change.confirm',privateRestoreInput)
    assert.deepEqual(privateSeries.occurrences.map(o=>[o.id,o.bookingId,o.packId]),privateIdentities)
    const privateSourceState=await h.state(),privatePackBefore=privateSourceState.packs.find(p=>p.id===privatePack.id)
    const privateLedger=state=>state.packCreditEvents.filter(e=>e.packId===privatePack.id).sort((a,b)=>a.revision-b.revision)
    const privateEvents=privateLedger(privateSourceState)
    assert.deepEqual(privateEvents.map(e=>e.revision),privateEvents.map((_,i)=>i+1),'the original funding chronology has one consecutive revision per movement')
    assert.deepEqual([privatePackBefore.summary.remaining,privatePackBefore.summary.reserved,privatePackBefore.summary.consumed],[0,3,0])
    assert.equal(privateEvents.filter(e=>e.type==='restore').reduce((sum,e)=>sum+e.credits,0),2,'both canceled sessions returned before the original allocations were reserved again')
    const privateActions=privateSourceState.staffActions.filter(a=>a.personId===privateMember.id)
    assert.ok(privateActions.some(a=>a.command==='appointment.reservation.confirm'&&a.actorRole==='front-desk'&&a.right==='booking'&&a.channel==='phone'))
    assert.ok(privateActions.some(a=>a.command==='appointment.change.confirm'&&a.action==='appointment.restore'&&a.actorRole==='owner'))
    const privateRecords=records=>records.map(r=>({id:r.id,kind:r.kind,data:JSON.parse(r.data)}))
      .filter(r=>r.data.personId===privateMember.id||r.data.appointmentReservationId===privateSeries.id||r.id===privateGrant.id||r.kind==='staffAccessEvent'&&r.data.personId===desk.id)
      .sort((a,b)=>a.id.localeCompare(b.id))
    const privateOriginals=privateRecords((await h.send('/api/strap/exit.json',undefined,h.owner)).value.tables.st_records)
    const privateMailCount=(await h.db.prepare('SELECT COUNT(*) AS n FROM st_notice_deliveries WHERE person_id=?').bind(privateMember.id).first()).n
    const retailManager=await h.person('RestoredRetailManager'),retailDesk=await h.person('RestoredRetailDesk');
    const retailWest=await h.cmd('location.save',{name:'Restored Retail West',timeZone:'America/Los_Angeles'});
    const retailSupplier=await h.cmd('retail.supplier.add',{name:'Restore supplier',reference:'synthetic-strap-restore-supplier',requestId:'restore-retail-supplier'});
    const retailSku=await h.cmd('retail.sku.add',{supplierId:retailSupplier.id,sku:'RESTORE',barcode:'synthetic-strap-restore-barcode',name:'Restore shirt',variant:'Medium',priceCents:2000,lowStock:1,requestId:'restore-retail-sku'});
    const retailStaff=[];
    for(const [person,role] of [[retailManager,'manager'],[retailDesk,'front-desk']]) {
      const grantInput={personId:person.id,role,enabled:true,rights:Object.fromEntries(['sale','refund'].map(right=>[right,{enabled:true,scopes:[{memberIds:[member.id],locationIds:['studio',retailWest.id],doors:['all']}]}]))};
      const grant=await h.cmd('staff.access.grant',grantInput);
      const session=await h.signIn(person.email);await h.enroll(session);
      const requests=[];
      for(const locationId of ['studio',retailWest.id]) {
        const suffix=role+'-'+locationId;
        await h.cmd('retail.receive',{skuId:retailSku.id,locationId,quantity:3,reference:'synthetic-strap-restore-stock-'+suffix,requestId:'restore-stock-'+suffix});
        const issue={personId:member.id,recipientId:member.id,locationId,amountCents:6000,tender:'external',reference:'synthetic-strap-restore-gift-'+suffix,requestId:'restore-gift-'+suffix};
        const card=await h.cmd('retail.gift.issue',issue,session);
        const sale={personId:member.id,skuId:retailSku.id,locationId,quantity:1,expectedCents:2000,tender:'gift',giftCardId:card.id,reference:'synthetic-strap-restore-sale-'+suffix,requestId:'restore-sale-'+suffix};
        const sold=await h.cmd('retail.sell',sale,session);
        const ret={saleId:sold.id,quantity:1,restock:true,reason:'Retained return',requestId:'restore-return-'+suffix};
        const returned=await h.cmd('retail.return',ret,session);
        const adjust={giftCardId:card.id,amountCents:100,reason:'Retained correction',requestId:'restore-adjust-'+suffix};
        const adjusted=await h.cmd('retail.gift.adjust',adjust,session);
        const refund={giftCardId:card.id,amountCents:1000,reason:'Retained original funding refund',reference:'synthetic-strap-restore-refund-'+suffix,requestId:'restore-refund-'+suffix};
        const refunded=await h.cmd('retail.gift.refund',refund,session);
        requests.push(...[['retail.gift.issue',issue,card],['retail.sell',sale,sold],['retail.return',ret,returned],['retail.gift.adjust',adjust,adjusted],['retail.gift.refund',refund,refunded]]);
      }
      retailStaff.push({person,grantInput,grant,session,requests,actions:(await h.state()).staffActions.filter(a=>a.actorId===requests[0][2].actorId)});
    }
    const retailBefore=(await h.send('/api/strap/retail',undefined,h.owner)).value;
    const originalOwner=h.owner
    await h.close();h=null
    await archive(source,['export','--output',file]);await archive(restored,['import','--input',file,'--yes'])
    h=await harness({root:restored,owner:originalOwner});assert.equal((await h.send('/api/strap/state',undefined,originalOwner)).status,401,'native sessions never restore');const owner=await h.signIn(h.auth.OWNER_EMAIL);await setup(h,owner);await h.enroll(owner)
    assert.equal((await h.send('/api/strap/state',undefined,sourceStaff)).status,401,'the source booking staff session does not travel')
    for(const entry of retailStaff) {
      assert.equal((await h.send('/api/strap/retail',undefined,entry.session)).status,401,'retail sessions do not travel');
      const session=await h.signIn(entry.person.email);
      for(const path of ['/app/retail','/api/strap/retail'])assert.equal((await h.send(path,undefined,session)).status,403,'retained grant requires fresh MFA');
      const version=(await h.state(owner)).version;
      for(const [name,input] of entry.requests)assert.equal((await h.send('/api/strap/command',{name,input},session)).status,403);
      assert.equal((await h.state(owner)).version,version);
      await h.enroll(session);
      assert.deepEqual((await h.state(owner)).staffAccessGrants.find(g=>g.id===entry.grant.id),entry.grant);
      for(const [name,input,result] of entry.requests)assert.deepEqual(await h.cmd(name,input,session),result,'retained request identity has no second effect');
      assert.deepEqual((await h.send('/api/strap/retail',undefined,owner)).value,retailBefore,'original stock, tender, gift and return amounts survive exactly');
      assert.deepEqual((await h.state(owner)).staffActions.filter(a=>a.actorId===entry.requests[0][2].actorId),entry.actions);
      await h.cmd('staff.access.grant',{...entry.grantInput,rights:{sale:{enabled:true,scopes:[{memberIds:[member.id],locationIds:['studio'],doors:['all']}]}}},owner);
      const revokedVersion=(await h.state(owner)).version;
      for(const [name,input] of entry.requests.filter(([name,input])=>!['retail.gift.issue','retail.sell'].includes(name)||input.locationId===retailWest.id))assert.equal((await h.send('/api/strap/command',{name,input},session)).status,403,'current refund and location revocation fences restored replay');
      assert.equal((await h.state(owner)).version,revokedVersion);
      assert.deepEqual((await h.send('/api/strap/retail',undefined,session)).value.retailLocations.map(l=>l.id),['studio']);
    }
    console.log('PROBE STAFF-001 native restore: manager and front desk at two locations retain original retail records, grants and audit; source sessions fail, fresh MFA is required and revoked restored replay changes nothing.');
    const privateRestoredState=await h.state(owner)
    assert.deepEqual(privateRecords((await h.send('/api/strap/exit.json',undefined,owner)).value.tables.st_records),privateOriginals,'native restore keeps private classes, bookings, previews, original funding movements, notices, canonical grants and actions')
    assert.deepEqual(privateRestoredState.staffAccessGrants.find(g=>g.id===privateGrant.id),privateGrant)
    assert.deepEqual(privateRestoredState.appointments.find(r=>r.id===privateSeries.id).occurrences.map(o=>[o.id,o.bookingId,o.packId]),privateIdentities)
    assert.deepEqual(privateRestoredState.packs.find(p=>p.id===privatePack.id),privatePackBefore)
    assert.deepEqual(privateLedger(privateRestoredState),privateEvents)
    const privateVersion=privateRestoredState.version
    assert.deepEqual(await h.cmd('appointment.change.confirm',privateRestoreInput,owner),privateSeries,'fresh owner MFA can replay the exact source restoration without a second allocation')
    assert.equal((await h.state(owner)).version,privateVersion,'committed restoration replay adds no change, audit or notice')
    const original=await h.send('/api/strap/preferences.json?personId='+member.id,undefined,owner)
    assert.equal(original.status,200);assert.deepEqual(original.value.preference,preference);assert.equal(original.value.history[0].source,'signed-in-member')
    const history=(await h.send('/api/strap/member-history?personId='+member.id,undefined,owner)).value
    assert.ok(history.merges.some(m=>m.id===merged.id));assert.ok(history.timeline.some(e=>e.record.text==='Original duplicate source message'))
    for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled({cron:'* * * * *'})
    const state=await h.state(owner)
    assert.deepEqual(state.familyTuition.invoices.find(r=>r.id===tuitionBill.id),tuitionBill,'native restore preserves exact payer consent and participant allocations without another bill');
    assert.equal(state.charges.filter(c=>c.familyInvoiceId===tuitionBill.id).length,1);
    assert.deepEqual(state.intake.responses.find(r=>r.id===intakeAnswer.id),intakeAnswer,'native restore preserves exact form version, restricted answer and original provenance')
    assert.equal((await h.send(tabletLaunch.url)).status,410,'archive carries launch history without any tablet credential authority')
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM st_intake_tablets').first()).n,0)
    assert.equal(state.marketingMessages.find(m=>m.id===queued.id).status,'queued','restore and cron never automatically execute native marketing')
    assert.equal(state.memberMessages.length,0,'owner state does not expose a member-only conversation projection')
    const staff=await h.signIn(desk.email)
    assert.equal((await h.send('/api/strap/state',undefined,staff)).status,403,'restored front desk must enroll a fresh second factor before opening records')
    const heldPrivateReplay=await h.send('/api/strap/command',{name:'appointment.change.confirm',input:privateMoveInput},staff)
    assert.equal(heldPrivateReplay.status,403,'the archived booking grant cannot replace fresh staff MFA even for replay')
    assert.equal((await h.state(owner)).version,state.version,'the MFA refusal does not change studio records')
    assert.equal((await h.send('/api/strap/command',{name:'member.record.create',input:{name:'Refused',email:'refused@studio.example',requestId:'synthetic-strap-restored'}},staff)).status,403)
    assert.equal((await h.send('/auth/invite',{email:'refused@studio.example'},staff)).status,403,'generic native invitation remains closed after restore')
    await h.enroll(staff)
    assert.equal((await h.state(staff)).appointments.find(r=>r.id===privateSeries.id).id,privateSeries.id,'fresh enrollment opens only the retained booking scope')
    const beforePrivateReplay=await h.state(owner)
    assert.deepEqual(await h.cmd('appointment.change.confirm',privateMoveInput,staff),movedPrivateSeries,'the original staff identity reuses its retained reviewed move result')
    assert.equal((await h.state(owner)).version,beforePrivateReplay.version)
    assert.deepEqual((await h.state(owner)).staffActions.filter(a=>a.personId===privateMember.id),privateActions)
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM st_notice_deliveries WHERE person_id=?').bind(privateMember.id).first()).n,privateMailCount,'native restore and both replays reserve no duplicate outbound notice')
    const pendingPrivateMove=await h.cmd('appointment.move.prepare',{reservationId:privateSeries.id,classId:privateSeries.occurrences[0].id,scope:'this',startDate:'2097-10-03',time:'09:00',channel:'phone'},staff)
    await h.cmd('staff.access.grant',{...privateGrantInput,rights:{...privateGrantInput.rights,booking:{...privateGrantInput.rights.booking,enabled:false}}},owner)
    const revokedPrivateState=await h.state(owner)
    for(const input of [{id:pendingPrivateMove.id,key:pendingPrivateMove.key,channel:'phone'},privateMoveInput,privateSaveInput]) {
      const name=input===privateSaveInput?'appointment.reservation.confirm':'appointment.change.confirm'
      assert.equal((await h.send('/api/strap/command',{name,input},staff)).status,403,'revoked booking authority refuses the next approval and old committed requests')
      assert.equal((await h.state(owner)).version,revokedPrivateState.version)
    }
    assert.deepEqual((await h.state(staff)).appointments,[],'member-record scope alone cannot expose private bookings after booking revocation')
    assert.deepEqual(privateLedger(await h.state(owner)),privateEvents)
  } finally {if(h)await h.close();await rm(temp,{recursive:true,force:true})}
})
