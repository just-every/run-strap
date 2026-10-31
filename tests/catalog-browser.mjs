import assert from 'node:assert/strict';
import { mkdir,readFile } from 'node:fs/promises';
import { join,extname } from 'node:path';
import { chromium } from '@playwright/test';

/** The owner publishes and sells through forms; members retain original receipts after a price change. */
export async function catalogBrowser(h,data) {
  const directory=process.env.STRAP_CATALOG_PROOF_DIR || process.env.STRAP_RIGHTS_PROOF_DIR;
  if(directory)await mkdir(directory,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  const contexts=[];
  try {
    const pageFor=async cookie=>{
      const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});
        return route.continue();
      });
      const eq=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,eq),value:cookie.slice(eq+1),url:h.origin}]);
      return context.newPage();
    };
    const shot=async(page,selector,label)=>{
      if(!directory)return;
      for(const width of [1440,390]) {
        await page.setViewportSize({width,height:1000});await page.locator(selector).scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'catalog stays inside the viewport');
        await page.screenshot({path:join(directory,`PLAN-001-${label}-${width}.png`),fullPage:false});
      }
      await page.setViewportSize({width:1440,height:1000});
    };
    const owner=await pageFor(h.owner);
    await owner.goto(h.origin+'/app/studio#product-catalog');
    const panel=owner.locator('#product-catalog');
    await panel.getByText('Publish a finite pack',{exact:true}).click();
    const publish=panel.locator('form').filter({has:owner.locator('input[name=code]')}).filter({hasNot:owner.locator('input[type=hidden][name=code]')});
    await publish.getByLabel('Stable product code',{exact:true}).fill('synthetic-strap-browser');
    await publish.getByLabel('Product name',{exact:true}).fill('Browser mat pack');
    await publish.getByLabel('Price in USD',{exact:true}).fill('129.00');
    await publish.getByLabel('Class credits',{exact:true}).fill('6');
    await publish.getByLabel('Eligible services (one per line; blank means all services)',{exact:true}).fill('Mat');
    await shot(owner,'#product-catalog','owner-publish');
    await publish.getByRole('button',{name:'Publish product',exact:true}).click();
    const version=(await h.state()).productCatalog.versions.find(v=>v.code==='synthetic-strap-browser');
    assert.ok(version,'browser publish creates an immutable catalog version');
    assert.deepEqual([version.amountCents,version.credits,version.currency],[12900,6,'USD']);
    await owner.goto(h.origin+'/app/packs');
    const purchase=owner.locator('#catalog-purchase form');
    await purchase.getByLabel('Member',{exact:true}).selectOption(data.first.id);
    await purchase.getByLabel('Published catalog pack',{exact:true}).selectOption(version.id);
    await purchase.getByRole('button',{name:'Review catalog pack',exact:true}).click();
    const draft=(await h.state()).drafts.find(d=>d.catalogVersion?.id===version.id);
    const preview=owner.locator('#draft-'+draft.id);
    assert.match(await preview.innerText(),/Browser mat pack.*version 1/s);
    assert.match(await preview.innerText(),/\$129\.00 USD.*6 credits/s);
    assert.match(await preview.innerText(),/Mat/);
    await shot(owner,'#draft-'+draft.id,'owner-review');
    await preview.getByRole('button',{name:'Approve this exact pack',exact:true}).click();
    const pack=(await h.state()).packs.find(p=>p.draftId===draft.id);
    assert.equal(pack.amountCents,12900);assert.equal(pack.remaining,6);
    await owner.goto(h.origin+'/app/studio#product-catalog');
    const product=owner.locator(`[data-product="${version.productId}"]`);
    await product.getByText('Publish a new version of Browser mat pack',{exact:true}).click();
    const update=product.locator('form[action*="name=catalog.publish"]');
    await update.getByLabel('Price in USD',{exact:true}).fill('159.00');
    await update.getByRole('button',{name:'Publish new version',exact:true}).click();
    const current=(await h.state()).productCatalog.versions.find(v=>v.code===version.code&&v.version===2);
    assert.equal(current.amountCents,15900);
    await owner.locator(`[data-product="${version.productId}"]`).getByText('Published version history',{exact:true}).click();
    const history=owner.locator(`[data-product="${version.productId}"] table`);
    assert.match(await history.innerText(),/\$129\.00/);assert.match(await history.innerText(),/\$159\.00/);
    await shot(owner,`[data-product="${version.productId}"]`,'owner-history');
    for(const [member,id,original] of [[data.first,data.sale.id,data.v1],[data.second,data.secondSale.id,data.v2],[data.first,pack.id,version]]) {
      const page=await pageFor(member.cookie);await page.goto(h.origin+'/app/packs#receipt-'+id);
      const receipt=page.locator('#receipt-'+id),text=await receipt.innerText();
      assert.ok(text.includes(original.name));
      assert.ok(text.includes(`version ${original.version}`));
      assert.ok(text.includes(`$${(original.amountCents/100).toFixed(2)} USD`));
      assert.ok(text.includes(`${original.credits} credits`));
      assert.ok(text.includes('Mat'));assert.ok(text.includes('Catalog studio'));
      assert.ok(text.includes('Original purchase expiration:'));
      assert.ok(text.includes('No automatic renewal.'));
      await shot(page,'#receipt-'+id,'member-original-v'+original.version+'-'+original.code);
    }
    console.log('PROBE PLAN-001 owner catalog forms: publish, prepare, approve and change USD price -> original member receipt remains $129.00 and six credits; screens at 1440 and 390.');
  } finally {for(const context of contexts)await context.close();await browser.close();}
}
