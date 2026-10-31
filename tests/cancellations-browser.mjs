import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

const day=86_400_000,path='/app/packs#cancellations'
const wall=(zone,at=Date.now())=>{
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]))
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}:${p.second}`}
}
const dateTime=async(form,prefix,value)=>{
  await form.locator(`input[name="${prefix}Date"]`).fill(value.date)
  await form.locator(`input[name="${prefix}Time"]`).fill(value.time)
}
const commandForm=(page,name)=>page.locator(`form[action*="name=${name}"]`)
const actor=async(h,who)=>(await h.state(who.cookie)).actor.id

async function saleAndAgreement(h,who,requestId){
  const draft=await h.cmd('pack.prepare',{personId:who.id,credits:6,amountCents:12000,expiresAt:new Date(Date.now()+90*day).toISOString()})
  const acknowledgment=await h.cmd('pack.approve',{id:draft.id})
  const pack=(await h.state()).packs.find(p=>p.id===acknowledgment.id)
  assert.ok(pack,'the accepted pack is loaded from the public state')
  const proposal=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId})
  const terms=await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},who.cookie)
  assert.equal(terms.status,'active')
  return {pack,terms}
}

async function ownStopAndWithdrawal(c){
  const {h,staff,mine,nina,go,shot,key}=c,{pack,terms}=await saleAndAgreement(h,nina,key())
  await go(mine)
  const stop=mine.locator(`[data-cancellation-stop="${terms.id}"]`)
  assert.equal(await stop.locator('[name=reason]').count(),0)
  await stop.scrollIntoViewIfNeeded();await shot(mine,'member-one-step-stop')
  await stop.getByRole('button',{name:'Stop renewal now',exact:true}).click()
  const stopped=(await h.state(nina.cookie)).cancellations.cancellations.find(r=>r.termsId===terms.id&&r.status==='scheduled')
  assert.ok(stopped);assert.equal(stopped.terminatedBy,await actor(h,nina));assert.equal(stopped.effectiveAt,pack.expiresAt)
  await go(staff,nina)
  assert.equal(await staff.locator(`[data-contract-cancellation="${stopped.id}"]`).getByRole('button',{name:'Preview withdrawal of my cancellation',exact:true}).count(),0,'an owner cannot withdraw a member termination')
  await mine.locator(`[data-contract-cancellation="${stopped.id}"]`).getByRole('button',{name:'Preview withdrawal of my cancellation',exact:true}).click()
  const preview=(await h.state(nina.cookie)).cancellations.withdrawals.find(w=>w.cancellationId===stopped.id&&w.status==='preview')
  assert.ok(preview)
  await go(staff,nina)
  assert.equal(await staff.locator(`[data-cancellation-withdrawal="${preview.id}"]`).getByRole('button',{name:'Confirm withdrawal; keep invoices stopped',exact:true}).count(),0)
  const withdrawal=mine.locator(`[data-cancellation-withdrawal="${preview.id}"]`)
  await withdrawal.scrollIntoViewIfNeeded();await shot(mine,'terminator-withdrawal-preview')
  await withdrawal.getByRole('button',{name:'Confirm withdrawal; keep invoices stopped',exact:true}).click()
  const before=await h.state(nina.cookie)
  assert.equal(before.cancellations.cancellations.find(r=>r.id===stopped.id).status,'withdrawn')
  assert.equal(before.recurring.terms.find(r=>r.id===terms.id).status,'stopped')
  await shot(mine,'withdrawn-invoices-still-stopped')
  await staff.goto(h.origin+`/app/packs?person=${nina.id}#freezes`);await staff.reload()
  await staff.getByText('Propose recurring studio invoices',{exact:true}).click()
  const propose=commandForm(staff,'plan.recurring.prepare')
  await propose.locator('select[name=packId]').selectOption(pack.id)
  await propose.locator('input[name=intervalMonths]').fill('1')
  await propose.getByRole('button',{name:'Preview recurring invoices',exact:true}).click()
  const fresh=(await h.state()).recurring.terms.find(r=>r.packId===pack.id&&r.id!==terms.id&&r.status==='preview')
  assert.ok(fresh);assert.equal((await h.state()).recurring.terms.some(r=>r.currentPackId===pack.id&&r.status==='active'),false)
  await mine.goto(h.origin+'/app/packs#freezes');await mine.reload()
  const consent=mine.locator(`[data-recurring="${fresh.id}"]`)
  await consent.scrollIntoViewIfNeeded();await shot(mine,'fresh-member-invoice-consent')
  await consent.getByRole('button',{name:'I agree to these recurring invoices',exact:true}).click()
  const after=await h.state(nina.cookie)
  assert.equal(after.recurring.terms.find(r=>r.id===fresh.id).status,'active')
  assert.equal(after.recurring.terms.find(r=>r.id===fresh.id).acceptedBy,await actor(h,nina))
  assert.deepEqual(after.recurring.invoices.map(i=>i.id),before.recurring.invoices.map(i=>i.id),'fresh acceptance replays no old invoice')
}

