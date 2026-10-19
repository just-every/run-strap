import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function exitBrowser(h, portable) {
  const browser = await chromium.launch({ headless:true, args:['--use-mock-keychain','--password-store=basic'] })
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true})
      const split=h.owner.indexOf('=')
      await context.addCookies([{name:h.owner.slice(0,split),value:h.owner.slice(split+1),url:h.origin}])
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const page=await context.newPage()
      await page.goto(h.origin+'/app/import')
      const link=page.getByRole('link',{name:'Download exit bundle',exact:true})
      assert.ok(await link.isVisible())
      await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MOVE-011-exit-${width}.png`),fullPage:true})
      const [download]=await Promise.all([page.waitForEvent('download'),link.click()])
      assert.equal(download.suggestedFilename(),'strap-exit.json')
      assert.equal(await download.failure(),null)
      assert.deepEqual(JSON.parse(await readFile(await download.path(),'utf8')).tables,portable.tables)
      assert.equal(new URL(page.url()).pathname,'/app/import')
      await context.close()
    }
  } finally { await browser.close() }
}
