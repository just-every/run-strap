import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import {join,extname} from 'node:path'
import {chromium} from '@playwright/test'

/** One desktop interaction journey; the same changed screens are captured at both widths. */
export async function privacyBrowser(h,member) {
  const browser=await chromium.launch({headless:true,...(process.env.STRAP_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.STRAP_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  const context=await browser.newContext({viewport:{width:1440,height:1000}})
  try {
    await context.route(h.origin+'/**',async route=>{
      const path=new URL(route.request().url()).pathname
      if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
      return route.continue()
    })
    const split=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,split),value:h.owner.slice(split+1),url:h.origin}])
    const page=await context.newPage(), target=h.origin+'/app/people?person='+member.id
    const open=async()=>{
      await page.locator('#privacy').waitFor()
      if(!await page.locator('#privacy').evaluate(el=>el.open))await page.locator('#privacy > summary').click()
    }
    const form=label=>page.locator('form').filter({has:page.getByRole('button',{name:label,exact:true})})
    const click=async label=>{await form(label).getByRole('button',{name:label,exact:true}).click();await page.waitForURL(url=>url.pathname==='/app/people');await page.waitForLoadState();assert.ok(await page.locator('#privacy').count(),page.url()+' '+(await page.textContent('body'))?.slice(0,1400));await open()}
    const capture=async name=>{
      if(!process.env.STRAP_PROOF_DIR)return
      await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
      for(const width of [1440,390]) {
        await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready)
        await page.locator(name==='request-review'?'#privacy':'#privacy-retention').screenshot({path:join(process.env.STRAP_PROOF_DIR,'SEC-003-'+name+'-'+width+'.png')})
      }
      await page.setViewportSize({width:1440,height:1000})
    }
    await page.goto(target);await open()
    await form('Record privacy request').getByLabel('Request received through').selectOption('phone')
    await click('Record privacy request')
    await form('Record identity check').getByLabel('Identity verification method').selectOption('callback-on-file')
    await form('Record identity check').getByRole('checkbox').check()
    await click('Record identity check')
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download member copy',exact:true}).click()
    const file=await download,bundle=JSON.parse(await readFile(await file.path(),'utf8'))
    assert.equal(bundle.person.email,member.email,'the ordinary form downloads the verified member copy')
    await page.reload();await open()
    await form('Record delivery').getByRole('checkbox').check();await click('Record delivery')
    assert.equal((await h.state()).privacy.requests.find(r=>r.personId===member.id&&r.type==='access').status,'delivered')
    await form('Record privacy request').getByLabel('Request type').selectOption('erasure')
    await click('Record privacy request')
    await form('Record identity check').getByRole('checkbox').check();await click('Record identity check')
    const review=form('Review erasure')
    await review.getByLabel('Reason to retain financial evidence').fill('Synthetic evidence retention')
    await review.getByLabel('Retain identifying documents until (UTC)').fill('2099-12-31')
    await review.getByLabel('Member waiver evidence').selectOption('retain')
    await review.getByLabel('Document hold basis (optional)').fill('Synthetic pending dispute')
    await review.getByLabel('Hold review date (UTC)').fill('2099-06-01')
    await review.getByLabel('Hold release condition').fill('Owner confirms dispute resolved')
    await review.getByRole('checkbox').check();await click('Review erasure')
    assert.ok(await page.locator('[data-privacy-review]').textContent())
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await capture('request-review')
    await form('Confirm member erasure').getByRole('checkbox').check()
    await form('Confirm member erasure').getByRole('button').click()
    await page.goto(h.origin+'/app/studio#privacy-retention')
    await page.getByRole('heading',{name:'Privacy retention',exact:true}).waitFor()
    assert.ok((await page.locator('#privacy-retention').textContent()).includes('Synthetic pending dispute'))
    const retainedDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download retained evidence',exact:true}).click()
    const evidence=JSON.parse(await readFile(await (await retainedDownload).path(),'utf8'))
    assert.equal(evidence.content.receipt.signature.signerName,member.name,'the held affirmation is available through its restricted door')
    await form('Dispose expired evidence').getByRole('checkbox').check();await form('Dispose expired evidence').getByRole('button').click()
    assert.ok((await page.textContent('body')).includes('privacy hold active'))
    await capture('retained-hold')
    await form('Release document hold').getByLabel('Reason to release this hold').fill('Synthetic dispute resolved')
    await form('Release document hold').getByRole('checkbox').check();await form('Release document hold').getByRole('button').click()
    await form('Dispose expired evidence').getByRole('checkbox').check();await form('Dispose expired evidence').getByRole('button').click()
    assert.ok((await page.textContent('body')).includes('privacy retention not due'))
    const retained=(await h.state()).privacy.retained.find(r=>r.personId===member.id)
    assert.ok(retained.hold.releasedAt)
    return retained
  } finally {await context.close();await browser.close()}
}
