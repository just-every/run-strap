import { seedAutomationArchive, assertRestoredAutomation } from './automation-archive.mjs';
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { harness } from './harness.mjs'
import {seedPrivacyArchive,erasePrivacyArchive,assertPrivacyArchive,assertPrivacyRestored} from './privacy-archive.mjs'
import { softwarePasskey, totp } from './mfa-helpers.mjs'
import { reconstructExit } from './exit-receiver.mjs'
import { acceptance, billingEdge, billingSucceeded } from './billing-sandbox.mjs'
import { paymentEdge, paymentAuth, signedEvent, billingView } from './payment-fixtures.mjs';
import { copyPost, evidenceCopyMailEdge } from './evidence-copy-journey.mjs'
import { taxEdge } from './tax-edge.mjs'
import { seedTaxArchive, assertPortableTax, assertRestoredTax } from './tax-archive.mjs'
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
// Read the public bundle as an independent receiver: every typed receipt has
// exact machine-readable evidence and an inert readable copy with verified bytes.
function assertWaiverDocuments(bundle,packages) {
  const records=bundle.tables.st_records.filter(row=>row.kind==='acknowledgement').map(row=>JSON.parse(row.data)).filter(receipt=>receipt.signature?.method==='typed-affirmation');
  const files=bundle.manifest.documents.typedAffirmationFiles;
  assert.equal(files.length,records.length*2);
  assert.deepEqual(Object.keys(bundle.files).sort(),[...files,...bundle.manifest.documents.membershipAgreementFiles].map(file=>file.path).sort());
  for(const file of files) {
    assert.ok(file.path.startsWith('./documents/waivers/'),'artifact paths are explicit relative file paths');
    const content=bundle.files[file.path],bytes=Buffer.from(content,'utf8'),receipt=records.find(record=>record.id===file.receiptId);
    assert.ok(receipt,'document artifact resolves to its original receipt');
    assert.equal(file.documentId,receipt.waiverId);assert.equal(file.personId,receipt.personId);assert.equal(file.signerPersonId,receipt.signature.signerPersonId);
    assert.equal(file.bytes,bytes.length);assert.equal(file.sha256,createHash('sha256').update(bytes).digest('hex'));
  }
  for(const evidence of packages) {
    const copies=files.filter(file=>file.receiptId===evidence.receipt.id);
    const machine=copies.find(file=>file.mediaType==='application/json'),readable=copies.find(file=>file.mediaType==='text/html');
    assert.ok(machine);assert.ok(readable);assert.deepEqual(JSON.parse(bundle.files[machine.path]),evidence);
    const html=bundle.files[readable.path],escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    for(const value of [evidence.document.text,evidence.document.id,evidence.document.version,evidence.document.sha256,evidence.receipt.id,evidence.receipt.personId,evidence.receipt.actorId,evidence.receipt.at,evidence.receipt.validUntil,evidence.receipt.signature.signerName,evidence.receipt.signature.participantName,evidence.receipt.signature.signerPersonId,evidence.receipt.signature.affirmationText,evidence.receipt.signature.channel,evidence.meaning]) if(value!==undefined && value!==null) assert.ok(html.includes(escape(value)),'readable copy retains exact evidence value');
    for(const value of [evidence.receipt.signature.authority,evidence.receipt.signature.deviceContext])assert.ok(html.includes(escape(JSON.stringify(value,null,2))),'authority and device context remain complete');
    assert.ok(!/<script\b|<iframe\b|<form\b|<link\b|\s(?:src|href|onclick)=/i.test(html),'download is self-contained and inert, including document text');
    assert.ok(!html.includes(evidence.document.text),'document markup is escaped, never executed');
  }
}
function assertAgreementDocuments(bundle,evidence) {
  const inventory=bundle.manifest.documents.membershipAgreementFiles,records=bundle.tables.st_records.map(row=>({kind:row.kind,data:JSON.parse(row.data)}));
  assert.equal(inventory.length,records.filter(row=>row.kind==='billingAgreement'&&row.data.signature?.method==='typed-affirmation').length*2);
  for(const file of inventory) {
    const agreement=records.find(row=>row.kind==='billingAgreement'&&row.data.id===file.agreementId)?.data,mandate=records.find(row=>row.kind==='paymentMandate'&&row.data.id===file.mandateId)?.data;
    assert.ok(file.path.startsWith('./documents/membership-agreements/'));assert.ok(agreement);assert.ok(mandate);
    assert.equal(file.termsId,agreement.termsId);assert.equal(file.personId,agreement.personId);assert.equal(file.signerPersonId,agreement.signature.signerPersonId);assert.equal(file.sellingStaffId,agreement.sellingStaffId);assert.equal(mandate.agreementId,agreement.id);
    const bytes=Buffer.from(bundle.files[file.path],'utf8');assert.equal(file.bytes,bytes.length);assert.equal(file.sha256,createHash('sha256').update(bytes).digest('hex'));
  }
  const copies=inventory.filter(file=>file.agreementId===evidence.agreement.id),json=copies.find(file=>file.mediaType==='application/json'),html=copies.find(file=>file.mediaType==='text/html');
  assert.ok(json);assert.ok(html);assert.deepEqual(JSON.parse(bundle.files[json.path]),evidence);
  const copy=bundle.files[html.path],escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  for(const value of [evidence.agreement.documentText,evidence.agreement.documentHash,evidence.agreement.documentVersion,evidence.agreement.originalAgreementHash,evidence.agreement.signedAt])assert.ok(copy.includes(escape(value)));
  for(const value of [evidence.agreement.signature,evidence.agreement.financialTerms,evidence.mandate])assert.ok(copy.includes(escape(JSON.stringify(value,null,2))),'agreement copy retains exact personal signature and separate payment permission');
  assert.ok(!/<script\b|<iframe\b|<form\b|<link\b|\s(?:src|href|onclick)=/i.test(copy),'membership document markup is inert and self-contained');
  assert.ok(!copy.includes(evidence.agreement.documentText));
  return {json:bundle.files[json.path],html:copy};
}
async function archiveMembership(h,member,terms,edge) {
    const membership=await h.cmd('billing.agreement.prepare',{termsId:terms.id,title:'Archived membership agreement',documentText:'Original agreed studio service.\n<agreement source="synthetic-strap-1">Care & separate consent.</agreement><script>throw new Error("synthetic agreement")</script>',adultVerified:true,adultEvidenceReference:'synthetic-strap-archive-adult-eligibility',requestId:'synthetic-strap-archive-billing-agreement'});
    await h.cmd('billing.agreement.accept',acceptance(membership,member.name),member.cookie);
    // Only the paid network edge is simulated; no collection or real provider completion is claimed.
    await billingSucceeded(h,'billing.connect',{accountId:'synthetic-strap-10',mode:'test',confirm:true,requestId:'synthetic-strap-archive-billing-connect'});
    const methodSetup=await billingSucceeded(h,'billing.setup.start',{id:membership.id,requestId:'synthetic-strap-archive-billing-setup'},member.cookie);
    edge.setComplete(true);
    let methodInput={id:membership.id,setupId:methodSetup.result.id,requestId:'synthetic-strap-archive-billing-complete'};
    let methodResult=await billingSucceeded(h,'billing.setup.complete',methodInput,member.cookie);
    const originalMethod=methodResult.result;
    const replacement=await billingSucceeded(h,'billing.setup.start',{id:membership.id,replaceMethodId:originalMethod.id,confirmReplacement:true,requestId:'synthetic-strap-archive-billing-replace'},member.cookie);
    edge.setCard('5556');
    methodInput={id:membership.id,setupId:replacement.result.id,requestId:'synthetic-strap-archive-billing-replaced'};
    methodResult=await billingSucceeded(h,'billing.setup.complete',methodInput,member.cookie);
    edge.setCard('4242');
    assert.equal(methodResult.result.replacesMethodId,originalMethod.id);assert.equal(methodResult.result.last4,'5556');
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM st_payment_connections').first()).count,1);
    const membershipBefore=await h.send('/api/strap/billing/agreement.json?id='+membership.id,undefined,member.cookie),membershipHtmlBefore=await h.send('/api/strap/billing/agreement.html?id='+membership.id,undefined,member.cookie);
    assert.equal(membershipBefore.status,200);assert.equal(membershipHtmlBefore.status,200);
    const connectedBilling=(await h.send('/api/strap/billing',undefined,member.cookie)).value;
    assert.equal(connectedBilling.methods.find(method=>method.id===methodResult.result.id).available,true);
    assert.equal(connectedBilling.methods.find(method=>method.id===originalMethod.id).status,'superseded');
    assert.deepEqual(connectedBilling.methods.filter(method=>method.available).map(method=>method.last4),['5556']);
    return {membership,methodInput,methodResult,membershipBefore,membershipHtmlBefore,methodHistory:connectedBilling.methods.map(({available,...method})=>method).sort((a,b)=>a.id.localeCompare(b.id))};
}
async function archiveCopyTablet(h,owner,waiver,suffix) {
  const person=await h.cmd('member.record.create',{name:'Archive copy '+suffix,email:'synthetic-strap-copy-'+suffix.toLowerCase()+'@studio.example',channel:'desk',requestId:'synthetic-strap-archive-copy-person-'+suffix},owner)
  const launch=await h.cmd('waiver.tablet.launch',{personId:person.id,waiverId:waiver.id,locationId:'studio',channel:'desk',requestId:'synthetic-strap-archive-copy-tablet-'+suffix},owner)
  const paired=await copyPost(h,'/intake/tablet/start',{token:new URL(launch.url,h.origin).searchParams.get('token')})
  assert.equal(paired.status,303)
  return {person,cookie:paired.headers.get('set-cookie').split(';')[0],fields:{signerName:person.name,confirm:'yes',adultConfirmed:'yes',emailCopy:'yes'}}
}
const integrationKey = async h => (await (await h.mf.dispatchFetch(h.origin + '/app/action?name=integration.create&returnTo=%2Fapp%2Fintegrations', { method: 'POST', redirect: 'manual', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ label: 'Excluded integration', 'sc_roster:read': 'true', 'sc_attendance:read': 'true', location: 'studio', 'ev_booking.changed': 'true', 'ev_attendance.changed': 'true' }).toString() })).text()).match(/<p class="token">(strap_int_[0-9a-f]{64})<\/p>/)[1]
const integrationRead = (h, token, resource = 'roster') => h.mf.dispatchFetch(h.origin + '/api/strap/integration/' + resource, { headers: { host: new URL(h.origin).host, authorization: `Bearer ${token}`, 'strap-schema-version': '1' } })
test('MOVE-011 / ARCHIVE-001 / SCHED-001 / SCHED-014 / SCHED-005 / APP-003 / API-002 / API-003 / RPT-007: portable exit reconstruction and public CLI archive round trip refuses damaged or populated stores and respects erasure, including a member’s emergency contact and its history', { timeout: 240_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(),'strap-archive-')), source=join(temporary,'source'), restored=join(temporary,'restored'), erased=join(temporary,'erased')
  let h
  const paymentEdge=billingEdge(),copyEdge=evidenceCopyMailEdge(),taxProvider=taxEdge(),billingAuth={STRIPE_BILLING_TEST_KEY:'synthetic-strap-999',STRIPE_TAX_TEST_KEY:'synthetic-strap-998'};
  const outbound=request=>{const origin=new URL(request.url).origin;assert.ok(['https://api.sendgrid.com','https://api.stripe.com'].includes(origin),'only the mail and billing provider edges are simulated');return origin==='https://api.sendgrid.com' ? copyEdge.outbound(request) : new URL(request.url).pathname.startsWith('/v1/tax/') ? taxProvider.outbound(request) : paymentEdge.outbound(request)}
  try {
    for (const path of [source,restored,erased]) await checkout(path)
    await exec(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'], { cwd:source, env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}, maxBuffer:2e6 })
    h=await harness({root:source,auth:billingAuth,outbound})
    assert.equal((await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})).status,303)
    const p=await h.cmd('person.save',{name:'Temporary joiner',email:'temporary@venue.example',role:'member',active:false})
    // APP-003: a staff-entered emergency contact is the third party's personal data and follows the member.
    const contactInput={personId:p.id,phone:'(212) 555-0144',emergencyName:'Rita Joiner',emergencyPhone:'212-555-0188',emergencyRelationship:'Mother',channel:'phone',revision:0,requestId:'archive-profile'}
    const contact=await h.cmd('profile.save.staff',contactInput)
    assert.deepEqual(contact.emergencyContact,{name:'Rita Joiner',phone:'2125550188',relationship:'Mother'})
    const contactReceipt='/api/strap/profile-save?command=profile.save.staff&personId='+p.id+'&requestId='+contactInput.requestId
    assert.equal((await h.send(contactReceipt,undefined,h.owner)).value.status,'saved','staff can verify a committed save for an inactive profile')
    const member = await h.person('Maya'), coach = await h.person('Priya','instructor')
    const ownProfileInput={phone:'6155550189',requestId:'synthetic-strap-portable-profile'}
    const ownProfile=await h.cmd('profile.save',ownProfileInput,member.cookie)
    const ownReceipt='/api/strap/profile-save?command=profile.save&requestId='+ownProfileInput.requestId
    assert.equal((await h.send(ownReceipt,undefined,member.cookie)).value.status,'saved')
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
    const automationProof=await seedAutomationArchive(h,member)
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
    const signedPolicy=await h.cmd('waiver.publish',{text:'Archived exact service policy and personal affirmation.\n<studio-policy source="synthetic-strap-1">Care & consent.</studio-policy><script>throw new Error("synthetic document")</script>',requiresSignature:true,service:'Evidence retention',validDays:365});
    const privacyFixture=await seedPrivacyArchive(h,signedPolicy);
    const adultEvidence=await h.cmd('waiver.acknowledge',{id:signedPolicy.id,documentHash:signedPolicy.documentHash,signerName:member.name,confirm:true},member.cookie);
    const guardianEvidence=await h.cmd('waiver.acknowledge',{id:signedPolicy.id,documentHash:signedPolicy.documentHash,signerName:signingGuardian.name,participantId:signingFamily.participantIds[0],confirm:true},signingGuardian.cookie);
    const signedBefore=await h.send('/api/strap/waiver-evidence.json?id='+adultEvidence.id,undefined,member.cookie);
    const guardianBefore=await h.send('/api/strap/waiver-evidence.json?id='+guardianEvidence.id,undefined,h.owner);
    Object.assign(privacyFixture,{guardian:signingGuardian,guardianEvidence,guardianDocument:signedPolicy,guardianChildId:signingFamily.participantIds[0]});
    await h.cmd('household.guardian.remove',{id:signingFamily.id,guardianId:signingGuardian.id,reason:'Authority ended before archive'});
    const billingPack=(await h.state()).packs.find(pack=>pack.personId===member.id);
    const billingPreview=await h.cmd('plan.recurring.prepare',{packId:billingPack.id,intervalMonths:1,requestId:'synthetic-strap-archive-billing-terms'});
    const billingTerms=await h.cmd('plan.recurring.accept',{id:billingPreview.id,key:billingPreview.key},member.cookie);
    const {membership,membershipBefore,membershipHtmlBefore}=await archiveMembership(h,member,billingTerms,paymentEdge);
    for(const extension of ['json','html'])assert.equal((await h.send('/api/strap/billing/agreement.'+extension+'?id='+membership.id,undefined,introAlias.cookie)).status,404,'another member cannot download a membership agreement');
    // Installation-local provider authority is a credential edge, never portable studio data.
    const taxProof=await seedTaxArchive(h);
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM st_tax_connections').first()).count,1);
    const originalMail={MAIL_PROVIDER:h.auth.MAIL_PROVIDER,MAIL_FROM:h.auth.MAIL_FROM},copyMail={MAIL_PROVIDER:'sendgrid',MAIL_FROM:'copies@studio.example',MAIL_API_KEY:'synthetic-strap-1'}
    await h.setAuth(copyMail)
    await h.cmd('waiver.copy.mail.review',{confirm:true})
    const copyTablet=await archiveCopyTablet(h,h.owner,signedPolicy,'Source')
    const requestedCopy=await copyPost(h,'/intake/tablet',copyTablet.fields,copyTablet.cookie)
    assert.equal(requestedCopy.status,200);assert.match(await requestedCopy.text(),/submitted for delivery/);assert.equal(copyEdge.calls.length,1)
    const copyLink=new URL(copyEdge.linkFor(copyTablet.person.email)),copyPath=copyLink.pathname+copyLink.search,copyToken=copyLink.searchParams.get('token')
    assert.equal((await h.send(copyPath)).status,200,'the issued capability is live and unused before native export')
    const copyRecord=await h.db.prepare('SELECT * FROM st_evidence_copies WHERE person_id=?').bind(copyTablet.person.id).first(),copyReview=await h.db.prepare('SELECT * FROM st_evidence_copy_mail').first()
    assert.equal(copyRecord.delivery_status,'accepted');assert.equal(copyRecord.consumed_at,null);assert.ok(copyReview.connection_id)
    const copyEvidenceBefore=await h.send('/api/strap/waiver-evidence.json?id='+copyRecord.receipt_id,undefined,h.owner),copyHtmlBefore=await h.send('/api/strap/waiver-evidence.html?id='+copyRecord.receipt_id,undefined,h.owner)
    assert.equal(copyEvidenceBefore.status,200);assert.equal(copyHtmlBefore.status,200)
    Object.assign(privacyFixture,{retained:copyTablet.person,retainedEvidence:copyEvidenceBefore.value,copyToken})
    const download=await h.send('/api/strap/exit.json',undefined,h.owner)
    assert.equal(download.status,200)
    assert.equal(download.headers.get('content-disposition'),'attachment; filename="strap-exit.json"')
    assert.equal(download.headers.get('cache-control'),'no-store')
    const portable=download.value
    assert.ok(!('st_tax_connections' in portable.tables));assert.ok(!download.text.includes(billingAuth.STRIPE_TAX_TEST_KEY),'portable exit excludes the configured tax provider credential');
    assertPortableTax(portable,taxProof);
    reconstructExit(portable,[csv,privacyFixture.csv],taxProof,privacyFixture.sharedCourse)
    assertWaiverDocuments(portable,[signedBefore.value,guardianBefore.value,copyEvidenceBefore.value]);
    for(const table of ['st_evidence_copies','st_evidence_copy_mail'])assert.ok(!(table in portable.tables),'portable exit excludes initialized personal-copy credentials and mail review')
    for(const credential of [copyToken,copyRecord.token_hash,copyReview.connection_id])assert.ok(!download.text.includes(credential),'portable exit omits personal-copy authority')
    const membershipCopies=assertAgreementDocuments(portable,membershipBefore.value);
    assert.equal(membershipCopies.html,membershipHtmlBefore.text);
    assert.ok(!('st_payment_connections' in portable.tables));assert.ok(!download.text.includes(billingAuth.STRIPE_BILLING_TEST_KEY));
    const adultCopy=portable.manifest.documents.typedAffirmationFiles.find(file=>file.receiptId===adultEvidence.id&&file.mediaType==='text/html');
    const guardianCopy=portable.manifest.documents.typedAffirmationFiles.find(file=>file.receiptId===guardianEvidence.id&&file.mediaType==='text/html');
    const adultHtmlBefore=await h.send('/api/strap/waiver-evidence.html?id='+adultEvidence.id,undefined,member.cookie);
    assert.equal(adultHtmlBefore.status,200);assert.match(adultHtmlBefore.headers.get('content-disposition'),/attachment/);assert.equal(adultHtmlBefore.text,portable.files[adultCopy.path]);
    const guardianHtmlBefore=await h.send('/api/strap/waiver-evidence.html?id='+guardianEvidence.id,undefined,h.owner);
    assert.equal(guardianHtmlBefore.status,200);assert.equal(guardianHtmlBefore.text,portable.files[guardianCopy.path]);
    assert.equal((await h.send('/api/strap/waiver-evidence.html?id='+guardianEvidence.id,undefined,signingGuardian.cookie)).status,404,'ended guardians cannot download historical human-readable copies');
    for(const value of [key.token,integration.token,'Excluded integration',h.auth.SESSION_SECRET,h.auth.SETUP_TOKEN,h.owner,...(h.mfaOwner ? [h.mfaOwner.secret,h.mfaOwner.recoveryCodes[0]] : [])]) assert.ok(!download.text.includes(value))
    assert.ok(Object.keys(portable.tables).every(name=>!name.startsWith('oa_')&&!name.includes('outbox')&&!name.includes('agent_keys')&&!name.includes('integration')),'API-002 integration keys stay out of the portable exit')
    if(process.env.STRAP_PROOF_DIR) await (await import('./exit-browser.mjs')).exitBrowser(h,portable)
    const identity={auth:h.auth,owner:h.owner,factor:h.mfaOwner,outbound};
    await h.close();h=null
    const old=join(temporary,'before.rer'),later=join(temporary,'later.rer'),again=join(temporary,'again.rer')
    await command(source,['export','--output',old,'--no-queue'])
    const bytes=await readFile(old,'utf8');assert.ok(bytes.includes('Temporary joiner'));assert.ok(bytes.includes('Rita Joiner'),'APP-003 the emergency contact and its history travel in the native archive');assert.ok(!bytes.includes('Excluded secret'));assert.ok(!bytes.includes('token_hash'));assert.ok(!bytes.includes('Excluded integration'),'API-002 integration keys never travel in the native archive')
    for (const value of [identity.factor.secret,...identity.factor.recoveryCodes,...factorMaterial]) assert.ok(!bytes.includes(value),'native archive excludes factor secrets and recovery codes')
    assert.ok(!bytes.includes(billingAuth.STRIPE_TAX_TEST_KEY),'native archive excludes the tax provider credential');
    assert.ok(!bytes.includes(billingAuth.STRIPE_BILLING_TEST_KEY),'native archive excludes billing provider credentials');
    const archived = bytes.split('\n').filter(Boolean).map(JSON.parse)
    for(const table of ['st_evidence_copies','st_evidence_copy_mail']) {
      assert.ok(!archived.find(row=>row.kind==='manifest').tables.some(entry=>entry.name===table),'native archive inventory excludes initialized personal-copy authority')
      assert.ok(!archived.filter(row=>row.kind==='part').flatMap(row=>row.items).some(row=>row.kind==='row'&&row.table===table),'native archive payload excludes initialized personal-copy authority')
    }
    for(const credential of [copyToken,copyRecord.token_hash,copyReview.connection_id])assert.ok(!bytes.includes(credential),'native archive contains no issued personal-copy credential or review binding')
    assert.ok(!archived.find(row=>row.kind==='manifest').tables.some(table=>table.name==='st_payment_connections'),'native archive inventory excludes payment execution authority');
    assert.ok(!archived.filter(row=>row.kind==='part').flatMap(row=>row.items).some(row=>row.kind==='row'&&row.table==='st_payment_connections'),'native archive payload excludes payment connections');
    assert.ok(!archived.find(row=>row.kind==='manifest').tables.some(table=>table.name==='st_tax_connections'),'native archive inventory excludes tax execution authority');
    assert.ok(!archived.filter(row=>row.kind==='part').flatMap(row=>row.items).some(row=>row.kind==='row'&&row.table==='st_tax_connections'),'native archive payload excludes the tax connection table');
    assert.ok(!archived.find(r=>r.kind==='manifest').tables.some(t=>t.name.startsWith('st_mfa_')),'native archive inventory excludes all factor, passkey, recovery and challenge tables')
    assert.ok(!archived.filter(r=>r.kind==='part').flatMap(r=>r.items).some(r=>r.kind==='row' && r.table.startsWith('st_mfa_')),'native archive payload excludes all factor tables')
    await command(restored,['import','--input',old,'--yes','--no-queue'])
    await command(restored,['export','--output',again,'--no-queue'])
    const rows=text=>text.split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='part')
    assert.ok(rows(bytes).length>0);assert.deepEqual(rows(await readFile(again,'utf8')),rows(bytes))
    // Recover access through native sign-in; the old session never travels.
    h=await harness({root:restored,...identity})
    for(const table of ['st_evidence_copies','st_evidence_copy_mail'])assert.equal((await h.db.prepare('SELECT count(*) AS count FROM '+table).first()).count,0,'native restore leaves personal-copy credentials and review empty')
    assert.equal((await h.send(copyPath)).status,410,'the source capability cannot open a confirmation on the restored installation')
    assert.equal((await copyPost(h,'/evidence/copy',{token:copyToken})).status,410,'the source capability cannot download retained evidence after restore')
    assert.equal(copyEdge.calls.length,1,'export, import and refused old capabilities send no copy mail')
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM st_payment_connections').first()).count,0,'native restore leaves stored methods disconnected');
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM st_tax_connections').first()).count,0,'native restore cannot reactivate excluded tax execution authority');
    assert.equal((await h.send('/api/strap/exit.json',undefined,identity.owner)).status,401)
    const restoredOwner=await h.signIn(h.auth.OWNER_EMAIL)
    assert.equal((await h.send('/api/strap/exit.json',undefined,restoredOwner)).value.error,'mfa_enrollment_required','SEC-004 second factors never restore: the owner enrolls again before any export')
    await h.enroll(restoredOwner)
    assert.equal((await h.send(contactReceipt,undefined,restoredOwner)).value.status,'saved','the restored owner verifies the retained source receipt after fresh authentication')
    assert.deepEqual(await h.cmd('profile.save.staff',contactInput,restoredOwner),contact,'a restored staff retry keeps the original result')
    assert.equal((await integrationRead(h,integration.token)).status,401,'API-002 a restored studio refuses the old integration secret')
    assert.equal((await integrationRead(h,integration.token,'attendance')).status,401,'API-002 restored attendance scope is refused too')
    assert.deepEqual((await h.state(restoredOwner)).integrations,[],'API-002 integration keys never restore')
    const restoredDownload=await h.send('/api/strap/exit.json',undefined,restoredOwner)
    assert.equal(restoredDownload.status,200)
    assert.deepEqual(restoredDownload.value.tables,portable.tables)
    assertPortableTax(restoredDownload.value,taxProof);
    await assertRestoredTax(h,restoredOwner,taxProof,taxProvider);
    assertWaiverDocuments(restoredDownload.value,[signedBefore.value,guardianBefore.value,copyEvidenceBefore.value]);
    const copyHtmlAfter=await h.send('/api/strap/waiver-evidence.html?id='+copyRecord.receipt_id,undefined,restoredOwner)
    assert.equal(copyHtmlAfter.status,200);assert.equal(copyHtmlAfter.text,copyHtmlBefore.text,'native restore retains the exact personal document while dropping its download capability')
    assert.deepEqual(assertAgreementDocuments(restoredDownload.value,membershipBefore.value),membershipCopies);
    assert.deepEqual(restoredDownload.value.manifest.documents.membershipAgreementFiles,portable.manifest.documents.membershipAgreementFiles);
    assert.deepEqual(restoredDownload.value.files,portable.files,'native restore reproduces the exact JSON and readable document bytes');
    assert.deepEqual(restoredDownload.value.manifest.documents.typedAffirmationFiles,portable.manifest.documents.typedAffirmationFiles,'native restore retains stable document relationships and file integrity');
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
    assert.equal((await h.send(ownReceipt,undefined,restoredMember)).value.status,'saved')
    assert.deepEqual(await h.cmd('profile.save',ownProfileInput,restoredMember),ownProfile,'member retry after restore retains the original request and result')
    assert.equal((await h.state(restoredOwner)).profileChanges.filter(c=>c.personId===member.id&&c.requestId===ownProfileInput.requestId).length,1,'restoration and retry cannot duplicate the profile change')
    assert.equal((await h.send(contactReceipt,undefined,restoredMember)).status,403,'a member cannot recover a staff receipt')
    console.log('PROBE APP-005 portability: public exit and native CLI restore -> current profile receipts recover after fresh sign-in, retries stay once-only, billing and mail require reviewed reconnection')
    const restoredMembership=await h.send('/api/strap/billing/agreement.json?id='+membership.id,undefined,restoredMember),restoredMembershipHtml=await h.send('/api/strap/billing/agreement.html?id='+membership.id,undefined,restoredMember);
    assert.equal(restoredMembership.status,200);assert.deepEqual(restoredMembership.value,membershipBefore.value);assert.equal(restoredMembershipHtml.status,200);assert.equal(restoredMembershipHtml.text,membershipHtmlBefore.text);
    for(const extension of ['json','html'])assert.equal((await h.send('/api/strap/billing/agreement.'+extension+'?id='+membership.id,undefined,introAliasCookie)).status,404,'native restore retains membership evidence privacy');
    const adultAfter=await h.send('/api/strap/waiver-evidence.json?id='+adultEvidence.id,undefined,restoredMember);
    const guardianAfter=await h.send('/api/strap/waiver-evidence.json?id='+guardianEvidence.id,undefined,restoredOwner);
    assert.equal(adultAfter.status,200);assert.deepEqual(adultAfter.value,signedBefore.value,'MEM-005 native restore retains exact adult document, declaration and attribution');
    assert.equal(guardianAfter.status,200);assert.deepEqual(guardianAfter.value,guardianBefore.value,'MEM-005 native restore retains historical guardian evidence and authority revision');
    assert.equal((await h.send('/api/strap/waiver-evidence.json?id='+guardianEvidence.id,undefined,restoredGuardian)).status,404,'MEM-005 historical guardian provenance never restores ended access');
    const adultHtmlAfter=await h.send('/api/strap/waiver-evidence.html?id='+adultEvidence.id,undefined,restoredMember),guardianHtmlAfter=await h.send('/api/strap/waiver-evidence.html?id='+guardianEvidence.id,undefined,restoredOwner);
    assert.equal(adultHtmlAfter.status,200);assert.equal(adultHtmlAfter.text,adultHtmlBefore.text,'restored member downloads the identical readable signed evidence');
    assert.equal(guardianHtmlAfter.status,200);assert.equal(guardianHtmlAfter.text,guardianHtmlBefore.text,'owner retains identical historical guardian evidence');
    assert.equal((await h.send('/api/strap/waiver-evidence.html?id='+guardianEvidence.id,undefined,restoredGuardian)).status,404,'native restore cannot revive historical guardian HTML-download access');
    reconstructExit(restoredDownload.value,[csv,privacyFixture.csv],taxProof,privacyFixture.sharedCourse)
    const recoveredRenewals=(await h.send('/api/strap/reports/renewals?lowCredits=10000',undefined,restoredOwner)).value
    assert.equal(recoveredRenewals.rows.find(r=>r.packId===renewalRow.packId).followup.leadId,renewalTask.leadId,'RPT-007 native restore retains the pack/task relationship')
    assert.deepEqual(await h.cmd('renewal.followup.create',renewalInput,restoredOwner),renewalTask,'RPT-007 native restore reuses the once-only task')
    assert.equal((await h.state(restoredOwner)).pipeline.leads.filter(l=>l.id===renewalTask.leadId).length,1)
    await assertRestoredAutomation(h,restoredOwner,automationProof)
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
    assert.deepEqual(restoredState.noticeDeliveries.filter(d=>d.sourceKind!=='confirmation').map(d=>[d.sourceKind,d.personId,d.status]),[['booking_action',introMember.id,'not_configured'],['booking_action',member.id,'not_configured'],['booking_action',member.id,'paused'],['booking_action',member.id,'paused'],['booking',lee.id,'paused']], 'series changes, cancellation and promotion email stay paused after restore')
    assert.match((await h.state(lee.cookie)).notices.map(n=>n.subject).join(),/You're booked: Restored Reformer/)
    await h.setAuth(originalMail)
    await h.cmd('mail.connect',{},restoredOwner)
    assert.doesNotMatch((await h.send('/app/studio',undefined,restoredOwner)).text,/Member email paused/)
    const closing=await h.cmd('closure.prepare',{scope:'class',classId:seat.id,reason:'Restored test'},restoredOwner)
    await h.cmd('closure.confirm',{id:closing.id,impact:closing.impact.key},restoredOwner)
    restoredState=await h.state(restoredOwner)
    assert.deepEqual(restoredState.noticeDeliveries.filter(d=>d.sourceKind!=='confirmation').map(d=>d.status),['not_configured','not_configured','paused','paused','paused','not_configured'])
    await h.setAuth(copyMail)
    const freshCopy=await archiveCopyTablet(h,restoredOwner,signedPolicy,'Restored'),beforeCopy=(await h.state(restoredOwner)).version
    assert.ok(!(await h.send('/intake/tablet',undefined,freshCopy.cookie)).text.includes('name="emailCopy"'),'reconnected ordinary mail does not restore personal-copy review')
    assert.equal((await copyPost(h,'/intake/tablet',freshCopy.fields,freshCopy.cookie)).status,409,'a fresh personal completion cannot dispatch before separate restored-owner review')
    assert.equal((await h.state(restoredOwner)).version,beforeCopy);assert.equal(copyEdge.calls.length,1)
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM st_evidence_copies').first()).count,0)
    await h.cmd('waiver.copy.mail.review',{confirm:true},restoredOwner)
    const freshRequest=await copyPost(h,'/intake/tablet',freshCopy.fields,freshCopy.cookie)
    assert.equal(freshRequest.status,200);assert.match(await freshRequest.text(),/submitted for delivery/);assert.equal(copyEdge.calls.length,2,'only a newly reviewed request dispatches a fresh copy')
    const freshToken=new URL(copyEdge.linkFor(freshCopy.person.email)).searchParams.get('token'),freshReceipt=(await h.state(restoredOwner)).acknowledgements.find(row=>row.personId===freshCopy.person.id)
    assert.notEqual(freshToken,copyToken)
    const freshOriginal=await h.send('/api/strap/waiver-evidence.html?id='+freshReceipt.id,undefined,restoredOwner),freshDownload=await copyPost(h,'/evidence/copy',{token:freshToken})
    assert.equal(freshOriginal.status,200);assert.equal(freshDownload.status,200);assert.equal(await freshDownload.text(),freshOriginal.text)
    assert.equal((await h.send(copyPath)).status,410,'fresh review never revives the old source credential')
    assert.equal((await copyPost(h,'/evidence/copy',{token:copyToken})).status,410)
    await h.close();h=null
    await command(restored,['import','--input',old,'--yes','--no-queue'],4)
    const corrupt=join(temporary,'corrupt.rer');await writeFile(corrupt,bytes.replace('Temporary joiner','Changed joiner'),{mode:0o600})
    // Checksum damage is a transfer failure (1); restore policy conflicts remain 4.
    await command(erased,['import','--input',corrupt,'--yes','--no-queue'],1)
    h=await harness({root:source,...identity});const eraser=await h.signIn(h.auth.OWNER_EMAIL);await h.cmd('mfa.verify',{code:totp(identity.factor.secret,1)},eraser);await h.cmd('person.erase',{id:p.id,revision:1},eraser);await erasePrivacyArchive(h,eraser,privacyFixture);assert.equal((await h.send(copyPath)).status,410);assert.equal((await copyPost(h,'/evidence/copy',{token:copyToken})).status,410);assert.equal(copyEdge.calls.length,2);await h.close();h=null
    await command(source,['export','--output',later,'--no-queue'])
    const erasedBytes=await readFile(later,'utf8')
    assertPrivacyArchive(erasedBytes,privacyFixture)
    for(const value of ['Rita Joiner','2125550188','2125550144','temporary@venue.example']) assert.ok(!erasedBytes.includes(value),`APP-003 erasure removes ${value} from the later archive`)
    // APP-003: the pre-erasure archive still holds the contact, so the later journal fences it.
    await command(erased,['import','--input',old,'--journal',later,'--yes','--no-queue'],4)
    await command(erased,['import','--input',later,'--yes','--no-queue'])
    const proxy=await getPlatformProxy({configPath:join(erased,'wrangler.jsonc'),persist:{path:join(erased,'.wrangler/state/v3')},remoteBindings:false})
    try {
      await assertPrivacyRestored(proxy.env.DB,privacyFixture)
      assert.equal((await proxy.env.DB.prepare('SELECT name FROM st_people WHERE id=?').bind(p.id).first()).name,'Erased person')
      const kept=(await proxy.env.DB.prepare("SELECT kind,data FROM st_records WHERE kind IN ('memberProfile','profileChange','memberCheckin') AND json_extract(data,'$.personId')=?").bind(p.id).all()).results
      assert.deepEqual(kept.map(r=>r.kind),['profileChange'],'APP-003 erasure deletes the current contact and the check-in phone')
      const entry=JSON.parse(kept[0].data)
      assert.deepEqual([entry.erased,entry.changed,entry.channel,entry.staffMade,'before' in entry,'after' in entry,'requestBasis' in entry],[true,['phone','emergencyContact'],'phone',true,false,false,false],'APP-003 the change keeps who acted and when; its values are erased')
    }
    finally { await proxy.dispose() }
    h=await harness({root:erased,...identity})
    const privacyOwner=await h.signIn(h.auth.OWNER_EMAIL);await h.enroll(privacyOwner)
    assert.equal((await h.send(contactReceipt,undefined,privacyOwner)).status,404,'a retained receipt cannot resurrect an erased profile after journal restore')
    const held=(await h.state(privacyOwner)).privacy.retained.find(r=>r.personId===privacyFixture.retained.id)
    assert.equal((await h.cmd('privacy.retained',{id:held.id},privacyOwner)).content.receipt.signature.signerName,privacyFixture.retained.name)
    const sharedHeld=(await h.state(privacyOwner)).privacy.retained.find(r=>r.sourceId===privacyFixture.guardianEvidence.id)
    assert.deepEqual((await h.cmd('privacy.retained',{id:sharedHeld.id},privacyOwner)).content.receipt,privacyFixture.guardianEvidence)
    assert.equal((await h.send('/api/strap/waiver-evidence.json?id='+privacyFixture.guardianEvidence.id,undefined,privacyOwner)).status,404)
    const privacyOther=await h.signIn(member.email)
    await h.cmd('privacy.retained',{id:held.id},privacyOther,403)
    await h.cmd('privacy.retained',{id:sharedHeld.id},privacyOther,403)
    await h.cmd('privacy.dispose',{id:sharedHeld.id,confirm:true},privacyOwner,409)
    await h.cmd('privacy.dispose',{id:held.id,confirm:true},privacyOwner,409)
    assert.equal((await h.send(copyPath)).status,410,'restore keeps the original copy capability retired')
    assert.equal((await copyPost(h,'/evidence/copy',{token:copyToken})).status,410)
  } finally { if(h)await h.close();await rm(temporary,{recursive:true,force:true}) }
})


