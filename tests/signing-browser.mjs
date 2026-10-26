import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function signingBrowser(h,{adult,guardian,childId,waiver}) {
  const browser=await chromium.launch({headless:true,...(process.env.STRAP_CHROMIUM_PATH?{executablePath:process.env.STRAP_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true})
    try {
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const page=await context.newPage()
      const sign=async cookie=>{await page.goto('about:blank');await context.clearCookies();const at=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:h.origin}])}
      const capture=async name=>{
        await page.evaluate(()=>document.fonts.ready)
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`)
        const missing=await page.locator('button,a,summary,[role=button]').evaluateAll(controls=>controls.filter(c=>c.checkVisibility()&&!c.innerText.trim()&&c.querySelector('svg,img')&&!c.querySelector('[role=tooltip]')).map(c=>c.getAttribute('aria-label')||c.tagName))
        assert.deepEqual(missing,[],name+': icon controls have tooltips')
        if(process.env.STRAP_PROOF_DIR){await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MEM-005-${name}-${width}.png`),fullPage:true})}
      }
      await sign(h.owner);await page.goto(h.origin+'/app/classes');await page.getByText('Publish a new version',{exact:true}).click();await capture('owner-version')
      // Each width gets its own replacement so both forms execute the real current-version door.
      const current=width===1440?waiver:await h.cmd('waiver.publish',{text:'Fresh mobile document for second viewport.',requiresSignature:true})
      await sign(adult.cookie);await page.goto(h.origin+'/app')
      const adultForm=page.locator('#waiver form');await adultForm.getByLabel('Your full name',{exact:true}).fill(adult.name);await adultForm.getByRole('checkbox').check();await capture('adult-signing')
      await adultForm.getByRole('button',{name:'Sign this document',exact:true}).click()
      await page.getByText('You completed this current version.',{exact:true}).waitFor();await capture('adult-completed')
      const mine=(await h.state(adult.cookie)).acknowledgements.find(a=>a.waiverId===current.id&&a.personId===adult.id);assert.ok(mine.signature)
      const download=await context.request.get(h.origin+'/api/strap/waiver-evidence.json?id='+mine.id);assert.equal(download.status(),200);assert.equal((await download.json()).receipt.signature.signerName,adult.name)
      await sign(guardian.cookie);await page.goto(h.origin+'/app/household')
      const guardianForm=page.locator('form').filter({has:page.getByRole('button',{name:'Sign the waiver for Signing child',exact:true})})
      await guardianForm.getByLabel('Your full name',{exact:true}).fill(guardian.name);await guardianForm.getByRole('checkbox').check();await capture('guardian-signing')
      await guardianForm.getByRole('button',{name:'Sign the waiver for Signing child',exact:true}).click()
      await page.getByRole('link',{name:/Download Signing child document evidence/}).first().waitFor();await capture('guardian-completed')
      const r=(await h.state(guardian.cookie)).acknowledgements.find(a=>a.waiverId===current.id&&a.personId===childId);assert.equal(r.signature.signerPersonId,guardian.id)
    }finally{await context.close()}
  }}finally{await browser.close()}
}

