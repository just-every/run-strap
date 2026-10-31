import { clientAppointmentPairs } from './client-appointment-cases.mjs'
import { coursePair } from './course-pair.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { run } from './harness.mjs'
import { acceptance, billingEdge, billingSucceeded } from './billing-sandbox.mjs'
const minute=60_000, hour=60*minute
const at = hours => new Date(Math.ceil((Date.now()+hours*hour)/minute)*minute).toISOString()
const monday = start => {const d=new Date(start);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)}
const form=(h,name,back,fields,cookie=h.owner)=>h.mf.dispatchFetch(h.origin+`/app/action?name=${name}&returnTo=${encodeURIComponent(back)}`,{method:'POST',headers:{origin:h.origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),redirect:'manual'})
async function refused(h,name,input,cookie,status=403) {const before=(await h.state()).version,r=await h.send('/api/strap/command',{name,input},cookie);assert.equal(r.status,status,JSON.stringify(r.value));assert.equal((await h.state()).version,before);return r}
async function followLink(h,email) {
  const mail=(await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()).results.map(row=>JSON.parse(row.message)).find(m=>m.to.includes(email))
  assert.ok(mail)
  const token=new URL(mail.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
  const response=await h.send('/auth/confirm',{token});assert.equal(response.status,303,response.text)
  assert.equal(response.headers.get('location'),'/app#waiver');return response.cookie
}
async function prepare(h) {
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Nashville',timeZone:'America/Chicago'})
  const coach=await h.person('Maya','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben')
  for (const p of [ana,ben]) await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits:5,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z'})).id})
  const publish=async(title,hours,capacity=1)=>{const start=at(hours);return (await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title,room:title,start,end:new Date(Date.parse(start)+50*minute).toISOString(),capacity,instructorId:coach.id}]})).id})).classes[0]}
  return {coach,ana,ben,publish}
}

