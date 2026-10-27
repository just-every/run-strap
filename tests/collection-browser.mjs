import assert from 'node:assert/strict';
import { mkdir,readFile } from 'node:fs/promises';
import { join,extname } from 'node:path';
import { chromium } from '@playwright/test';

export async function collectionBrowser(h,edge,{seed,agreement,desk}) {
  const proof=process.env.STRAP_PROOF_DIR;await mkdir(proof,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    try {
      await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname,types={'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'};if(!path.includes('..')&&types[extname(path)])return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:types[extname(path)]});return route.continue();});
      const page=await context.newPage();page.setDefaultTimeout(15000);
      const sign=async cookie=>{await page.goto('about:blank');await context.clearCookies();const at=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:h.origin}]);};
      const capture=async name=>{for(const width of [1440,390]) {await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits');await page.screenshot({path:join(proof,'STAFF-001-'+name+'-'+width+'.png'),fullPage:true});}await page.setViewportSize({width:1440,height:1000});};
      await sign(desk.cookie);await page.goto(h.origin+'/app/people?person='+seed.member.id);
      await page.getByText('Personal payment method',{exact:true}).click();
      const form=page.locator('form[action*="name=billing.setup.start.launch"]');
      assert.deepEqual(await form.locator(':invalid').evaluateAll(es=>es.map(e=>({name:e.name,value:e.value,options:e.options?Array.from(e.options).map(o=>[o.value,o.text]):null}))),[]);
      const posted=page.waitForResponse(r=>new URL(r.url()).pathname==='/app/action'&&r.request().method()==='POST');
      await page.getByRole('button',{name:'Open personal card setup',exact:true}).click();
      const response=await posted;assert.equal(response.status(),200,(await response.text()).match(/role="alert">([^<]+)/)?.[1] ?? 'staff launch failed');
      assert.equal(await page.getByRole('link',{name:'Open member personal step',exact:true}).count(),1,(await page.locator('main').innerText()).slice(0,900));
      await page.getByRole('link',{name:'Open member personal step',exact:true}).waitFor();
      await capture('collection-handoff');
      await sign(seed.member.cookie);await page.goto(h.origin+'/app/packs#billing');
      const section=page.locator('[data-billing-agreement="'+agreement.id+'"]');
      await section.getByRole('button',{name:'Replace test card with Stripe',exact:true}).click();
      await page.getByRole('link',{name:'Continue to Stripe test card setup',exact:true}).waitFor();
      await capture('replacement-review');
      await page.goto(h.origin+'/app/packs#billing');
      edge.setComplete(false);
      await section.getByRole('button',{name:'Check replacement authorization',exact:true}).click();
      await section.getByRole('status').filter({hasText:'Stripe has not confirmed'}).waitFor();
      const pending=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
      assert.equal(pending.methods.filter(m=>m.available).length,1,'pending setup preserves the authorized method');
      await capture('replacement-pending');
      edge.setComplete(true);
      await section.getByRole('button',{name:'Check replacement authorization',exact:true}).click();
      await section.getByText('replaced historical method',{exact:false}).first().waitFor();
      assert.equal(await section.getByRole('button',{name:'Replace test card with Stripe',exact:true}).count(),1);
      await capture('replacement-confirmed');
      const missing=await page.locator('button,a,summary,[role=button]').evaluateAll(cs=>cs.filter(c=>c.checkVisibility()&&!c.innerText.trim()&&c.querySelector('svg,img')&&!c.querySelector('[role=tooltip]')).map(c=>c.tagName));assert.deepEqual(missing,[]);
      for(const tip of await page.locator('.has-tooltip:visible').all()){await tip.focus();await tip.locator('[role=tooltip]').waitFor({state:'visible'});await tip.hover();await page.waitForTimeout(350);await tip.locator('[role=tooltip]').waitFor({state:'visible'});}
    } finally {await context.close();}
  } finally {await browser.close();}
}