async function allocateReceipt(c,pack,label){
  const {h,staff,go,shot,key}=c,reference=key()
  const receipt=await h.cmd('payment.record',{personId:pack.personId,amountCents:pack.amountCents,reference})
  const state=await h.state(),charge=state.charges.find(r=>r.packId===pack.id&&r.amountCents===pack.amountCents&&!r.reversesChargeId)
  assert.ok(charge)
  await go(staff,{id:pack.personId})
  await staff.getByText('Allocate an actual external receipt',{exact:true}).click()
  const allocation=commandForm(staff,'contract.prepayment.record')
  await allocation.locator('select[name=packId]').selectOption(pack.id)
  await allocation.locator('select[name=paymentId]').selectOption(receipt.id)
  await allocation.locator('select[name=chargeId]').selectOption(charge.id)
  await allocation.locator('input[name=amount]').fill((pack.amountCents/100).toFixed(2))
  await allocation.locator('input[name=reference]').fill(key())
  await allocation.scrollIntoViewIfNeeded();await shot(staff,label)
  await allocation.getByRole('button',{name:'Record receipt allocation',exact:true}).click()
}

async function ownerEarlyTermination(c){
  const {h,staff,nina,zone,go,shot,key}=c,{pack,terms}=await saleAndAgreement(h,nina,key())
  await allocateReceipt(c,pack,'early-receipt-allocation')
  await go(staff,nina)
  await staff.getByText('Prepare an earlier termination',{exact:true}).click()
  const prepare=commandForm(staff,'plan.cancellation.prepare')
  await prepare.locator('select[name=packId]').selectOption(pack.id)
  const effective={...wall(zone,Date.now()+14*day),time:'10:30:00'}
  await dateTime(prepare,'effective',effective)
  await prepare.locator('select[name=reasonCode]').selectOption(c.reasonCode)
  await prepare.locator('textarea[name=reason]').fill('The studio agreed to an earlier end after the member moved')
  await prepare.getByRole('button',{name:'Preview early termination',exact:true}).click()
  const preview=(await h.state()).cancellations.cancellations.find(r=>r.termsId===terms.id&&r.status==='preview')
  assert.deepEqual([preview.reasonCode,preview.reasonLabel],[c.reasonCode,'Moved away'])
  assert.ok(preview);assert.equal(preview.disposition,'refund_due');assert.equal(preview.effects.unusedPrepaid.paidCents,pack.amountCents)
  assert.deepEqual(wall(zone,Date.parse(preview.effectiveAt)),effective,'the chosen termination time uses the studio clock')
  assert.ok(preview.effects.unusedPrepaid.amountCents>0);assert.equal(preview.effects.finalChargeCents,0)
  const card=staff.locator(`[data-contract-cancellation="${preview.id}"]`)
  await card.scrollIntoViewIfNeeded();await shot(staff,'owner-exact-early-termination')
  await card.getByRole('button',{name:'Confirm this exact early termination',exact:true}).click()
  const confirmed=(await h.state()).cancellations.cancellations.find(r=>r.id===preview.id)
  assert.equal(confirmed.status,'scheduled');assert.equal(confirmed.effectiveAt,preview.effectiveAt)
  assert.equal(confirmed.terminatedBy,(await h.state()).actor.id)
  await staff.locator(`[data-contract-cancellation="${preview.id}"]`).scrollIntoViewIfNeeded();await shot(staff,'owner-early-termination-confirmed')
  await staff.goto(h.origin+'/app/studio#termination-reasons')
  const reason=staff.locator(`[data-termination-reason="${c.reasonCode}"]`)
  await reason.locator('[name=label]').fill('Relocated elsewhere');await reason.locator('[name=active]').selectOption('false')
  await reason.getByRole('button',{name:'Save reason code',exact:true}).click()
  await staff.locator('#termination-reasons').scrollIntoViewIfNeeded();await shot(staff,'owner-reason-retired')
  await go(staff,nina)
  assert.match(await staff.locator(`[data-contract-cancellation="${preview.id}"]`).innerText(),/Moved away/)
  const worklist=(await h.send('/api/strap/reports/renewals',undefined,h.owner)).value.rows.find(r=>r.terminationId===preview.id)
  assert.deepEqual([worklist.reasonCode,worklist.reasonLabel],[c.reasonCode,'Moved away'])
  await staff.goto(h.origin+'/app/renewals')
  const renewalRow=staff.locator(`[data-pack-id="${pack.id}"]`)
  assert.match(await renewalRow.innerText(),/Moved away/)
  await renewalRow.scrollIntoViewIfNeeded();await shot(staff,'renewal-historical-label')
}