// The catalogue is the real dispatch registry. Every member-tagged command
// must have a working staff pair, not just a matching string in a second list.
test('STAFF-006 / SEC-002: every current member command has a real staff door, identical member outcome and one canonical named-right audit entry; unauthorized users and agents cannot act for members',async()=>{
  await run(async audit=>{
    await audit.confirmSetup(audit.owner)
    await audit.cmd('studio.save',{location:'Nashville',timeZone:'America/Chicago'})
    const proof=await(await import('./studio-audit-cases.mjs')).studioAuditCases(audit)
    await(await import('./staff-actions-browser.mjs')).studioAuditBrowser(audit,proof)
    const native=await(await import('./studio-audit-cases.mjs')).nativeAuditSources(audit,{erase:false})
    await(await import('./staff-actions-browser.mjs')).nativeAuditBrowser(audit,native)
    await(await import('./studio-audit-cases.mjs')).eraseNativeAudit(audit,native)
  })
  const billing=billingEdge()
  await run(async h=>{
    const {coach,ana,ben,publish}=await prepare(h)
    const historyMember=await h.person('HistoryOne'),otherHistoryMember=await h.person('HistoryTwo')
    const future=await publish('Future Flow',26),near=await publish('Open check-in',0.25)
    await h.cmd('spots.save',{room:'Future Flow',spots:['Mat 1','Mat 2'],disabled:[]})
    // First get a code by the member door; staff reading it preserves its bytes and revision.
    const ownCode=await h.cmd('checkin.code',{},ana.cookie)
    const catalogue=(await h.send('/api/strap/commands',undefined,h.owner)).value.commands
    const memberCommands=catalogue.filter(c=>c.roles.includes('member')),covered=new Set()
    const checkAudit=async(name,input,runCommand=()=>h.cmd(name,input))=>{
      const before=await h.state(),ids=new Set(before.staffActions.map(a=>a.id));const result=await runCommand();const after=await h.state()
      const fresh=after.staffActions.filter(a=>!ids.has(a.id))
      assert.equal(fresh.length,1,`${name}: exactly one canonical staff entry`)
      assert.deepEqual([fresh[0].actorId,fresh[0].actorRole,fresh[0].channel],[after.actor.id,'owner',input.channel??'desk'])
      assert.equal(fresh[0].command,name);assert.equal(fresh[0].right,name.startsWith('billing.')?catalogue.find(c=>c.name===name).staffRight:name==='family.bill.launch'?'collection':(name.startsWith('intro.')||name.startsWith('course.enrollment.'))?'sale':(name==='plan.change.prepare'||name.startsWith('plan.cancellation.')||name.startsWith('plan.disclosure.')||name.startsWith('freeze.')||['plan.recurring.stop','plan.recurring.reconnect'].includes(name))?'contract-change':['plan.recurring.prepare','lead.nurture.purchase','lead.winback.purchase'].includes(name)?'membership-sale':(name.startsWith('appointment.client.')||name==='attendance.plan.accept.staff'||name==='lead.empty.accept'||name.startsWith('booking.')||name.startsWith('reservation.')||name.startsWith('guest.')||name.startsWith('absence.')||name==='makeup.book')?'booking':name.startsWith('contract.authority.')||name.startsWith('household.')||['attendance.availability.launch','lead.referral.record','intake.submit.staff','preferences.save.staff','member.message.send.staff','notice.dismiss.staff','recognition.launch','mail.preference.launch','profile.save.staff','makeup.guardian.save','makeup.guardian.launch','makeup.guardian.revoke'].includes(name)?'member-record':'check-in');assert.ok('before'in fresh[0]&&'after'in fresh[0]);return {result,event:fresh[0],after}
    }
    let emptyDeskOffer,nurtureDeskOffer,winbackDeskOffer;
    let contractMember,contractDelegate,contractPack,contractGrant,contractCancel,contractWithdrawal,contractRequest;
    const nativeContract=async(name)=>{const member=await h.person(name),ack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:3,amountCents:9000,expiresAt:'2099-12-31T00:00:00Z'})).id}),proposal=await h.cmd('plan.recurring.prepare',{packId:ack.id,intervalMonths:1,requestId:randomUUID()});await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie);return {member,pack:(await h.state()).packs.find(p=>p.id===ack.id)}};
    let reservationDraft,reservation,cancellationDraft,seriesMember,guestQuote,guestPack,makeupRelation,makeupOriginal,makeupTarget,makeupCredit,makeupPreview,foreignMakeup,foreignRelation,freezePack,freezeType,freezeMember,freezePreview,freezeScheduled,freezeEnd,withdrawnRequest,invoiceMember,invoicePack,invoiceProposal,invoiceTerms
    let introMember,introDeskMember,introMemberPreview,introStaffPreview;
    let billingMember,billingAgreement,billingSetup;
    const actions={
      ...clientAppointmentPairs(h,coach,checkAudit,{member:historyMember,staffMember:otherHistoryMember}),
      'course.accept':async door=>coursePair(h,door,checkAudit),
      'intake.submit':async door=>{
        const form=await h.cmd('intake.form.publish',{title:'Phone intake pair',scope:'service',service:'Future intake service',required:false,questions:[{label:'Class preference',required:true,sensitive:false},{label:'Restricted preference',required:true,sensitive:true}],requestId:randomUUID()});
        const own=await h.cmd('intake.submit',{formId:form.id,answers:{q0:'Mat',q1:'Private preference'},requestId:randomUUID()},ana.cookie);
        const input={personId:ben.id,formId:form.id,answers:{q0:'Mat',q1:'Private preference'},requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);
        assert.deepEqual(r.result.answers,own.answers);assert.equal(r.result.staffMade,true);assert.equal(r.event.personId,ben.id);assert.equal(r.event.after.complete,true);
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1);
        assert.equal((await h.state(ben.cookie)).intake.responses.find(v=>v.id===r.result.id).staffMade,true);
      },
      'family.bill.accept':async door=>{
        const payer=await h.person('PairTuitionPayer'),child=await h.person('PairTuitionChild');
        const home=await h.cmd('household.save',{name:'Tuition staff pair'});
        await h.cmd('household.participant.add',{id:home.id,personId:child.id});
        await h.cmd('household.payer.propose',{id:home.id,payerId:payer.id});
        await h.cmd('household.payer.accept',{id:home.id},payer.cookie);
        const plan=await h.cmd('family.tuition.save',{householdId:home.id,name:'Paired tuition',service:'Mat',startsMonth:'2098-01',endsMonth:'2098-03',discountBps:1000,rows:[{personId:child.id,amountCents:10000,credits:4}],requestId:randomUUID()});
        const preview=await h.cmd('family.bill.preview',{id:plan.id,month:'2098-01',requestId:randomUUID()});
        const input={id:preview.id,requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);
        assert.equal(r.result.status,'member_action_required');assert.equal(r.event.personId,payer.id);
        assert.equal((await h.state()).familyTuition.invoices.length,0,'staff launch creates no invoice');
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1);
        await refused(h,'family.bill.accept',{id:preview.id,key:preview.key,confirm:true},h.owner,403);
        const bill=await h.cmd('family.bill.accept',{id:preview.id,key:preview.key,confirm:true},payer.cookie);
        assert.equal(bill.acceptedBy,(await h.state(payer.cookie)).actor.id);
        assert.equal((await h.state(child.cookie)).packs.find(p=>p.familyInvoiceId===bill.id).remaining,4);
      },
      'preferences.save':async door=>{
        const own=await h.cmd('preferences.save',{revision:0,marketingEmail:false,preferredTimes:'Mornings',requestId:randomUUID()},ana.cookie);
        const input={personId:ben.id,revision:0,marketingEmail:false,preferredTimes:'Mornings',requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);
        assert.equal(r.result.preferredTimes,own.preferredTimes);assert.equal(r.event.right,'member-record');assert.equal(r.event.personId,ben.id);
        assert.deepEqual(await h.cmd(door,input),r.result);
      },
      'member.message.send':async door=>{
        const own=await h.cmd('member.message.send',{text:'Member asks about next class',requestId:randomUUID()},ana.cookie);
        const input={personId:ana.id,text:'Staff reply in the studio conversation',requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);
        assert.equal(own.staffMade,false);assert.equal(r.result.staffMade,true);assert.equal(r.event.personId,ana.id);
        assert.deepEqual(await h.cmd(door,input),r.result);assert.ok((await h.state(ana.cookie)).memberMessages.some(m=>m.id===r.result.id));
      },
      'intro.preview':async door=>{
        introMember=await h.person('IntroMemberPair');introDeskMember=await h.person('IntroDeskPair');
        for(const member of [introMember,introDeskMember])await h.cmd('intro.identity.verify',{personId:member.id,householdChecked:true,reason:'Verified identity and household'});
        const offer=await h.cmd('intro.offer.save',{name:'Staff and member intro',days:14,credits:2,amountCents:3900,eligibility:'new',limit:'person'});
        introMemberPreview=await h.cmd('intro.preview',{offerId:offer.id,requestId:randomUUID()},introMember.cookie);
        const r=await checkAudit(door,{personId:introDeskMember.id,offerId:offer.id,requestId:randomUUID(),channel:'phone'});introStaffPreview=r.result;
        for(const key of ['days','credits','amountCents','eligibleServices','renewsAutomatically'])assert.deepEqual(r.result[key],introMemberPreview[key]);
      },
      'intro.purchase':async door=>{
        const sale=await h.cmd('intro.purchase',{id:introMemberPreview.id,key:introMemberPreview.key,confirm:true},introMember.cookie);
        const input={id:introStaffPreview.id,key:introStaffPreview.key,confirm:true,requestId:randomUUID(),channel:'phone'};
        const r=await checkAudit(door,input);assert.equal(r.event.personId,introDeskMember.id);
        for(const key of ['days','credits','amountCents','eligibleServices'])assert.deepEqual(r.result[key],sale[key]);
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1);
      },
      'contract.authority.accept':async door=>{
        ({member:contractMember,pack:contractPack}=await nativeContract('Dalia'));contractDelegate=await h.person('Rosa');
        contractGrant=await h.cmd('contract.authority.save',{personId:contractMember.id,delegateId:contractDelegate.id,kind:'payer',evidenceReference:'synthetic-strap-701'});
        const r=await checkAudit(door,{id:contractGrant.id,requestId:randomUUID(),channel:'phone'});assert.equal(r.result.status,'member_action_required');
        await h.cmd('contract.authority.accept',{id:contractGrant.id},contractMember.cookie);await h.cmd('contract.authority.accept',{id:contractGrant.id},contractDelegate.cookie);
      },
      'contract.authority.revoke':async door=>{const r=await checkAudit(door,{id:contractGrant.id,requestedByPersonId:contractMember.id,requestEvidenceReference:'synthetic-strap-710',reason:'Member withdrew delegation by phone',requestId:randomUUID(),channel:'phone'});assert.ok(r.result.revokedAt)},
      'plan.cancellation.stop':async door=>{const r=await checkAudit(door,{packId:contractPack.id,requestId:randomUUID(),channel:'phone'});assert.equal(r.result.status,'scheduled');assert.equal(r.result.terminatedBy,r.after.actor.id)},
      'plan.cancellation.statutory':async door=>{const {member,pack}=await nativeContract('Imani');const r=await checkAudit(door,{packId:pack.id,reasonCode:'cooling-off',documentedAt:new Date().toISOString(),evidenceReference:'synthetic-strap-702',requestId:randomUUID(),channel:'phone'});assert.equal(r.result.status,'applied');assert.equal(r.after.cancellations.statements.filter(s=>s.cancellationId===r.result.id).length,1)},
      'plan.cancellation.request':async door=>{
        const {member,pack}=await nativeContract('Selena');const input={packId:pack.id,effectiveAt:at(72),reason:'Member phoned for an early end',requestId:randomUUID(),channel:'phone'};
        await h.cmd('plan.cancellation.reason.save',{code:'other',label:'Other',active:true,revision:0});input.reasonCode='other';
        contractRequest=await h.cmd('plan.cancellation.request',{...input,requestId:randomUUID()},member.cookie);
        const r=await checkAudit(door,{...input,cancellationRequestId:contractRequest.id});assert.equal(r.result.status,'preview');
        contractCancel=await h.cmd('plan.cancellation.confirm',{id:r.result.id,key:r.result.key,requestId:randomUUID(),channel:'phone'});
      },
      'plan.cancellation.withdraw.prepare':async door=>{
        const stopped=await h.cmd('plan.cancellation.stop',{packId:contractPack.id,requestId:randomUUID()},contractMember.cookie);
        // The owner terminated this one; an owner can withdraw only their own action.
        const own=await checkAudit('plan.cancellation.withdraw.prepare',{id:stopped.id,requestId:randomUUID(),channel:'phone'});assert.equal(own.result.requiresFreshAcceptance,true);
        const {member,pack}=await nativeContract('Camila');const memberCancel=await h.cmd('plan.cancellation.stop',{packId:pack.id,requestId:randomUUID()},member.cookie);
        const r=await checkAudit(door,{id:memberCancel.id,requestId:randomUUID(),channel:'phone'});assert.equal(r.result.status,'member_action_required');
        contractCancel=memberCancel;contractMember=member;contractPack=pack;contractWithdrawal=await h.cmd('plan.cancellation.withdraw.prepare',{id:memberCancel.id,requestId:randomUUID()},member.cookie);
      },
      'plan.cancellation.withdraw.confirm':async door=>{
        const r=await checkAudit(door,{id:contractWithdrawal.id,requestId:randomUUID(),channel:'phone'});assert.equal(r.result.status,'member_action_required');
        await h.cmd('plan.cancellation.withdraw.confirm',{id:contractWithdrawal.id,key:contractWithdrawal.key,requestId:randomUUID()},contractMember.cookie);
        assert.equal((await h.state()).cancellations.cancellations.find(c=>c.id===contractCancel.id).status,'withdrawn');
      },

      'freeze.request':async door=>{
        freezeMember=await h.person('Marisol');freezeType=await h.cmd('freeze.type.save',{name:'Travel',reason:'Agreed absence',feeCents:1000,defaultLengthDays:30,maxLengthDays:90,allowedStartDays:[1,2,3,4,5,6,7],allowOpenEnded:false});
        freezePack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:freezeMember.id,credits:5,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z'})).id});
        freezePack=(await h.state()).packs.find(p=>p.id===freezePack.id);
        const input={packId:freezePack.id,freezeTypeId:freezeType.id,startAt:'2098-01-02',endAt:'2098-02-01',reason:'Member requested travel leave',requestId:randomUUID()};
        const request=await h.cmd('freeze.request',input,freezeMember.cookie);
        const r=await checkAudit(door,{...input,freezeRequestId:request.id,channel:'phone',requestId:randomUUID()});
        freezePreview=r.result;
        assert.equal(r.result.freezeRequestId,request.id);assert.equal(r.result.effects.durationDays,30);
        assert.deepEqual((await h.state(freezeMember.cookie)).freezes.freezes.find(f=>f.id===r.result.id),r.after.freezes.freezes.find(f=>f.id===r.result.id));
      },
      'freeze.accept':async door=>{
        const r=await checkAudit(door,{id:freezePreview.id,requestId:randomUUID(),channel:'phone'});
        assert.equal(r.result.status,'member_action_required');
        assert.equal((await h.state()).freezes.freezes.find(f=>f.id===freezePreview.id).acceptedAt,null,'the staff door cannot accept for the member');
        await refused(h,'freeze.accept',{id:freezePreview.id,key:freezePreview.key},h.owner);
        await refused(h,'freeze.confirm',{id:freezePreview.id,key:freezePreview.key,requestId:randomUUID()},h.owner,409);
        const accepted=await h.cmd('freeze.accept',{id:freezePreview.id,key:freezePreview.key},freezeMember.cookie);
        assert.ok(accepted.acceptedAt);
        const confirm={id:freezePreview.id,key:freezePreview.key,requestId:randomUUID(),channel:'phone'};
        freezeScheduled=await h.cmd('freeze.confirm',confirm);await h.cmd('freeze.confirm',confirm);
        const events=(await h.state()).staffActions.filter(a=>a.command==='freeze.confirm'&&a.requestId===confirm.requestId);
        assert.equal(events.length,1);assert.equal(events[0].personId,freezeMember.id);assert.equal(events[0].after.typeName,freezeType.name);assert.equal(events[0].reason,freezePreview.reason);
      },
      'freeze.end.accept':async door=>{
        freezeEnd=await h.cmd('freeze.end.prepare',{id:freezeScheduled.id,endAt:'2098-01-20',reason:'Member requested an earlier return',requestId:randomUUID(),channel:'phone'});
        const r=await checkAudit(door,{id:freezeEnd.id,requestId:randomUUID(),channel:'phone'});
        assert.equal(r.result.status,'member_action_required');
        await refused(h,'freeze.end.accept',{id:freezeEnd.id,key:freezeEnd.key},h.owner);
        await refused(h,'freeze.end.confirm',{id:freezeEnd.id,key:freezeEnd.key,requestId:randomUUID()},h.owner,409);
        await h.cmd('freeze.end.accept',{id:freezeEnd.id,key:freezeEnd.key},freezeMember.cookie);
        await h.cmd('freeze.end.confirm',{id:freezeEnd.id,key:freezeEnd.key,requestId:randomUUID(),channel:'phone'});
      },
      'freeze.request.withdraw':async door=>{
        const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:freezeMember.id,credits:3,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z'})).id});
        const input={packId:pack.id,freezeTypeId:freezeType.id,startAt:'2098-03-02',endAt:'2098-03-20',reason:'Later trip',requestId:randomUUID()};
        const requested=await h.cmd('freeze.request',input,freezeMember.cookie);
        const r=await checkAudit(door,{id:requested.id,reason:'Member cancelled this request by phone',requestId:randomUUID(),channel:'phone'});
        withdrawnRequest=r.result;assert.equal(r.result.status,'withdrawn');
        const own=await h.cmd('freeze.request',{...input,requestId:randomUUID()},freezeMember.cookie);
        assert.equal((await h.cmd('freeze.request.withdraw',{id:own.id,requestId:randomUUID()},freezeMember.cookie)).status,'withdrawn','the member withdraws their own request without a reason');
        const declined=await h.cmd('freeze.request',{...input,requestId:randomUUID()},freezeMember.cookie);
        const decision=await checkAudit('freeze.decline',{id:declined.id,reason:'Requested period is unavailable; please propose another',requestId:randomUUID(),channel:'phone'});
        assert.equal(decision.result.status,'declined');
      },
      'freeze.withdraw':async door=>{
        const current=(await h.state()).freezes.freezes.find(f=>f.id===freezeScheduled.id);
        const input={id:current.id,withdrawKey:current.withdrawal.key,reason:'Member withdrew the scheduled leave by phone',requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);
        assert.equal(r.result.status,'withdrawn');
        assert.equal(r.after.packs.find(p=>p.id===freezePack.id).expiresAt,freezePack.expiresAt);
        assert.equal(r.after.charges.filter(c=>c.freezeId===current.id).reduce((sum,c)=>sum+c.amountCents,0),0,'the fee debt reverses once');
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1);assert.equal((await h.state()).charges.filter(c=>c.freezeId===current.id).reduce((sum,c)=>sum+c.amountCents,0),0,'replay never reverses a freeze fee twice');
      },
      'plan.recurring.accept':async door=>{
        invoiceMember=await h.person('Elena');invoicePack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:invoiceMember.id,credits:5,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z'})).id});
        const input={packId:invoicePack.id,intervalMonths:1,requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);invoiceProposal=r.result;
        assert.equal(invoiceProposal.status,'preview');assert.equal(invoiceProposal.acceptedBy,undefined);
        await refused(h,'plan.recurring.accept',{id:invoiceProposal.id,key:invoiceProposal.key},h.owner);
        invoiceTerms=await h.cmd('plan.recurring.accept',{id:invoiceProposal.id,key:invoiceProposal.key},invoiceMember.cookie);
        assert.equal(invoiceTerms.status,'active');assert.equal(invoiceTerms.acceptedBy,(await h.state(invoiceMember.cookie)).actor.id);
        assert.deepEqual((await h.state(invoiceMember.cookie)).recurring.terms.find(t=>t.id===invoiceTerms.id),(await h.state()).recurring.terms.find(t=>t.id===invoiceTerms.id));
        const connection=(await h.state()).recurring.connection,previousOrigin='https://synthetic-strap-30.invalid';
        await h.db.prepare("UPDATE st_contract_connections SET origin=? WHERE id='billing'").bind(previousOrigin).run();
        await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.billingOrigin',?) WHERE id=?").bind(previousOrigin,invoiceTerms.id).run();
        const moved=await checkAudit('plan.recurring.reconnect',{previousOrigin,connectionId:connection.connectionId,requestId:randomUUID(),channel:'phone'});
        assert.ok(moved.result.agreementIds.includes(invoiceTerms.id));
        assert.equal((await h.state(invoiceMember.cookie)).recurring.terms.find(t=>t.id===invoiceTerms.id).acceptedAt,invoiceTerms.acceptedAt,'the owner reconnects the live address without accepting again for the member');
      },
      'plan.recurring.stop':async door=>{
        const input={id:invoiceTerms.id,reason:'Member withdrew future invoice agreement by phone',channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input);
        assert.equal(r.result.status,'scheduled');assert.equal((await h.state(invoiceMember.cookie)).recurring.terms.find(t=>t.id===invoiceTerms.id).status,'cancellation_scheduled');
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1);
      },
      'makeup.guardian.accept':async door=>{
        makeupRelation=await h.cmd('makeup.guardian.save',{personId:ana.id,guardianId:ben.id,relationship:'adult-delegate',authorizationEvidence:'Participant requested a named adult delegate at the desk'})
        const r=await checkAudit(door,{id:makeupRelation.id,requestId:randomUUID(),channel:'phone'})
        assert.equal(r.result.status,'member_action_required')
        await refused(h,'makeup.guardian.accept',{id:makeupRelation.id},h.owner)
        await h.cmd('makeup.guardian.accept',{id:makeupRelation.id},ana.cookie)
        await h.cmd('makeup.guardian.accept',{id:makeupRelation.id},ben.cookie)
      },
      'absence.preview':async door=>{
        await h.cmd('absence.policy.save',{service:'Makeup Flow',noticeHours:0,expiryDays:14})
        const source=await publish('Makeup Flow',44,4);makeupTarget=await publish('Makeup Flow',46,4)
        makeupOriginal=await h.cmd('booking.book',{classId:source.id},ana.cookie)
        const input={id:makeupOriginal.id,reason:'Member phoned in',channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        makeupPreview=r.result
        const memberPreview=await h.cmd('absence.preview',{...input,requestId:randomUUID()},ana.cookie)
        assert.deepEqual(memberPreview.cancellationEffect,makeupPreview.cancellationEffect,'member and phone desk review the same credit-return choice')
        assert.equal((await h.state()).bookings.find(b=>b.id===makeupOriginal.id).status,'booked','preview leaves the original seat in place')
      },
      'absence.report':async door=>{
        const r=await checkAudit(door,{id:makeupOriginal.id,previewId:makeupPreview.id,key:makeupPreview.key,reason:makeupPreview.reason,channel:'phone',requestId:randomUUID()})
        makeupCredit=r.result.creditId
        assert.equal((await h.state(ana.cookie)).makeups.credits.filter(c=>c.originalBookingId===makeupOriginal.id).length,1)
        const other=await h.cmd('booking.book',{classId:makeupOriginal.classId},ben.cookie)
        foreignMakeup=await h.cmd('absence.report',{id:other.id,reason:'Other member called',channel:'phone',requestId:randomUUID()})
      },
      'makeup.book':async door=>{
        const input={creditId:makeupCredit,classId:makeupTarget.id,requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input)
        assert.equal(r.result.originalBookingId,makeupOriginal.id)
        assert.equal((await h.state(ana.cookie)).makeups.credits.find(c=>c.id===makeupCredit).bookingId,r.result.id)
        await h.cmd(door,input); assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1)
      },
      'makeup.guardian.revoke':async door=>{
        await checkAudit(door,{id:makeupRelation.id,reason:'Participant ended the named delegation by phone',requestId:randomUUID(),channel:'phone'})
        assert.ok((await h.state(ben.cookie)).makeups.credits.every(c=>c.personId!==ana.id))
        const outside=await h.person('OutsideGuardian')
        foreignRelation=await h.cmd('makeup.guardian.save',{personId:ben.id,guardianId:outside.id,relationship:'adult-delegate',authorizationEvidence:'Distinct participant requested a delegate'})
      },
      'guest.consent.save':async door=>{
        const input={personId:ana.id,channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.equal(r.result.status,'member_action_required')
        await h.cmd('guest.consent.save',{sponsorEmail:ben.email,consent:true},ana.cookie)
        assert.ok((await h.state(ben.cookie)).guests.guests.some(g=>g.id===ana.id))
        await refused(h,'guest.consent.save',{sponsorEmail:ben.email,consent:true},h.owner)
      },
      'guest.consent.revoke':async door=>{
        const r=await checkAudit(door,{personId:ana.id,requestId:randomUUID(),channel:'desk'})
        assert.equal(r.result.status,'member_action_required')
        const grant=(await h.state(ana.cookie)).guests.consents.find(g=>g.type==='guest'&&g.sponsorId===ben.id)
        await h.cmd('guest.consent.revoke',{id:grant.id},ana.cookie)
        assert.equal((await h.state(ben.cookie)).guests.guests.length,0)
        await h.cmd('guest.consent.save',{sponsorEmail:ben.email,consent:true},ana.cookie)
      },
      'guest.preview':async door=>{
        const draft=await h.cmd('pack.prepare',{personId:ben.id,credits:3,amountCents:6000,expiresAt:'2099-12-31T00:00:00Z',guestTerms:{passes:2,period:'month',rollover:0,services:[],perGuest:1,windowDays:365,excess:'refuse',priceCents:0}})
        guestPack=await h.cmd('pack.approve',{id:draft.id})
        const r=await checkAudit(door,{sponsorId:ben.id,guestId:ana.id,packId:guestPack.id,classId:future.id,channel:'phone',requestId:randomUUID()})
        guestQuote=r.result; assert.equal(guestQuote.amountCents,0)
      },
      'guest.book':async door=>{
        const input={id:guestQuote.id,confirm:true,channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.equal(r.result.guestFunding,'pass')
        assert.equal((await h.state(ben.cookie)).packs.find(p=>p.id===guestPack.id).remaining,3)
        await h.cmd(door,input); assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1)
        await h.cmd('booking.cancel',{id:r.result.id},ana.cookie)
      },
      'reservation.prepare':async door=>{
        seriesMember=await h.person('SeriesMember')
        await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:seriesMember.id,credits:3,amountCents:6000,expiresAt:'2099-12-31T00:00:00Z'})).id})
        const dates={startDate:'2098-01-06',endDate:'2098-01-20',time:'09:00',minutes:50,intervalWeeks:1,title:'Standing class',service:'Yoga',room:'Series',capacity:3,instructorId:coach.id}
        const series=await h.cmd('series.publish',{id:(await h.cmd('series.prepare',dates)).id})
        const r=await checkAudit(door,{classId:series.classes[0].id,throughDate:dates.endDate,personId:seriesMember.id,channel:'phone',requestId:randomUUID()})
        reservationDraft=r.result
        assert.ok(reservationDraft.outcomes.every(o=>o.status==='booked'))
        assert.equal(r.after.bookings.filter(b=>b.reservationId).length,0,'staff preview books nothing')
      },
      'reservation.confirm':async door=>{
        const input={id:reservationDraft.id,key:reservationDraft.key,channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        reservation=r.result
        assert.equal(r.after.bookings.filter(b=>b.reservationId===reservation.id).length,3)
        assert.deepEqual((await h.state(seriesMember.cookie)).reservations.find(r=>r.id===reservation.id),reservation,'member reads the same staff-made outcomes')
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1)
      },
      'reservation.cancel.prepare':async door=>{
        const r=await checkAudit(door,{reservationId:reservation.id,channel:'phone',requestId:randomUUID()});cancellationDraft=r.result
        assert.equal(cancellationDraft.outcomes.length,3)
      },
      'reservation.cancel.confirm':async door=>{
        const input={id:cancellationDraft.id,key:cancellationDraft.key,channel:'phone',cancelReason:'Schedule conflict',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.equal(r.result.status,'cancelled')
        const children=r.after.bookingActions.filter(a=>a.parentActionId===r.event.id)
        assert.equal(children.length,3,'per-occurrence audit links to its one canonical command audit')
        assert.ok(children.every(a=>a.actorRole==='owner'&&a.staffMade&&a.channel==='phone'&&a.right==='booking'))
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1)
      },
      'profile.save':async door=>{
        const input={personId:ana.id,emergencyName:'Rosa Diaz',emergencyPhone:'(615) 555-0123',channel:'phone',revision:0,requestId:randomUUID()},r=await checkAudit(door,input)
        assert.deepEqual(r.result.emergencyContact,{name:'Rosa Diaz',phone:'6155550123',relationship:null})
        assert.deepEqual((await h.state(ana.cookie)).people.find(p=>p.id===ana.id).emergencyContact,r.result.emergencyContact,'the member reads the staff-made profile')
        assert.deepEqual([r.event.before.emergencyContact,r.event.after.emergencyContact],[null,r.result.emergencyContact])
        assert.equal((await h.cmd('profile.save',{emergencyRelationship:'Sister',revision:1,requestId:randomUUID()},ana.cookie)).emergencyContact.relationship,'Sister')
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.length,r.after.staffActions.length,'replay creates no second entry')
      },
      'recognition.preference.save':async door=>{
        const current=(await h.state(ana.cookie)).recognition.preferences[0]
        const input={personId:ana.id,channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.equal(r.result.preferenceDoor,true)
        assert.deepEqual((await h.state(ana.cookie)).recognition.preferences[0],current,'staff launch preserves the member-owned choice')
        const saved=await h.cmd('recognition.preference.save',{optedIn:true,version:current.version},ana.cookie)
        assert.equal(saved.optedIn,true)
        assert.equal(saved.history.at(-1).actorId,(await h.state(ana.cookie)).actor.id)
        await h.cmd(door,input)
        assert.equal((await h.state()).staffActions.filter(a=>a.command===door&&a.requestId===input.requestId).length,1)
      },
      'household.payer.accept':async door=>{
        const guardian=await h.person('PairGuardian'),payer=await h.person('PairPayer'),household=await h.cmd('household.save',{name:'Pair family'})
        await h.cmd('household.guardian.link',{id:household.id,guardianId:guardian.id,evidenceReference:'synthetic-strap-61'})
        await h.cmd('household.payer.propose',{id:household.id,payerId:payer.id})
        const input={id:household.id,requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input)
        assert.equal(r.result.status,'member_action_required');assert.equal(r.result.personId,payer.id)
        assert.equal((await h.state(payer.cookie)).households[0].pendingPayer.personId,payer.id,'staff launch never accepts for the payer')
        await refused(h,'household.payer.accept',{id:household.id},h.owner)
        await refused(h,'household.payer.accept',{id:household.id},guardian.cookie,404)
        assert.equal((await h.cmd('household.payer.accept',{id:household.id},payer.cookie)).payerId,payer.id)
        await h.cmd(door,input)
      },
      'household.guardian.leave':async door=>{
        const first=await h.person('LeaveOne'),second=await h.person('LeaveTwo'),household=await h.cmd('household.save',{name:'Leave family'})
        for (const g of [first,second]) await h.cmd('household.guardian.link',{id:household.id,guardianId:g.id,evidenceReference:'synthetic-strap-62'})
        const input={id:household.id,guardianId:second.id,reason:'Asked at the desk',channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.deepEqual(r.result.guardianIds,[first.id]);assert.equal(r.event.personId,second.id)
        assert.deepEqual((await h.cmd('household.guardian.leave',{id:household.id},first.cookie)).guardianIds,[],'a guardian ends their own guardianship through their own door')
        await refused(h,'household.guardian.leave',{id:household.id},second.cookie,404)
      },
      'mail.preference.save':async door=>{
        const current=(await h.state(ana.cookie)).messagePreference
        const input={personId:ana.id,channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.equal(r.result.url,'/signin?returnTo=%2Fapp%23message-preferences')
        assert.equal(r.result.status,'member_action_required')
        assert.deepEqual((await h.state(ana.cookie)).messagePreference,current,'staff launch preserves the member-owned preference')
        assert.equal((await h.cmd('mail.preference.save',{optedOut:true,requestId:randomUUID()},ana.cookie)).optedOut,true)
        assert.equal((await h.cmd('mail.preference.save',{optedOut:false,requestId:randomUUID()},ana.cookie)).optedOut,false)
        await h.cmd(door,input)
        assert.equal((await h.state()).staffActions.filter(a=>a.command===door&&a.requestId===input.requestId).length,1)
      },
      'booking.move':async door=>{
        const from=await publish('Move from',30),to=await publish('Move to',32)
        const booked=await h.cmd('booking.book',{classId:from.id},ana.cookie)
        const input={id:booked.id,classId:to.id,cancelReason:'Other',channel:'phone',requestId:randomUUID()}
        const r=await checkAudit(door,input)
        assert.equal(r.result.classId,to.id)
        assert.equal((await h.state(ana.cookie)).bookings.find(b=>b.id===booked.id).classId,to.id)
        assert.equal(r.event.before.classId,from.id);assert.equal(r.event.after.classId,to.id)
        await h.cmd(door,input)
        assert.equal((await h.state()).staffActions.filter(a=>a.command===door&&a.requestId===input.requestId).length,1)
      },
      'booking.book':async door=>{
        const r=await checkAudit(door,{personId:ana.id,classId:future.id,channel:'phone'})
        assert.equal(r.result.status,'booked');assert.equal((await h.state(ana.cookie)).bookings.find(b=>b.id===r.result.id).status,'booked');return r.result
      },
      'booking.spot':async door=>{
        const b=(await h.state()).bookings.find(b=>b.personId===ana.id&&b.classId===future.id&&b.status==='booked')
        const r=await checkAudit(door,{id:b.id,spot:'Mat 2',channel:'phone'})
        assert.equal(r.result.spot,'Mat 2');assert.equal((await h.state(ana.cookie)).bookings.find(x=>x.id===b.id).spot,'Mat 2')
      },
      'booking.cancel':async door=>{
        const b=(await h.state()).bookings.find(b=>b.personId===ana.id&&b.classId===future.id&&b.status==='booked')
        assert.deepEqual((await h.state(ana.cookie)).bookings.find(x=>x.id===b.id).cancelEffect,b.cancelEffect,'staff and member read the same preview')
        const r=await checkAudit(door,{id:b.id,cancelReason:'Other',channel:'phone'})
        assert.equal(r.result.refunded,true);assert.equal((await h.state(ana.cookie)).notices.filter(n=>n.bookingId===b.id&&n.subject.startsWith('Booking cancelled:')).length,1)
      },
      'booking.offer.accept':async door=>{
        await h.cmd('waitlist.save',{mode:'offer',claimMinutes:30,lateWindow:'promote'})
        const first=await h.cmd('booking.book',{classId:future.id},ana.cookie)
        const waiter=await h.cmd('booking.book',{classId:future.id},ben.cookie)
        await h.cmd('booking.cancel',{id:first.id},ana.cookie)
        const ordinaryIds=new Set((await h.state()).bookings.filter(b=>!b.guestPackId&&b.classId===future.id).map(b=>b.id))
        const cancellations=(await h.state(ana.cookie)).notices.filter(n=>ordinaryIds.has(n.bookingId)&&n.subject.startsWith('Booking cancelled:'))
        assert.equal(new Set(cancellations.map(n=>n.body)).size,1,'staff and member cancellation notices agree')
        const r=await checkAudit(door,{id:waiter.id,channel:'inbox'})
        assert.equal(r.result.status,'booked');assert.equal((await h.state(ben.cookie)).bookings.find(b=>b.id===waiter.id).status,'booked')
      },
      'attendance.self':async door=>{
        const b=await h.cmd('booking.book',{classId:near.id},ana.cookie)
        const r=await checkAudit(door,{id:b.id,channel:'desk'})
        assert.equal(r.result.attendance,'attended');assert.equal((await h.state(ana.cookie)).bookings.find(x=>x.id===b.id).attendance,'attended')
      },
      'checkin.code':async door=>{
        const input={personId:ana.id,channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.equal(r.result.code,ownCode.code);assert.equal(r.result.codeRevision,ownCode.codeRevision)
        assert.ok(!JSON.stringify(r.event).includes(ownCode.code),'raw check-in credentials stay out of audit')
        const count=r.after.staffActions.length
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.length,count,'replay creates no second entry')
        await refused(h,door,{...input,personId:ben.id},h.owner,409)
      },
      'waiver.acknowledge':async door=>{
        const w=await h.cmd('waiver.publish',{text:'Current waiver: choose your own limits; acknowledge only for yourself.'})
        const input={personId:ana.id,waiverId:w.id,channel:'desk',requestId:randomUUID()}
        const beforeMails=(await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n
        const r=await checkAudit(door,input)
        assert.equal(r.result.status,'requested');assert.ok(!(await h.state()).acknowledgements.some(a=>a.personId===ana.id&&a.waiverId===w.id),'staff launch never acknowledges')
        await h.cmd(door,input)
        assert.equal((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n,beforeMails+1,'same request sends one secure link')
        const cookie=await followLink(h,ana.email)
        assert.equal((await h.send('/app',undefined,cookie)).status,200)
        await h.cmd('waiver.acknowledge',{id:w.id},cookie)
        assert.equal((await h.state()).acknowledgements.find(a=>a.personId===ana.id&&a.waiverId===w.id).actorId,(await h.state(cookie)).actor.id)
        assert.equal(r.event.right,'check-in')
      },
      'notice.dismiss':async door=>{
        const n=(await h.state(ana.cookie)).notices.find(n=>!n.dismissedAt)
        const input={id:n.id,personId:ana.id,channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        const own=(await h.state(ana.cookie)).notices.find(x=>x.id===n.id)
        assert.deepEqual([own.subject,own.body],[n.subject,n.body]);assert.ok(own.dismissedAt)
        assert.equal(own.dismissedByStaff.actorId,r.after.actor.id);assert.equal(r.event.right,'member-record')
        assert.match((await h.send('/app',undefined,ana.cookie)).text,/Marked read by staff/)
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.length,r.after.staffActions.length)
      },
      'plan.change.request':async door=>{
        const pack=(await h.state(ana.cookie)).packs[0]
        const input={packId:pack.id,mode:'renewal',credits:6,amountCents:12000,expiresAt:'2100-06-30T00:00:00.000Z',channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input)
        assert.equal(r.result.status,'preview');assert.equal(r.event.before.id,pack.id);assert.equal(r.event.after.id,r.result.id)
        assert.deepEqual((await h.state(ana.cookie)).planChanges.changes.find(c=>c.id===r.result.id),r.after.planChanges.changes.find(c=>c.id===r.result.id),'staff and member read the same preview')
        await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1)
      },
      'plan.change.accept':async door=>{
        const preview=(await h.state(ana.cookie)).planChanges.changes.find(c=>c.status==='preview')
        await refused(h,'plan.change.accept',{id:preview.id,key:preview.key},h.owner)
        assert.equal((await h.state(ana.cookie)).planChanges.changes.find(c=>c.id===preview.id).status,'preview','the staff preview never accepts for the member')
        const accepted=await h.cmd('plan.change.accept',{id:preview.id,key:preview.key},ana.cookie)
        assert.equal(accepted.acceptedBy,(await h.state(ana.cookie)).actor.id)
        await refused(h,door,{packId:preview.packId,mode:'renewal',credits:7,amountCents:13000,expiresAt:'2100-07-30T00:00:00.000Z',requestId:randomUUID()},h.owner,409)
      },
    }
    actions['lead.empty.accept']=async door=>{
      const member=await h.person('EmptyDeskMember');
      await h.cmd('waiver.acknowledge',{id:(await h.state()).waiver.id},member.cookie);
      await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:2,amountCents:3000,expiresAt:'2099-12-31T00:00:00Z'})).id});
      await h.cmd('preferences.save',{revision:0,requestId:randomUUID(),marketingInApp:true,consentStatement:'Member requested studio class offers'},member.cookie);
      const entry=await publish('Empty desk class',64,2),preview=await h.cmd('lead.empty.prepare',{classId:entry.id,personIds:[member.id],leadMinutes:10080,maxPer30Days:1,incentiveCents:0,budgetCents:0,text:'Open class for this member'});
      await h.cmd('lead.empty.approve',{id:preview.id,key:preview.key});
      const offer=(await h.state(member.cookie)).emptyPlaces.offers[0];emptyDeskOffer=offer;const input={id:offer.id,requestId:randomUUID(),channel:'phone'};
      const result=await checkAudit(door,input);assert.equal(result.result.status,'booked');assert.equal(result.event.personId,member.id);
      assert.equal((await h.state(member.cookie)).bookings.find(b=>b.id===result.result.id).status,'booked');
      await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1);
    };
    actions['lead.nurture.purchase']=async door=>{
      const member=await h.person('NurtureDeskMember');await h.cmd('waiver.acknowledge',{id:(await h.state()).waiver.id},member.cookie);
      const intro=await h.cmd('intro.offer.save',{name:'Desk intro',days:7,credits:2,amountCents:1000,eligibility:'new',limit:'person',eligibleServices:['Desk intro yoga']});
      await h.cmd('lead.nurture.save',{introOfferId:intro.id,welcome:'Welcome',guidance:'Bring water',offerText:'Exact finite studio membership',planName:'Desk finite month',days:30,amountCents:4000});
      await h.cmd('preferences.save',{revision:0,requestId:randomUUID(),marketingInApp:true,consentStatement:'Please send intro guidance and offers'},member.cookie);
      await h.cmd('intro.identity.verify',{personId:member.id,householdChecked:true,reason:'Owner verified new eligibility'});
      const quote=await h.cmd('intro.preview',{offerId:intro.id,requestId:randomUUID()},member.cookie);await h.cmd('intro.purchase',{id:quote.id,key:quote.key,confirm:true},member.cookie);
      await h.cmd('lead.nurture.review',{});
      const start=new Date(Date.now()+6000).toISOString(),entry=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title:'Desk intro yoga',service:'Desk intro yoga',room:'Desk intro room',start,end:new Date(Date.parse(start)+1000).toISOString(),capacity:2,instructorId:coach.id}]})).id})).classes[0];
      const booking=await h.cmd('booking.book',{classId:entry.id},member.cookie);await h.cmd('attendance.checkin',{id:booking.id},coach.cookie);
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(entry.end)-Date.now()+20)));await h.cmd('lead.nurture.review',{});
      nurtureDeskOffer=(await h.state(member.cookie)).nurture.offers[0];assert.ok(nurtureDeskOffer);
      const input={id:nurtureDeskOffer.id,key:nurtureDeskOffer.key,confirm:true,requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);
      assert.equal(r.result.entitlement.kind,'unlimited');assert.equal(r.result.amountCents,4000);assert.equal(r.event.personId,member.id);
      await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1);
    };
    actions['lead.referral.record']=async door=>{
      const submission=await h.cmd('lead.referral.record',{friendEmail:ana.email,requestId:randomUUID()},ben.cookie);assert.equal(submission.referredPersonId,undefined);
      const input={personId:ben.id,friendEmail:ana.email,sourceReference:'Member named this friend by phone',channel:'phone',requestId:randomUUID()},r=await checkAudit(door,input);
      assert.equal(r.result.personId,ben.id);assert.equal(r.result.referredPersonId,ana.id);assert.ok(r.result.verifiedAt);assert.equal(r.event.before.id,submission.id);
      await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1);
    };
    actions['lead.winback.purchase']=async door=>{
      const member=await h.person('WinbackDeskMember');await h.cmd('waiver.acknowledge',{id:(await h.state()).waiver.id},member.cookie);
      const expiresAt=new Date(Date.now()+4000).toISOString();await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:1,amountCents:1000,planName:'Ended finite plan',expiresAt})).id});
      await h.cmd('preferences.save',{revision:0,requestId:randomUUID(),marketingInApp:true,consentStatement:'Please send me return offers'},member.cookie);
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(expiresAt)-Date.now()+20)));
      const preview=await h.cmd('lead.winback.prepare',{personIds:[member.id],planName:'Finite return month',days:30,amountCents:4000,eligibleServices:[],rewardCents:0,budgetCents:0,cadenceDays:30,offerDays:7,text:'Exact finite return membership'});
      await h.cmd('lead.winback.approve',{id:preview.id,key:preview.key});winbackDeskOffer=(await h.state(member.cookie)).winback.offers[0];assert.ok(winbackDeskOffer);
      const input={id:winbackDeskOffer.id,key:winbackDeskOffer.key,confirm:true,requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);
      assert.equal(r.result.entitlement.kind,'unlimited');assert.equal(r.result.amountCents,4000);assert.equal(r.event.personId,member.id);
      await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1);
    };
    actions['plan.disclosure.accept']=async door=>{
      const member=await h.person('PriceAcceptanceDesk'),pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt:'2099-12-31T00:00:00.000Z'})).id});
      const proposal=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:12,requestId:randomUUID()});
      const terms=await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie);
      const d=await h.cmd('plan.disclosure.schedule',{termsId:terms.id,leadDays:30,proposedAmountCents:12000,requestId:randomUUID()});
      await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.sendAt',?) WHERE id=?").bind(new Date(Date.now()-1000).toISOString(),d.id).run();await(await h.mf.getWorker()).scheduled();
      const input={id:d.id,requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);
      assert.equal(r.result.status,'member_action_required');assert.equal(r.event.personId,member.id);assert.equal(r.event.right,'contract-change');
      const delivered=(await h.state()).renewalDisclosures.find(v=>v.id===d.id);
      await h.cmd('plan.disclosure.accept',{id:d.id,key:delivered.key},h.owner,403);
      assert.ok((await h.cmd('plan.disclosure.accept',{id:d.id,key:delivered.key},member.cookie)).acceptedAtPrice);
    };
    actions['attendance.availability.save']=async door=>{
      const input={personId:ana.id,requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);
      assert.equal(r.result.status,'member_action_required');assert.equal(r.event.personId,ana.id);
      assert.equal((await h.state()).attendancePlans.availability.length,0,'staff cannot set member availability');
      await h.cmd('attendance.availability.save',{version:0,windows:[{start:future.start,end:future.end}],locationIds:['studio']},ana.cookie);
    };
    actions['attendance.plan.accept']=async door=>{
      const attendanceClass=await publish('Attendance parity class',123,2);
      const member=await h.person('AttendanceParity');await h.cmd('waiver.acknowledge',{id:(await h.state()).waiver.id},member.cookie);
      await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:3,amountCents:3000,expiresAt:'2099-12-31T00:00:00Z'})).id});
      await h.cmd('attendance.availability.save',{version:0,windows:[{start:attendanceClass.start,end:attendanceClass.end}],locationIds:['studio']},member.cookie);
      const offer=await h.cmd('attendance.plan.prepare',{personId:member.id});assert.ok(offer.choices.some(c=>c.classId===attendanceClass.id));
      const input={id:offer.id,classId:attendanceClass.id,requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);
      assert.equal(r.result.status,'booked');assert.equal(r.event.personId,member.id);
      await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1);
    };
    // Billing uses a separate dispatcher, joined into the same public catalogue.
    // These owner launches preserve the personal step; they grant no staff signing power.
    const billingLaunch=async(name,door)=>{
      const before=(await h.send('/api/strap/billing',undefined,billingMember.cookie)).value,calls=billing.calls.length;
      const input={id:billingAgreement.id,requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);
      assert.equal(r.result.status,'member_action_required');assert.equal(r.result.memberCommand,name);assert.equal(r.event.personId,billingMember.id);
      assert.equal(r.event.staffMade,true);assert.equal(r.event.before.documentHash,billingAgreement.documentHash);assert.equal(r.event.before.financialHash,billingAgreement.financialHash);
      const after=(await h.send('/api/strap/billing',undefined,billingMember.cookie)).value;
      for(const key of ['agreements','mandates','methods','setups','operations'])assert.deepEqual(after[key],before[key],name+': launch leaves the member act untouched');
      assert.equal(billing.calls.length,calls,'staff launch calls no payment provider');
      assert.ok(after.launches.some(l=>l.id===r.result.id));
      assert.equal((await h.send('/api/strap/billing',undefined,ana.cookie)).value.launches.length,0,'unrelated members cannot read the launch');
      const target=new URL(r.result.url,h.origin).searchParams.get('returnTo');
      assert.ok(target.startsWith('/app/packs#billing-'));
      assert.equal((await h.send(target,undefined,billingMember.cookie)).status,200,'launch points to the real personal screen');
      assert.deepEqual(await h.cmd(door,input),r.result);assert.equal((await h.state()).staffActions.filter(a=>a.command===door&&a.requestId===input.requestId).length,1);
      await refused(h,door,{...input,channel:'desk'},h.owner,409);
      return r;
    };
    actions['billing.agreement.accept']=async door=>{
      billingMember=historyMember;
      const draft=await h.cmd('pack.prepare',{personId:billingMember.id,credits:4,amountCents:8000,expiresAt:new Date(Date.now()+30*86400000).toISOString(),eligibleServices:['Fitness']});
      const pack=await h.cmd('pack.approve',{id:draft.id});
      const preview=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:randomUUID()});
      const terms=await h.cmd('plan.recurring.accept',{id:preview.id,key:preview.key},billingMember.cookie);
      billingAgreement=await h.cmd('billing.agreement.prepare',{termsId:terms.id,requestId:randomUUID(),adultVerified:true,adultEvidenceReference:'synthetic-strap-913',title:'Personal membership agreement',documentText:'Four Fitness classes each calendar-month term, with separately authorized recurring payment.'});
      await billingLaunch('billing.agreement.accept',door);
      await refused(h,'billing.agreement.accept',acceptance(billingAgreement,billingMember.name),h.owner);
      const signed=await h.cmd('billing.agreement.accept',acceptance(billingAgreement,billingMember.name),billingMember.cookie);
      assert.equal(signed.signature.actorId,(await h.state(billingMember.cookie)).actor.id);
    };
    actions['billing.setup.start']=async door=>{
      await billingSucceeded(h,'billing.connect',{accountId:'synthetic-strap-10',mode:'test',confirm:true,requestId:'synthetic-strap-910'});
      await billingLaunch('billing.setup.start',door);
      const input={id:billingAgreement.id,requestId:'synthetic-strap-911'};
      await refused(h,'billing.setup.start',input,h.owner);
      billingSetup=(await billingSucceeded(h,'billing.setup.start',input,billingMember.cookie)).result;
    };
    actions['billing.setup.complete']=async door=>{
      await billingLaunch('billing.setup.complete',door);
      const input={id:billingAgreement.id,setupId:billingSetup.id,requestId:'synthetic-strap-912'};
      await refused(h,'billing.setup.complete',input,h.owner);
      billing.setComplete(true);
      const saved=await billingSucceeded(h,'billing.setup.complete',input,billingMember.cookie);
      assert.equal(saved.result.authorizedBy,(await h.state(billingMember.cookie)).actor.id);
    };
    actions['billing.mandate.revoke']=async door=>{
      await billingLaunch('billing.mandate.revoke',door);
      await refused(h,'billing.mandate.revoke',{id:billingAgreement.id},h.owner);
      const revoked=await h.cmd('billing.mandate.revoke',{id:billingAgreement.id},billingMember.cookie);
      assert.equal(revoked.revokedBy,(await h.state(billingMember.cookie)).actor.id);
      assert.equal((await h.send('/api/strap/billing',undefined,billingMember.cookie)).value.methods[0].available,false);
    };
    // Work in actual action order so every pair has a real member state to change.
    for (const name of Object.keys(actions)) {
      const entry=memberCommands.find(c=>c.name===name)
      assert.ok(entry,`${name}: discovered as a member command`)
      assert.ok(catalogue.some(c=>c.name===entry.memberDoor.staff),`${name}: registered staff command`)
      await actions[name](entry.memberDoor.staff);covered.add(name)
      if (name.startsWith('reservation.')) assert.equal((await h.send(`/app/people?person=${seriesMember.id}`,undefined,h.owner)).status,200,'the staff history renders the recurring action and its before/after effects')
    }
    const historyPage=await h.send('/app/people',undefined,h.owner);assert.equal(historyPage.status,200,'all new canonical staff actions render in the shared history: '+historyPage.text)
    assert.equal((await h.send('/app/people?person='+ana.id,undefined,h.owner)).status,200,'member history renders guest and makeup effects')
    for (const entry of memberCommands) assert.ok(covered.has(entry.name),`${entry.name}: a new member action needs a tested staff pair`)
    const key=await h.cmd('agent.create',{label:'Staff parity agent'})
    for (const entry of memberCommands) {
      const input={id:'unknown',personId:ana.id,classId:future.id,waiverId:(await h.state()).waiver.id,requestId:randomUUID()}
      if(entry.name.startsWith('billing.'))input.id=billingAgreement.id;
      if(entry.name==='lead.referral.record')Object.assign(input,{personId:ben.id,friendEmail:ana.email});
      if(entry.name==='lead.winback.purchase')Object.assign(input,{id:winbackDeskOffer.id,key:winbackDeskOffer.key,confirm:true});
      if(entry.name==='lead.empty.accept')input.id=emptyDeskOffer.id;
      if(entry.name==='lead.nurture.purchase')Object.assign(input,{id:nurtureDeskOffer.id,key:nurtureDeskOffer.key,confirm:true});
      if(entry.name==='intro.preview') Object.assign(input,{personId:introDeskMember.id,offerId:introStaffPreview.offerId});
      if(entry.name==='intro.purchase') Object.assign(input,{id:introStaffPreview.id,key:introStaffPreview.key,confirm:true});
      if(entry.name==='contract.authority.revoke')input.id=contractGrant.id;
      if(['plan.cancellation.stop','plan.cancellation.statutory'].includes(entry.name))input.packId=contractPack.id;
      if (entry.name==='freeze.request') Object.assign(input,{packId:freezePack.id,freezeTypeId:freezeType.id,startAt:'2098-01-02',reason:'Unrelated member'});
      if (entry.name==='freeze.accept') input.id=freezePreview.id;
      if (entry.name==='freeze.end.accept') input.id=freezeEnd.id;
      if (entry.name==='freeze.request.withdraw') input.id=withdrawnRequest.id;
      if (entry.name==='freeze.withdraw') Object.assign(input,{id:freezeScheduled.id,withdrawKey:'unrelated'});
      if (entry.name==='plan.recurring.accept') Object.assign(input,{packId:invoicePack.id,intervalMonths:1});
      if (entry.name==='plan.recurring.stop') Object.assign(input,{id:invoiceTerms.id,reason:'Unrelated member'});
      if (entry.name.startsWith('absence.')) input.id=foreignMakeup.originalBookingId
      if (entry.name === 'makeup.book') Object.assign(input,{creditId:foreignMakeup.creditId,classId:makeupTarget.id})
      if (entry.name === 'makeup.guardian.revoke') input.id=foreignRelation.id
      if (entry.name === 'guest.preview') Object.assign(input,{sponsorId:ben.id,guestId:ana.id,packId:guestPack.id})
      if (entry.name === 'guest.book') Object.assign(input,{id:guestQuote.id,confirm:true})
      if (entry.name.startsWith('reservation.')) Object.assign(input,{personId:seriesMember.id,classId:reservationDraft.classId,throughDate:reservationDraft.throughDate,reservationId:reservation.id,id:entry.name==='reservation.cancel.confirm'?cancellationDraft.id:reservationDraft.id,key:entry.name==='reservation.cancel.confirm'?cancellationDraft.key:reservationDraft.key})
      // Self-capable shared commands still refuse acting for somebody else.
      if (['booking.cancel','booking.spot','booking.offer.accept','booking.move'].includes(entry.memberDoor.staff)) {
        const other=(await h.state()).bookings.find(b=>b.personId===ben.id&&b.status==='booked');input.id=other.id
        if (entry.memberDoor.staff==='booking.move') input.classId=near.id
      }
      const denial=['lead.winback.purchase','lead.empty.accept','lead.nurture.purchase','absence.preview','absence.report','makeup.book','makeup.guardian.revoke','plan.recurring.stop','freeze.request.withdraw','freeze.withdraw','contract.authority.revoke','plan.cancellation.stop','plan.cancellation.statutory','intro.preview','intro.purchase'].includes(entry.name)?404:403
      await refused(h,entry.memberDoor.staff,input,ana.cookie,denial)
      if (!['attendance.checkin'].includes(entry.memberDoor.staff)) await refused(h,entry.memberDoor.staff,input,coach.cookie,(entry.name.startsWith('intro.')||entry.name.startsWith('lead.'))?403:denial)
      const before=(await h.state()).version
      assert.equal((await h.send('/api/strap/agent/command',{name:entry.memberDoor.staff,input},'',{authorization:`Bearer ${key.token}`})).status,403)
      assert.equal((await h.state()).version,before)
    }
    const codeBefore=(await h.state()).checkinCodes.find(c=>c.personId===ana.id)
    await refused(h,'checkin.rotate',{personId:ana.id},h.owner,400)
    const rotated=await checkAudit('checkin.rotate',{personId:ana.id,reason:'Lost key tag',channel:'phone',requestId:randomUUID()})
    assert.notEqual(rotated.result.code,codeBefore.code);assert.equal(rotated.result.codeRevision,codeBefore.codeRevision+1)
    // SEC-002: search and download actual staff-made changes, without broadening access or rewriting history.
    const edit={personId:historyMember.id,phone:'6155550197',channel:'phone',revision:0,requestId:randomUUID()}
    await h.cmd('profile.save.staff',edit)
    await h.cmd('profile.save.staff',edit) // a replay remains one change in search and export
    await h.cmd('profile.save.staff',{personId:otherHistoryMember.id,phone:'6155550198',channel:'inbox',revision:0,requestId:randomUUID()})
    const historyQuery=new URLSearchParams({person:historyMember.id,auditActor:(await h.state()).actor.id,auditRight:'member-record',auditChannel:'phone',auditCommand:'profile.save.staff'})
    const history=await h.send('/api/strap/staff-history?'+historyQuery,undefined,h.owner)
    assert.equal(history.status,200);assert.equal(history.headers.get('cache-control'),'no-store')
    assert.equal(history.value.rows.length,1,'only the selected member, right, channel and command appear; replay is not duplicated')
    const change=history.value.rows[0]
    assert.deepEqual([change.actorRole,change.actorId,change.personId,change.right,change.channel,change.before.phone,change.after.phone],['owner',(await h.state()).actor.id,historyMember.id,'member-record','phone',null,'6155550197'])
    const {parseCsv}=await import('./report-downloads.mjs')
    const download=await h.send('/api/strap/staff-history.csv?'+historyQuery,undefined,h.owner)
    assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'no-store');assert.match(download.headers.get('content-disposition'),/attachment/)
    const [columns,...data]=parseCsv(download.text),exported=Object.fromEntries(columns.map((key,i)=>[key,data[0][i]]))
    assert.equal(data.length,1)
    assert.deepEqual(JSON.parse(exported.before),change.before);assert.deepEqual(JSON.parse(exported.after),change.after)
    for(const field of ['actorId','actorRole','personId','command','right','channel','at','reason'])assert.deepEqual(exported[field],change[field])
    const changedQuery=new URLSearchParams(historyQuery);changedQuery.set('auditChannel','inbox')
    assert.equal((await h.send('/api/strap/staff-history?'+changedQuery,undefined,h.owner)).value.rows.length,0)
    for(const [field,value] of [['auditActor','unrecorded-staff'],['auditRight','booking'],['auditCommand','booking.cancel'],['person',otherHistoryMember.id]]) {
      const excluded=new URLSearchParams(historyQuery);excluded.set(field,value)
      assert.equal((await h.send('/api/strap/staff-history?'+excluded,undefined,h.owner)).value.rows.length,0,field+' filters independently')
    }
    const empty=await h.send('/api/strap/staff-history.csv?'+changedQuery,undefined,h.owner);assert.equal(parseCsv(empty.text).length,1,'empty exports retain headers and no unrelated changes')
    const all=(await h.send('/api/strap/staff-history',undefined,h.owner)).value.rows
    for(let i=1;i<all.length;i++)assert.ok(all[i-1].at>=all[i].at,'history is newest first')
    assert.equal(all.filter(a=>a.personId===historyMember.id&&a.command==='profile.save.staff').length,1)
    assert.ok(all.some(a=>a.personId===otherHistoryMember.id&&a.channel==='inbox'&&a.after.phone==='6155550198'))
    const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(change.at))
    const dated=new URLSearchParams(historyQuery);dated.set('auditFrom',localDay);dated.set('auditTo',localDay)
    assert.deepEqual((await h.send('/api/strap/staff-history?'+dated,undefined,h.owner)).value.rows,history.value.rows,'inclusive studio-local bounds retain the exact change')
    dated.set('auditFrom','2099-12-30');dated.set('auditTo','2099-12-31')
    assert.equal((await h.send('/api/strap/staff-history?'+dated,undefined,h.owner)).value.rows.length,0,'out-of-period changes are excluded')
    const unused=await h.cmd('person.save',{name:'Unused History',email:'unused-history@studio.example',role:'member',active:true})
    await h.cmd('profile.save.staff',{personId:unused.id,phone:'6155550199',channel:'phone',revision:0,requestId:randomUUID()})
    await h.cmd('person.erase',{id:unused.id})
    const redacted=(await h.send('/api/strap/staff-history?person='+unused.id,undefined,h.owner)).value.rows
    assert.equal(redacted.length,1);assert.equal(redacted[0].erased,true)
    assert.deepEqual([redacted[0].before,redacted[0].after],[null,null],'existing unused-identity erasure keeps provenance without personal values')
    assert.ok(!JSON.stringify(redacted).includes('6155550199'))
    const redactedCsv=await h.send('/api/strap/staff-history.csv?person='+unused.id,undefined,h.owner)
    assert.ok(!redactedCsv.text.includes('6155550199'))
    const version=(await h.state()).version
    for(const path of ['/api/strap/staff-history','/api/strap/staff-history.csv']) {
      for(const cookie of [ana.cookie,coach.cookie,''])assert.equal((await h.send(path,undefined,cookie)).status,cookie?403:401)
      assert.equal((await h.send(path,undefined,'',{authorization:`Bearer ${key.token}`})).status,401)
      for(const query of ['auditFrom=2026-02-30','auditFrom=2026-02-02&auditTo=2026-02-01'])assert.equal((await h.send(path+'?'+query,undefined,h.owner)).status,400)
      assert.equal((await h.send(path,{},h.owner)).status,404,'no write door is exposed')
    }
    assert.equal((await h.state()).version,version,'search, exports, denied reads and attempted rewrites change no studio records')
    const fullExport=JSON.stringify(all)
    assert.ok(!fullExport.includes(rotated.result.code),'check-in credentials do not enter audit downloads')
    if(process.env.STRAP_PROOF_DIR)await(await import('./staff-actions-browser.mjs')).staffActionsBrowser(h,{ana,ben,publish,historyMember})
  },{auth:{STRIPE_BILLING_TEST_KEY:'synthetic-strap-999'},outbound:billing.outbound})
})

