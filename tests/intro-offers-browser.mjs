import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from '@playwright/test';

/** The real server-rendered forms and native sessions, using the test runtime's public HTTP origin. */
export async function introOffersBrowser(h) {
  const directory=process.env.STRAP_PROOF_DIR;await mkdir(directory,{recursive:true});
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});
  try {
    for(const width of [1440,390]){
      const member=await h.person('IntroBrowser'+width), deskMember=await h.person('IntroDeskBrowser'+width);
      const context=await browser.newContext({viewport:{width,height:1000}});
      try {
        await context.route(h.origin+'/**',async route=>{
          const path=new URL(route.request().url()).pathname;
          if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});
          return route.continue();
        });
        const signIn=async cookie=>{await context.clearCookies();const index=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,index),value:cookie.slice(index+1),url:h.origin}]);};
        const page=await context.newPage();
        const capture=async(name,locator)=>{
          await locator.scrollIntoViewIfNeeded();
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow at '+width);
          await page.screenshot({path:join(directory,`PLAN-004-${name}-${width}.png`),fullPage:false});
        };
        await signIn(h.owner);await page.goto(h.origin+'/app/packs#intro-offers');
        const section=page.locator('#intro-offers');await section.getByText('Configure an intro offer',{exact:true}).click();
        const config=section.locator('form[action*="name=intro.offer.save"]');
        await config.getByLabel('Offer name',{exact:true}).fill('Browser two-week intro '+width);
        await config.getByLabel('Intro price',{exact:true}).fill('39.00');
        await config.getByLabel('Included visits',{exact:true}).fill('2');
        await config.getByLabel('Intro eligible services (one per line; blank = all)',{exact:true}).fill('Mat');
        await capture('configure',config);await config.getByRole('button',{name:'Save intro offer',exact:true}).click();
        const offer=(await h.state()).intros.offers.find(o=>o.name==='Browser two-week intro '+width);
        assert.deepEqual([offer.days,offer.credits,offer.amountCents],[14,2,3900]);
        for(const person of [member,deskMember]){
          await section.getByText('Verify intro eligibility identity',{exact:true}).click();
          const verification=section.locator('form[action*="name=intro.identity.verify"]');
          await verification.getByLabel('Member',{exact:true}).selectOption(person.id);
          await verification.getByLabel('Identity verification reason',{exact:true}).fill('Identity and household checked at the desk');
          await verification.getByRole('checkbox').check();
          await capture('identity-'+(person.id===member.id?'member':'desk'),verification);
          await verification.getByRole('button',{name:'Record verified identity',exact:true}).click();
        }
        const card=section.locator(`[data-intro-offer="${offer.id}"]`),desk=card.locator('form[action*="name=intro.preview"]');
        await desk.getByLabel('Member',{exact:true}).selectOption(deskMember.id);
        await desk.getByLabel('Sale channel',{exact:true}).selectOption('phone');
        await desk.getByRole('button',{name:'Preview intro purchase',exact:true}).click();
        let preview=(await h.state()).intros.previews.filter(q=>q.personId===deskMember.id&&q.status==='preview').at(-1);
        let review=section.locator(`[data-intro-preview="${preview.id}"]`);
        await review.getByRole('checkbox').check();await capture('desk-preview',review);
        await review.getByRole('button',{name:'Confirm intro purchase',exact:true}).click();
        let sale=(await h.state()).intros.sales.find(r=>r.personId===deskMember.id);
        assert.ok(sale);assert.equal((await h.state()).staffActions.filter(a=>a.command==='intro.purchase'&&a.after.id===sale.id).length,1);
        // A duplicate is refused visibly. The reasoned owner exception has its own exact confirmation.
        await section.locator(`[data-intro-offer="${offer.id}"]`).getByLabel('Member',{exact:true}).selectOption(deskMember.id);
        await section.locator(`[data-intro-offer="${offer.id}"]`).getByRole('button',{name:'Preview intro purchase',exact:true}).click();
        const alert=page.getByRole('alert');assert.match(await alert.innerText(),/intro already used/);await capture('duplicate-refused',alert);
        const exception=section.locator(`[data-intro-offer="${offer.id}"] form[action*="name=intro.preview"]`);
        await exception.getByLabel('Member',{exact:true}).selectOption(deskMember.id);
        await exception.getByText('Eligibility exception (owner only)',{exact:true}).click();
        await exception.getByLabel('Eligibility exception reason',{exact:true}).fill('Owner-approved repeat after studio closure');
        await exception.getByRole('button',{name:'Preview intro purchase',exact:true}).click();
        preview=(await h.state()).intros.previews.filter(q=>q.personId===deskMember.id&&q.status==='preview').at(-1);
        review=section.locator(`[data-intro-preview="${preview.id}"]`);await review.getByRole('checkbox').check();await capture('exception-preview',review);
        await review.getByRole('button',{name:'Confirm intro purchase',exact:true}).click();
        const exceptionSale=(await h.state()).intros.sales.find(r=>r.previewId===preview.id);
        assert.ok((await h.state()).staffActions.some(a=>a.command==='intro.purchase'&&a.right==='price'&&a.after.id===exceptionSale.id));
        await capture('desk-receipt',section.locator(`[data-intro-sale="${exceptionSale.id}"]`));
        await page.goto(h.origin+'/app/people?person='+deskMember.id+'&auditCommand=intro.purchase#staff-actions');
        const history=page.locator('#staff-actions');await history.getByText('Recorded change',{exact:true}).first().click();
        assert.match(await history.innerText(),/Sell exact intro offer/);await capture('staff-history',history);
        await signIn(member.cookie);await page.goto(h.origin+'/app/packs#intro-offers');
        assert.equal(await section.getByText('Configure an intro offer',{exact:true}).count(),0);
        assert.ok(!(await section.innerText()).includes('Owner-approved repeat after studio closure'));
        const own=section.locator(`[data-intro-offer="${offer.id}"]`);await capture('member-offer',own);
        await own.getByRole('button',{name:'Preview intro purchase',exact:true}).click();
        preview=(await h.state(member.cookie)).intros.previews.filter(q=>q.status==='preview').at(-1);
        review=section.locator(`[data-intro-preview="${preview.id}"]`);await review.getByRole('checkbox').check();await capture('member-preview',review);
        await review.getByRole('button',{name:'Confirm intro purchase',exact:true}).click();
        sale=(await h.state(member.cookie)).intros.sales[0];assert.equal(sale.amountCents,3900);
        await capture('member-receipt',section.locator(`[data-intro-sale="${sale.id}"]`));
        // Conversion uses the existing separately accepted monthly studio-invoice door.
        let proposal=await h.cmd('plan.recurring.prepare',{packId:sale.packId,intervalMonths:1,requestId:'synthetic-strap-browser-'+width});
        await page.reload();let agreement=page.locator(`[data-recurring="${proposal.id}"]`);
        await capture('conversion-choice',agreement);await agreement.getByRole('button',{name:'Stop future invoices now',exact:true}).click();
        assert.equal((await h.state(member.cookie)).recurring.terms.find(t=>t.id===proposal.id).status,'stopped');
        await capture('conversion-declined',page.locator(`[data-recurring="${proposal.id}"]`));
        proposal=await h.cmd('plan.recurring.prepare',{packId:sale.packId,intervalMonths:1,requestId:'synthetic-strap-browser-fresh-'+width});
        await page.reload();agreement=page.locator(`[data-recurring="${proposal.id}"]`);
        await agreement.getByRole('button',{name:'I agree to these recurring invoices',exact:true}).click();
        const agreed=(await h.state(member.cookie)).recurring.terms.find(t=>t.id===proposal.id);
        assert.equal(agreed.status,'active');assert.equal(agreed.acknowledgement.amountCents,3900);
        await capture('conversion-accepted',page.locator(`[data-recurring="${proposal.id}"]`));
      } finally {await context.close();}
    }
  } finally {await browser.close();}
}
