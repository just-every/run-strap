import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {join,extname} from 'node:path'
import {chromium} from '@playwright/test'

const formFor=(page,name)=>page.locator(`form[action*="name=${name}"]`)
const presence='I confirm I am physically present at this studio while accepting this agreement.'

async function settingsAndSale(c){
  const {h,staff,pageFor,shot,key,fixtures}=c
  await staff.goto(h.origin+'/app/packs#cancellations')
  await staff.getByText('Statutory cancellation settings',{exact:true}).click()
  const settings=formFor(staff,'plan.cancellation.policy.save')
  await settings.locator('[name=studioOpenedOn]').fill('2025-01-01')
  await settings.locator('[name=studioOpeningEvidenceReference]').fill(key())
  for(const region of ['GA','FL','CA'])await settings.locator(`[name=deduction_${region}]`).check()
  await settings.scrollIntoViewIfNeeded();await shot(staff,'owner-statutory-settings')
  await settings.getByRole('button',{name:'Save cancellation settings',exact:true}).click()
  const policy=(await h.state()).cancellations.policy
  assert.equal(policy.studioOpenedOn,'2025-01-01')
  assert.deepEqual(policy.coolingDeductions,{GA:true,FL:true,CA:true})

  await staff.goto(h.origin+'/app/packs?person='+fixtures.saleMember.id+'#prepare-pack')
  const prepare=formFor(staff,'pack.prepare')
  await prepare.locator('[name=personId]').selectOption(fixtures.saleMember.id)
  await prepare.locator('[name=credits]').fill('10')
  await prepare.locator('[name=amount]').fill('59.00')
  await prepare.locator('[name=initiationFee]').fill('199.00')
  await prepare.scrollIntoViewIfNeeded();await shot(staff,'owner-initiation-fee-form')
  await prepare.getByRole('button',{name:'Prepare pack',exact:true}).click()
  const draft=(await h.state()).drafts.find(d=>d.personId===fixtures.saleMember.id&&d.type==='pack'&&d.status==='draft')
  assert.ok(draft);assert.equal(draft.amountCents,5900);assert.equal(draft.initiationFeeCents,19900)
  const preview=staff.locator(`#draft-${draft.id}`)
  await preview.scrollIntoViewIfNeeded()
  assert.match(await preview.innerText(),/\$199\.00/);assert.match(await preview.innerText(),/\$258\.00/)
  await shot(staff,'owner-initiation-fee-preview')
  await preview.getByRole('button',{name:'Approve this exact pack',exact:true}).click()
  const pack=(await h.state()).packs.find(p=>p.draftId===draft.id)
  assert.ok(pack)

  await staff.goto(h.origin+'/app/packs?person='+fixtures.saleMember.id+'#freezes')
  await staff.getByText('Propose recurring studio invoices',{exact:true}).click()
  const proposal=formFor(staff,'plan.recurring.prepare')
  await proposal.locator('[name=packId]').selectOption(pack.id)
  await proposal.locator('[name=contractAcceptanceChannel]').selectOption('in-person')
  const evidence=key()
  await proposal.locator('[name=acceptanceEvidenceReference]').fill(evidence)
  await proposal.scrollIntoViewIfNeeded();await shot(staff,'owner-in-person-proposal')
  await proposal.getByRole('button',{name:'Preview recurring invoices',exact:true}).click()
  const terms=(await h.state()).recurring.terms.find(t=>t.packId===pack.id)
  assert.ok(terms)
  const ownerPreview=staff.locator(`[data-recurring="${terms.id}"]`)
  assert.ok((await ownerPreview.innerText()).includes(presence))
  assert.match(await ownerPreview.innerText(),/2025-01-01/)
  await ownerPreview.scrollIntoViewIfNeeded();await shot(staff,'owner-in-person-exact-preview')
  const member=await pageFor(fixtures.saleMember.cookie)
  await member.goto(h.origin+'/app/packs#freezes')
  const memberPreview=member.locator(`[data-recurring="${terms.id}"]`)
  const confirm=memberPreview.getByRole('checkbox',{name:presence,exact:true})
  assert.equal(await confirm.getAttribute('required'),'')
  assert.equal(await confirm.isChecked(),false)
  assert.match(await memberPreview.innerText(),/\$199\.00 one-time initiation fee/)
  assert.match(await memberPreview.innerText(),/Each recurring invoice is \$59\.00/)
  await memberPreview.scrollIntoViewIfNeeded();await shot(member,'member-in-person-confirmation')
  await confirm.check()
  await memberPreview.getByRole('button',{name:'I agree to these recurring invoices',exact:true}).click()
  const accepted=(await h.state()).recurring.terms.find(t=>t.id===terms.id)
  assert.equal(accepted.acceptedChannel,'member-self-service')
  assert.equal(accepted.contractAcceptanceChannel,'in-person');assert.equal(accepted.acceptancePresent,true)
  assert.equal(accepted.acceptanceEvidenceReference,evidence);assert.equal(accepted.studioOpenedOn,'2025-01-01')
  await member.locator(`[data-recurring="${terms.id}"]`).scrollIntoViewIfNeeded();await shot(member,'member-in-person-accepted')
}

