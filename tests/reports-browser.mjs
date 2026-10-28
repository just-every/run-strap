import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { downloadPair, downloadReport, downloadNativePair } from './report-downloads-browser.mjs'
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

// RPT-003 adds HTTP and CSV doors; its evidence links reuse the native pack and charge screens.
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
        const exported = await downloadNativePair(page,'retention-filtered',width,'Download retention CSV','Download retention XLSX')
        assert.deepEqual(exported,report.rows)
        await capture('screen-filtered')
        const pending = page.waitForEvent('download')
        await page.goto(h.origin+'/api/strap/reports/retention.csv?'+query).catch(error=>assert.match(error.message,/Download is starting|ERR_ABORTED/))
        const download = await pending
        const {parseCsv} = await import('./report-downloads.mjs')
        const [keys,...values] = parseCsv(await readFile(await download.path(),'utf8'))
        assert.deepEqual(values.map(values=>Object.fromEntries(keys.map((key,i)=>[key,values[i]]))),report.rows,`RPT-003 authenticated filtered browser download agrees at ${width}`)
        if (proof) await download.saveAs(join(proof,`RPT-003-filtered-${width}.csv`))
        await page.getByLabel('Acquisition month (YYYY-MM)',{exact:true}).fill('1900-01')
        await page.getByRole('button',{name:'Apply cohort filters',exact:true}).click()
        assert.equal((await downloadNativePair(page,'retention-empty',width,'Download retention CSV','Download retention XLSX')).length,0)
        await capture('empty')
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}

export async function retentionLifecycleBrowser(h,report){
  const {proofPages}=await import('./renewal-disclosures-browser.mjs')
  await proofPages(h,async({pageFor,shot})=>{
    const page=await pageFor(h.owner)
    await page.goto(h.origin+'/app/retention')
    const cohort=page.locator('[data-cohort]').filter({hasText:'Lifecycle offer'})
    assert.match(await cohort.innerText(),/Moved away: 1/);assert.match(await cohort.innerText(),/Price: 1/)
    assert.match(await cohort.innerText(),/Travel leave: 1/);assert.match(await cohort.innerText(),/70.00/)
    await shot(page,'RPT-003-lifecycle')
    const row=report.rows.find(r=>r.collectedRenewalCents===7000)
    await page.locator(`[data-pack-id="${row.packId}"]`).getByRole('link',{name:'Renewal',exact:true}).click()
    await page.locator(`[data-recurring-invoice="${row.renewalInvoiceId}"]`).scrollIntoViewIfNeeded();await shot(page,'RPT-003-recurring-invoice')
    await page.goto(h.origin+'/app/retention')
    await page.locator(`[data-pack-id="${row.packId}"]`).getByRole('link',{name:'Receipt 1',exact:true}).click()
    await page.locator('#source-record').waitFor()
    const source=JSON.parse(await page.getByLabel('Retained source record',{exact:true}).inputValue())
    assert.equal(source.id,row.paymentIds[0]);await shot(page,'RPT-008-collected-receipt')
  })
}


export async function retentionChurnBrowser(h,report,query) {
  const {proofPages}=await import('./renewal-disclosures-browser.mjs')
  await proofPages(h,async({pageFor,shot})=>{
    const page=await pageFor(h.owner)
    await page.goto(h.origin+'/app/retention')
    await page.getByLabel('Churn from (UTC instant)',{exact:true}).fill(report.churnPeriod.from)
    await page.getByLabel('Churn to (UTC instant)',{exact:true}).fill(report.churnPeriod.to)
    await page.getByRole('button',{name:'Apply cohort filters',exact:true}).click()
    const cohort=page.locator('[data-cohort]').filter({hasText:'Churn offer'})
    assert.match(await cohort.innerText(),/1 of 4 opening members lost/)
    assert.match(await cohort.innerText(),/25% member churn/)
    assert.match(await cohort.innerText(),/80% gross canceled recurring revenue/)
    assert.deepEqual(await downloadNativePair(page,'retention-churn',page.viewportSize().width,'Download retention CSV','Download retention XLSX'),report.rows)
    await shot(page,'RPT-008-period-churn')
    await page.getByRole('link',{name:'Opening agreement 1',exact:true}).first().click()
    await page.locator('[data-recurring]').first().waitFor()
    await shot(page,'RPT-008-opening-agreement')
  })
}


export async function retentionHistoryBrowser(h,report,original) {
  const {proofPages}=await import('./renewal-disclosures-browser.mjs')
  await proofPages(h,async({pageFor,shot})=>{
    const page=await pageFor(h.owner)
    await page.goto(h.origin+'/app/retention')
    assert.equal(await page.locator('[data-pack-id]').count(),20)
    assert.match(await page.getByRole('heading',{name:'Imported definition differences',exact:true}).locator('../..').innerText(),/Historical freezes and churn denominators/)
    assert.deepEqual(await downloadNativePair(page,'retention-history',page.viewportSize().width,'Download retention CSV','Download retention XLSX'),report.rows)
    await shot(page,'RPT-003-continuous-history')
    await page.goto(h.origin+original.packUrl)
    await page.locator('#history-evidence').scrollIntoViewIfNeeded()
    const source=JSON.parse(await page.getByLabel('Retained historical source',{exact:true}).inputValue())
    assert.equal(source.terms.length,18);assert.equal(source.terms[0].contractReference,original.sourceRecord.contractReference)
    await shot(page,'RPT-003-import-source')
  })
}
