import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from '@playwright/test';

export async function guestsBrowser(h, {host,guest,packId,classId}) {
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
            await form.locator('select[name=personId]').selectOption(host.id);
            await form.getByLabel('Price',{exact:true}).fill('99.00');
            await form.getByLabel('Guest passes per period (blank = none)',{exact:true}).fill('2');
            await form.locator('select[name=guestPeriod]').selectOption('month');
            await form.locator('select[name=guestExcess]').selectOption('charge');
            await form.getByLabel('Guest drop-in price',{exact:true}).fill('25.00');
            await form.scrollIntoViewIfNeeded();
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
            await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`PLAN-010-policy-${width}.png`),fullPage:false});
            await form.getByRole('button',{name:'Prepare pack',exact:true}).click();
            const draft=(await h.state()).drafts.filter(d=>d.type==='pack'&&d.personId===host.id&&d.amountCents===9900&&d.status==='draft').at(-1);
            assert.equal(draft.guestTerms.passes,2); assert.equal(draft.guestTerms.priceCents,2500);
            const review=page.locator('#draft-'+draft.id); await review.scrollIntoViewIfNeeded();
            assert.match(await review.innerText(),/2 per month/);
            await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`PLAN-010-review-${width}.png`),fullPage:false});
            await review.getByRole('button',{name:'Approve this exact pack',exact:true}).click();
            assert.equal((await h.state()).packs.find(p=>p.draftId===draft.id).guestTerms.priceCents,2500);
          }
          if (role==='host') {
            await page.locator('#guests').getByText('Book a guest',{exact:true}).click();
            const prepare=page.locator('form[action*="name=guest.preview"]');
            await prepare.locator('select[name=packId]').selectOption(packId);
            await prepare.locator('select[name=guestId]').selectOption(guest.id);
            await prepare.locator('select[name=classId]').selectOption(classId);
            assert.equal(await prepare.evaluate(f=>f.checkValidity()),true);
            await prepare.getByRole('button',{name:'Preview guest booking',exact:true}).click();
            const draft=(await h.state(host.cookie)).guests.drafts.filter(d=>d.status==='preview'&&d.personId===guest.id&&d.classId===classId).at(-1);
            assert.equal(draft.amountCents,2500);
            const confirm=page.locator(`form[action*="name=guest.book"]:has(input[value="${draft.id}"])`);
            await confirm.getByRole('checkbox').check(); await confirm.scrollIntoViewIfNeeded();
            await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`PLAN-010-confirm-${width}.png`),fullPage:false});
            await confirm.getByRole('button',{name:'Confirm guest booking',exact:true}).click();
            const booked=(await h.state(host.cookie)).guests.drafts.find(d=>d.id===draft.id).bookingId;
            await page.locator(`form[action*="name=booking.cancel"]:has(input[value="${booked}"]) button`).click();
            const end=await h.state(); assert.equal(end.bookings.find(b=>b.id===booked).status,'cancelled');
            assert.equal(end.charges.filter(c=>c.bookingId===booked).reduce((n,c)=>n+c.amountCents,0),0);
            const allowance=page.locator('#guests details').filter({hasText:'guest passes left this period'}).first(); await allowance.locator('summary').first().click();
            const ledger=page.locator('#guests').getByText('Guest-pass ledger',{exact:true}); await ledger.click();
            assert.match(await page.locator('#guests').innerText(),/One|reserve|transfer|return/);
          }
          if (role==='guest') { await page.getByText('Allow a host or payer relationship',{exact:true}).click(); await page.getByLabel('Host’s studio email',{exact:true}).fill(host.email); await page.getByRole('checkbox',{name:'I explicitly authorize this host.',exact:true}).check(); await page.getByRole('button',{name:'Save guest permission',exact:true}).click(); await page.getByText('Allow a host or payer relationship',{exact:true}).click(); }
          await page.locator('#guests').scrollIntoViewIfNeeded();
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`PLAN-010-${role}-${width}.png`),fullPage:false});
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
}
