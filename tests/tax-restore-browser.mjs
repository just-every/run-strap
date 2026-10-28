import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function taxRestoreBrowser(h,owner) {
  const directory=process.env.STRAP_TAX_RESTORE_PROOF_DIR
  await mkdir(directory,{recursive:true})
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--use-mock-keychain','--password-store=basic']})
  try {for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000}})
    try {
      await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()})
      const at=owner.indexOf('=');await context.addCookies([{name:owner.slice(0,at),value:owner.slice(at+1),url:h.origin}])
      const page=await context.newPage()
      await page.goto(h.origin+'/app/studio#member-mail')
      const mail=page.locator('#member-mail'),tax=page.locator('#tax')
      await mail.getByRole('heading',{name:'Member email paused',exact:true}).waitFor()
      assert.ok((await tax.innerText()).includes('Tax execution is disconnected'))
      assert.equal(await tax.getByRole('button',{name:'Calculate test tax',exact:true}).count(),0)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      await mail.screenshot({path:join(directory,`BILL-012-restored-delivery-${width}.png`)})
      await tax.screenshot({path:join(directory,`BILL-012-restored-tax-${width}.png`)})
      if(width===390) {
        await mail.getByRole('button',{name:'Reconnect member email',exact:true}).click()
        await mail.waitFor({state:'detached'})
        assert.equal((await h.state(owner)).memberMail.connected,true)
        assert.equal((await h.send('/api/strap/tax',undefined,owner)).value.connected,false,'mail review grants no tax execution authority')
      }
    } finally {await context.close()}
  }} finally {await browser.close()}
}
