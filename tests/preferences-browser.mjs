import assert from 'node:assert/strict'
import { readFile,mkdir } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'
async function proof(h,cookie,run) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try {for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000}})
    try {
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const at=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:h.origin}])
      const page=await context.newPage(),capture=async name=>{
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`)
        if(process.env.STRAP_PROOF_DIR){await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`${name}-${width}.png`),fullPage:true})}
      }
      await run(page,width,capture)
    }finally{await context.close()}
  }}finally{await browser.close()}
}
export async function preferencesBrowser(h,{member,desk}) {
  await proof(h,member.cookie,async(page,width,capture)=>{
    await page.goto(h.origin+'/app/profile')
    await page.getByRole('heading',{name:'Channel preferences and privacy',exact:true}).waitFor()
    await capture('MEM-006-member-preferences')
    const preference=page.locator('form').filter({has:page.getByRole('button',{name:'Save preference record',exact:true})})
    await preference.getByLabel('Preferred class times',{exact:true}).fill('Morning '+width)
    await preference.getByLabel('Consent statement for any marketing opt-in',{exact:true}).fill('I request the selected email marketing permission')
    await preference.getByRole('button',{name:'Save preference record',exact:true}).click()
    assert.equal(await preference.getByLabel('Preferred class times',{exact:true}).inputValue(),'Morning '+width)
    const event=page.waitForEvent('download');await page.getByRole('link',{name:'Export preference record',exact:true}).click()
    const artifact=JSON.parse(await readFile(await(await event).path(),'utf8'))
    assert.equal(artifact.preference.preferredTimes,'Morning '+width);assert.ok(artifact.history.at(-1).at);assert.equal(artifact.history.at(-1).source,'signed-in-member')
    await page.getByLabel('Reply to studio',{exact:true}).fill('My preferred times are current '+width)
    await page.getByRole('button',{name:'Send reply',exact:true}).click()
    await page.getByText('My preferred times are current '+width,{exact:false}).waitFor()
    await capture('MEM-006-record-export-and-reply')
  })
  await proof(h,desk.cookie,async(page,width,capture)=>{
    await page.goto(h.origin+'/app/people?person='+member.id)
    await page.getByText('Channel preferences and privacy',{exact:true}).click()
    const preference=page.locator('form').filter({has:page.getByRole('button',{name:'Save preference record',exact:true})})
    assert.equal(await preference.getByLabel('Accessibility requests (member and owner only)').count(),0)
    await preference.getByLabel('SMS marketing permission (member reply required)',{exact:true}).selectOption('false')
    await preference.getByLabel('Consent statement for any marketing opt-in',{exact:true}).fill('Member confirmed existing email marketing choice')
    await preference.getByLabel('Source of the member’s stated permission',{exact:true}).fill('Phone request '+width)
    await preference.getByRole('button',{name:'Save preference record',exact:true}).click()
    await page.getByText('Channel preferences and privacy',{exact:true}).click()
    await capture('MEM-006-staff-opt-out')
    assert.equal((await h.send('/api/strap/preferences.json',undefined,member.cookie)).value.preference.marketing.sms,'denied')
  })
}
export async function renewalQueueBrowser(h,{member,pack}) {
  const current=(await h.send('/api/strap/preferences.json',undefined,member.cookie)).value.preference
  await h.cmd('preferences.save',{revision:current.revision,marketingInApp:true,consentStatement:'I request in-app renewal messages',requestId:'synthetic-strap-browser-consent'},member.cookie)
  await proof(h,h.owner,async(page,width,capture)=>{
    await page.goto(h.origin+'/app/renewals')
    await page.getByLabel('Sequence name',{exact:true}).fill('Browser renewal '+width)
    await page.getByLabel('Marketing channel',{exact:true}).selectOption('inApp')
    await page.getByLabel('Renewal message',{exact:true}).fill('Your renewal options are ready to review '+width)
    await page.getByRole('button',{name:'Preview renewal sequence',exact:true}).click()
    await capture('RPT-007-sequence-preview')
    await page.getByRole('button',{name:'Approve this exact sequence',exact:true}).click()
    const rule=(await h.state()).renewalSequences.find(r=>r.name==='Browser renewal '+width)
    const row=page.locator(`[data-pack-id="${pack.id}"]`)
    // Each previous enrollment remains visible, and new approved rules remain available for explicit enrollment.
    await row.getByLabel('Approved renewal sequence',{exact:true}).selectOption(rule.id)
    await row.getByRole('button',{name:'Enroll once',exact:true}).click()
    await page.getByRole('button',{name:'Review queue now',exact:true}).click()
    const message=(await h.state()).marketingMessages.find(m=>m.sequenceId===rule.id&&m.packId===pack.id)
    assert.equal(message.status,'delivered')
    await capture('RPT-007-native-queue-outcomes')
  })
}