async function statutoryRefund(c){
  const {h,staff,mine,nina,zone,go,shot,key}=c,{pack,terms}=await saleAndAgreement(h,nina,key())
  await allocateReceipt(c,pack,'statutory-receipt-allocation')
  await go(mine)
  await mine.getByText('Document a statutory cancellation',{exact:true}).click()
  const documented=commandForm(mine,'plan.cancellation.statutory')
  await documented.locator('select[name=packId]').selectOption(pack.id)
  await documented.locator('select[name=reasonCode]').selectOption('relocation')
  await dateTime(documented,'documented',wall(zone))
  await documented.locator('input[name=evidenceReference]').fill(key())
  await documented.locator('input[name=relocationMiles]').fill(String((await h.state()).cancellations.policy.relocationMiles+5))
  await documented.scrollIntoViewIfNeeded();await shot(mine,'documented-statutory-request')
  await documented.getByRole('button',{name:'Submit documented cancellation',exact:true}).click()
  const state=await h.state(nina.cookie),ended=state.cancellations.cancellations.find(r=>r.termsId===terms.id&&r.status==='applied')
  assert.ok(ended,'the documented request takes effect without owner approval')
  const due=state.cancellations.refunds.find(r=>r.cancellationId===ended.id)
  assert.ok(due);assert.equal(due.status,'refund_due');assert.ok(due.amountCents>0&&due.amountCents<=pack.amountCents)
  assert.equal(await mine.locator(`[data-cancellation-refund="${due.id}"] form`).count(),0,'members see refund due, while external settlement stays owner-only')
  await mine.locator(`[data-cancellation-refund="${due.id}"]`).scrollIntoViewIfNeeded();await shot(mine,'member-unused-prepaid-refund-due')
  await go(staff,nina)
  const settlement=staff.locator(`[data-cancellation-refund="${due.id}"] form[action*="name=plan.cancellation.refund.settle"]`)
  await settlement.locator('select[name=payerId]').selectOption(nina.id)
  await settlement.locator('input[name=amount]').fill((due.amountCents/100).toFixed(2))
  await settlement.locator('input[name=reference]').fill(key())
  await dateTime(settlement,'settled',wall(zone))
  await settlement.scrollIntoViewIfNeeded();await shot(staff,'owner-external-refund-settlement')
  await settlement.getByRole('button',{name:'Record external refund settlement',exact:true}).click()
  const settled=(await h.state()).cancellations.refunds.find(r=>r.id===due.id)
  assert.equal(settled.status,'settled');assert.equal(settled.settledCents,due.amountCents)
  await staff.locator(`[data-cancellation-refund="${due.id}"]`).scrollIntoViewIfNeeded();await shot(staff,'external-refund-settled')
}