async function recordServiceValues(c){
  const {h,staff,fixtures,shot}=c
  for(const [i,value] of fixtures.ga.serviceBookings.entries()){
    await staff.goto(h.origin+'/app/packs?person='+fixtures.ga.member.id+'#cancellations')
    await staff.getByText('Record value of a received service',{exact:true}).click()
    const service=formFor(staff,'contract.service-value.record')
    await service.locator('[name=bookingId]').selectOption(value.bookingId)
    await service.locator('[name=amount]').fill('40.00')
    await service.locator('[name=evidenceReference]').fill(value.evidenceReference)
    if(i===0){await service.scrollIntoViewIfNeeded();await shot(staff,'owner-received-service-value')}
    await service.getByRole('button',{name:'Record received-service value',exact:true}).click()
  }
  await staff.goto(h.origin+'/app/people?person='+fixtures.ga.member.id+'#staff-actions')
  const history=staff.locator('#staff-actions'),valuations=history.locator('[data-staff-command="contract.service-value.record"]')
  assert.equal(await valuations.count(),3)
  await valuations.first().getByText('Recorded change',{exact:true}).click()
  assert.match(await valuations.first().innerText(),/\$40\.00/)
  await valuations.first().scrollIntoViewIfNeeded();await shot(staff,'owner-service-valuation-history')
}

async function refundPreviewAndSubmit(c,name,a,date,time,expected,deduction,formula){
  const {h,pageFor,shot,key}=c,page=await pageFor(a.member.cookie)
  await page.goto(h.origin+'/app/packs#cancellations')
  await page.getByText('Document a statutory cancellation',{exact:true}).click()
  const statutory=formFor(page,'plan.cancellation.statutory')
  await statutory.locator('[name=packId]').selectOption(a.pack.id)
  await statutory.locator('[name=reasonCode]').selectOption('cooling-off')
  await statutory.locator('[name=documentedDate]').fill(date)
  await statutory.locator('[name=documentedTime]').fill(time)
  await statutory.locator('[name=evidenceReference]').fill(key())
  await statutory.getByRole('button',{name:'Preview refund first (optional)',exact:true}).click()
  let state=await h.state(a.member.cookie)
  const preview=state.cancellations.statutoryPreviews.find(p=>p.packId===a.pack.id)
  assert.ok(preview);assert.equal(preview.value.amountCents,expected)
  assert.equal(preview.value.formula.deductionCents,deduction)
  assert.ok(!state.cancellations.cancellations.some(r=>r.packId===a.pack.id),'optional preview has not terminated the agreement')
  assert.ok(!state.cancellations.refunds.some(r=>r.packId===a.pack.id),'optional preview has not recorded a refund due')
  const article=page.locator(`[data-statutory-refund-preview="${preview.id}"]`)
  const calculation=article.locator('[data-cooling-refund-calculation]')
  assert.ok((await calculation.innerText()).includes('$'+(expected/100).toFixed(2)))
  if(formula)assert.match(await article.innerText(),formula)
  await article.scrollIntoViewIfNeeded();await shot(page,name+'-refund-preview')
  await article.getByRole('button',{name:'Submit this documented cancellation',exact:true}).click()
  state=await h.state(a.member.cookie)
  const cancellation=state.cancellations.cancellations.find(r=>r.packId===a.pack.id)
  assert.equal(cancellation.status,'applied')
  const refund=state.cancellations.refunds.find(r=>r.cancellationId===cancellation.id)
  assert.equal(refund.amountCents,expected);assert.equal(refund.settledCents,0)
  assert.deepEqual(cancellation.effects.unusedPrepaid,preview.value)
  const confirmation=page.locator(`[data-contract-cancellation="${cancellation.id}"]`)
  assert.ok((await confirmation.locator('[data-cooling-refund-calculation]').innerText()).includes('$'+(expected/100).toFixed(2)))
  assert.match(await confirmation.innerText(),/Refund settle-by/)
  await confirmation.scrollIntoViewIfNeeded();await shot(page,name+'-refund-confirmation')
  const due=page.locator(`[data-cancellation-refund="${refund.id}"]`)
  assert.match(await due.innerText(),/\$0\.00 settled externally/)
  await due.scrollIntoViewIfNeeded();await shot(page,name+'-refund-due')
}

export async function coolingRefundsBrowser(h,cases){
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  // A fresh temporary browser profile uses the runner's real HOME.
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  let sequence=2400
  try{for(const width of [1440,390]){
    const contexts=[]
    try{
      const pageFor=async cookie=>{
        const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context)
        await context.route(h.origin+'/**',async route=>{
          const asset=new URL(route.request().url()).pathname
          if(!asset.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(asset))return route.fulfill({body:await readFile(join(process.cwd(),'public',asset)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(asset)]})
          return route.continue()
        })
        const eq=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,eq),value:cookie.slice(eq+1),url:h.origin}])
        return context.newPage()
      }
      const shot=async(page,label)=>{
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'the entire page fits the viewport')
        await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`PLAN-007-refund-${label}-${width}.png`)})
      }
      const fixtures=cases.browserCases[width]
      assert.ok(fixtures,'each width receives fresh uncancelled agreements')
      const c={h,fixtures,pageFor,shot,staff:await pageFor(h.owner),key:()=>`synthetic-strap-${sequence++}`}
      await settingsAndSale(c)
      await recordServiceValues(c)
      await refundPreviewAndSubmit(c,'ny',fixtures.ny,'2026-01-06','00:00:00',25800,0)
      await refundPreviewAndSubmit(c,'ga',fixtures.ga,'2026-01-08','00:00:00',15800,10000,/capped at \$100/)
      await refundPreviewAndSubmit(c,'fl',fixtures.fl,'2026-01-08','12:00:00',8100,900,/complete local term days/)
      await refundPreviewAndSubmit(c,'ca',fixtures.ca,'2026-02-04','00:00:00',90000,180000,/pro-rata time made available/)
    }finally{for(const context of contexts)await context.close()}
  }}finally{await browser.close()}
}
