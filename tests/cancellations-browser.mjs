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
  await prepare.locator('textarea[name=reason]').fill('The studio agreed to an earlier end after the member moved')
  await prepare.getByRole('button',{name:'Preview early termination',exact:true}).click()
  const preview=(await h.state()).cancellations.cancellations.find(r=>r.termsId===terms.id&&r.status==='preview')
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
  const payerGrant=await record(nina,payer,'payer')
  await go(payerPage);assert.equal(await payerPage.locator(`[data-contract-authority="${payerGrant.id}"]`).count(),0,'the payer sees no new invitation or contract facts before participant consent');await shot(payerPage,'payer-before-participant-consent');
  await accept(mine,payerGrant);await accept(payerPage,payerGrant)
  await go(payerPage)
  const payerStop=payerPage.locator(`[data-cancellation-stop="${payerPlan.terms.id}"]`)
  assert.equal(await payerStop.locator('[name=reason]').count(),0)
  await payerStop.scrollIntoViewIfNeeded();await shot(payerPage,'payer-own-account-stop')
  await payerStop.getByRole('button',{name:'Stop renewal now',exact:true}).click()
  const cancelled=(await h.state(payer.cookie)).cancellations.cancellations.find(r=>r.termsId===payerPlan.terms.id&&r.status==='scheduled')
  assert.ok(cancelled);assert.equal(cancelled.terminatedBy,await actor(h,payer))
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
  for(const [page,who,grant,label,cancellationId] of [[payerPage,payer,payerGrant,'payer',cancelled.id],[guardianPage,guardian,guardianGrant,'guardian',ended.id]]){
    await go(page)
    await page.locator(`[data-contract-authority="${grant.id}"]`).getByRole('button',{name:'Revoke cancellation authority',exact:true}).click()
    assert.ok((await h.state()).cancellations.authorities.find(g=>g.id===grant.id).revokedAt)
    assert.equal((await h.state(who.cookie)).cancellations.cancellations.some(r=>r.personId===grant.personId),false)
    assert.equal(await page.locator(`[data-contract-cancellation="${cancellationId}"]`).count(),0)
    await page.locator(`[data-contract-authority="${grant.id}"]`).scrollIntoViewIfNeeded();await shot(page,label+'-authority-revoked')
  }
}

export async function cancellationsBrowser(h,{nina,payer,guardian,child,stranger}){
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
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
        const shot=async(page,label)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'the page fits the viewport');await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`PLAN007-${label}-${width}.png`),fullPage:false})}
        const key=()=>`synthetic-strap-${sequence++}`,zone=(await h.state()).studio.timeZone
        // End seed grants through the actual owner form, so each width starts fresh.
        for(const grant of (await h.state()).cancellations.authorities.filter(g=>!g.revokedAt&&((g.personId===nina.id&&g.delegateId===payer.id)||(g.personId===child.id&&g.delegateId===guardian.id)))){
          await go(staff)
          const revoke=staff.locator(`[data-contract-authority="${grant.id}"] form[action*="name=contract.authority.revoke"]`)
          await revoke.locator('textarea[name=reason]').fill('The named participant and delegate requested fresh reviewed authority')
          await revoke.getByRole('button',{name:'Revoke cancellation authority',exact:true}).click()
        }
        const context={h,nina,payer,guardian,child,staff,mine,payerPage,guardianPage,go,shot,key,zone}
        await ownStopAndWithdrawal(context)
        await ownerEarlyTermination(context)
        await statutoryRefund(context)
        await authorityJourneys(context)
        await go(outsider,nina)
        assert.doesNotMatch(await outsider.locator('#cancellations').innerText(),/Nina|Kira|Oscar/, 'another member’s contract, payer and guardian identities stay private; the account still sees its own stop door')
        const privateView=(await h.state(stranger.cookie)).cancellations
        for(const field of ['authorities','contracts','requests','cancellations','withdrawals','statements','refunds','settlements'])assert.equal(privateView[field].filter(r=>[nina.id,child.id].includes(r.personId)).length,0)
        await outsider.locator('#cancellations').scrollIntoViewIfNeeded();await shot(outsider,'unrelated-account-private')
      }finally{for(const context of contexts)await context.close()}
    }
  }finally{await browser.close()}
}
