import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'
import { taxAddress } from './tax-sandbox.mjs'

export async function taxBrowser(h,seed,widths=[1440,390]) {
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {for(const width of widths){
    const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true})
    try {
      await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()})
      const at=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,at),value:h.owner.slice(at+1),url:h.origin}])
      const page=await context.newPage(),panel=page.locator('#tax')
      const capture=async name=>{
        await page.evaluate(()=>document.fonts.ready)
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits '+width)
        const missing=await page.locator('button,a,summary,[role=button]').evaluateAll(cs=>cs.filter(c=>c.checkVisibility()&&!c.innerText.trim()&&c.querySelector('svg,img')&&!c.querySelector('[role=tooltip]')).map(c=>c.tagName));assert.deepEqual(missing,[])
        await panel.screenshot({path:join(process.env.STRAP_PROOF_DIR,`BILL-012-${name}-${width}.png`)})
      }
      await page.goto(h.origin+'/app/studio#tax')
      await panel.getByRole('heading',{name:'Sales tax',exact:true}).waitFor()
      await panel.getByText('Update classifications or reconnect',{exact:true}).click()
      const settings=panel.locator('form[action*="name=tax.config.save"]').first()
      for(const [label,value] of [['Street address',taxAddress.line1],['City',taxAddress.city],['State',taxAddress.state],['ZIP code',taxAddress.postalCode],['Registered states','WA, CA'],['Classification label','Exercise mat'],['Stripe product tax code','txcd_99999999']])await settings.getByLabel(label,{exact:true}).fill(value)
      await settings.getByLabel('Product or service',{exact:true}).selectOption('retail:'+seed.sku.id)
      await settings.getByRole('checkbox').check();await capture('configuration')
      await settings.getByRole('button',{name:'Review and connect test tax',exact:true}).click()
      await panel.getByText('Test connection reviewed and active.',{exact:true}).waitFor()
      const sale=await h.cmd('retail.sell',{personId:seed.member.id,skuId:seed.sku.id,quantity:2,expectedCents:4000,tender:'external',reference:'synthetic-strap-tax-browser-sale-'+width,requestId:'synthetic-strap-tax-browser-sale-'+width})
      await page.reload();await panel.getByText('Calculate tax on a recorded sale',{exact:true}).click()
      const calc=panel.locator('form[action*="name=tax.calculate"]')
      await calc.getByLabel('Recorded sale',{exact:true}).selectOption(JSON.stringify([sale.chargeId,'retail:'+seed.sku.id]))
      await calc.getByRole('button',{name:'Calculate test tax',exact:true}).click()
      const current=(await h.send('/api/strap/tax',undefined,h.owner)).value
      const calculation=current.calculations.find(c=>c.originalChargeId===sale.chargeId);assert.ok(calculation)
      const preview=panel.locator('[data-tax-calculation="'+calculation.id+'"]')
      assert.match(await preview.innerText(),/\$40\.00/);assert.match(await preview.innerText(),/\$4\.00/);assert.match(await preview.innerText(),/\$44\.00/)
      await capture('preview')
      await preview.getByRole('button',{name:'Record test tax invoice',exact:true}).click()
      const invoice=(await h.send('/api/strap/tax',undefined,h.owner)).value.invoices.find(i=>i.originalChargeId===sale.chargeId);assert.ok(invoice)
      await panel.locator('[data-tax-invoice="'+invoice.id+'"]').waitFor();await capture('invoice')
      const recordPayment=async (reversalId,amount,reference)=>{
        await panel.getByText('Record an external tax payment',{exact:true}).click()
        const payment=panel.locator('form[action*="name=tax.payment.record"]')
        await payment.getByLabel('Tax invoice or reversal',{exact:true}).selectOption(JSON.stringify([invoice.id,reversalId]))
        const providerReference=reversalId ? (await h.send('/api/strap/tax',undefined,h.owner)).value.reversals.find(r=>r.id===reversalId).providerTransactionId : invoice.providerTransactionId
        assert.ok((await payment.locator('select option:checked').innerText()).includes(providerReference),'the owner can distinguish the exact provider tax record')
        await payment.getByLabel('Tax payment amount (USD)',{exact:true}).fill(amount)
        await payment.getByLabel('External payment reference',{exact:true}).fill(reference)
        await payment.getByLabel('Payment reason',{exact:true}).fill('Owner records money already exchanged outside Strap')
        await capture(reversalId ? 'refund-form' : 'receipt-form')
        await payment.getByRole('button',{name:'Record external tax payment',exact:true}).click()
        await panel.locator('[data-tax-payment]').filter({has:page.getByText(reference,{exact:true})}).waitFor()
        const saved=(await h.send('/api/strap/tax',undefined,h.owner)).value.payments.find(p=>p.reference===reference)
        assert.ok(saved);assert.equal(saved.taxInvoiceId,invoice.id);assert.equal(saved.taxReversalId,reversalId)
        assert.equal(saved.amountCents,(reversalId ? -1 : 1)*Math.round(Number(amount)*100))
        assert.equal(saved.providerTransactionId,reversalId ? (await h.send('/api/strap/tax',undefined,h.owner)).value.reversals.find(r=>r.id===reversalId).providerTransactionId : invoice.providerTransactionId)
        return saved
      }
      await recordPayment(null,'4.00','synthetic-strap-tax-browser-receipt-'+width);await capture('receipt')
      const returned=await h.cmd('retail.return',{saleId:sale.id,quantity:1,restock:false,reason:'One mat returned after the test sale',requestId:'synthetic-strap-tax-browser-return-'+width})
      await page.reload();await panel.getByText('Reverse tax for a recorded return',{exact:true}).click()
      const refund=panel.locator('form[action*="name=tax.refund"]')
      await refund.getByLabel('Returned sale',{exact:true}).selectOption(JSON.stringify([invoice.id,returned.id]))
      await refund.getByLabel('Expected tax credit (USD)',{exact:true}).fill('2.00')
      await refund.getByLabel('Reversal reference',{exact:true}).fill('synthetic-strap-tax-browser-reversal-'+width)
      await refund.getByLabel('Reason',{exact:true}).fill('Tax follows the original partial mat return')
      await refund.getByRole('button',{name:'Record test tax reversal',exact:true}).click()
      const tax=(await h.send('/api/strap/tax',undefined,h.owner)).value,reversal=tax.reversals.find(r=>r.retailReturnId===returned.id)
      assert.equal(reversal?.taxCents,-200);assert.equal(reversal?.priceCents,-2000)
      const recorded=panel.locator('[data-tax-reversal="'+reversal.id+'"]');await recorded.waitFor();assert.match(await recorded.innerText(),/\$2\.00/)
      await recordPayment(reversal.id,'2.00','synthetic-strap-tax-browser-refund-'+width);await capture('refund')
      await panel.getByText('Tax operation history',{exact:true}).click();await capture('reversal')
      const [download]=await Promise.all([page.waitForEvent('download'),panel.getByRole('link',{name:'Download tax evidence CSV',exact:true}).click()])
      const csv=await readFile(await download.path(),'utf8');assert.ok(csv.includes(reversal.providerTransactionId));assert.ok(csv.includes(invoice.providerTransactionId))
      await panel.getByText('Recorded exemptions',{exact:true}).click()
      const exemption=panel.locator('form[action*="name=tax.config.save"]').filter({has:page.locator('[name=exemptionPersonId]')})
      await exemption.getByLabel('Exempt member',{exact:true}).selectOption(seed.member.id)
      await exemption.getByLabel('Exemption evidence reference',{exact:true}).fill('synthetic-strap-browser-exemption-'+width)
      await exemption.getByLabel('Exemption reason',{exact:true}).fill('Owner reviewed the member exemption evidence')
      await exemption.getByRole('checkbox').check()
      await exemption.getByRole('button',{name:'Record exemption',exact:true}).click()
      const configured=(await h.send('/api/strap/tax',undefined,h.owner)).value.config
      assert.ok(configured.exemptions.some(e=>e.personId===seed.member.id&&e.reference==='synthetic-strap-browser-exemption-'+width))
      assert.deepEqual(configured.registeredStates,['WA','CA'])
      for(const tip of await page.locator('.has-tooltip:visible').all()) {await tip.focus();await tip.locator('[role=tooltip]').waitFor({state:'visible'});await tip.hover();await page.waitForTimeout(350);await tip.locator('[role=tooltip]').waitFor({state:'visible'})}
    } finally {await context.close()}
  }} finally {await browser.close()}
}