async function authorityJourneys(c){
  const {h,staff,mine,payerPage,guardianPage,nina,payer,guardian,child,go,shot,key}=c
  const record=async(person,delegate,kind)=>{
    await go(staff)
    await staff.getByText('Record verified contract authority',{exact:true}).click()
    const form=commandForm(staff,'contract.authority.save')
    await form.locator('select[name=personId]').selectOption(person.id)
    await form.locator('select[name=delegateId]').selectOption(delegate.id)
    await form.locator('select[name=kind]').selectOption(kind)
    if(kind==='minor-guardian')await form.locator('input[name=adultOn]').fill(`${new Date().getUTCFullYear()+1}-07-01`)
    await form.locator('input[name=evidenceReference]').fill(key())
    await form.scrollIntoViewIfNeeded();await shot(staff,kind+'-authority-record')
    await form.getByRole('button',{name:'Record authority for acceptance',exact:true}).click()
    const grant=(await h.state()).cancellations.authorities.find(g=>g.personId===person.id&&g.delegateId===delegate.id&&g.kind===kind&&!g.revokedAt)
    assert.ok(grant);return grant
  }
  const accept=async(page,grant)=>{
    await go(page)
    await page.locator(`[data-contract-authority="${grant.id}"]`).getByRole('button',{name:'Accept my cancellation authority',exact:true}).click()
  }
  const payerPlan=await saleAndAgreement(h,nina,key())
  const retail={id:key(),personId:nina.id,reason:'retail',description:'Private retail purchase',amountCents:43127,createdAt:new Date().toISOString()};
  await h.db.prepare('INSERT INTO st_records(id,kind,data,version) VALUES(?,?,?,0)').bind(retail.id,'charge',JSON.stringify(retail)).run();
  const payerGrant=await record(nina,payer,'payer')
  await go(payerPage);assert.equal(await payerPage.locator(`[data-contract-authority="${payerGrant.id}"]`).count(),0,'the payer sees no new invitation or contract facts before participant consent');await shot(payerPage,'payer-before-participant-consent');
  await accept(mine,payerGrant);await accept(payerPage,payerGrant)
  await go(payerPage)
  const payerStop=payerPage.locator(`[data-cancellation-stop="${payerPlan.terms.id}"]`)
  assert.equal(await payerStop.locator('[name=reason]').count(),0)
  await payerStop.scrollIntoViewIfNeeded();await shot(payerPage,'payer-own-account-stop')
  await payerStop.getByRole('button',{name:'Stop renewal now',exact:true}).click()
  const cancelled=(await h.state(payer.cookie)).cancellations.cancellations.find(r=>r.termsId===payerPlan.terms.id&&r.status==='scheduled')
  assert.ok(cancelled);assert.equal(cancelled.terminatedBy,await actor(h,payer));assert.equal(cancelled.effects.existingBalanceCents,12000);assert.ok(!JSON.stringify((await h.state(payer.cookie)).cancellations).includes(retail.id));
  const payerConfirmation=payerPage.locator(`[data-contract-cancellation="${cancelled.id}"]`);assert.match(await payerConfirmation.innerText(),/Covered-agreement balance \$120\.00/);assert.doesNotMatch(await payerConfirmation.innerText(),/431\.27|Private retail/);await payerConfirmation.scrollIntoViewIfNeeded();await shot(payerPage,'payer-covered-agreement-only');
  await go(mine)
  assert.equal(await mine.locator(`[data-contract-cancellation="${cancelled.id}"]`).getByRole('button',{name:'Preview withdrawal of my cancellation',exact:true}).count(),0,'the participant cannot withdraw the payer’s termination')
  const guardianGrant=await record(child,guardian,'minor-guardian')
  await accept(guardianPage,guardianGrant)
  const childPlan=await saleAndAgreement(h,child,key())
  await go(guardianPage)
  const guardianStop=guardianPage.locator(`[data-cancellation-stop="${childPlan.terms.id}"]`)
  await guardianStop.scrollIntoViewIfNeeded();await shot(guardianPage,'guardian-own-account-stop')
  await guardianStop.getByRole('button',{name:'Stop renewal now',exact:true}).click()
  const guardianState=await h.state(guardian.cookie),ended=guardianState.cancellations.cancellations.find(r=>r.termsId===childPlan.terms.id&&r.status==='scheduled')
  assert.ok(ended);assert.equal(ended.terminatedBy,await actor(h,guardian))
  assert.equal(guardianState.cancellations.authorities.find(g=>g.id===guardianGrant.id).memberAcceptedAt,null,'the child need not accept legal-guardian cancellation authority')
  const expired={...(await h.state()).cancellations.authorities.find(g=>g.id===guardianGrant.id),adultAt:new Date(Date.now()-1000).toISOString(),authorityEndsAt:new Date(Date.now()-1000).toISOString()};
  await h.db.prepare('UPDATE st_records SET data=? WHERE kind=? AND id=?').bind(JSON.stringify(expired),'contractAuthority',expired.id).run();
  await go(guardianPage);assert.equal(await guardianPage.locator(`[data-contract-cancellation="${ended.id}"]`).count(),0);
  const expiredGrant=guardianPage.locator(`[data-contract-authority="${guardianGrant.id}"]`);assert.match(await expiredGrant.innerText(),/Ends/);await expiredGrant.scrollIntoViewIfNeeded();await shot(guardianPage,'guardian-expired-end-date');
  assert.equal((await h.state()).cancellations.cancellations.find(r=>r.id===ended.id).status,'scheduled','expiry preserves a prior cancellation');
  await go(await c.childPage());
  const adult=c.adultPage;await adult.locator(`[data-contract-cancellation="${ended.id}"]`).getByRole('button',{name:'Preview withdrawal of my cancellation',exact:true}).click();
  const restore=(await h.state(child.cookie)).cancellations.withdrawals.find(w=>w.cancellationId===ended.id&&w.status==='preview');
  await adult.locator(`[data-cancellation-withdrawal="${restore.id}"]`).getByRole('button',{name:'Confirm withdrawal; keep invoices stopped',exact:true}).click();
  assert.equal((await h.state()).recurring.terms.find(t=>t.id===childPlan.terms.id).status,'stopped');
  await adult.locator(`[data-cancellation-withdrawal="${restore.id}"]`).scrollIntoViewIfNeeded();await shot(adult,'adult-restores-with-fresh-consent-required');
  const newTerms=await h.cmd('plan.recurring.prepare',{packId:childPlan.pack.id,intervalMonths:1,requestId:key()});await go(adult);const consent=adult.locator(`[data-recurring="${newTerms.id}"]`);await consent.scrollIntoViewIfNeeded();await shot(adult,'adult-fresh-invoice-acceptance');await consent.getByRole('button',{name:'I agree to these recurring invoices',exact:true}).click();assert.equal((await h.state()).recurring.terms.find(t=>t.id===newTerms.id).status,'active');
  for(const [page,who,grant,label,cancellationId] of [[payerPage,payer,payerGrant,'payer',cancelled.id],[guardianPage,guardian,guardianGrant,'guardian',ended.id]]){
    await go(page)
    await page.locator(`[data-contract-authority="${grant.id}"]`).getByRole('button',{name:'Revoke cancellation authority',exact:true}).click()
    assert.ok((await h.state()).cancellations.authorities.find(g=>g.id===grant.id).revokedAt)
    assert.equal((await h.state(who.cookie)).cancellations.cancellations.some(r=>r.personId===grant.personId),false)
    assert.equal(await page.locator(`[data-contract-cancellation="${cancellationId}"]`).count(),0)
    await page.locator(`[data-contract-authority="${grant.id}"]`).scrollIntoViewIfNeeded();await shot(page,label+'-authority-revoked')
  }
}