test('STAFF-006: invitation launch is an audited request, the new member alone acknowledges, code issuance and reasoned rotation replay once, and uncertain mail is never resent',async()=>{
  await run(async h=>{
    await h.cmd('studio.save',{location:'Nashville',timeZone:'America/Chicago'})
    const cy=await h.cmd('person.save',{name:'Cy',email:'cy@studio.example',role:'member',active:true})
    const w=await h.cmd('waiver.publish',{text:'Cy must acknowledge this exact version personally.'})
    const input={personId:cy.id,waiverId:w.id,requestId:randomUUID(),channel:'phone'}
    await refused(h,'waiver.launch',{...input,waiverId:'obsolete'},h.owner,409)
    const launch=await h.cmd('waiver.launch',input)
    assert.equal(launch.status,'requested');assert.equal((await h.state()).acknowledgements.length,0)
    const cookie=await followLink(h,cy.email)
    await refused(h,'waiver.acknowledge',{id:w.id,personId:cy.id},h.owner)
    await h.cmd('waiver.acknowledge',{id:w.id},cookie)
    const s=await h.state();assert.equal(s.acknowledgements[0].actorId,(await h.state(cookie)).actor.id)
    assert.equal(s.staffActions.filter(a=>a.command==='waiver.launch').length,1)
    const codeInput={personId:cy.id,requestId:randomUUID(),channel:'desk'}
    const code=await h.cmd('checkin.code.staff',codeInput)
    assert.equal((await h.cmd('checkin.code',{},cookie)).code,code.code,'member and staff receive the same first-issued code')
    const rotateInput={personId:cy.id,requestId:randomUUID(),channel:'phone',reason:'Lost tag'}
    const rotated=await h.cmd('checkin.rotate',rotateInput),replayed=await h.cmd('checkin.rotate',rotateInput)
    assert.deepEqual([replayed.code,replayed.codeRevision],[rotated.code,rotated.codeRevision])
    assert.equal((await h.state()).staffActions.filter(a=>a.command==='checkin.rotate').length,1)
    await refused(h,'checkin.code.staff',codeInput,h.owner,409)
    const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
    const records=portable.tables.st_records.map(r=>({kind:r.kind,data:JSON.parse(r.data)}))
    assert.equal(records.filter(r=>r.kind==='waiverLaunch').length,1)
    assert.equal(records.filter(r=>r.kind==='staffAction').length,3)
    assert.ok(!('st_waiver_launch_dispatches'in portable.tables))
  })
  await run(async h=>{
    await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
    const cy=await h.cmd('person.save',{name:'Cy',email:'cy@studio.example',role:'member',active:true})
    const w=await h.cmd('waiver.publish',{text:'An uncertain email cannot stand in for this person’s acknowledgment.'})
    await h.setAuth({TEST_MAIL_FAILURE:'unknown'})
    const beforeMails=(await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n
    const input={personId:cy.id,waiverId:w.id,requestId:randomUUID(),channel:'desk'}
    const first=await h.cmd('waiver.launch',input),again=await h.cmd('waiver.launch',input)
    assert.equal(first.status,'uncertain');assert.equal(again.status,'uncertain')
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n,beforeMails+1,'uncertainty never automatically mints/sends a second link')
    assert.equal((await h.state()).staffActions.filter(a=>a.command==='waiver.launch').length,1)
    assert.equal((await h.state()).acknowledgements.length,0)
    assert.match((await h.send('/app/people?person='+cy.id,undefined,h.owner)).text,/Outcome unknown; delivery not confirmed/)
  })
})
