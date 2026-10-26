import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { copyParticipant } from './evidence-copy-journey.mjs'

export async function evidenceCopyBrowser(h,{edge,waiver}) {
  const browser=await chromium.launch({headless:true,...(process.env.STRAP_CHROMIUM_PATH?{executablePath:process.env.STRAP_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try{for(const width of [1440,390]) {
    const owner=await browser.newContext({viewport:{width,height:1000}}),tablet=await browser.newContext({viewport:{width,height:1000}}),personal=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true})
    try{
      const assets=async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()}
      await owner.route(h.origin+'/**',assets);await tablet.route(h.origin+'/**',assets);await personal.route(h.origin+'/**',assets)
      const at=h.owner.indexOf('=');await owner.addCookies([{name:h.owner.slice(0,at),value:h.owner.slice(at+1),url:h.origin}])
      const page=await owner.newPage(),shared=await tablet.newPage(),privatePage=await personal.newPage()
      const capture=async(p,name)=>{await p.evaluate(()=>document.fonts.ready);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits '+width);if(process.env.STRAP_PROOF_DIR){await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});await p.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MEM-005-copy-${name}-${width}.png`),fullPage:true})}}
      await page.goto(h.origin+'/app/classes');await page.getByText('Personal document copies',{exact:true}).click();const review=page.locator('form[action*="name=waiver.copy.mail.review"]');await review.locator('input[name=confirm]').check();await capture(page,'owner-review');await review.getByRole('button',{name:'Review personal copy delivery',exact:true}).click()
      const member=await copyParticipant(h,'Browser'+width)
      await page.goto(h.origin+'/app/people?person='+member.id);await page.getByText('Member waiver link',{exact:true}).click()
      await page.locator('form').filter({has:page.locator('input[name=waiverId][value="'+waiver.id+'"]')}).getByRole('button',{name:'Launch locked signing tablet',exact:true}).click()
      const link=await page.getByRole('link',{name:'Open private signing handoff',exact:true}).getAttribute('href');assert.ok(link)
      await shared.goto(h.origin+link);await shared.getByRole('button',{name:'Open this document',exact:true}).click()
      assert.equal(await shared.locator('input[name=adultConfirmed]').isChecked(),false);assert.equal(await shared.locator('input[name=emailCopy]').isChecked(),false)
      await shared.getByLabel('Your full name',{exact:true}).fill(member.name);await shared.locator('input[name=confirm]').check();await shared.locator('input[name=adultConfirmed]').check();await shared.locator('input[name=emailCopy]').check();await capture(shared,'personal-request')
      const before=edge.calls.length;await shared.getByRole('button',{name:'Sign and lock tablet',exact:true}).click();await shared.getByRole('heading',{name:'Document saved · tablet locked',exact:true}).waitFor();assert.equal(edge.calls.length,before+1);assert.ok(!(await shared.locator('body').innerText()).includes(waiver.text));assert.equal(await shared.locator('a[href*="/evidence/copy"]').count(),0);await capture(shared,'tablet-locked')
      const emailLink=edge.linkFor(member.email);assert.equal((await tablet.request.get(emailLink)).status(),403)
      await privatePage.goto(emailLink);assert.ok(!(await privatePage.locator('body').innerText()).includes(member.name));assert.ok(!(await privatePage.locator('body').innerText()).includes(waiver.text));await capture(privatePage,'private-confirmation')
      const receipt=(await h.state()).acknowledgements.find(row=>row.personId===member.id),original=await h.send('/api/strap/waiver-evidence.html?id='+receipt.id,undefined,h.owner)
      const downloading=privatePage.waitForEvent('download');downloading.catch(()=>{});const submitted=privatePage.waitForResponse(response=>new URL(response.url()).pathname==='/evidence/copy'&&response.request().method()==='POST');await privatePage.getByRole('button',{name:'Download my document copy',exact:true}).click();const received=await submitted;assert.equal(received.status(),200,'copy confirmation: '+JSON.stringify({origin:received.request().headers().origin,refusal:received.headers()['x-strap-refusal']}));const download=await downloading,file=await download.path();assert.equal(await readFile(file,'utf8'),original.text)
      await download.saveAs(file+'.html');const artifact=await personal.newPage();await artifact.goto(pathToFileURL(file+'.html').href);await capture(artifact,'downloaded-copy');await artifact.close()
      assert.equal((await privatePage.goto(emailLink)).status(),410);assert.equal(await privatePage.getByRole('button',{name:'Download my document copy',exact:true}).count(),0);assert.ok(!(await privatePage.locator('body').innerText()).includes(member.name));assert.ok(!(await privatePage.locator('body').innerText()).includes(waiver.text));await capture(privatePage,'copy-unavailable')
      assert.equal((await personal.request.get(h.origin+'/api/strap/state')).status(),401)
      assert.equal(await h.db.prepare('SELECT id FROM oa_operators WHERE lower(email)=lower(?)').bind(member.email).first(),null)
    }finally{await personal.close();await tablet.close();await owner.close()}
  }}finally{await browser.close()}
}
