import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function upcomingInvoicesBrowser(h,{query,scheduled,total,focused,focusedRows,focusedTotal}) {
  const proof=process.env.STRAP_UPCOMING_PROOF_DIR ?? process.env.STRAP_PROOF_DIR ?? process.env.STRAP_RIGHTS_PROOF_DIR
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  if(proof)await mkdir(proof,{recursive:true})
  try {
    // Functional assertions run at one width; the phone render is the candidate's proof.
    for(const width of proof?[1440,390]:[1440]) {
      const context=await browser.newContext({viewport:{width,height:1000}})
      try {
        await context.route(h.origin+'/**',async route=>{
          const path=new URL(route.request().url()).pathname
          if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
          return route.continue()
        })
        const eq=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,eq),value:h.owner.slice(eq+1),url:h.origin}])
        const page=await context.newPage()
        const response=await page.goto(h.origin+'/app/upcoming-invoices'+query)
        if(width===1440) {
          assert.equal(response.status(),200)
          await page.getByRole('heading',{name:'Upcoming native invoices',exact:true}).waitFor()
          assert.equal(await page.locator('[data-forecast-total]').getAttribute('data-forecast-total'),String(total))
          for(const row of scheduled) {
            const source=page.locator(`[data-upcoming-agreement="${row.agreementId}"]`)
            assert.ok((await source.innerText()).includes(row.member))
            assert.equal(await source.getByRole('link',{name:row.member,exact:true}).getAttribute('href'),row.agreementUrl)
            assert.ok((await source.innerText()).includes((row.amountCents/100).toFixed(2)))
          }
          const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download forecast CSV',exact:true}).click()])
          const {parseCsv}=await import('./report-downloads.mjs')
          const [columns,...records]=parseCsv(await readFile(await download.path(),'utf8'))
          assert.equal(records.find(r=>r[0]==='period-total')[columns.indexOf('forecastCents')],total)
          assert.equal(await page.locator('form[action*="name=plan.recurring"],form[action*="name=billing"]').count(),0,'forecast has no mutation controls')
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'forecast fits the viewport')
          await page.getByLabel('First studio date',{exact:true}).fill(focused.from)
          await page.getByLabel('Last studio date',{exact:true}).fill(focused.to)
          await page.getByLabel('Sale location',{exact:true}).selectOption(focused.location)
          await page.getByLabel('Accepted plan',{exact:true}).selectOption(focused.plan)
          await page.getByLabel('Invoice status',{exact:true}).selectOption(focused.status)
          await Promise.all([page.waitForURL(url=>url.searchParams.get('status')===focused.status),page.getByRole('button',{name:'Show forecast',exact:true}).click()])
          assert.equal(await page.locator('[data-forecast-total]').getAttribute('data-forecast-total'),String(focusedTotal))
          assert.equal(await page.locator('[data-upcoming-agreement]').count(),focusedRows.length)
          for(const row of focusedRows) assert.equal(await page.locator(`[data-upcoming-agreement="${row.agreementId}"]`).count(),1)
          for(const format of ['CSV','XLSX']) {
            const link=page.getByRole('link',{name:'Download forecast '+format,exact:true})
            const href=new URL(await link.getAttribute('href'),h.origin)
            for(const [key,value] of Object.entries(focused))assert.equal(href.searchParams.get(key),value,'download preserves the visible filter')
            const [filteredDownload]=await Promise.all([page.waitForEvent('download'),link.click()])
            const bytes=await readFile(await filteredDownload.path())
            const records=format==='CSV' ? parseCsv(bytes.toString()) : (await(await import('read-excel-file/node')).default(bytes)).find(s=>s.sheet==='Forecast').data
            const [columns,...rows]=records,at=key=>columns.indexOf(key)
            assert.equal(rows.find(r=>r[0]==='period-total')[at('forecastCents')],focusedTotal)
            assert.deepEqual(rows.filter(r=>r[0]==='invoice').map(r=>r[at('agreementId')]).sort(),focusedRows.map(r=>r.agreementId).sort())
          }
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'filtered forecast fits the viewport')
        } else {
          await page.goto(h.origin+'/app/upcoming-invoices?'+new URLSearchParams(focused))
        }
        if(proof)await page.screenshot({path:join(proof,`BILL-013-forecast-${width}.png`),fullPage:true})
      } finally {await context.close()}
    }
  } finally {await browser.close()}
}
