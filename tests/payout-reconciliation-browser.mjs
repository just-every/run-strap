import assert from 'node:assert/strict';
import { readFile,mkdir } from 'node:fs/promises';
import { join,extname } from 'node:path';
import { chromium } from '@playwright/test';
export async function payoutsBrowser(h,report) {
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    try {
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname,types={'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon','.js':'text/javascript'};
        if(!path.includes('..')&&types[extname(path)])return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:types[extname(path)]});return route.continue();
      });
      const at=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,at),value:h.owner.slice(at+1),url:h.origin}]);
      const version=(await h.state()).version;
      const page=await context.newPage();await page.goto(h.origin+'/app/payouts');
      assert.equal(await page.locator('[data-total=fees]').innerText(),'$3.75 USD');assert.equal(await page.locator('[data-total=net]').innerText(),'$96.25 USD');
      assert.equal(await page.locator('[data-card-observation]').count(),2);assert.equal(await page.locator('[data-payout-observation]').count(),1);
      for(const row of report.cards)assert.ok((await page.locator('[data-card-observation="'+row.id+'"]').innerText()).includes(row.providerTransactionId));
      assert.match(await page.locator('[data-payout-observation]').innerText(),/Unmatched.*confirmation unavailable/);
      for(const [name,type] of [['Download reconciliation JSON','json'],['Download reconciliation CSV','csv']]) {
        const download=page.waitForEvent('download');await page.getByRole('link',{name,exact:true}).click();const file=await download;const contents=await readFile(await file.path(),'utf8');
        if(type==='json')assert.deepEqual(JSON.parse(contents),report);
        else {const lines=contents.trim().split('\r\n');assert.equal(lines.length,5);const headers=lines[0].slice(1,-1).split('","'),summary=Object.fromEntries(lines[1].slice(1,-1).split('","').map((v,i)=>[headers[i],v]));assert.deepEqual([summary.cardGrossTotalCents,summary.cardFeeTotalCents,summary.cardNetTotalCents,summary.bankDepositConfirmation],['10000','375','9625','unavailable']);for(const row of [...report.cards,...report.payouts]) {const line=lines.find(l=>l.includes('"'+row.id+'"'));assert.ok(line);assert.ok(line.includes('"'+row.observedAt+'"'));for(const key of ['grossCents','feeCents','netCents','amountCents','mappedNetCents','providerDifferenceCents'])if(row[key]!==undefined&&row[key]!==null)assert.ok(line.includes('"'+row[key]+'"'));}}
      }
      assert.equal((await h.state()).version,version,'browser page and matching downloads do not write');
      const form=page.locator('form[action*="billing.payouts.refresh"]');assert.equal(await form.getByRole('checkbox').isChecked(),false);
      const small=await page.locator('main').locator('p,label,button,a,h1,h2,h3,dt,dd,td,th').evaluateAll(es=>es.filter(e=>e.checkVisibility()&&parseFloat(getComputedStyle(e).fontSize)<13).map(e=>e.tagName));assert.deepEqual(small,[]);
      for(const tip of await page.locator('.has-tooltip:visible').all()) {await tip.focus();await tip.locator('[role=tooltip]').waitFor({state:'visible'});await tip.hover();await page.waitForTimeout(350);await tip.locator('[role=tooltip]').waitFor({state:'visible'});}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.STRAP_PROOF_DIR) {
        await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});
        for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,'BILL-011-reconciliation-'+width+'.png'),fullPage:true});}
      }
      await page.setViewportSize({width:1440,height:1000});
      await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Refresh observations',exact:true}).click();
      assert.equal(page.url(),h.origin+'/app/payouts');
      assert.equal(await page.locator('[data-total=fees]').innerText(),'$3.75 USD');
      assert.ok((await h.state()).version>version,'explicit browser refresh retains a new observation');
    } finally {await context.close();}
  } finally {await browser.close();}
}
