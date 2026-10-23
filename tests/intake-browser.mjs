import assert from 'node:assert/strict'
import { readFile,mkdir } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function intakeBrowser(h,{member,desk,coach}) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000}})
    try{
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const page=await context.newPage()
      const sign=async cookie=>{await page.goto('about:blank');await context.clearCookies();const at=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:h.origin}])}
      const capture=async name=>{await page.evaluate(()=>document.fonts.ready);const iconOnly=await page.locator('button,a,summary,[role=button]').evaluateAll(controls=>controls.filter(c=>c.getBoundingClientRect().width>0&&c.getBoundingClientRect().height>0&&!c.innerText.trim()&&c.querySelector('svg,img')).map(c=>c.getAttribute('aria-label')||c.tagName));assert.deepEqual(iconOnly,[],name+': every visible control has a text label; no icon-only controls need a tooltip');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`);if(process.env.STRAP_PROOF_DIR){await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MEM-004-${name}-${width}.png`),fullPage:true})}}
      const title='Service intake '+width,goal='Class goals '+width,care='Private care '+width
      await sign(h.owner);await page.goto(h.origin+'/app/intake')
      const builder=page.locator('form').filter({has:page.getByRole('button',{name:'Publish intake version',exact:true})})
      await builder.getByLabel('Form title',{exact:true}).fill(title);await builder.getByLabel('Applies to',{exact:true}).selectOption('service')
      await builder.getByLabel('Class service (for one service)',{exact:true}).fill('Browser service '+width)
      await builder.getByLabel('Question text 1',{exact:true}).fill(goal);await builder.getByLabel('Answer required 1',{exact:true}).selectOption('true')
      await builder.getByLabel('Question text 2',{exact:true}).fill(care);await builder.getByLabel('Answer required 2',{exact:true}).selectOption('true');await builder.getByLabel('Answer visibility 2',{exact:true}).selectOption('true')
      await capture('owner-builder');await builder.getByRole('button',{name:'Publish intake version',exact:true}).click()
      const f=(await h.state()).intake.forms.find(f=>f.title===title);assert.ok(f)
      await sign(member.cookie);await page.goto(h.origin+'/app');await page.getByRole('link',{name:'Complete the current intake forms',exact:true}).waitFor();await capture('member-enrollment-prompt');await page.goto(h.origin+'/app/intake')
      const self=page.locator('#form-'+f.id)
      await self.getByLabel(goal,{exact:true}).fill('Member requests steady pacing')
      await self.getByLabel(care+' (restricted)',{exact:true}).fill('Synthetic private member answer '+width)
      await capture('member-completion');await self.getByRole('button',{name:'Save my intake answers',exact:true}).click()
      await page.locator('#form-'+f.id).getByText('This version is complete.',{exact:false}).waitFor();await capture('member-completed')
      await sign(h.owner);await page.goto(h.origin+'/app/intake?series='+f.seriesId)
      await page.getByLabel('Question text 1',{exact:true}).fill(goal+' updated')
      await capture('owner-new-version');await page.getByRole('button',{name:'Publish intake version',exact:true}).click()
      const updated=(await h.state()).intake.forms.find(v=>v.seriesId===f.seriesId);assert.equal(updated.version,2)
      await sign(desk.cookie);await page.goto(h.origin+'/app/intake?person='+member.id)
      const staff=page.locator('#form-'+updated.id).locator('form').filter({has:page.getByRole('button',{name:'Save staff-entered answers',exact:true})})
      await staff.getByLabel('Request channel',{exact:true}).selectOption('phone')
      await staff.getByLabel(goal+' updated',{exact:true}).fill('Phone request: quiet group')
      await staff.getByLabel(care+' (restricted)',{exact:true}).fill('Synthetic private phone answer '+width)
      await capture('front-desk-phone');await staff.getByRole('button',{name:'Save staff-entered answers',exact:true}).click()
      const response=(await h.state(member.cookie)).intake.responses.find(r=>r.formId===updated.id);assert.equal(response.staffMade,true);assert.equal(response.channel,'phone')
      await page.goto(h.origin+'/app/people?person='+member.id);await page.getByText('Intake answers and provenance',{exact:true}).click();await capture('staff-profile-history');await page.goto(h.origin+'/app/intake?person='+member.id)
      const launch=page.locator('#form-'+updated.id).locator('form').filter({has:page.getByRole('button',{name:'Launch locked tablet intake',exact:true})})
      await launch.getByRole('button',{name:'Launch locked tablet intake',exact:true}).click()
      const link=await page.getByRole('link',{name:'Open private intake handoff',exact:true}).getAttribute('href');assert.ok(link)
      await capture('staff-tablet-launch')
      const tablet=await browser.newContext({viewport:{width,height:1000}})
      try{
        await tablet.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()})
        const tabletPage=await tablet.newPage(),responses=[];tabletPage.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/intake/'))responses.push({path:new URL(r.url()).pathname,status:r.status(),refusal:r.headers()['x-strap-refusal']})});await tabletPage.goto(h.origin+link);await tabletPage.getByRole('button',{name:'Open this intake form',exact:true}).click();assert.equal(await tabletPage.locator('h1').innerText(),title,JSON.stringify(responses))
        await tabletPage.getByLabel(goal+' updated',{exact:true}).fill('Member entered on private tablet')
        await tabletPage.getByLabel(care+' (restricted)',{exact:true}).fill('Synthetic private tablet answer '+width)
        await tabletPage.getByRole('checkbox').check()
        assert.equal(await tabletPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
        if(process.env.STRAP_PROOF_DIR)await tabletPage.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MEM-004-tablet-completion-${width}.png`),fullPage:true})
        await tabletPage.getByRole('button',{name:'Submit my intake and lock tablet',exact:true}).click();await tabletPage.getByRole('heading',{name:'Intake saved · tablet locked',exact:true}).waitFor()
        if(process.env.STRAP_PROOF_DIR)await tabletPage.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MEM-004-tablet-locked-${width}.png`),fullPage:true})
        assert.equal((await tablet.request.get(h.origin+'/api/strap/state')).status(),403)
      }finally{await tablet.close()}
      await sign(member.cookie);await page.goto(h.origin+'/app/profile')
      await page.getByText('Intake answers and provenance',{exact:true}).click()
      await page.getByText('Synthetic private phone answer '+width,{exact:true}).waitFor();await capture('profile-provenance')
      await sign(coach.cookie);await page.goto(h.origin+'/app')
      assert.ok(!(await page.locator('body').innerText()).includes('Synthetic private'));await capture('instructor-denial')
    }finally{await context.close()}
  }}finally{await browser.close()}
}
