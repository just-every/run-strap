import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function reportsBrowser(h,{flow,later,report}) {
  const browser = await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:1000}})
      await context.route(h.origin+'/**',async route => {
        const path = new URL(route.request().url()).pathname
        if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const index = h.owner.indexOf('=')
      await context.addCookies([{name:h.owner.slice(0,index),value:h.owner.slice(index+1),url:h.origin}])
      const page = await context.newPage()
      await page.goto(h.origin+'/app/reports')
      await page.getByRole('heading',{name:'Attendance and demand',exact:true}).waitFor()
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'report fits the viewport')
      await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`RPT-002-report-${width}.png`),fullPage:true})
      await page.getByLabel('Room',{exact:true}).selectOption('Reformer room')
      await page.getByRole('button',{name:'Apply report filters'}).click()
      const row = page.locator(`[data-class-id="${flow.id}"]`)
      assert.equal(await page.locator('[data-class-id]').count(),1)
      await row.getByText('1 attended · 1 no-show · 1 visitors',{exact:true}).waitFor()
      await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`RPT-002-filtered-${width}.png`),fullPage:true})
      await row.getByRole('link',{name:'Roster and bookings'}).click()
      await page.locator('#roster').waitFor()
      assert.ok(await page.getByText('Ana',{exact:true}).first().isVisible())
      await page.goto(h.origin+'/app/reports')
      await page.locator(`[data-class-id="${later.id}"]`).getByRole('link',{name:'Cancellation actions (2)'}).click()
      await page.locator('#cancellations').waitFor()
      assert.ok((await page.locator('#cancellations').innerText()).includes('2 cancellations'))
      await page.goto(h.origin+'/app/reports')
      await page.getByLabel('From date',{exact:true}).fill('2099-01-01')
      await page.getByRole('button',{name:'Apply report filters'}).click()
      await page.getByText('No sessions match these filters.',{exact:true}).waitFor()
      await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`RPT-002-empty-${width}.png`),fullPage:true})
      await context.close()
    }
  } finally { await browser.close() }
}
