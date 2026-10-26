import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'
import readXlsx from 'read-excel-file/node'
import { parseCsv } from './report-downloads.mjs'

export async function financeBrowser(h,{report,month,prefix='reconciliation',sourceId}) {
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true})
    try{
      await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()})
      const at=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,at),value:h.owner.slice(at+1),url:h.origin}])
      const page=await context.newPage()
      await page.goto(h.origin+'/app/revenue?financeMonth='+month+'#finance')
      await page.getByRole('heading',{name:'Cash, earned revenue and liabilities',exact:true}).waitFor()
      const capture=async name=>{await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits '+width);const missing=await page.locator('button,a,summary,[role=button]').evaluateAll(cs=>cs.filter(c=>c.checkVisibility()&&!c.innerText.trim()&&c.querySelector('svg,img')&&!c.querySelector('[role=tooltip]')).map(c=>c.tagName));assert.deepEqual(missing,[]);await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`RPT-004-${prefix}-${name}-${width}.png`),fullPage:true})}
      const panel=page.locator('#finance')
      assert.equal(await panel.locator('[data-finance-source]').count(),report.sources.length)
      await capture('reconciliation')
      for(const format of ['CSV','XLSX']){
        const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download finance '+format,exact:true}).click()])
        const bytes=await readFile(await download.path())
        if(format==='CSV')assert.equal(parseCsv(bytes.toString()).filter(r=>['invoice','cash','gift-tender','gift-liability','refund-due','refund-cash'].includes(r[0])).length,report.sources.length)
        else assert.equal((await readXlsx(bytes)).find(s=>s.sheet==='Reconciliation').data.find(r=>r[0]==='cashCents')[3],report.closing.cashCents)
      }
      const tip=page.locator('.has-tooltip').first();if(await tip.count()){await tip.focus();await tip.locator('[role=tooltip]').waitFor({state:'visible'});await tip.hover();await page.waitForTimeout(350);await tip.locator('[role=tooltip]').waitFor({state:'visible'})}
      const source=(sourceId ? report.sources.find(r=>r.id===sourceId) : report.sources.find(r=>r.kind==='refund-cash')) ?? report.sources[0]
      await page.goto(h.origin+source.sourceUrl)
      const record=JSON.parse(await page.getByLabel('Retained finance source',{exact:true}).inputValue());assert.equal(record.id,source.id)
      await capture('source')
      await page.getByLabel('Finance month',{exact:true}).fill('2019-12');await page.getByRole('button',{name:'Apply finance month',exact:true}).click()
      await page.getByText('No finance records in this period or earlier.',{exact:true}).waitFor();await capture('empty')
    } finally{await context.close()}
  }}finally{await browser.close()}
}
