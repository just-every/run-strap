import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from '@playwright/test';

export async function guestsBrowser(h, {host,guest,packId}) {
  const browser = await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});
  try {
    for (const width of [1440,390]) {
      for (const [role,cookie] of [['owner',h.owner],['host',host.cookie],['guest',guest.cookie]]) {
        const context = await browser.newContext({viewport:{width,height:1000}});
        try {
          await context.route(h.origin+'/**',async route=>{
            const path = new URL(route.request().url()).pathname;
            if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});
            return route.continue();
          });
          const index=cookie.indexOf('='); await context.addCookies([{name:cookie.slice(0,index),value:cookie.slice(index+1),url:h.origin}]);
          const page=await context.newPage(); await page.goto(h.origin+'/app/packs#guests');
          await page.locator('#guests').getByRole('heading',{name:'Guest passes',exact:true}).waitFor();
          if (role==='owner') {
            const form=page.locator('form[action*="name=pack.prepare"]');
            await form.getByText('Guest-pass allowance',{exact:true}).click();
            await form.getByLabel('Guest passes per period (blank = none)',{exact:true}).fill('2');
            await form.locator('select[name=guestPeriod]').selectOption('month');
            await form.locator('select[name=guestExcess]').selectOption('charge');
            await form.getByLabel('Guest drop-in price',{exact:true}).fill('25.00');
            await form.scrollIntoViewIfNeeded();
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
            await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`PLAN-010-policy-${width}.png`),fullPage:false});
          }
          if (role==='host') {
            const allowance=page.locator('#guests details').filter({hasText:'guest passes left this period'}).first(); await allowance.locator('summary').first().click();
            const ledger=page.locator('#guests').getByText('Guest-pass ledger',{exact:true}); await ledger.click();
            assert.match(await page.locator('#guests').innerText(),/One|reserve|transfer|return/);
          }
          if (role==='guest') { await page.getByText('Allow a host or payer relationship',{exact:true}).click(); await page.getByLabel('Host’s studio email',{exact:true}).fill(host.email); }
          await page.locator('#guests').scrollIntoViewIfNeeded();
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`PLAN-010-${role}-${width}.png`),fullPage:false});
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
}
