import assert from 'node:assert/strict';
import { mkdir,readFile } from 'node:fs/promises';
import { join,extname } from 'node:path';
import { chromium } from '@playwright/test';

export async function staffRightsBrowser(h,s) {
  const proof=process.env.STRAP_RIGHTS_PROOF_DIR ?? process.env.STRAP_PROOF_DIR;await mkdir(proof,{recursive:true});
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:1000}});
      try {
        await context.route(h.origin+'/**',async route=>{
          const path=new URL(route.request().url()).pathname,types={'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon','.js':'text/javascript'};
          if(!path.includes('..')&&types[extname(path)])return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:types[extname(path)]});
          return route.continue();
        });
        const login=async cookie=>{await context.clearCookies();const i=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,i),value:cookie.slice(i+1),url:h.origin}]);};
        const page=await context.newPage();page.setDefaultTimeout(15000);
        const capture=async name=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits');await page.screenshot({path:join(proof,'STAFF-001-'+name+'-'+width+'.png'),fullPage:true});};
        await login(h.owner);await page.goto(h.origin+'/app/security');
        const grant=page.locator('form[action*="name=staff.access.grant"]');
        await grant.locator('[name="personId"]').selectOption(s.desk.id);await grant.locator('[name="role"]').selectOption('front-desk');
        for(const right of ['booking','override','fee-waiver','check-in','member-record'])await grant.locator('[name="right_'+right+'"]').check();
        for(const member of [s.ana,s.ben])await grant.locator('[name="member_'+member.id+'"]').check();
        await grant.locator('[name="location_studio"]').check();
        await grant.getByRole('button',{name:'Save staff rights',exact:true}).click();
        assert.ok((await h.state()).staffAccessGrants.some(g=>g.personId===s.desk.id&&g.rights.booking.enabled));
        await page.locator('#staff-rights').scrollIntoViewIfNeeded();await capture('owner-rights');
        const entry=await s.publish('Desk reservation '+width,width===1440?50:52);
        await login(s.desk.cookie);await page.goto(h.origin+'/app/people?person='+s.ana.id);
        const book=page.locator('form[action*="name=booking.desk"]');await book.locator('[name="classId"]').selectOption(entry.id);
        await book.getByRole('button',{name:'Book at desk',exact:true}).click();
        const booked=(await h.state()).bookings.find(b=>b.classId===entry.id&&b.personId===s.ana.id);assert.ok(booked);
        let row=page.locator('[data-staff-booking="'+booked.id+'"]');await row.locator('summary').click();
        const cancel=row.locator('form[action*="name=booking.cancel"]');await cancel.locator('[name="cancelReason"]').selectOption('Sick');await cancel.getByRole('button',{name:'Cancel booking',exact:true}).click();
        assert.equal((await h.state()).bookings.find(b=>b.id===booked.id).status,'cancelled');
        row=page.locator('[data-staff-booking="'+booked.id+'"]');await row.locator('summary').click();const restore=row.locator('form[action*="name=booking.restore"]');await restore.locator('[name="reason"]').fill('Member requested the seat again');await restore.getByRole('button',{name:'Restore booking',exact:true}).click();
        assert.equal((await h.state()).bookings.find(b=>b.id===booked.id).status,'booked');
        await page.locator('[data-staff-booking="'+booked.id+'"] summary').click();await page.locator('#staff-bookings').scrollIntoViewIfNeeded();await capture('desk-bookings');
        for(const path of ['/api/strap/exit.json','/api/strap/reports/revenue.csv'])assert.equal((await context.request.get(h.origin+path)).status(),403);
        await login(s.manager.cookie);await page.goto(h.origin+'/app/people?person='+s.ana.id);await capture('manager-members');
        await s.grant(s.coach,'instructor',['booking','member-record'],[s.ana.id],['studio']);
        if(width===1440)await h.enroll(s.coach.cookie);
        await login(s.coach.cookie);await page.goto(h.origin+'/app/people?person='+s.ana.id);await capture('instructor-members');
      } finally {await context.close();}
    }
  } finally {await browser.close();}
}
