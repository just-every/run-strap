import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from '@playwright/test';

export async function clientAppointmentsBrowser(h,{coach}) {
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});
  try {for(const width of (process.env.STRAP_CLIENT_WIDTHS??'1440').split(',').map(Number)) {
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
    const shot=async(page,name,target)=>{
      await page.waitForLoadState('networkidle');await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits screen');
      const panel=page.locator('#client-appointments');await panel.waitFor();
      const tiny=await panel.evaluate(root=>[...root.querySelectorAll('*')].filter(e=>e.getClientRects().length&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<13).map(e=>e.tagName+':'+e.textContent.slice(0,30)));
      assert.deepEqual(tiny,[],'appointment text stays readable');
      const missing=await page.locator('button,a,summary,[role=button]').evaluateAll(controls=>controls.filter(c=>c.checkVisibility()&&!c.innerText.trim()&&c.querySelector('svg,img')&&!c.querySelector('[role=tooltip]')).map(c=>c.tagName));
      assert.deepEqual(missing,[],'visible icon controls have tooltips');
      await (target??panel).screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-015-${name}-${width}.png`)});
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
      const nextDate=width===1440?'2093-10-21':'2093-10-28';
      const nextSource=await h.cmd('appointment.series.offer.save',{requestId:randomUUID(),service:'Private Pilates',instructorId:coach.id,room:'Reformer studio',startDate:nextDate,endDate:nextDate,time:'09:00',minutes:50});
      const nextOffer=await h.cmd('appointment.client.deliver',{personId:member.id,offerId:nextSource.id,depositCents:0,requestId:randomUUID()});
      await phone.reload();panel=phone.locator('#client-appointments');
      const offered=panel.locator(`[data-client-appointment-offer="${nextOffer.id}"]`);
      await offered.getByRole('checkbox').check();await offered.getByLabel('Request received by').selectOption('phone');await shot(phone,'staff-accept-review');
      await offered.getByRole('button',{name:'Accept exact appointment terms',exact:true}).click();
      const next=(await h.state(member.cookie)).appointments.find(r=>r.clientOfferId===nextOffer.id);assert.equal(next.acceptedByRole,'front-desk');await shot(phone,'staff-accepted');
      let row=panel.locator(`[data-client-appointment="${next.id}"]`);await row.getByText('Move this appointment',{exact:true}).click();
      const moving=row.locator('form').filter({has:phone.getByRole('button',{name:'Preview appointment move',exact:true})});
      await moving.getByLabel('New local start time').fill('13:00');await moving.getByLabel('Request received by').selectOption('phone');await moving.getByRole('button',{name:'Preview appointment move',exact:true}).click();await shot(phone,'staff-move-preview');
      await panel.locator('[data-client-appointment-preview]').getByRole('button',{name:'Confirm appointment move',exact:true}).click();await shot(phone,'staff-moved');
      await mine.reload();panel=mine.locator('#client-appointments');row=panel.locator(`[data-client-appointment="${next.id}"]`);
      await row.getByText('Cancel this appointment',{exact:true}).click();await row.getByLabel('Cancellation reason').fill('My plans changed');await row.getByRole('button',{name:'Preview appointment cancellation',exact:true}).click();await shot(mine,'member-cancel-preview');
      await panel.getByRole('button',{name:'Confirm appointment cancellation',exact:true}).click();await shot(mine,'member-confirmed-cancellation');
      const result=await h.state();assert.equal(result.packs.find(p=>p.personId===member.id).remaining,5);
      const events=result.staffActions.filter(a=>a.personId===member.id&&['appointment.client.accept','appointment.client.change.confirm'].includes(a.command));
      assert.deepEqual(events.map(e=>e.action).sort(),['appointment.cancel','appointment.move','appointment.save']);
      assert.ok(events.every(e=>e.actorRole==='front-desk'&&e.right==='booking'&&e.channel==='phone'));
      const series=await h.cmd('appointment.series.offer.save',{requestId:randomUUID(),service:'Private Pilates',instructorId:coach.id,room:'Reformer studio',startDate:width===1440?'2097-01-03':'2097-02-07',endDate:width===1440?'2097-01-17':'2097-02-21',time:'09:00',minutes:50,choices:[{date:width===1440?'2097-01-10':'2097-02-14',skip:true,reason:'Studio holiday'}]});
      const seriesOffer=await h.cmd('appointment.client.deliver',{personId:member.id,offerId:series.id,requestId:randomUUID()});
      await mine.reload();panel=mine.locator('#client-appointments');
      const seriesReview=panel.locator(`[data-client-appointment-offer="${seriesOffer.id}"]`);await seriesReview.getByText('Not reserved: Studio holiday',{exact:true}).waitFor();await shot(mine,'member-series-offer',seriesReview);
      await seriesReview.getByRole('checkbox').check();await seriesReview.getByRole('button',{name:'Accept exact appointment terms',exact:true}).click();
      const seriesSaved=(await h.state(member.cookie)).appointments.find(r=>r.clientOfferId===seriesOffer.id);
      assert.deepEqual(seriesSaved.occurrences.map(o=>o.status),['booked','skipped','booked']);
      assert.equal((await h.state()).packs.find(p=>p.personId===member.id).remaining,3);
      await shot(mine,'member-series-saved',panel.locator(`[data-client-appointment="${seriesSaved.id}"]`));

    } finally {for(const context of contexts)await context.close();}
  }} finally {await browser.close();}
}