// Same origin is deliberate: restored owner IDs and an unchanged hostname are
// insufficient authority to restart billing. Only the excluded live epoch is.
test('BILL-005 / MOVE-011: native restore at the same origin leaves recurring invoice authority disconnected', { timeout: 180_000 }, async () => {
  const temporary=await mkdtemp(join(tmpdir(),'strap-billing-archive-')),source=join(temporary,'source'),restored=join(temporary,'restored')
  let h
  const payments=paymentEdge(),billingAuth=paymentAuth;
  const providerEdge=payments;
  try {
    for(const path of [source,restored])await checkout(path)
    await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:2e6})
    h=await harness({root:source,auth:billingAuth,outbound:providerEdge.outbound})
    await h.confirmSetup(h.owner)
    await h.cmd('studio.save',{location:'synthetic-strap-1',timeZone:'America/New_York'})
    const member=await h.person('synthetic-strap-2')
    const dueAt=new Date(Math.ceil((Date.now()+25_000)/1000)*1000).toISOString()
    const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:12000,expiresAt:dueAt})).id})
    const proposal=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:'synthetic-strap-3'})
    const agreed=await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie)
    const {membership,methodInput,methodResult,membershipBefore,methodHistory}=await archiveMembership(h,member,agreed,providerEdge);
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

    const paidCheckout=await h.cmd('billing.checkout.start',{packId:expiryPack.id,requestId:'synthetic-strap-archive-paid',confirm:true});
    assert.equal(paidCheckout.status,'open');payments.complete(paidCheckout.providerSessionId);
    const paidEvent=payments.event(paidCheckout.providerSessionId);assert.equal((await signedEvent(h,paidEvent)).status,200);
    const pendingCheckout=await h.cmd('billing.checkout.start',{packId:deliveredPack.id,requestId:'synthetic-strap-archive-pending',confirm:true});
    const retainedPayments=await billingView(h);
    assert.equal(retainedPayments.invoices.find(i=>i.id===paidCheckout.id).status,'paid');
    const terminationReason=await h.cmd('plan.cancellation.reason.save',{code:'moved-away',label:'Moved away',active:true,revision:0})
    const terminationPack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:4,amountCents:8000,expiresAt:'2099-12-01T00:00:00Z'})).id})
    const terminationTerms=await h.cmd('plan.recurring.prepare',{packId:terminationPack.id,intervalMonths:1,requestId:'synthetic-strap-archive-terms'})
    await h.cmd('plan.recurring.accept',{id:terminationTerms.id,key:terminationTerms.key},member.cookie)
    const terminationPreview=await h.cmd('plan.cancellation.prepare',{packId:terminationPack.id,reasonCode:terminationReason.code,reason:'Member is moving away',effectiveAt:'2099-11-15T00:00:00Z',requestId:'synthetic-strap-archive-termination'})
    const termination=await h.cmd('plan.cancellation.confirm',{id:terminationPreview.id,key:terminationPreview.key,requestId:'synthetic-strap-archive-confirm'})
    const withdrawal=await h.cmd('plan.cancellation.withdraw.prepare',{id:termination.id,requestId:'synthetic-strap-archive-withdrawal'})
    const draftPack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:4,amountCents:8000,expiresAt:'2099-12-01T00:00:00Z'})).id})
    const draftTerms=await h.cmd('plan.recurring.prepare',{packId:draftPack.id,intervalMonths:1,requestId:'synthetic-strap-archive-agent-terms'})
    await h.cmd('plan.recurring.accept',{id:draftTerms.id,key:draftTerms.key},member.cookie)
    const sourceAgent=await h.cmd('agent.create',{label:'Archive termination preparation'}),agentHeaders={authorization:'Bearer '+sourceAgent.token}
    const draftResponse=await h.send('/api/strap/agent/command',{name:'plan.cancellation.prepare',input:{packId:draftPack.id,reasonCode:terminationReason.code,reason:'Member asked about moving',effectiveAt:'2099-11-15T00:00:00Z',requestId:'synthetic-strap-archive-agent-draft'}},'',agentHeaders)
    assert.equal(draftResponse.status,200,draftResponse.text);const agentDraft=draftResponse.value.result??draftResponse.value
    const immediateInput={packId:draftPack.id,timing:'immediate',reasonCode:terminationReason.code,reason:'Moving today',requestId:'synthetic-strap-archive-immediate-preview'}
    const immediateDraft=await h.cmd('plan.cancellation.prepare',immediateInput)
    const immediatePreview=await h.cmd('plan.cancellation.prepare',{...immediateInput,requestId:'synthetic-strap-archive-immediate-final'})
    const immediate=await h.cmd('plan.cancellation.confirm',{id:immediatePreview.id,key:immediatePreview.key,requestId:'synthetic-strap-archive-immediate-confirm'})
    assert.equal(immediate.status,'applied');assert.equal(immediate.effectiveAt,immediatePreview.effectiveAt)
    const retiredReason=await h.cmd('plan.cancellation.reason.save',{code:terminationReason.code,label:'Moved elsewhere',active:false,revision:terminationReason.revision})

    const before=await h.state(),sourceOrigin=h.origin,identity={auth:{...h.auth},owner:h.owner,port:Number(new URL(h.origin).port),outbound:providerEdge.outbound}
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
    assert.ok(!archived.find(r=>r.kind==='manifest').tables.some(t=>t.name==='st_payment_connections'));
    assert.ok(!archived.filter(r=>r.kind==='part').flatMap(r=>r.items).some(r=>r.kind==='row'&&r.table==='st_payment_connections'));
    await command(restored,['import','--input',archive,'--yes','--no-queue'])
    h=await harness({root:restored,...identity})
    const restoredOwner=await h.signIn(h.auth.OWNER_EMAIL)
    await h.confirmSetup(restoredOwner);await h.enroll(restoredOwner)
    // Reuse the actual listening origin, not a rewritten request URL.
    assert.equal(h.origin,sourceOrigin)
    assert.equal(h.auth.STRIPE_BILLING_TEST_KEY,billingAuth.STRIPE_BILLING_TEST_KEY,'provider key is unchanged while local payment execution authority is excluded');
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM st_payment_connections').first()).count,0);
    const state=()=>h.state(restoredOwner)
    const recoveredCancellation=(await h.state(restoredOwner)).cancellations
    assert.deepEqual(recoveredCancellation.reasonCodes.find(r=>r.code==='moved-away'),retiredReason)
    const restoredTermination=recoveredCancellation.cancellations.find(c=>c.id===termination.id)
    assert.deepEqual([restoredTermination.reasonCode,restoredTermination.reasonLabel,restoredTermination.status],['moved-away','Moved away','scheduled'])
    const restoredAction=(await h.state(restoredOwner)).staffActions.find(a=>a.command==='plan.cancellation.confirm'&&a.after.id===termination.id)
    assert.equal(restoredAction.after.reasonLabel,'Moved away')
    await h.cmd('plan.cancellation.prepare',{packId:terminationPack.id,reasonCode:'moved-away',reason:'Retired selection',effectiveAt:'2099-11-02T00:00:00Z',requestId:'synthetic-strap-archive-retired'},restoredOwner,409)
    const restoredDraft=recoveredCancellation.cancellations.find(c=>c.id===agentDraft.id)
    assert.deepEqual([restoredDraft.status,restoredDraft.createdRole,restoredDraft.reasonCode,restoredDraft.reasonLabel,restoredDraft.stale],['preview','agent','moved-away','Moved away',true])
    assert.equal((await h.send('/api/strap/agent/context',undefined,'',agentHeaders)).status,401,'preparation credentials never return with an archive')
    await h.cmd('plan.cancellation.confirm',{id:restoredDraft.id,key:restoredDraft.key,requestId:'synthetic-strap-archive-stale-agent'},restoredOwner,409)
    const restoredImmediate=recoveredCancellation.cancellations.find(c=>c.id===immediate.id)
    const {canWithdraw:immediateWithdraw,stale:immediateStale,...restoredImmediateRecord}=restoredImmediate
    assert.equal(immediateWithdraw,false);assert.equal(immediateStale,false)
    assert.deepEqual(restoredImmediateRecord,immediate,'applied immediate termination retains its exact reviewed instant, reason and effects')
    const restoredImmediateDraft=recoveredCancellation.cancellations.find(c=>c.id===immediateDraft.id)
    assert.deepEqual([restoredImmediateDraft.timing,restoredImmediateDraft.effectiveAt,restoredImmediateDraft.previewExpiresAt,restoredImmediateDraft.stale],['immediate',immediateDraft.effectiveAt,immediateDraft.previewExpiresAt,true])
    const immediateVersion=(await h.state(restoredOwner)).version
    await h.cmd('plan.cancellation.confirm',{id:restoredImmediateDraft.id,key:restoredImmediateDraft.key,requestId:'synthetic-strap-archive-immediate-refused'},restoredOwner,409)
    assert.equal((await h.state(restoredOwner)).version,immediateVersion)
    assert.equal(recoveredCancellation.statements.filter(c=>c.cancellationId===immediate.id).length,1)
    assert.equal((await h.state(restoredOwner)).staffActions.filter(a=>a.command==='plan.cancellation.confirm'&&a.after.id===immediate.id).length,1)
    const withdraw={id:withdrawal.id,key:withdrawal.key,requestId:'synthetic-strap-archive-withdraw-confirm'}
    await h.cmd('plan.cancellation.withdraw.confirm',withdraw,restoredOwner);await h.cmd('plan.cancellation.withdraw.confirm',withdraw,restoredOwner)
    const withdrawnState=await h.state(restoredOwner)
    assert.equal(withdrawnState.cancellations.cancellations.find(c=>c.id===termination.id).status,'withdrawn')
    assert.equal(withdrawnState.recurring.terms.find(t=>t.id===terminationTerms.id).status,'stopped')
    assert.equal(withdrawnState.recurring.terms.find(t=>t.id===terminationTerms.id).requiresFreshAcceptance,true)
    assert.equal(withdrawnState.staffActions.filter(a=>a.command==='plan.cancellation.withdraw.confirm'&&a.after.id===withdrawal.id).length,1)
    assert.equal(withdrawnState.recurring.invoices.length,0)
    console.log('PROBE PLAN-012 restore: native archive and import at same origin -> historical reason and agent draft retained, retired preview refused, old preparation credential rejected, withdrawal once with invoice authority stopped.');


    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM st_disclosure_connections').first()).count,0);
    assert.equal((await state()).renewalDisclosures.find(d=>d.id===expiryDisclosure.id).status,'scheduled');
    const restoredDisclosure=(await state()).renewalDisclosures.find(d=>d.id===deliveredDisclosure.id);
    assert.equal(restoredDisclosure.status,'delivered','the retained in-app notice survives restore');
    assert.equal(restoredDisclosure.delivery.status,'paused','old delivery intent never claims a live dispatch queue');
    assert.equal(restoredDisclosure.canAccept,false,'a restored price proposal cannot revive excluded dispatch authority');
    const restoredMember=await h.signIn(member.email);
    const historicalBilling=(await h.send('/api/strap/billing',undefined,restoredMember)).value;
    assert.equal(historicalBilling.methods.length,2);
    assert.equal(historicalBilling.connected,false);assert.equal(historicalBilling.methods.some(method=>method.available),false);
    assert.deepEqual(historicalBilling.methods.map(({available,...method})=>method).sort((a,b)=>a.id.localeCompare(b.id)),methodHistory,'restore retains the superseded method and selected replacement as historical records');
    assert.equal(historicalBilling.mandates.find(mandate=>mandate.id===membershipBefore.value.mandate.id).methodAuthorized,true,'original method evidence remains historical data');
    const restoredBilling=await billingView(h,restoredOwner);
    assert.equal(restoredBilling.connected,false);
    assert.deepEqual(restoredBilling.invoices.map(({balanceCents,access,...i})=>i).sort((a,b)=>a.id.localeCompare(b.id)),retainedPayments.invoices.map(({balanceCents,access,...i})=>i).sort((a,b)=>a.id.localeCompare(b.id)));
    for(const key of ['events','reconciliations','exceptions'])assert.deepEqual([...restoredBilling[key]].sort((a,b)=>a.id.localeCompare(b.id)),[...retainedPayments[key]].sort((a,b)=>a.id.localeCompare(b.id)));
    const noCalls=providerEdge.calls.length;
    await h.cmd('billing.reconcile',{id:pendingCheckout.id,requestId:'synthetic-strap-restored-reconcile'},restoredOwner,409);
    assert.equal((await signedEvent(h,paidEvent)).status,409);assert.equal(providerEdge.calls.length,noCalls);
    const providerCalls=providerEdge.calls.length,financialBefore=await h.state(restoredOwner);
    const restoredAttempt=await h.cmd('billing.setup.complete',{...methodInput,requestId:'synthetic-strap-archive-billing-restored'},restoredMember,409);
    assert.equal(restoredAttempt.error,'billing_reconnection_required');
    assert.equal(providerEdge.calls.length,providerCalls,'restored provider IDs cannot execute without reviewed reconnection');
    const financialAfter=await h.state(restoredOwner);assert.deepEqual(financialAfter.payments,financialBefore.payments);assert.deepEqual(financialAfter.charges,financialBefore.charges);

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
    const oldEpoch=retainedPayments.connection.connectionId;
    await h.cmd('billing.connect',{accountId:'synthetic-strap-10',mode:'test',confirm:true,requestId:'synthetic-strap-restored-review'},restoredOwner);
    const reviewed=await billingView(h,restoredOwner);assert.equal(reviewed.connected,true);assert.notEqual(reviewed.connection.connectionId,oldEpoch);
    assert.equal(reviewed.methods.some(m=>m.available),false,'fresh merchant review cannot resurrect historical method authority');
    payments.complete(pendingCheckout.providerSessionId);
    await h.cmd('billing.reconcile',{id:pendingCheckout.id,requestId:'synthetic-strap-restored-after-review'},restoredOwner);
    assert.equal((await billingView(h,restoredOwner)).invoices.find(i=>i.id===pendingCheckout.id).status,'paid');
    assert.equal((await h.state(restoredOwner)).payments.filter(p=>p.stripeInvoiceId===pendingCheckout.id).length,1);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM st_contract_connections').first()).count,0,'Stripe review never revives native renewal authority');

  } finally {if(h)await h.close();await rm(temporary,{recursive:true,force:true})}
})
