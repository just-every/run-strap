import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from '@playwright/test';
import { auditPage } from './accessibility-browser.mjs';
import { publishWidget, widgetChoice } from './booking-widget-journey.mjs';

export async function widgetBrowser(h,week,edge) {
  const proof=process.env.STRAP_WIDGET_PROOF_DIR??process.env.STRAP_PROOF_DIR;if(proof)await mkdir(proof,{recursive:true});
  await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Movement studio',timeZone:'America/New_York'});
  const member=await h.person('WidgetBrowserMember'),desk=await h.person('WidgetBrowserDesk'),coach=await h.person('WidgetBrowserCoach','instructor');
  const draft=await h.cmd('classes.prepare',{week,classes:[0,1,2].map(n=>({title:'Mat movement '+n,service:n===2?'Strength':'Mat',start:week+`T${10+n*2}:00:00Z`,end:week+`T${11+n*2}:00:00Z`,capacity:4,instructorId:coach.id}))});await h.cmd('classes.publish',{id:draft.id});const entries=(await h.state()).classes;
  const pack=await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt:new Date(Date.parse(week)+90*86400_000).toISOString()});await h.cmd('pack.approve',{id:pack.id});
  await (await import('./payment-fixtures.mjs')).connectPayment(h);
  let invoice=await h.cmd('billing.checkout.start',{packId:(await h.state()).packs[0].id,requestId:'synthetic-strap-widget-browser-payment',confirm:true});
  await h.cmd('waiver.publish',{text:'Review the current movement safety policy before joining this class.',requiresSignature:true});
  await h.cmd('intake.form.publish',{requestId:'synthetic-strap-widget-browser-intake',title:'Movement preparation',scope:'service',service:'Mat',required:true,questions:[{label:'Movement preference',required:true,sensitive:true}]});
  await h.cmd('staff.access.grant',{personId:desk.id,role:'front-desk',enabled:true,rights:{booking:{enabled:true,scopes:[{memberIds:[member.id],locationIds:['studio'],doors:['all']}]}}});await h.enroll(desk.cookie);
  await h.cmd('intro.offer.save',{name:'Phone intro',days:14,credits:2,amountCents:3000,eligibility:'new',limit:'person',eligibleServices:['Mat']});
  let embed='';const hosts=[];
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
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
        await context.route('https://checkout.stripe.com/**',async route=>{
          edge.complete(invoice.providerSessionId);
          await h.cmd('billing.reconcile',{id:invoice.id,requestId:'synthetic-strap-widget-browser-settled'});
          return route.fulfill({status:303,headers:{location:h.origin+'/app/packs?billing=returned'}});
        });
        const page=await context.newPage();page.setDefaultTimeout(15000);
        const login=async cookie=>{await context.clearCookies();const i=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,i),value:cookie.slice(i+1),url:h.origin}]);};
        const capture=async(name,target=page)=>{assert.ok(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits viewport');if(proof)await page.screenshot({path:join(proof,`APP-002-${name}-${width}.png`),fullPage:true});};
        embed=h.origin+'/booking/widget?'+new URLSearchParams({embeddingOrigin:hosts[0].origin});
        await page.goto(hosts[0].origin);const frame=page.frameLocator('iframe');await frame.getByRole('heading',{name:'Class schedule',exact:true}).waitFor();
        await capture('embedded-schedule',page.frames().find(f=>f.url()===embed));
        if(width===1440) {
          await auditPage(page.frames().find(f=>f.url()===embed),'public embedded schedule');
          assert.equal(await page.evaluate(()=>document.querySelector('iframe').contentDocument),null,'host cannot inspect cross-origin document');
          await frame.getByLabel('Service',{exact:true}).selectOption('Strength');await Promise.all([page.waitForEvent('framenavigated',{predicate:f=>f.url().includes('service=Strength')}),frame.getByRole('button',{name:'Show classes'}).click()]);await frame.getByRole('heading',{name:entries[2].title,exact:true}).waitFor();assert.equal(await frame.getByRole('heading',{name:entries[0].title,exact:true}).count(),0);
          await page.goto(hosts[1].origin);await page.frameLocator('iframe').getByRole('heading',{name:'Class schedule',exact:true}).waitFor();
          await page.goto(hosts[2].origin);await page.waitForLoadState('networkidle');assert.equal(await page.frameLocator('iframe').getByRole('heading',{name:'Class schedule',exact:true}).count(),0,'unapproved ancestor is blocked by the browser');
          await page.goto(hosts[0].origin);
          await page.frameLocator('iframe').getByRole('link',{name:'Select class',exact:true}).first().click();await page.waitForURL('**/signin?returnTo=*');assert.equal(page.frames().length,1,'sign-in opens at top level');
          const returnTo=new URL(page.url()).searchParams.get('returnTo');assert.ok(returnTo.startsWith('/app/widget?selection='));
          await login(member.cookie);await page.goto(h.origin+returnTo);await page.getByRole('heading',{name:'Review selected class'}).waitFor();await capture('private-signing');await auditPage(page,'private selected class signing and intake');
          await page.getByLabel('I personally affirm this exact document. This does not authorize a payment.').check();await page.getByRole('button',{name:'Sign this document',exact:true}).click();await page.waitForURL(h.origin+returnTo);
          await page.getByLabel('Movement preference',{exact:true}).fill('Personal mat choice');await page.getByRole('button',{name:'Save my intake answers',exact:true}).click();await page.waitForURL(h.origin+returnTo);await page.getByRole('button',{name:'Book my class',exact:true}).waitFor();
          await page.getByRole('link',{name:'Review approved test payment',exact:false}).click();await page.getByRole('heading',{name:'Approved test payment',exact:true}).waitFor();await capture('approved-payment');await auditPage(page,'private approved payment');
          await page.getByRole('link',{name:'Continue approved test payment',exact:true}).click();await page.waitForURL(h.origin+'/app/packs?billing=returned');await page.getByRole('link',{name:'Return to selected class',exact:true}).waitFor();await capture('payment-return');
          await page.getByRole('link',{name:'Return to selected class',exact:true}).click();await page.getByRole('button',{name:'Book my class',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('selection'),new URL(returnTo,h.origin).searchParams.get('selection'));await capture('private-review');await auditPage(page,'private selected class review');
          await page.getByLabel('I am an adult booking for myself.').check();const posted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('name=booking.book'));await page.getByRole('button',{name:'Book my class',exact:true}).click();const result=await posted;if(result.status()!==303)assert.fail(((await result.text()).match(/role="alert"[^>]*>([^<]+)/)?.[1]??'form refused')+' origin='+result.request().headers().origin);await page.waitForURL(h.origin+'/app');assert.equal((await h.state(member.cookie)).bookings.filter(b=>b.classId===entries[0].id).length,1);
        } else {
          const selection=await widgetChoice(h,hosts[0].origin,entries[1].id);await login(desk.cookie);await page.goto(h.origin+selection.location);await page.getByRole('heading',{name:'Review selected class'}).waitFor();await page.getByLabel('Invited adult member',{exact:true}).selectOption(member.id);await page.getByRole('button',{name:'Review member',exact:true}).click();await page.getByRole('heading',{name:member.name,exact:true}).waitFor();
          assert.equal(await page.getByRole('button',{name:'Send personal signing link',exact:true}).count(),0,'booking right alone shows no signing launch');await page.getByLabel('Booking reference',{exact:true}).fill('synthetic-strap-widget-phone');await capture('staff-review');await page.getByRole('button',{name:'Book for member',exact:true}).click();await page.waitForURL(h.origin+'/app');assert.ok((await h.state()).bookings.some(b=>b.personId===member.id&&b.classId===entries[1].id&&b.madeByRole==='front-desk'));
          await h.cmd('waiver.publish',{text:'Current Strength service movement policy.',service:'Strength',requiresSignature:true});
          const fresh=await widgetChoice(h,hosts[0].origin,entries[2].id);await login(h.owner);await page.goto(h.origin+fresh.location+'&member='+member.id);await page.getByRole('heading',{name:member.name,exact:true}).waitFor();await capture('staff-signing-launch');
          await page.getByLabel('Channel',{exact:true}).selectOption('phone');await page.getByRole('button',{name:'Send personal signing link',exact:true}).click();await page.waitForURL(h.origin+fresh.location+'&member='+member.id);assert.equal((await h.state()).staffActions.filter(a=>a.command==='waiver.launch'&&a.personId===member.id&&a.channel==='phone').length,1);
          await login(member.cookie);await page.goto(h.origin+fresh.location);await page.getByRole('heading',{name:'Review selected class'}).waitFor();await capture('private-signing');
          await page.getByLabel('I personally affirm this exact document. This does not authorize a payment.').check();await page.getByRole('button',{name:'Sign this document',exact:true}).click();await page.waitForURL(h.origin+fresh.location);await page.getByRole('button',{name:'Book my class',exact:true}).waitFor();await capture('private-review');
        }
        await login(h.owner);await page.goto(h.origin+'/app/studio');const settings=page.locator('section').filter({has:page.getByRole('heading',{name:'Public schedule settings',exact:true})});await settings.scrollIntoViewIfNeeded();if(proof)await settings.screenshot({path:join(proof,`APP-002-settings-${width}.png`)});
        await settings.getByLabel('Adult invitation requests',{exact:true}).selectOption('true');await settings.getByLabel('I approve these exact public embedding origins.').check();await settings.getByRole('button',{name:'Save public schedule',exact:true}).click();
        await context.clearCookies();await page.goto(hosts[0].origin);await page.frameLocator('iframe').getByRole('link',{name:'Request an invitation',exact:true}).first().click();await page.waitForURL('**/booking/join?selection=*');
        const joinToken=new URL(page.url()).searchParams.get('selection'),newName='Synthetic browser adult '+width,newEmail='new-'+width+'-'+member.email;
        await page.getByRole('heading',{name:'Request a studio invitation',exact:true}).waitFor();await capture('signup-request');if(width===1440)await auditPage(page,'public personal invitation request');
        await page.getByLabel('Your full name',{exact:true}).fill(newName);await page.getByLabel('Your email',{exact:true}).fill(newEmail);await page.getByLabel('I am an adult requesting an invitation for myself.').check();await page.getByLabel('I ask the studio owner to review these details and invite me to sign in.').check();await page.getByRole('button',{name:'Request my invitation',exact:true}).click();await page.getByRole('heading',{name:'Invitation request recorded',exact:true}).waitFor();await capture('signup-recorded');
        await login(h.owner);await page.goto(h.origin+'/app/studio');const approval=page.locator('form[action*="name=widget.signup.approve"]').filter({hasText:newName});await approval.getByRole('checkbox').check();if(proof)await approval.screenshot({path:join(proof,`APP-002-owner-signup-review-${width}.png`)});await approval.getByRole('button',{name:'Create reviewed member',exact:true}).click();await page.getByRole('button',{name:'Invite reviewed member',exact:true}).click();
        const mail=(await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()).results.map(r=>JSON.parse(r.message)).find(m=>m.to.includes(newEmail));
        const authToken=new URL(mail.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token'),signedIn=await h.send('/auth/confirm',{token:authToken});
        await login(signedIn.cookie);await page.goto(h.origin+signedIn.headers.get('location'));await page.getByRole('heading',{name:'Review selected class',exact:true}).waitFor();if(width===1440)assert.equal(new URL(page.url()).searchParams.get('selection'),joinToken);await capture('new-member-return');
        if(width===390) {
          const selected=page.url(),newMember=(await h.state()).people.find(p=>p.email===newEmail);await h.cmd('intro.identity.verify',{personId:newMember.id,reason:'Checked in person at the studio',householdChecked:true});
          await page.getByLabel('I personally affirm this exact document. This does not authorize a payment.').check();await page.getByRole('button',{name:'Sign this document',exact:true}).click();await page.waitForURL(selected);
          await page.getByLabel('Movement preference',{exact:true}).fill('New adult mat choice');await page.getByRole('button',{name:'Save my intake answers',exact:true}).click();await page.waitForURL(selected);
          await page.getByRole('button',{name:'Review intro offer',exact:true}).click();await page.waitForURL(selected);await page.getByRole('heading',{name:'Phone intro · exact terms',exact:true}).waitFor();await capture('intro-terms');await auditPage(page,'private intro offer terms');
          await page.getByLabel('Confirm these exact intro terms and studio-balance charge.').check();await page.getByRole('button',{name:'Buy intro offer',exact:true}).click();await page.waitForURL(selected);await page.getByRole('button',{name:'Book my class',exact:true}).waitFor();
          const sale=(await h.state()).intros.sales.find(r=>r.personId===newMember.id);invoice=await h.cmd('billing.checkout.start',{packId:sale.packId,requestId:'synthetic-strap-widget-intro-payment',confirm:true});
          await page.reload();await page.getByRole('link',{name:'Review approved test payment',exact:false}).click();await page.getByRole('heading',{name:'Approved test payment',exact:true}).waitFor();await capture('approved-payment');
          await page.getByRole('link',{name:'Continue approved test payment',exact:true}).click();await page.waitForURL(h.origin+'/app/packs?billing=returned');await page.getByRole('link',{name:'Return to selected class',exact:true}).waitFor();await capture('payment-return');
          await page.getByRole('link',{name:'Return to selected class',exact:true}).click();await page.getByLabel('I am an adult booking for myself.').check();await page.getByRole('button',{name:'Book my class',exact:true}).click();await page.waitForURL(h.origin+'/app');
          const after=await h.state();assert.equal(after.bookings.filter(b=>b.personId===newMember.id&&b.classId===entries[0].id&&b.status==='booked').length,1);assert.equal(after.payments.filter(p=>p.packId===sale.packId).length,1);assert.equal(after.packs.find(p=>p.id===sale.packId).remaining,1);
        }
        await login(h.owner);await page.goto(h.origin+'/app/studio');
        if(width===1440) {await settings.getByLabel('Public schedule',{exact:true}).selectOption('false');await settings.getByLabel('I approve these exact public embedding origins.').check();await settings.getByRole('button',{name:'Save public schedule',exact:true}).click();assert.equal((await h.send('/booking/widget?embeddingOrigin='+encodeURIComponent(hosts[0].origin))).status,404);await h.cmd('widget.settings.save',{enabled:true,origins:hosts.slice(0,2).map(h=>h.origin),confirm:true});}
      }finally {await context.close();}
    }
  } finally {await browser.close();await Promise.all(hosts.map(({server})=>new Promise(r=>server.close(r))));}
}
