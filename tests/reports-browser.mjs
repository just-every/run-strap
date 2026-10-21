import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { downloadPair, downloadReport } from './report-downloads-browser.mjs'
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
      assert.equal((await downloadPair(page,'attendance-filtered',width)).length,1)
      await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`RPT-006-attendance-filtered-${width}.png`),fullPage:true})
      await row.getByRole('link',{name:'Roster and bookings'}).click()
      await page.locator('#roster').waitFor()
      assert.ok(await page.getByText('Ana',{exact:true}).first().isVisible())
      await page.goto(h.origin+'/app/reports')
      await page.locator(`[data-class-id="${later.id}"]`).getByRole('link',{name:'Cancellation actions (2)'}).click()
      await page.locator('#cancellations').waitFor()
      assert.ok((await page.locator('#cancellations').innerText()).includes('2 cancellations'))
      const cancellations = await downloadReport(page,'Download filtered XLSX','cancellations',width)
      assert.equal(cancellations.length-1,2,'RPT-006: cancellation source link carries the selected class filter')
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'cancellation screen fits')
      await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`RPT-006-cancellations-${width}.png`),fullPage:true})
      await page.goto(h.origin+'/app/people?classId=missing#cancellations')
      await page.getByText('No cancellations match these filters.',{exact:true}).waitFor()
      assert.equal((await downloadReport(page,'Download filtered XLSX','cancellations-empty',width)).length,1)
      await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`RPT-006-cancellations-empty-${width}.png`),fullPage:true})
      await page.goto(h.origin+'/app/reports')
      await page.getByLabel('From date',{exact:true}).fill('2099-01-01')
      await page.getByRole('button',{name:'Apply report filters'}).click()
      await page.getByText('No sessions match these filters.',{exact:true}).waitFor()
      assert.equal((await downloadPair(page,'attendance-empty',width)).length,0)
      await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`RPT-006-attendance-empty-${width}.png`),fullPage:true})
      await context.close()
    }
  } finally { await browser.close() }
}

// RPT-003 adds HTTP/CSV doors; its evidence links reuse the native pack/charge screens.
export async function retentionEvidenceBrowser(h,row,query) {
  const proof = process.env.STRAP_PROOF_DIR
  if (proof) await mkdir(proof,{recursive:true})
  const browser = await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:1000}})
      try {
        await context.route(h.origin+'/**',async route => {
          const path = new URL(route.request().url()).pathname
          if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
          return route.continue()
        })
        const index = h.owner.indexOf('=')
        await context.addCookies([{name:h.owner.slice(0,index),value:h.owner.slice(index+1),url:h.origin}])
        const page = await context.newPage()
        const capture = async name => {
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`RPT-003 ${name} fits ${width}`)
          if (proof) await page.screenshot({path:join(proof,`RPT-003-${name}-${width}.png`),fullPage:true})
        }
        await page.goto(h.origin+row.packUrl)
        await page.locator('#pack-'+row.packId+' > summary').click()
        await capture('pack-evidence')
        await page.goto(h.origin+row.renewalUrl)
        const change = page.locator(`[data-plan-change="${row.renewalChangeId}"]`)
        await change.waitFor(); assert.ok((await change.innerText()).includes('applied'))
        await change.scrollIntoViewIfNeeded()
        await capture('renewal-evidence')
        await page.goto(h.origin+row.chargeUrls[0])
        await page.locator('#source-record').waitFor()
        const record = JSON.parse(await page.getByLabel('Retained source record',{exact:true}).inputValue())
        assert.equal(record.id,row.chargeIds[0]); assert.equal(record.packId,row.packId)
        await capture('charge-evidence')
        const expected = (await context.request.get(h.origin+'/api/strap/reports/retention?'+query))
        assert.equal(expected.status(),200)
        const report = await expected.json()
        // The screen reads the same projection: every cohort and term, then the same filters through its own form.
        await page.goto(h.origin+'/app/retention')
        await page.getByRole('heading',{name:'Retention cohorts',exact:true}).waitFor()
        const everything = (await (await context.request.get(h.origin+'/api/strap/reports/retention')).json())
        assert.deepEqual(await page.locator('[data-pack-id]').evaluateAll(rows => rows.map(row => row.dataset.packId)),everything.rows.map(row => row.packId))
        assert.deepEqual(await page.locator('[data-cohort]').evaluateAll(rows => rows.map(row => [row.dataset.cohort,row.dataset.offer])),everything.cohorts.map(cohort => [cohort.acquisitionMonth,cohort.initialOffer]))
        await capture('screen')
        await page.getByLabel('Acquisition month (YYYY-MM)',{exact:true}).fill(report.filters.month)
        await page.getByLabel('Initial offer',{exact:true}).fill(report.filters.offer)
        await page.getByRole('button',{name:'Apply cohort filters',exact:true}).click()
        await page.getByRole('heading',{name:'Retention cohorts',exact:true}).waitFor()
        assert.deepEqual(await page.locator('[data-pack-id]').evaluateAll(rows => rows.map(row => row.dataset.packId)),report.rows.map(row => row.packId))
        const cohort = report.cohorts[0], card = page.locator('[data-cohort="'+cohort.acquisitionMonth+'"]')
        assert.ok((await card.innerText()).includes(String(cohort.meanTenureDays)+' days mean'))
        assert.equal(new URL(await page.getByRole('link',{name:'Download retention CSV',exact:true}).getAttribute('href'),h.origin).search,'?'+query.replace(/\+/g,'+'))
        await capture('screen-filtered')
        const pending = page.waitForEvent('download')
        await page.goto(h.origin+'/api/strap/reports/retention.csv?'+query).catch(error=>assert.match(error.message,/Download is starting|ERR_ABORTED/))
        const download = await pending
        const {parseCsv} = await import('./report-downloads.mjs')
        const [keys,...values] = parseCsv(await readFile(await download.path(),'utf8'))
        assert.deepEqual(values.map(values=>Object.fromEntries(keys.map((key,i)=>[key,values[i]]))),report.rows,`RPT-003 authenticated filtered browser download agrees at ${width}`)
        if (proof) await download.saveAs(join(proof,`RPT-003-filtered-${width}.csv`))
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