async function ownerPayerRevocation(c,width){
  const {h,nina,payer,staff,go,shot,key}=c
  const {pack,terms}=await saleAndAgreement(h,nina,key())
  const grant=await h.cmd('contract.authority.save',{personId:nina.id,delegateId:payer.id,kind:'payer',evidenceReference:key()})
  await h.cmd('contract.authority.accept',{id:grant.id},nina.cookie)
  await h.cmd('contract.authority.accept',{id:grant.id},payer.cookie)
  await go(staff,nina)
  const article=staff.locator(`[data-contract-authority="${grant.id}"]`),form=article.locator('form[action*="name=contract.authority.revoke"]')
  assert.match(await form.innerText(),/never on studio initiative/)
  const options=await form.locator('[name=requestedByPersonId] option').evaluateAll(nodes=>nodes.map(n=>n.value))
  assert.deepEqual(options,[nina.id,payer.id],'only the two named parties can request owner revocation')
  await form.locator('[name=reason]').fill('Named party requested revocation by phone')
  await form.locator('[name=requestedByPersonId]').selectOption(width===1440?nina.id:payer.id)
  const before=(await h.state()).version
  await form.getByRole('button',{name:'Revoke cancellation authority',exact:true}).click()
  assert.equal((await h.state()).version,before,'missing recorded request evidence prevents form submission')
  const evidence=key()
  await form.locator('[name=requestEvidenceReference]').fill(evidence)
  await form.scrollIntoViewIfNeeded();await shot(staff,'owner-payer-revocation-recorded-party-request')
  await form.getByRole('button',{name:'Revoke cancellation authority',exact:true}).click()
  const state=await h.state(),revoked=state.cancellations.authorities.find(g=>g.id===grant.id)
  assert.ok(revoked.revokedAt)
  assert.equal(revoked.revocationRequestedByPersonId,width===1440?nina.id:payer.id)
  assert.equal(revoked.revocationRequestEvidenceReference,evidence)
  assert.ok(!(await h.state(payer.cookie)).cancellations.contracts.some(t=>t.id===terms.id))
  await article.scrollIntoViewIfNeeded();assert.match(await article.innerText(),/Revoked/);await shot(staff,'owner-payer-revocation-confirmed')
  await staff.goto(h.origin+'/app/people?person='+nina.id+'#staff-actions')
  const audit=staff.locator('#staff-actions')
  const event=state.staffActions.find(a=>a.command==='contract.authority.revoke'&&a.after.id===grant.id)
  assert.equal(event.after.revocationRequestEvidenceReference,evidence)
  const row=audit.locator('[data-staff-command="contract.authority.revoke"]').first()
  await row.scrollIntoViewIfNeeded();await shot(staff,'owner-payer-revocation-audit')
}

