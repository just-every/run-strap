import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from '@playwright/test';

export async function clientAppointmentsBrowser(h,{coach}) {
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});
  try {for(const width of [1440,390]) {
    const contexts=[];
    const pageFor=async cookie=>{
      const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context);
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});
        return route.continue();
      });
      const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:h.origin}]);return context.newPage();
    };
    const shot=async(page,name)=>{
      await page.waitForLoadState('networkidle');await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits screen');
      const panel=page.locator('#client-appointments');await panel.waitFor();
      const tiny=await panel.evaluate(root=>[...root.querySelectorAll('*')].filter(e=>e.getClientRects().length&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<13).map(e=>e.tagName+':'+e.textContent.slice(0,30)));
      assert.deepEqual(tiny,[],'appointment text stays readable');
      await panel.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-015-${name}-${width}.png`)});
    };
    try {
      const member=await h.person('ClientScreen'+width),desk=await h.person('ClientDesk'+width);
      await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt:'2099-12-31T00:00:00Z',eligibleServices:['Private Pilates']})).id});
      const waiver=(await h.state()).waiver;if(waiver)await h.cmd('waiver.acknowledge',{id:waiver.id},member.cookie);
      await h.cmd('staff.access.grant',{personId:desk.id,role:'front-desk',enabled:true,rights:Object.fromEntries(['booking','member-record'].map(right=>[right,{enabled:true,scopes:[{memberIds:[member.id],locationIds:['studio'],doors:['all']}]}]))});
      desk.cookie=await h.signIn(desk.email);await h.enroll(desk.cookie);
      const date=width===1440?'2093-10-20':'2093-10-27';
      const source=await h.cmd('appointment.series.offer.save',{requestId:randomUUID(),service:'Private Pilates',instructorId:coach.id,room:'Reformer studio',equipment:['Reformer 1'],bufferBeforeMinutes:10,bufferAfterMinutes:10,startDate:date,endDate:date,time:'09:00',minutes:50});
      const owner=await pageFor(h.owner),mine=await pageFor(member.cookie),phone=await pageFor(desk.cookie),back='/app/people?person='+member.id;
      await owner.goto(h.origin+back);let panel=owner.locator('#client-appointments');
      await panel.getByText('Send an appointment invitation',{exact:true}).click();
      await panel.getByLabel('Private owner offer').selectOption(source.id);await panel.getByLabel('Deposit owed externally ($)').fill('25.00');await shot(owner,'owner-delivery');
      await panel.getByRole('button',{name:'Send in-app invitation',exact:true}).click();
      await mine.goto(h.origin+'/app');panel=mine.locator('#client-appointments');await shot(mine,'member-invitation');
      await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Accept exact appointment terms',exact:true}).click();
      let saved=(await h.state(member.cookie)).appointments.find(r=>r.clientOfferId);
      assert.equal(saved.occurrences[0].status,'booked');assert.equal((await h.state()).packs.find(p=>p.personId===member.id).remaining,4);await shot(mine,'member-booked');
      await owner.goto(h.origin+back);panel=owner.locator('#client-appointments');await panel.getByText('Record received deposit',{exact:true}).click();await panel.getByLabel('External receipt reference').fill('synthetic-strap-browser-'+width);await shot(owner,'owner-deposit');
      await panel.getByRole('button',{name:'Record external deposit receipt',exact:true}).click();assert.equal((await h.state()).appointments.find(r=>r.id===saved.id).deposit.status,'recorded',await owner.locator('body').innerText());assert.ok((await owner.locator('body').innerText()).includes('Receipt recorded'),await owner.locator('body').innerText());await shot(owner,'owner-receipt');
      await mine.reload();panel=mine.locator('#client-appointments');await panel.getByText('Move this appointment',{exact:true}).click();await panel.getByLabel('New local start time').fill('11:00');await panel.getByRole('button',{name:'Preview appointment move',exact:true}).click();await shot(mine,'member-move-preview');
      await panel.getByRole('button',{name:'Confirm appointment move',exact:true}).click();await shot(mine,'member-moved');
      saved=(await h.state(member.cookie)).appointments.find(r=>r.id===saved.id);assert.equal(saved.occurrences[0].start,date+'T15:00:00.000Z');
      await phone.goto(h.origin+back);panel=phone.locator('#client-appointments');await panel.getByText('Cancel this appointment',{exact:true}).click();
      const cancel=panel.locator('form').filter({has:phone.getByRole('button',{name:'Preview appointment cancellation',exact:true})});await cancel.getByLabel('Cancellation reason').fill('Member phoned to cancel');await cancel.getByLabel('Request received by').selectOption('phone');
      await cancel.getByRole('button',{name:'Preview appointment cancellation',exact:true}).click();await shot(phone,'staff-cancel-preview');
      const review=panel.locator('[data-client-appointment-preview]').last();await review.getByLabel('Request received by').selectOption('phone');await review.getByRole('button',{name:'Confirm appointment cancellation',exact:true}).click();await shot(phone,'staff-cancelled');
      assert.equal((await h.state()).packs.find(p=>p.personId===member.id).remaining,5);
      await mine.reload();await shot(mine,'member-cancelled');
    } finally {for(const context of contexts)await context.close();}
  }} finally {await browser.close();}
}
