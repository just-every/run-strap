import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from '@playwright/test';
import { publishWidget, widgetChoice } from './booking-widget-journey.mjs';

export async function widgetBrowser(h,week) {
  const proof=process.env.STRAP_WIDGET_PROOF_DIR??process.env.STRAP_PROOF_DIR;if(proof)await mkdir(proof,{recursive:true});
  await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Movement studio',timeZone:'America/New_York'});
  const member=await h.person('WidgetBrowserMember'),desk=await h.person('WidgetBrowserDesk'),coach=await h.person('WidgetBrowserCoach','instructor');
  const draft=await h.cmd('classes.prepare',{week,classes:[0,1,2].map(n=>({title:'Mat movement '+n,service:n===2?'Strength':'Mat',start:week+`T${10+n*2}:00:00Z`,end:week+`T${11+n*2}:00:00Z`,capacity:4,instructorId:coach.id}))});await h.cmd('classes.publish',{id:draft.id});const entries=(await h.state()).classes;
  const pack=await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt:new Date(Date.parse(week)+90*86400_000).toISOString()});await h.cmd('pack.approve',{id:pack.id});
  await h.cmd('staff.access.grant',{personId:desk.id,role:'front-desk',enabled:true,rights:{booking:{enabled:true,scopes:[{memberIds:[member.id],locationIds:['studio'],doors:['all']}]}}});await h.enroll(desk.cookie);
  let embed='';const hosts=[];
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH??(process.platform==='linux'?'/usr/bin/chromium':undefined),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  try {
    for(let n=0;n<3;n++) {const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(`<!doctype html><html lang="en"><title>Studio website</title><body style="margin:0"><iframe title="Class schedule" src="${embed}" style="border:0;width:100%;height:1200px"></iframe></body></html>`)});await new Promise(r=>server.listen(0,'127.0.0.1',r));hosts.push({server,origin:`http://127.0.0.1:${server.address().port}`});}
    await publishWidget(h,entries[0],coach,hosts[0].origin);
    for(const entry of entries.slice(1))await h.cmd('widget.class.publish',{classId:entry.id,description:'Accessible movement with individual choices.',approved:true});
    await h.cmd('widget.settings.save',{enabled:true,origins:hosts.slice(0,2).map(h=>h.origin),confirm:true});
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:1000}});
      try {
        const types={'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon','.js':'text/javascript'};
        await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&types[extname(path)])return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:types[extname(path)]});return route.continue();});
        const page=await context.newPage();page.setDefaultTimeout(15000);
        const login=async cookie=>{await context.clearCookies();const i=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,i),value:cookie.slice(i+1),url:h.origin}]);};
        const capture=async(name,target=page)=>{assert.ok(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits viewport');if(proof)await page.screenshot({path:join(proof,`APP-002-${name}-${width}.png`),fullPage:true});};
        embed=h.origin+'/booking/widget?'+new URLSearchParams({embeddingOrigin:hosts[0].origin});
        await page.goto(hosts[0].origin);const frame=page.frameLocator('iframe');await frame.getByRole('heading',{name:'Class schedule',exact:true}).waitFor();
        await capture('embedded-schedule',page.frames().find(f=>f.url()===embed));
        if(width===1440) {
          assert.equal(await page.evaluate(()=>document.querySelector('iframe').contentDocument),null,'host cannot inspect cross-origin document');
          await frame.getByLabel('Service',{exact:true}).selectOption('Strength');await Promise.all([page.waitForEvent('framenavigated',{predicate:f=>f.url().includes('service=Strength')}),frame.getByRole('button',{name:'Show classes'}).click()]);await frame.getByRole('heading',{name:entries[2].title,exact:true}).waitFor();assert.equal(await frame.getByRole('heading',{name:entries[0].title,exact:true}).count(),0);
          await page.goto(hosts[1].origin);await page.frameLocator('iframe').getByRole('heading',{name:'Class schedule',exact:true}).waitFor();
          await page.goto(hosts[2].origin);await page.waitForLoadState('networkidle');assert.equal(await page.frameLocator('iframe').getByRole('heading',{name:'Class schedule',exact:true}).count(),0,'unapproved ancestor is blocked by the browser');
          await page.goto(hosts[0].origin);
          await page.frameLocator('iframe').getByRole('link',{name:'Select class',exact:true}).first().click();await page.waitForURL('**/signin?returnTo=*');assert.equal(page.frames().length,1,'sign-in opens at top level');
          const returnTo=new URL(page.url()).searchParams.get('returnTo');assert.ok(returnTo.startsWith('/app/widget?selection='));
          await login(member.cookie);await page.goto(h.origin+returnTo);await page.getByRole('heading',{name:'Review selected class'}).waitFor();await capture('private-review');
          await page.getByLabel('I am an adult booking for myself.').check();const posted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('name=booking.book'));await page.getByRole('button',{name:'Book my class',exact:true}).click();const result=await posted;if(result.status()!==303)assert.fail(((await result.text()).match(/role="alert"[^>]*>([^<]+)/)?.[1]??'form refused')+' origin='+result.request().headers().origin);await page.waitForURL(h.origin+'/app');assert.equal((await h.state(member.cookie)).bookings.filter(b=>b.classId===entries[0].id).length,1);
        } else {
          const selection=await widgetChoice(h,hosts[0].origin,entries[1].id);await login(desk.cookie);await page.goto(h.origin+selection.location);await page.getByRole('heading',{name:'Review selected class'}).waitFor();await page.getByLabel('Invited adult member',{exact:true}).selectOption(member.id);await page.getByLabel('Booking reference',{exact:true}).fill('synthetic-strap-widget-phone');await capture('staff-review');await page.getByRole('button',{name:'Book for member',exact:true}).click();await page.waitForURL(h.origin+'/app');assert.ok((await h.state()).bookings.some(b=>b.personId===member.id&&b.classId===entries[1].id&&b.madeByRole==='front-desk'));
          const fresh=await widgetChoice(h,hosts[0].origin,entries[2].id);await login(member.cookie);await page.goto(h.origin+fresh.location);await page.getByRole('heading',{name:'Review selected class'}).waitFor();await capture('private-review');
        }
        await login(h.owner);await page.goto(h.origin+'/app/studio');const settings=page.locator('section').filter({has:page.getByRole('heading',{name:'Public schedule settings',exact:true})});await settings.scrollIntoViewIfNeeded();if(proof)await settings.screenshot({path:join(proof,`APP-002-settings-${width}.png`)});
        if(width===1440) {await settings.getByLabel('Public schedule',{exact:true}).selectOption('false');await settings.getByLabel('I approve these exact public embedding origins.').check();await settings.getByRole('button',{name:'Save public schedule',exact:true}).click();assert.equal((await h.send('/booking/widget?embeddingOrigin='+encodeURIComponent(hosts[0].origin))).status,404);await h.cmd('widget.settings.save',{enabled:true,origins:hosts.slice(0,2).map(h=>h.origin),confirm:true});}
      }finally {await context.close();}
    }
  } finally {await browser.close();await Promise.all(hosts.map(({server})=>new Promise(r=>server.close(r))));}
}
