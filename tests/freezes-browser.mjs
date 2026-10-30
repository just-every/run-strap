import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

const dateAt=(zone,days)=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Date.now()+days*86_400_000)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`}
export async function freezesBrowser(h,{member,direct,stranger,typeId}) {
  typeId=(await h.cmd('freeze.type.save',{name:'Travel',reason:'Planned travel agreed with the studio',feeCents:1000,defaultLengthDays:30,maxLengthDays:90,allowedStartDays:[1,2,3,4,5,6,7],allowOpenEnded:false})).id
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {
    for(const width of [1440,390]) {
      const contexts=[]
      try {
        const pageFor=async cookie=>{
          const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context)
          await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()})
          const eq=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,eq),value:cookie.slice(eq+1),url:h.origin}]);return context.newPage()
        }
        const shot=async(page,label)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`PLAN-006-${label}-${width}.png`),fullPage:false})}
        const sale=async who=>{const ack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:who.id,credits:8,amountCents:14000,expiresAt:new Date(Date.now()+90*86400000).toISOString()})).id});return(await h.state()).packs.find(p=>p.id===ack.id)}
        const pack=await sale(member),directPack=await sale(direct),packId=pack.id,directPackId=directPack.id,zone=(await h.state()).studio.timeZone
        const staff=await pageFor(h.owner),mine=await pageFor(member.cookie),directMine=await pageFor(direct.cookie)
        // The actual recurring-consent forms precede any freeze: no balance agreement is inferred.
        await staff.goto(h.origin+'/app/packs?person='+member.id+'#freezes')
        await staff.getByText('Propose recurring studio invoices',{exact:true}).click()
        const recurring=staff.locator('form[action*="name=plan.recurring.prepare"]')
        await recurring.locator('select[name=packId]').selectOption(packId)
        await recurring.getByLabel('Calendar months per invoice',{exact:true}).fill('1')
        await recurring.getByRole('button',{name:'Preview recurring invoices',exact:true}).click()
        const proposal=(await h.state()).recurring.terms.find(t=>t.packId===packId)
        assert.ok(proposal)
        await mine.goto(h.origin+'/app/packs#freezes');await mine.reload()
        assert.match(await mine.locator(`[data-recurring-consent="${proposal.id}"]`).innerText(),/until stopped/)
        await mine.locator(`[data-recurring="${proposal.id}"]`).getByRole('button',{name:'I agree to these recurring invoices',exact:true}).click()
        assert.equal((await h.state(member.cookie)).recurring.terms.find(t=>t.id===proposal.id).status,'active')
        assert.match(await mine.locator(`[data-recurring-acknowledgement="${proposal.id}"]`).innerText(),/until stopped/)
        const dates=[dateAt(zone,2),dateAt(zone,32)]
        const type=mine.locator(`[data-freeze-type="${typeId}"]`)
        await type.locator('summary').click()
        const ask=type.locator('form[action*="name=freeze.request"]')
        await ask.locator('select[name=packId]').selectOption(packId)
        for(const [prefix,date] of [['Freeze starts',dates[0]],['Resumption',dates[1]]])await ask.getByLabel(prefix+' date',{exact:true}).fill(date)
        assert.equal(await ask.locator('input[type=time]').count(),0)
        await ask.locator('textarea[name=reason]').fill('Family travel planned with the studio')
        await shot(mine,'member-request')
        await ask.getByRole('button',{name:'Request these freeze dates',exact:true}).click()
        const request=(await h.state(member.cookie)).freezes.requests.find(r=>r.packId===packId)
        assert.ok(request)
        await staff.goto(h.origin+'/app/packs?person='+member.id+'#freezes')
        await staff.locator(`[data-freeze-request="${request.id}"]`).getByRole('button',{name:'Preview requested freeze',exact:true}).click()
        const freeze=(await h.state()).freezes.freezes.find(f=>f.packId===packId)
        const preview=staff.locator(`[data-freeze="${freeze.id}"]`)
        await preview.getByText(/Freeze fee \$10\.00/).waitFor()
        assert.equal(await preview.getByRole('button',{name:'Approve this exact freeze',exact:true}).count(),0,'staff must wait for exact member acceptance')
        await preview.scrollIntoViewIfNeeded();await shot(staff,'staff-preview')
        await mine.goto(h.origin+'/app/packs#freezes');await mine.reload()
        await shot(mine,'member-preview-before-scroll');assert.equal(await mine.locator(`[data-freeze="${freeze.id}"]`).count(),1,(await mine.locator('body').innerText()).slice(-5000));
        await mine.locator(`[data-freeze="${freeze.id}"]`).scrollIntoViewIfNeeded();await shot(mine,'member-preview')
        assert.equal(await mine.getByRole('button',{name:'Approve this exact freeze',exact:true}).count(),0)
        await mine.locator(`[data-freeze="${freeze.id}"]`).getByRole('button',{name:'I accept this exact freeze',exact:true}).click()
        assert.ok((await h.state(member.cookie)).freezes.freezes.find(f=>f.id===freeze.id).acceptedAt)
        await staff.reload()
        await preview.getByRole('button',{name:'Approve this exact freeze',exact:true}).click()
        assert.equal((await h.state(member.cookie)).freezes.freezes.find(f=>f.id===freeze.id).status,'scheduled')
        await mine.reload();await mine.locator(`[data-freeze="${freeze.id}"]`).scrollIntoViewIfNeeded();await shot(mine,'member-confirmed')
        await preview.getByText('End this freeze earlier',{exact:true}).click()
        const endForm=preview.locator('form[action*="name=freeze.end.prepare"]')
        await endForm.getByLabel('Earlier resumption date',{exact:true}).fill(dateAt(zone,22))
        await endForm.getByLabel('Reason for earlier resumption',{exact:true}).fill('The member can return ten days earlier')
        await endForm.getByRole('button',{name:'Preview earlier resumption',exact:true}).click()
        const end=(await h.state()).freezes.ends.find(e=>e.freezeId===freeze.id&&e.status==='preview')
        const endPreview=staff.locator(`[data-freeze-end="${end.id}"]`)
        assert.equal(await endPreview.getByRole('button',{name:'Approve this earlier resumption',exact:true}).count(),0)
        await endPreview.scrollIntoViewIfNeeded();await shot(staff,'staff-resumption-awaiting-member')
        await mine.reload()
        await mine.locator(`[data-freeze-end="${end.id}"]`).getByRole('button',{name:'I accept this exact earlier resumption',exact:true}).click()
        await staff.reload()
        await endPreview.getByRole('button',{name:'Approve this earlier resumption',exact:true}).click()
        assert.equal((await h.state()).packs.find(p=>p.id===packId).expiresAt,end.revisedExpiresAt)
        await mine.reload()
        const withdrawal=mine.locator(`[data-freeze-withdrawal="${freeze.id}"]`)
        await withdrawal.locator('summary').click()
        assert.equal(await withdrawal.locator('[name=reason]').count(),0)
        await withdrawal.scrollIntoViewIfNeeded();await shot(mine,'member-withdrawal-preview')
        await withdrawal.getByRole('button',{name:'Withdraw this scheduled freeze',exact:true}).click()
        const withdrawn=await h.state(member.cookie)
        assert.equal(withdrawn.freezes.freezes.find(f=>f.id===freeze.id).status,'withdrawn')
        assert.equal(withdrawn.packs.find(p=>p.id===packId).expiresAt,pack.expiresAt)
        assert.equal(withdrawn.recurring.terms.find(t=>t.id===proposal.id).nextRenewalAt,pack.expiresAt)
        assert.equal(withdrawn.charges.filter(c=>c.freezeId===freeze.id).reduce((sum,c)=>sum+c.amountCents,0),0)
        await mine.locator(`[data-freeze="${freeze.id}"]`).scrollIntoViewIfNeeded();await shot(mine,'member-withdrawn')
        // Staff begins on the actual member profile and follows its freeze door.
        await staff.goto(h.origin+'/app/people?person='+direct.id)
        await staff.getByText('Membership freezes',{exact:true}).click()
        await staff.getByRole('link',{name:'Freeze this member’s plan',exact:true}).click()
        const directType=staff.locator(`[data-freeze-type="${typeId}"]`)
        await directType.locator('summary').click()
        const prepare=directType.locator('form[action*="name=freeze.prepare"]')
        await prepare.locator('select[name=packId]').selectOption(directPackId)
        await prepare.getByLabel('Freeze starts date',{exact:true}).fill(dates[0])
        await prepare.getByLabel('Resumption date',{exact:true}).fill(dates[1])
        await shot(staff,'staff-direct-form')
        await prepare.getByRole('button',{name:'Preview direct freeze',exact:true}).click()
        const directFreeze=(await h.state()).freezes.freezes.find(f=>f.packId===directPackId)
        assert.equal(directFreeze.freezeRequestId,null)
        assert.equal(await staff.locator(`[data-freeze="${directFreeze.id}"]`).getByRole('button',{name:'Approve this exact freeze',exact:true}).count(),0)
        await directMine.goto(h.origin+'/app/packs#freezes');await directMine.reload()
        await directMine.locator(`[data-freeze="${directFreeze.id}"]`).getByRole('button',{name:'I accept this exact freeze',exact:true}).click()
        await staff.reload()
        await staff.locator(`[data-freeze="${directFreeze.id}"]`).getByRole('button',{name:'Approve this exact freeze',exact:true}).click()
        await staff.goto(h.origin+'/app/people?person='+direct.id+'#staff-actions')
        await staff.locator('#staff-actions').scrollIntoViewIfNeeded();await shot(staff,'staff-direct-audit')
        assert.equal((await h.state()).staffActions.filter(a=>a.command==='freeze.confirm'&&a.after.id===directFreeze.id&&a.right==='contract-change').length,1)
        await staff.goto(h.origin+'/app/packs?person='+direct.id+'#freezes')
        const directWithdrawal=staff.locator(`[data-freeze-withdrawal="${directFreeze.id}"]`)
        await directWithdrawal.locator('summary').click()
        await directWithdrawal.getByLabel('Reason for withdrawing freeze',{exact:true}).fill('Member called to cancel the scheduled leave')
        await directWithdrawal.getByRole('button',{name:'Withdraw this scheduled freeze',exact:true}).click()
        assert.equal((await h.state()).packs.find(p=>p.id===directPackId).expiresAt,directPack.expiresAt)
        // Closed requests remain visible; members can withdraw without a reason.
        const requestViaForm=async(pack,reason)=>{
          await mine.goto(h.origin+'/app/packs#freezes');await mine.reload()
          const type=mine.locator(`[data-freeze-type="${typeId}"]`);await type.locator('summary').click()
          const ask=type.locator('form[action*="name=freeze.request"]')
          await ask.locator('select[name=packId]').selectOption(pack.id)
          await ask.getByLabel('Freeze starts date',{exact:true}).fill(dates[0])
          await ask.getByLabel('Resumption date',{exact:true}).fill(dates[1])
          await ask.locator('textarea[name=reason]').fill(reason)
          await ask.getByRole('button',{name:'Request these freeze dates',exact:true}).click()
          return(await h.state(member.cookie)).freezes.requests.find(r=>r.packId===pack.id&&r.status==='requested')
        }
        const declineRequest=await requestViaForm(await sale(member),'A second trip for studio review')
        await staff.goto(h.origin+'/app/packs?person='+member.id+'#freezes')
        const decline=staff.locator(`[data-freeze-request="${declineRequest.id}"]`)
        await decline.getByText('Decline this request',{exact:true}).click()
        await decline.getByLabel('Reason for declining freeze request',{exact:true}).fill('The studio requested revised dates before agreeing')
        await decline.scrollIntoViewIfNeeded();await shot(staff,'staff-decline-request')
        await decline.getByRole('button',{name:'Decline freeze request',exact:true}).click()
        assert.equal((await h.state()).freezes.requests.find(r=>r.id===declineRequest.id).status,'declined')
        await mine.goto(h.origin+'/app/packs#freezes');await mine.reload()
        await mine.locator(`[data-freeze-request="${declineRequest.id}"]`).scrollIntoViewIfNeeded();await shot(mine,'member-declined-request')
        const ownRequest=await requestViaForm(await sale(member),'A request the member then withdraws')
        const ownRequestPanel=mine.locator(`[data-freeze-request="${ownRequest.id}"]`)
        assert.equal(await ownRequestPanel.locator('[name=reason]').count(),0)
        await ownRequestPanel.getByRole('button',{name:'Withdraw freeze request',exact:true}).click()
        assert.equal((await h.state(member.cookie)).freezes.requests.find(r=>r.id===ownRequest.id).status,'withdrawn')
        await ownRequestPanel.scrollIntoViewIfNeeded();await shot(mine,'member-withdrawn-request')
        await mine.locator(`[data-recurring="${proposal.id}"]`).getByRole('button',{name:'Stop future invoices now',exact:true}).click()
        assert.equal((await h.state(member.cookie)).recurring.terms.find(t=>t.id===proposal.id).status,'cancellation_scheduled')
        assert.equal((await h.state(stranger.cookie)).freezes.requests.length,0)
      } finally {for(const context of contexts)await context.close()}
    }
  } finally {await browser.close()}
}

// The delegated workflow is asserted on the staff phone. The same changed
// screens are also photographed at desktop width without repeating the writes.
export async function scopedFreezesBrowser(h,{member,desk,type,grant,rights,day,today,midnight,west}) {
  const directory=process.env.STRAP_RIGHTS_PROOF_DIR||process.env.STRAP_PROOF_DIR;
  await mkdir(directory,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  const contexts=[];
  try {
    const pageFor=async cookie=>{
      const context=await browser.newContext({viewport:{width:390,height:1000}});contexts.push(context);
      await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()});
      const eq=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,eq),value:cookie.slice(eq+1),url:h.origin}]);return context.newPage();
    };
    const shot=async(page,selector,label)=>{
      for(const width of [1440,390]) {
        await page.setViewportSize({width,height:1000});await page.locator(selector).scrollIntoViewIfNeeded();
        await page.screenshot({path:join(directory,`PLAN-011-${label}-${width}.png`),fullPage:false});
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'phone stays within the viewport');
    };
    const followMemberLink=async(mine,link)=>{
      const target=await link.getAttribute('href');
      assert.equal(target,'/signin?returnTo=%2Fapp%2Fpacks%23freezes');
      await mine.goto(h.origin+target);
      await mine.getByLabel('Email',{exact:true}).fill(member.email);
      await mine.getByRole('button',{name:'Email a sign-in link',exact:true}).click();
      const outbox=(await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()).results;
      const message=outbox.map(r=>JSON.parse(r.message)).find(m=>m.to.includes(member.email));
      await mine.goto(message.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]);
      await mine.getByRole('button',{name:'Confirm',exact:true}).click();
      assert.equal(new URL(mine.url()).pathname,'/app/packs');
    };
    const actor=desk,role='front-desk',locationId=west.id;
    await grant(actor,role,rights,[member.id],[locationId]);
    const ack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:12000,locationId,expiresAt:midnight(day(today,90))})).id});
    const pack=(await h.state()).packs.find(p=>p.id===ack.id),proposal=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:crypto.randomUUID()});
    await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie);
    const staff=await pageFor(actor.cookie),mine=await pageFor(member.cookie),back='/app/people?person='+member.id+'#freezes';
    await staff.goto(h.origin+back);
    assert.equal(await staff.locator('form[action*="name=freeze.type.save"]').count(),0,'types stay owner-managed');
    assert.equal(await staff.locator('form[action*="name=plan.recurring.prepare"]').count(),0,'the freeze right grants no membership sale');
    const panel=staff.locator(`[data-freeze-type="${type.id}"]`);await panel.locator('summary').click();
    const prepare=panel.locator('form[action*="name=freeze.prepare"]');
    await prepare.locator('[name=packId]').selectOption(pack.id);await prepare.getByLabel('Freeze starts date',{exact:true}).fill(day(today,2));await prepare.getByLabel('Resumption date',{exact:true}).fill(day(today,32));
    await shot(staff,'#freezes','staff-form');
    await prepare.getByRole('button',{name:'Preview direct freeze',exact:true}).click();
    const freeze=(await h.state()).freezes.freezes.find(f=>f.packId===pack.id),preview=staff.locator(`[data-freeze="${freeze.id}"]`);
    assert.equal(freeze.feeCents,1000);assert.equal(freeze.effects.durationDays,30);assert.equal(freeze.freezeRequestId,null);
    assert.equal(await preview.getByRole('button',{name:'Approve this exact freeze',exact:true}).count(),0);
    await preview.getByRole('button',{name:'Open member freeze acceptance',exact:true}).click();
    assert.equal((await h.state()).freezes.freezes.find(f=>f.id===freeze.id).acceptedAt,null);
    await shot(staff,'.panel[role=status]','staff-awaiting-member');
    const freezeLink=staff.getByRole('link',{name:'Open member freeze acceptance',exact:true});
    await freezeLink.waitFor();await followMemberLink(mine,freezeLink);
    const personal=mine.locator(`[data-freeze="${freeze.id}"]`);await shot(mine,`[data-freeze="${freeze.id}"]`,'member-exact-fee');
    await personal.getByRole('button',{name:'I accept this exact freeze',exact:true}).click();
    await staff.reload();
    // A form already shown on the phone loses authority on its next request.
    await grant(actor,role,['member-record'],[member.id],[locationId]);
    const before=await h.state();await preview.getByRole('button',{name:'Approve this exact freeze',exact:true}).click();
    assert.equal((await h.state()).version,before.version);assert.equal((await h.state()).freezes.freezes.find(f=>f.id===freeze.id).status,'preview');
    assert.equal(await staff.locator('form[action*="name=freeze.confirm"]').count(),0);
    await shot(staff,'.page-main','staff-revoked');
    await grant(actor,role,rights,[member.id],[locationId]);await staff.goto(h.origin+back);
    await preview.getByRole('button',{name:'Approve this exact freeze',exact:true}).click();
    assert.equal((await h.state()).freezes.freezes.find(f=>f.id===freeze.id).status,'scheduled');
    await shot(staff,`[data-freeze="${freeze.id}"]`,'staff-confirmed');
    await preview.getByText('End this freeze earlier',{exact:true}).click();
    const ending=preview.locator('form[action*="name=freeze.end.prepare"]');await ending.getByLabel('Earlier resumption date',{exact:true}).fill(day(today,22));await ending.getByLabel('Reason for earlier resumption',{exact:true}).fill('Member returns on day twenty');
    await ending.getByRole('button',{name:'Preview earlier resumption',exact:true}).click();
    const end=(await h.state()).freezes.ends.find(e=>e.freezeId===freeze.id),endPanel=staff.locator(`[data-freeze-end="${end.id}"]`);
    assert.equal(await endPanel.getByRole('button',{name:'Approve this earlier resumption',exact:true}).count(),0);
    await endPanel.getByRole('button',{name:'Open member resumption acceptance',exact:true}).click();
    await shot(staff,'.panel[role=status]','staff-day-twenty');
    const endLink=staff.getByRole('link',{name:'Open member resumption acceptance',exact:true});
    await endLink.waitFor();await followMemberLink(mine,endLink);await shot(mine,`[data-freeze-end="${end.id}"]`,'member-day-twenty');await mine.locator(`[data-freeze-end="${end.id}"]`).getByRole('button',{name:'I accept this exact earlier resumption',exact:true}).click();
    await staff.reload();await endPanel.getByRole('button',{name:'Approve this earlier resumption',exact:true}).click();
    const state=await h.state();assert.equal(state.packs.find(p=>p.id===pack.id).expiresAt,end.revisedExpiresAt);assert.equal(state.charges.filter(c=>c.freezeId===freeze.id).length,1);assert.equal(state.staffActions.filter(a=>a.command==='freeze.end.confirm'&&a.after.id===end.id).length,1);
    await shot(staff,`[data-freeze-end="${end.id}"]`,'staff-end-confirmed');
    // Shared icon controls already use the common tooltip; no icon-only action
    // in this surface may lose its accessible tooltip when reached by keyboard.
    for(const control of await staff.locator('a.has-tooltip,button.has-tooltip').all()) {
      await control.focus();const tip=control.locator('[role=tooltip]');assert.equal(await tip.count(),1);assert.equal(await tip.isVisible(),true);
    }
    console.log('PROBE PLAN-011 A: profile launch renders a member link; native sign-in and personal acceptance complete for freeze and early resumption. Staff phone: member profile -> Medical fee and date acceptance, revoked visible confirmation refused, restored rights confirm once, personal day-20 resumption; screens 1440 and 390.');
  } finally {for(const context of contexts)await context.close();await browser.close();}
}