export async function tabletSigningBrowser(h,{member,desk,waiver}) {
  const browser=await chromium.launch({headless:true,...(process.env.STRAP_CHROMIUM_PATH?{executablePath:process.env.STRAP_CHROMIUM_PATH}:{}),args:['--no-sandbox']})
  try{for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000}}),tablet=await browser.newContext({viewport:{width,height:1000}})
    const staticAssets=async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()}
    try {
      await context.route(h.origin+'/**',staticAssets);await tablet.route(h.origin+'/**',staticAssets)
      const at=desk.cookie.indexOf('=');await context.addCookies([{name:desk.cookie.slice(0,at),value:desk.cookie.slice(at+1),url:h.origin}])
      const page=await context.newPage(),tabletPage=await tablet.newPage();const tabletResponses=[];tabletPage.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/intake/'))tabletResponses.push({status:r.status(),refusal:r.headers()['x-strap-refusal']})})
      const capture=async(p,name)=>{await p.evaluate(()=>document.fonts.ready);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`);const missing=await p.locator('button,a,summary,[role=button]').evaluateAll(cs=>cs.filter(c=>c.checkVisibility()&&!c.innerText.trim()&&c.querySelector('svg,img')&&!c.querySelector('[role=tooltip]')).map(c=>c.tagName));assert.deepEqual(missing,[]);if(process.env.STRAP_PROOF_DIR){await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});await p.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MEM-005-${name}-${width}.png`),fullPage:true})}}
      await context.clearCookies();const ownerAt=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,ownerAt),value:h.owner.slice(ownerAt+1),url:h.origin}]);assert.equal((await page.goto(h.origin+'/app/people')).status(),200);await page.getByRole('heading',{name:'People',exact:true}).waitFor();await capture(page,'owner-signing-grants');await context.clearCookies();await context.addCookies([{name:desk.cookie.slice(0,at),value:desk.cookie.slice(at+1),url:h.origin}]);
      const current=await h.cmd('waiver.publish',{text:waiver.text+' Viewport '+width,requiresSignature:true});
      await page.goto(h.origin+'/app/people?person='+member.id);await page.getByText('Member waiver link',{exact:true}).click()
      await capture(page,'desk-launch')
      await page.getByRole('button',{name:'Launch locked signing tablet',exact:true}).click()
      const link=await page.getByRole('link',{name:'Open private signing handoff',exact:true}).getAttribute('href');assert.ok(link)
      await capture(page,'desk-handoff')
      await tabletPage.goto(h.origin+link);await tabletPage.getByRole('button',{name:'Open this document',exact:true}).click()
      await tabletPage.getByLabel('Your full name',{exact:true}).fill(member.name);await tabletPage.getByRole('checkbox').check();await capture(tabletPage,'tablet-signing')
      await tabletPage.getByRole('button',{name:'Sign and lock tablet',exact:true}).click();assert.match(await tabletPage.locator('body').innerText(),/Document saved · tablet locked/,JSON.stringify(tabletResponses));await capture(tabletPage,'tablet-locked')
      assert.equal((await tablet.request.get(h.origin+'/auth/magic-link')).status(),403)
      assert.equal((await tablet.request.get(h.origin+'/api/strap/state')).status(),403)
      const receipt=(await h.state(member.cookie)).acknowledgements.filter(a=>a.waiverId===current.id&&a.signature?.channel==='desk-tablet').at(-1);assert.equal(receipt.signature.signerPersonId,member.id)
    }finally{await tablet.close();await context.close()}
  }}finally{await browser.close()}
}

export async function serviceSigningBrowser(h,{adult,guardian,childId,policy}) {
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox']})
  try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000}})
    try{
      await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()})
      const page=await context.newPage()
      const sign=async cookie=>{await context.clearCookies();const i=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,i),value:cookie.slice(i+1),url:h.origin}])}
      const capture=async name=>{await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits '+width);const missing=await page.locator('button,a,summary,[role=button]').evaluateAll(cs=>cs.filter(c=>c.checkVisibility()&&!c.innerText.trim()&&c.querySelector('svg,img')&&!c.querySelector('[role=tooltip]')).map(c=>c.tagName));assert.deepEqual(missing,[]);await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MEM-005-service-${name}-${width}.png`),fullPage:true})}
      const current=await h.cmd('waiver.publish',{text:policy.text+' Mobile viewport '+width,requiresSignature:true,service:'Reformer',validDays:1})
      await sign(h.owner);await page.goto(h.origin+'/app/classes');await page.getByText('Publish a new version',{exact:true}).click();await page.getByLabel('Applies to service (blank for studio waiver)',{exact:true}).fill('Reformer');await page.getByLabel('Completion valid for days (blank for no expiry)',{exact:true}).fill('1');await capture('owner-policy')
      await sign(adult.cookie);await page.goto(h.origin+'/app');const personal=page.locator('#policy-'+current.id);await personal.getByLabel('Your full name',{exact:true}).fill(adult.name);await personal.getByRole('checkbox').check();await capture('adult-review');await personal.getByRole('button',{name:'Sign Reformer policy',exact:true}).click();await page.getByText('Current document completed.',{exact:true}).waitFor();await capture('adult-completed')
      await sign(guardian.cookie);await page.goto(h.origin+'/app/household');const child=page.locator('[data-participant-id="'+childId+'"]');const guardianForm=child.locator('#policy-'+current.id);await guardianForm.getByLabel('Your full name',{exact:true}).fill(guardian.name);await guardianForm.getByRole('checkbox').check();await capture('guardian-review');await guardianForm.getByRole('button',{name:'Sign Reformer policy for Policy child',exact:true}).click();await child.getByText('Current document completed.',{exact:true}).waitFor();await capture('guardian-completed')
    }finally{await context.close()}
  }}finally{await browser.close()}
}