export async function cancellationsBrowser(h,{nina,payer,guardian,child,stranger}){
  const proof=process.env.STRAP_PROOF_DIR??process.env.STRAP_RIGHTS_PROOF_DIR
  await mkdir(proof,{recursive:true})
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  let sequence=800
  try{
    for(const width of [1440,390]){
      const contexts=[]
      try{
        const pageFor=async cookie=>{
          const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context)
          await context.route(h.origin+'/**',async route=>{
            const asset=new URL(route.request().url()).pathname
            if(!asset.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(asset))return route.fulfill({body:await readFile(join(process.cwd(),'public',asset)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(asset)]})
            return route.continue()
          })
          const eq=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,eq),value:cookie.slice(eq+1),url:h.origin}]);return context.newPage()
        }
        const staff=await pageFor(h.owner),mine=await pageFor(nina.cookie),payerPage=await pageFor(payer.cookie),guardianPage=await pageFor(guardian.cookie),outsider=await pageFor(stranger.cookie)
        const go=async(page,who)=>{await page.goto(h.origin+(who?`/app/packs?person=${who.id}#cancellations`:path));await page.reload()}
        const shot=async(page,label)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'the page fits the viewport');await page.screenshot({path:join(proof,`PLAN007-${label}-${width}.png`),fullPage:false})}
        const key=()=>`synthetic-strap-${sequence++}`,zone=(await h.state()).studio.timeZone
        // End seed grants through the actual owner form, so each width starts fresh.
        for(const grant of (await h.state()).cancellations.authorities.filter(g=>!g.revokedAt&&((g.personId===nina.id&&g.delegateId===payer.id)||(g.personId===child.id&&g.delegateId===guardian.id)))){
          await go(staff)
          const revoke=staff.locator(`[data-contract-authority="${grant.id}"] form[action*="name=contract.authority.revoke"]`)
          if(grant.kind==='payer'){
            await revoke.locator('[name=requestedByPersonId]').selectOption(grant.personId)
            await revoke.locator('[name=requestEvidenceReference]').fill(key())
          }
          await revoke.locator('textarea[name=reason]').fill('The named participant and delegate requested fresh reviewed authority')
          await revoke.getByRole('button',{name:'Revoke cancellation authority',exact:true}).click()
        }
        const adultPage=await pageFor(child.cookie);const context={h,nina,payer,guardian,child,staff,mine,payerPage,guardianPage,go,shot,key,zone,adultPage,childPage:async()=>adultPage}
        context.reasonCode='moved-away-'+width
        await staff.goto(h.origin+'/app/studio#termination-reasons')
        await staff.getByText('Add termination reason',{exact:true}).click()
        const add=staff.locator('#termination-reasons form').filter({has:staff.locator('input[name=code]')}).last()
        await add.locator('[name=code]').fill(context.reasonCode);await add.locator('[name=label]').fill('Moved away')
        await add.getByRole('button',{name:'Add reason code',exact:true}).click()
        assert.equal((await h.state()).cancellations.reasonCodes.find(r=>r.code===context.reasonCode).label,'Moved away')
        await staff.locator('#termination-reasons').scrollIntoViewIfNeeded();await shot(staff,'owner-reason-catalog')
        await ownStopAndWithdrawal(context)
        await ownerEarlyTermination(context)
        await statutoryRefund(context)
        await authorityJourneys(context)
        await ownerPayerRevocation(context,width)
        await go(outsider,nina)
        assert.doesNotMatch(await outsider.locator('#cancellations').innerText(),/Nina|Kira|Oscar/, 'another member’s contract, payer and guardian identities stay private; the account still sees its own stop door')
        const privateView=(await h.state(stranger.cookie)).cancellations
        for(const field of ['authorities','contracts','requests','cancellations','withdrawals','statements','refunds','settlements'])assert.equal(privateView[field].filter(r=>[nina.id,child.id].includes(r.personId)).length,0)
        await outsider.locator('#cancellations').scrollIntoViewIfNeeded();await shot(outsider,'unrelated-account-private')
      }finally{for(const context of contexts)await context.close()}
    }
  }finally{await browser.close()}
}

