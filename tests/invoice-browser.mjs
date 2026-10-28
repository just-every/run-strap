import assert from 'node:assert/strict';
import { mkdir,readFile } from 'node:fs/promises';
import { join,extname } from 'node:path';
import { chromium } from '@playwright/test';

export async function invoiceBrowser(h,{member,other,pack,desk,stripeReceipt,payerPack}) {
  const proof=process.env.STRAP_PROOF_DIR ?? 'logs/proof/invoices';await mkdir(proof,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    try {
      await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname,types={'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'};if(!path.includes('..')&&types[extname(path)])return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:types[extname(path)]});return route.continue();});
      const page=await context.newPage();page.setDefaultTimeout(15000);
      const sign=async cookie=>{await page.goto('about:blank');await context.clearCookies();const at=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:h.origin}]);};
      const open=async()=>{const invoice=page.locator('[data-invoice-document="'+pack.id+'"]');await invoice.waitFor();await invoice.evaluate(el=>{el.open=true;});return invoice;};
      const capture=async(name,width,panel)=>{
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits width');
        const small=await panel.locator('p,label,button,a,summary,small,th,td').evaluateAll(es=>es.filter(e=>e.checkVisibility()&&parseFloat(getComputedStyle(e).fontSize)<13).map(e=>e.tagName));assert.deepEqual(small,[]);
        for(const tip of await page.locator('.has-tooltip:visible').all()){await tip.focus();await tip.locator('[role=tooltip]').waitFor({state:'visible'});await tip.hover();await page.waitForTimeout(350);await tip.locator('[role=tooltip]').waitFor({state:'visible'});}
        await panel.screenshot({path:join(proof,'BILL-009-'+name+'-'+width+'.png')});
      };
      for(const width of [1440,390]) {
        await page.setViewportSize({width,height:1000});await sign(member.cookie);await page.goto(h.origin+'/app/packs#invoice-documents');
        let invoice=await open();const text=await invoice.innerText();for(const expected of ['Larkhill Movement LLC','$110.00','$40.00','$70.00','$10.00','Externally recorded','Collected','Refund succeeded'])assert.ok(text.includes(expected),expected+' visible on member invoice');
        await capture('member',width,invoice);
        for(const [label,receipt] of [['Download invoice',false],['Download receipt',true]]) {
          const link=receipt?invoice.locator('[data-payment-receipt="'+stripeReceipt.id+'"] a[download]'):invoice.getByRole('link',{name:label,exact:true});
          const downloaded=page.waitForEvent('download');await link.click();const file=await downloaded,html=await readFile(await file.path(),'utf8');assert.ok(html.includes('Larkhill Movement LLC'));assert.ok(html.includes('$110.00'));assert.ok(html.includes('One-time initiation fee'));assert.ok(html.includes('$10.00'));
          const copy=await context.newPage();try{await copy.setViewportSize({width,height:1000});await copy.setContent(html);assert.equal(await copy.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await copy.screenshot({path:join(proof,'BILL-009-'+(receipt?'receipt':'invoice')+'-download-'+width+'.png'),fullPage:true});}finally{await copy.close();}
        }
        await sign(other.cookie);await page.goto(h.origin+'/app/packs');assert.equal(await page.locator('[data-invoice-document="'+pack.id+'"]').count(),0);
        const payerInvoice=page.locator('[data-invoice-document="'+payerPack.id+'"]');await payerInvoice.evaluate(el=>{el.open=true;});assert.ok((await payerInvoice.innerText()).includes('$25.00'));await capture('payer',width,payerInvoice);
        await sign(h.owner);await page.goto(h.origin+'/app/studio#invoice-mail');await capture('mail-settings',width,page.locator('#invoice-mail'));await page.goto(h.origin+'/app/packs#invoice-documents');invoice=await open();assert.ok((await invoice.innerText()).includes('$110.00'));await capture('owner-packs',width,invoice);
        const prepare=page.locator('#prepare-pack');await prepare.locator('[name=personId]').selectOption(other.id);await prepare.getByLabel('Price',{exact:true}).fill('110.00');await prepare.getByLabel('Pack discount (optional)',{exact:true}).fill('10.00');await prepare.getByLabel('One-time initiation fee (optional)',{exact:true}).fill('10.00');await capture('prepare-discount',width,prepare);await prepare.getByRole('button',{name:'Prepare pack',exact:true}).click();
        const draft=(await h.state()).drafts.filter(d=>d.type==='pack'&&d.status==='draft'&&d.personId===other.id).at(-1);assert.deepEqual([draft.amountCents,draft.discountCents,draft.initiationFeeCents],[10000,1000,1000]);await capture('discount-approval',width,page.locator('#draft-'+draft.id));
        await page.goto(h.origin+'/app/people?person='+pack.personId+'#invoice-documents');invoice=await open();await capture('owner-profile',width,invoice);
        await sign(desk.cookie);await page.goto(h.origin+'/app/people?person='+pack.personId+'#invoice-documents');invoice=await open();
        const receipt=invoice.locator('[data-payment-receipt="'+stripeReceipt.id+'"]');await receipt.getByText('Email receipt',{exact:true}).click();const form=receipt.locator('form');assert.equal(await form.getByRole('checkbox').isChecked(),false);await form.getByLabel('Member requested this through').selectOption('phone');await form.getByRole('checkbox').check();await capture('staff-resend',width,invoice);await form.getByRole('button',{name:'Send requested copy'}).click();
        invoice=await open();const history=invoice.getByText('Copy delivery history',{exact:true});await history.click();assert.ok((await invoice.innerText()).includes('Requested by staff'));await capture('staff-sent',width,invoice);
      }
    }finally{await context.close();}
  }finally{await browser.close();}
}
