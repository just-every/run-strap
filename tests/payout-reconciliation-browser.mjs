import assert from 'node:assert/strict';
import { readFile,mkdir } from 'node:fs/promises';
import { join,extname } from 'node:path';
import { chromium } from '@playwright/test';
export async function payoutsBrowser(h,report,{statement=false,difference=0,unavailable=false}={}) {
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
      for(const width of [1440,390]) {
        await page.setViewportSize({width,height:1000});
        assert.equal(await page.locator('[data-total=fees]').innerText(),'$3.75 USD');
        if(statement) {
          assert.equal(await page.locator('[data-statement-net]').innerText(),'Provider net $88.50 USD');
          assert.equal(await page.locator('[data-statement-difference]').innerText(),difference===0?'Difference from payout $0.00 USD':'Difference from payout -$0.01 USD');
          const details=page.locator('[data-payout-observation] details');
          if(await details.getAttribute('open')===null)await details.locator('summary').click();
          assert.equal(await page.locator('[data-payout-transaction]').count(),4);
          assert.match(await page.locator('[data-payout-transaction="synthetic-strap-refund-balance"]').innerText(),/-\$7\.00.*-\$0\.25.*-\$6\.75/s);
          assert.match(await page.locator('[data-payout-observation]').innerText(),/Native card coverage: unresolved/);
        }
        if(unavailable) {
          assert.equal(await page.locator('[data-statement-net]').innerText(),'Provider net Unavailable');
          assert.equal(await page.locator('[data-statement-difference]').innerText(),'Difference from payout Unavailable');
          assert.equal(await page.locator('[data-payout-transaction]').count(),0);
          assert.match(await page.locator('[data-payout-observation]').innerText(),/payout_membership_currency_mismatch/);
        }
        for(const [name,type] of [['Download reconciliation JSON','json'],['Download reconciliation CSV','csv']]) {
          const download=page.waitForEvent('download');await page.getByRole('link',{name,exact:true}).click();const file=await download;const contents=await readFile(await file.path(),'utf8');
          if(type==='json')assert.deepEqual(JSON.parse(contents),report);
          else {
            const lines=contents.trim().split('\r\n'),memberCount=report.payouts.reduce((n,p)=>n+(p.transactions?.length??0),0);
            assert.equal(lines.length,5+memberCount);
            const headers=lines[0].slice(1,-1).split('","'),decode=line=>Object.fromEntries(line.slice(1,-1).split('","').map((v,i)=>[headers[i],v.replace(/^\t/,'')])),rows=lines.slice(1).map(decode),summary=rows[0];
            assert.deepEqual([summary.cardGrossTotalCents,summary.cardFeeTotalCents,summary.cardNetTotalCents,summary.bankDepositConfirmation],['10000','375','9625','unavailable']);
            for(const row of [...report.cards,...report.payouts]) {
              const exported=rows.find(r=>r.id===row.id);assert.ok(exported);assert.equal(exported.observedAt,row.observedAt);
              for(const key of ['grossCents','feeCents','netCents','amountCents','mappedNetCents','providerDifferenceCents','statementDifferenceCents'])if(row[key]!==undefined&&row[key]!==null)assert.equal(exported[key],String(row[key]));
            }
            for(const payout of report.payouts)for(const t of payout.transactions??[]) {
              const row=rows.find(r=>r.kind==='payout_transaction'&&r.providerPayoutId===payout.providerPayoutId&&r.providerTransactionId===t.providerTransactionId);assert.ok(row);
              for(const key of ['sourceId','type','currency','grossCents','feeCents','netCents','providerCreatedAt','availableAt'])assert.equal(row[key],String(t[key]??''));
              assert.equal(row.observedAt,payout.observedAt);assert.equal(row.accountId,payout.accountId);assert.equal(row.refreshId,payout.refreshId);
            }
            if(unavailable) {const p=rows.find(r=>r.kind==='payout');assert.deepEqual([p.statementGrossCents,p.statementFeeCents,p.statementNetCents,p.statementDifferenceCents],['','','','']);}
            if(statement) {
              const payout=rows.find(r=>r.kind==='payout');assert.deepEqual([payout.statementGrossCents,payout.statementFeeCents,payout.statementNetCents,payout.statementDifferenceCents,payout.nativeCoverageStatus],['9200','350','8850',String(difference),'unresolved']);
            }
          }
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        if(process.env.STRAP_PROOF_DIR) {
          await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});
          await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,'BILL-011-'+(unavailable?'unavailable':statement?(difference?'difference':'statement'):'reconciliation')+'-'+width+'.png'),fullPage:true});
        }
      }
      assert.equal((await h.state()).version,version,'browser page and matching downloads do not write');
      const form=page.locator('form[action*="billing.payouts.refresh"]');assert.equal(await form.getByRole('checkbox').isChecked(),false);
      const small=await page.locator('main').locator('p,label,button,a,h1,h2,h3,dt,dd,td,th,summary').evaluateAll(es=>es.filter(e=>e.checkVisibility()&&parseFloat(getComputedStyle(e).fontSize)<13).map(e=>e.tagName));assert.deepEqual(small,[]);
      for(const tip of await page.locator('.has-tooltip:visible').all()) {await tip.focus();await tip.locator('[role=tooltip]').waitFor({state:'visible'});await tip.hover();await page.waitForTimeout(350);await tip.locator('[role=tooltip]').waitFor({state:'visible'});}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.setViewportSize({width:1440,height:1000});
      await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Refresh observations',exact:true}).click();
      assert.equal(page.url(),h.origin+'/app/payouts');
      assert.equal(await page.locator('[data-total=fees]').innerText(),'$3.75 USD');
      assert.ok((await h.state()).version>version,'explicit browser refresh retains a new observation');
    } finally {await context.close();}
  } finally {await browser.close();}
}
