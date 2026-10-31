import assert from 'node:assert/strict'
import { readFile,mkdir } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { downloadPair } from './report-downloads-browser.mjs'
import { chromium } from '@playwright/test'

export async function revenueBrowser(h,{report,date}) {
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  const browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:1000}})
      try {
        await context.route(h.origin+'/**',async route=>{
          const path = new URL(route.request().url()).pathname
          if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
          return route.continue()
        })
        const index = h.owner.indexOf('=')
        await context.addCookies([{name:h.owner.slice(0,index),value:h.owner.slice(index+1),url:h.origin}])
        const page = await context.newPage()
        await page.goto(h.origin+'/app/revenue')
        await page.getByRole('heading',{name:'Revenue and collections',exact:true}).waitFor()
        const capture = async name => {
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' does not overflow')
          await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`RPT-001-${name}-${width}.png`),fullPage:true})
        }
        assert.equal(await page.locator('[data-source-id]').count(),report.sources.length)
        await capture('dashboard')
        await page.getByLabel('From date',{exact:true}).fill(date)
        await page.getByLabel('Through date',{exact:true}).fill(date)
        await page.getByLabel('Plan',{exact:true}).selectOption('unlimited: Monthly mat')
        await page.getByLabel('Location',{exact:true}).selectOption('Brooklyn studio')
        await page.getByRole('button',{name:'Apply revenue filters',exact:true}).click()
        await page.getByRole('heading',{name:'Revenue and collections',exact:true}).waitFor()
        assert.equal(await page.locator('[data-source-id]').count(),report.sources.filter(r=>r.plan==='unlimited: Monthly mat').length)
        assert.equal((await downloadPair(page,'revenue-filtered',width)).length,report.sources.filter(r=>r.plan==='unlimited: Monthly mat').length)
        await capture('plan-filter')
        const refund = report.sources.find(r=>r.kind==='refund')
        await page.goto(h.origin+refund.sourceUrl)
        await page.getByRole('heading',{name:'Source record',exact:true}).waitFor()
        const record = JSON.parse(await page.getByLabel('Retained source record',{exact:true}).inputValue())
        assert.equal(record.id,refund.id); assert.equal(record.amountCents,refund.amountCents)
        await capture('refund-source')
        await page.goto(h.origin+'/app/revenue?from=2099-01-01&to=2099-01-31')
        await page.getByText('No events match these filters.',{exact:true}).waitFor()
        assert.equal(await page.locator('[data-source-id]').count(),0)
        assert.equal((await downloadPair(page,'revenue-empty',width)).length,0)
        await capture('empty-period')
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}

/** The existing revenue screen, its filtered downloads and one retained lifecycle record. */
export async function recurringRevenueBrowser(h,{query,report,west,march9}) {
  const proof=process.env.STRAP_PROOF_DIR ?? 'logs/proof/revenue-lifecycle'
  await mkdir(proof,{recursive:true})
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000}})
    try {
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const index=h.owner.indexOf('=')
      await context.addCookies([{name:h.owner.slice(0,index),value:h.owner.slice(index+1),url:h.origin}])
      const page=await context.newPage(),url=h.origin+'/app/revenue?'+query
      await page.goto(url)
      assert.deepEqual(await page.locator('[data-recurring-totals] dd').allTextContents(),['7','5','3','3'])
      assert.equal(await page.locator('[data-source-id]').count(),report.sources.length)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      const save=async(name,width)=>page.screenshot({path:join(proof,`RPT-001-${name}-${width}.png`),fullPage:true})
      await save('recurring-dashboard',1440)
      // The assertions run at one width; the same changed screens are captured on the phone too.
      await page.setViewportSize({width:390,height:1000})
      await save('recurring-dashboard',390)
      await page.setViewportSize({width:1440,height:1000})
      await page.getByLabel('From date',{exact:true}).fill('2026-03-09')
      await page.getByLabel('Through date',{exact:true}).fill('2026-03-09')
      await page.getByLabel('Location',{exact:true}).selectOption(west.name)
      await page.getByRole('button',{name:'Apply revenue filters',exact:true}).click()
      await page.getByRole('heading',{name:'Revenue and collections',exact:true}).waitFor()
      assert.deepEqual(await page.locator('[data-recurring-totals] dd').allTextContents(),['2','0','0','0'])
      assert.equal(await page.locator('[data-source-id]').count(),2)
      const previous=process.env.STRAP_PROOF_DIR
      process.env.STRAP_PROOF_DIR=proof
      try { assert.equal((await downloadPair(page,'recurring-filtered',1440)).length,march9.totals.recurringStarts) }
      finally { if(previous===undefined)delete process.env.STRAP_PROOF_DIR;else process.env.STRAP_PROOF_DIR=previous }
      const source=report.sources.find(r=>r.kind==='membership-cancellation')
      await page.goto(url)
      await page.locator(`[data-source-id="${source.id}"]`).getByRole('link',{name:'Inspect record',exact:true}).click()
      await page.getByRole('heading',{name:'Source record',exact:true}).waitFor()
      assert.deepEqual(JSON.parse(await page.getByLabel('Retained source record',{exact:true}).inputValue()),source.record)
      assert.equal(new URL(page.url()).searchParams.get('plan'),'unlimited: Lifecycle','drill-through retains the selected filters')
      await save('recurring-source',1440)
      await page.setViewportSize({width:390,height:1000})
      await save('recurring-source',390)
    } finally { await context.close() }
  } finally { await browser.close() }
}
