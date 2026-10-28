import assert from 'node:assert/strict';
import { mkdir,readFile } from 'node:fs/promises';
import { join,extname } from 'node:path';
import { chromium } from '@playwright/test';
import { paymentSeed,billingView } from './payment-fixtures.mjs';

export async function paymentsBrowser(h,{checkout}) {
  const proof=process.env.STRAP_PROOF_DIR;await mkdir(proof,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    try {
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname,types={'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'};
        if(!path.includes('..')&&types[extname(path)])return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:types[extname(path)]});return route.continue();
      });
      const at=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,at),value:h.owner.slice(at+1),url:h.origin}]);
      const page=await context.newPage();page.setDefaultTimeout(15000);
      const capture=async(name,panel)=>{
        for(const width of [1440,390]) {
          await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits '+width);
          const missing=await page.locator('button,a,summary,[role=button]').evaluateAll(cs=>cs.filter(c=>c.checkVisibility()&&!c.innerText.trim()&&c.querySelector('svg,img')&&!c.querySelector('[role=tooltip]')).map(c=>c.tagName));assert.deepEqual(missing,[]);
          const small=await panel.locator('p,label,button,a,summary,h2,h3').evaluateAll(es=>es.filter(e=>e.checkVisibility()&&parseFloat(getComputedStyle(e).fontSize)<13).map(e=>e.tagName));assert.deepEqual(small,[]);
          for(const tip of await page.locator('.has-tooltip:visible').all()) {await tip.focus();await tip.locator('[role=tooltip]').waitFor({state:'visible'});await tip.hover();await page.waitForTimeout(350);await tip.locator('[role=tooltip]').waitFor({state:'visible'});}
          await panel.screenshot({path:join(proof,'BILL-payments-'+name+'-'+width+'.png')});
        }
      };
      await page.goto(h.origin+'/app/studio#payment-connection');
      const settings=page.locator('#payment-connection');
      await settings.getByText('Ready for test card payments',{exact:false}).waitFor();
      await capture('connection-ready',settings);
      const review=settings.locator('form[action*="name=billing.connect"]');assert.equal(await review.getByRole('checkbox').isChecked(),false);await review.getByRole('checkbox').check();await review.getByRole('button').click();
      await settings.getByText('Ready for test card payments',{exact:false}).waitFor();
      const connected=(await billingView(h)).connection;assert.equal(connected.accountId,checkout.accountId);
      await settings.getByText('Connection review history',{exact:true}).click();await capture('connection-reviewed',settings);
      const disconnect=settings.locator('form[action*="name=billing.disconnect"]');await disconnect.getByRole('checkbox').check();await disconnect.getByRole('button').click();
      assert.equal((await billingView(h)).connected,false);await capture('connection-disconnected',settings);
      const reconnect=settings.locator('form[action*="name=billing.connect"]');await reconnect.getByRole('checkbox').check();await reconnect.getByRole('button').click();
      assert.equal((await billingView(h)).connected,true);await capture('connection-reconnected',settings);
      const pending=await paymentSeed(h,'EveningFitnessMember');
      await page.goto(h.origin+'/app/packs#payments');const payments=page.locator('#payments');
      const invoice=payments.locator('[data-stripe-invoice="'+checkout.id+'"]');
      assert.ok((await invoice.innerText()).includes('paid'));assert.ok((await invoice.innerText()).includes('$0.00'));assert.ok((await invoice.innerText()).includes('plan credits 5'));
      const reconcile=invoice.getByRole('button',{name:'Reconcile with Stripe',exact:true});await reconcile.click();await invoice.waitFor();
      await capture('reconciliation',payments);
      await payments.getByText('Collect an approved plan',{exact:true}).click();
      const start=payments.locator('form[action*="name=billing.checkout.start"]').filter({has:page.locator('input[name="packId"][value="'+pending.pack.id+'"]')});
      assert.equal(await start.getByRole('checkbox').isChecked(),false);await start.getByRole('checkbox').check();
      await capture('checkout-review',payments);await start.getByRole('button').click();
      await page.getByRole('link',{name:'Continue to Stripe test payment',exact:true}).waitFor();
      const unpaid=(await billingView(h)).invoices.find(i=>i.packId===pending.pack.id);assert.equal(unpaid.status,'open');assert.equal(unpaid.balanceCents,5000);assert.equal(unpaid.access,5);
      await capture('hosted-handoff',page.locator('main'));
      await page.goto(h.origin+'/app/packs#payments');
      await page.locator('#payments').getByText('Signed event history',{exact:true}).click();
      await page.locator('#payments').getByText('Reconciliation history',{exact:true}).click();
      const comparison=page.locator('[data-reconciliation]').first();
      assert.ok((await comparison.innerText()).includes('Stripe $50.00 USD'));
      assert.ok((await comparison.innerText()).includes('Studio balance $50.00 before, $0.00 after'));
      assert.ok((await comparison.innerText()).includes('Plan credits 5 before, 5 after'));
      await capture('retained-history',page.locator('#payments'));
    } finally {await context.close();}
  } finally {await browser.close();}
}
