import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

async function screens(h,name,act) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});
  try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000}});
    await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()});
    const i=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,i),value:h.owner.slice(i+1),url:h.origin}]);
    const page=await context.newPage();await page.goto(h.origin+'/app/retail');await page.getByRole('heading',{name:'Inventory and drawers',exact:true}).waitFor();
    await act(page,width);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'screen fits viewport');
    const iconOnly=await page.locator('a,button,summary').evaluateAll(els=>els.filter(el=>el.querySelector('svg')&&!el.textContent.trim()).map(el=>({name:el.getAttribute('aria-label'),tooltip:!!el.querySelector('[role="tooltip"]')})));
    assert.ok(iconOnly.every(c=>c.name&&c.tooltip),'every icon-only control has a named tooltip');
    await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`${name}-${width}.png`),fullPage:true});await context.close();
  }}finally{await browser.close()}
}
export async function retailBrowser(h,{large}) {
  await screens(h,'SALE-003',async(page,width)=>{
    await page.getByLabel('Find barcode',{exact:true}).fill(large.barcode);await page.getByRole('button',{name:'Look up barcode',exact:true}).click();
    assert.ok(await page.getByRole('cell',{name:large.sku,exact:true}).count());
    const receive=page.locator('details').filter({has:page.locator('summary').getByText('Receive purchase',{exact:true})});await receive.locator('summary').click();
    await receive.getByLabel('SKU variant',{exact:true}).selectOption(large.id);await receive.getByLabel('Location',{exact:true}).selectOption('studio');await receive.getByLabel('Quantity',{exact:true}).fill('1');await receive.getByLabel('Purchase reference',{exact:true}).fill('synthetic-strap-browser-'+width);
    await receive.getByRole('button',{name:'Receive stock',exact:true}).click();await page.getByRole('heading',{name:'Inventory and drawers',exact:true}).waitFor();
    assert.ok((await h.send('/api/strap/retail',undefined,h.owner)).value.receipts.some(r=>r.reference==='synthetic-strap-browser-'+width));
  });
}
export async function drawerBrowser(h,sessionId) {
  await screens(h,'SALE-004',async(page,width)=>{
    const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:'Front desk',exact:false})}).filter({has:page.getByText('Manager correction',{exact:true})});
    const correction=row.locator('details').filter({has:page.getByText('Manager correction',{exact:true})});await correction.locator('summary').click();await correction.getByLabel('Corrected counted cash in USD',{exact:true}).fill('170.00');await correction.getByLabel('Reason',{exact:true}).fill('Confirmed cash tray count '+width);await correction.getByRole('button',{name:'Adjust count',exact:true}).click();await page.getByRole('heading',{name:'Inventory and drawers',exact:true}).waitFor();
    const r=(await h.send('/api/strap/retail',undefined,h.owner)).value;assert.ok(r.adjustments.some(a=>a.reason==='Confirmed cash tray count '+width));assert.equal(r.sessions.find(s=>s.id===sessionId).varianceCents,0);
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download tender CSV',exact:true}).click();const file=await download;assert.equal(file.suggestedFilename(),'tenders.csv');
  });
}
export async function giftBrowser(h,giftCardId) {
  await screens(h,'SALE-001',async(page,width)=>{
    await page.getByRole('heading',{name:'Gift cards and promotions',exact:true}).waitFor();
    const details=page.locator('details').filter({has:page.getByText('Refund-right adjustment',{exact:true})});await details.locator('summary').click();await details.getByLabel('Signed adjustment in USD',{exact:true}).fill('1.00');await details.getByLabel('Reason',{exact:true}).fill('Approved gift correction '+width);await details.getByRole('button',{name:'Adjust gift value',exact:true}).click();await page.getByRole('heading',{name:'Inventory and drawers',exact:true}).waitFor();
    const r=(await h.send('/api/strap/retail',undefined,h.owner)).value;assert.ok(r.gifts.entries.some(e=>e.reason==='Approved gift correction '+width));assert.ok(r.gifts.cards.some(c=>c.id===giftCardId));
  });
}