export async function staffTerminationsBrowser(h,s){
  const proof=process.env.STRAP_PROOF_DIR??process.env.STRAP_RIGHTS_PROOF_DIR
  await mkdir(proof,{recursive:true})
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try{
    for(const width of [1440,390]){
      const context=await browser.newContext({viewport:{width,height:1000}})
      try{
        await context.route(h.origin+'/**',async route=>{
          const asset=new URL(route.request().url()).pathname,types={'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}
          if(!asset.includes('..')&&types[extname(asset)])return route.fulfill({body:await readFile(join(process.cwd(),'public',asset)),contentType:types[extname(asset)]})
          return route.continue()
        })
        const i=s.desk.cookie.indexOf('=');await context.addCookies([{name:s.desk.cookie.slice(0,i),value:s.desk.cookie.slice(i+1),url:h.origin}])
        const page=await context.newPage();page.setDefaultTimeout(15000)
        const {pack}=await saleAndAgreement(h,s.ben,'synthetic-strap-staff-browser-'+width)
        const url=h.origin+'/app/people?person='+s.ben.id+'#staff-terminations'
        const shot=async label=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(proof,`PLAN012-staff-${label}-${width}.png`)})}
        await s.grant(s.desk,'front-desk',['member-record'],[s.ben.id],['studio'])
        await page.goto(url)
        assert.equal(await commandForm(page,'plan.cancellation.prepare').count(),0)
        await s.grant(s.desk,'front-desk',['member-record','contract-change'],[s.ben.id],['studio'])
        const scoped=await h.state(s.desk.cookie)
        assert.ok(scoped.staffTerminationContracts.some(t=>t.packId===pack.id),'the selected contract is in the current staff scope')
        assert.ok(scoped.terminationReasonCodes.some(r=>r.code==='moved-away'),'active reasons are available to permitted staff')
        await page.goto(url);const response=await page.reload();assert.equal(response.status(),200,await page.locator('body').innerText())
        await page.getByText('Prepare an earlier termination',{exact:true}).click()
        const form=commandForm(page,'plan.cancellation.prepare')
        await form.locator('[name=packId]').selectOption(pack.id)
        await form.locator('[name=reasonCode]').selectOption('moved-away')
        await form.locator('[name=reason]').fill('Member is moving away')
        await dateTime(form,'effective',wall((await h.state()).studio.timeZone,Date.now()+30*day))
        await form.getByRole('button',{name:'Preview early termination',exact:true}).click()
        const preview=(await h.state()).cancellations.cancellations.find(c=>c.packId===pack.id&&c.status==='preview')
        assert.ok(preview)
        const card=page.locator(`[data-contract-cancellation="${preview.id}"]`)
        assert.match(await card.innerText(),/Moved away \(moved-away\)/)
        await card.scrollIntoViewIfNeeded();await shot('preview')
        await s.grant(s.desk,'front-desk',['member-record'],[s.ben.id],['studio'])
        const version=(await h.state()).version
        await card.getByRole('button',{name:'Confirm this exact early termination',exact:true}).click()
        assert.equal((await h.state()).version,version)
        assert.equal((await h.state()).cancellations.cancellations.find(c=>c.id===preview.id).status,'preview')
        assert.equal(await commandForm(page,'plan.cancellation.confirm').count(),0)
        await shot('revoked')
        await s.grant(s.desk,'front-desk',['member-record','contract-change'],[s.ben.id],['studio'])
        await page.goto(url);await page.reload()
        await page.locator(`[data-contract-cancellation="${preview.id}"]`).getByRole('button',{name:'Confirm this exact early termination',exact:true}).click()
        const state=await h.state(),confirmed=state.cancellations.cancellations.find(c=>c.id===preview.id)
        assert.deepEqual([confirmed.status,confirmed.reasonCode,confirmed.reasonLabel],['scheduled','moved-away','Moved away'])
        const audit=state.staffActions.filter(a=>a.command==='plan.cancellation.confirm'&&a.after.id===preview.id)
        assert.equal(audit.length,1);assert.equal(audit[0].actorRole,'front-desk');assert.equal(audit[0].after.reasonLabel,'Moved away')
        await page.locator(`[data-contract-cancellation="${preview.id}"]`).scrollIntoViewIfNeeded();await shot('confirmed')
        if(width===390){
          const current=page.locator(`[data-contract-cancellation="${preview.id}"]`);
          await current.getByRole('button',{name:'Preview withdrawal of my cancellation',exact:true}).click();
          const withdrawal=(await h.state()).cancellations.withdrawals.find(w=>w.cancellationId===preview.id&&w.status==='preview');assert.ok(withdrawal);
          const withdrawalCard=page.locator(`[data-cancellation-withdrawal="${withdrawal.id}"]`);
          assert.match(await withdrawalCard.innerText(),/Invoice authority stays stopped/);
          for(const proofWidth of [390,1440]){await page.setViewportSize({width:proofWidth,height:1000});await withdrawalCard.scrollIntoViewIfNeeded();await page.screenshot({path:join(proof,`PLAN012-staff-withdrawal-preview-${proofWidth}.png`)});}
          await page.setViewportSize({width:390,height:1000});
          await s.grant(s.desk,'front-desk',['member-record'],[s.ben.id],['studio']);
          const version=(await h.state()).version;
          await withdrawalCard.getByRole('button',{name:'Confirm withdrawal; keep invoices stopped',exact:true}).click();
          assert.equal((await h.state()).version,version);assert.equal(await commandForm(page,'plan.cancellation.withdraw.confirm').count(),0);
          await s.grant(s.desk,'front-desk',['member-record','contract-change'],[s.ben.id],['studio']);
          await page.goto(url);await page.reload();
          await page.locator(`[data-cancellation-withdrawal="${withdrawal.id}"]`).getByRole('button',{name:'Confirm withdrawal; keep invoices stopped',exact:true}).click();
          const after=await h.state();assert.equal(after.cancellations.cancellations.find(c=>c.id===preview.id).status,'withdrawn');
          assert.equal(after.recurring.terms.find(t=>t.currentPackId===pack.id).status,'stopped');
          assert.equal(after.staffActions.filter(a=>a.command==='plan.cancellation.withdraw.confirm'&&a.after.id===withdrawal.id).length,1);
          assert.match(await page.locator(`[data-cancellation-withdrawal="${withdrawal.id}"]`).innerText(),/confirmed/);
          for(const proofWidth of [390,1440]){await page.setViewportSize({width:proofWidth,height:1000});await page.locator(`[data-cancellation-withdrawal="${withdrawal.id}"]`).scrollIntoViewIfNeeded();await page.screenshot({path:join(proof,`PLAN012-staff-withdrawn-${proofWidth}.png`)});}
        }
      }finally{await context.close()}
    }
  }finally{await browser.close()}
}


export async function terminationDraftBrowser(h,{member,draft}){
  const proof=process.env.STRAP_PROOF_DIR??process.env.STRAP_RIGHTS_PROOF_DIR;await mkdir(proof,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  try{
    const context=await browser.newContext({viewport:{width:390,height:1000}});
    try{
      await context.route(h.origin+'/**',async route=>{
        const asset=new URL(route.request().url()).pathname,types={'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'};
        if(!asset.includes('..')&&types[extname(asset)])return route.fulfill({body:await readFile(join(process.cwd(),'public',asset)),contentType:types[extname(asset)]});
        return route.continue();
      });
      const eq=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,eq),value:h.owner.slice(eq+1),url:h.origin}]);
      const page=await context.newPage();await page.goto(h.origin+'/app/packs?person='+member.id+'#cancellations');
      const card=page.locator(`[data-contract-cancellation="${draft.id}"]`);
      assert.match(await card.innerText(),/Agent-prepared draft/);assert.match(await card.innerText(),/Relocation \(agent-move\)/);
      assert.equal(await card.getByRole('button',{name:'Confirm this exact early termination',exact:true}).count(),1);
      for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await card.scrollIntoViewIfNeeded();await page.screenshot({path:join(proof,`PLAN012-agent-draft-${width}.png`)});}
    }finally{await context.close();}
  }finally{await browser.close();}
}
