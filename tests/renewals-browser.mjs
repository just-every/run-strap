import assert from 'node:assert/strict'
import { readFile,mkdir } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

// RPT-007: the existing real Worker, native session, HTML forms and downloaded CSV.
export async function renewalsBrowser(h,{packs}) {
  const proof = process.env.STRAP_PROOF_DIR
  if (proof) await mkdir(proof,{recursive:true})
  const parse = text => text.trimEnd().split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m => m[1].replaceAll('""','"')))
  const browser = await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try {
    for (const [i,width] of [1440,390].entries()) {
      const context = await browser.newContext({viewport:{width,height:1000}})
      try {
        await context.route(h.origin+'/**',async route => {
          const path = new URL(route.request().url()).pathname
          if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
          return route.continue()
        })
        const at = h.owner.indexOf('=')
        await context.addCookies([{name:h.owner.slice(0,at),value:h.owner.slice(at+1),url:h.origin}])
        const page = await context.newPage()
        const capture = async name => {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true,`RPT-007 ${name} fits ${width}`)
          if (proof) await page.screenshot({path:join(proof,`RPT-007-${name}-${width}.png`),fullPage:true})
        }
        await page.goto(h.origin+'/app/renewals')
        await page.getByRole('heading',{name:'Renewal worklist',exact:true}).waitFor()
        const report = (await h.send('/api/strap/reports/renewals',undefined,h.owner)).value
        assert.deepEqual(await page.locator('[data-pack-id]').evaluateAll(rows => rows.map(row => row.dataset.packId)),report.rows.map(row => row.packId))
        await capture('worklist')
        await page.getByLabel('Next days',{exact:true}).fill('45')
        await page.getByLabel('Low-credit threshold',{exact:true}).fill('0')
        await page.getByRole('button',{name:'Apply worklist filters',exact:true}).click()
        const csvUrl = await page.getByRole('link',{name:'Download worklist CSV',exact:true}).getAttribute('href')
        assert.equal(new URL(csvUrl,h.origin).search,'?days=45&lowCredits=0')
        const downloadEvent = page.waitForEvent('download')
        await page.getByRole('link',{name:'Download worklist CSV',exact:true}).click()
        const download = await downloadEvent
        const [columns,...values] = parse(await readFile(await download.path(),'utf8'))
        const csv = values.map(row => Object.fromEntries(columns.map((key,index) => [key,JSON.parse(row[index])])))
        assert.deepEqual(await page.locator('[data-pack-id]').evaluateAll(rows => rows.map(row => row.dataset.packId)),csv.map(row => row.packId))
        for (const row of csv) {
          const entry = page.locator(`[data-pack-id="${row.packId}"]`)
          assert.ok((await entry.innerText()).includes(String(row.remainingCredits)+' credits'))
          assert.ok((await entry.innerText()).includes(row.member))
          assert.equal(await entry.locator('time').first().getAttribute('datetime'),row.expiresAt)
          if (row.lastVisit) assert.equal(await entry.locator('time').nth(1).getAttribute('datetime'),row.lastVisit)
        }
        await capture('filtered-csv')
        const pack = packs[i]
        await page.locator(`[data-pack-id="${pack.id}"]`).getByRole('link',{name:'Assign follow-up',exact:true}).click()
        await page.getByLabel('Next action',{exact:true}).fill('Review mat pack renewal with the owner')
        await page.getByLabel('Due at (UTC)',{exact:true}).fill('2099-01-02T15:30')
        await capture('assign-task')
        // Source changes between opening a form and submission must be visible, with no task.
        await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'})
        await page.getByRole('button',{name:'Create assigned follow-up',exact:true}).click()
        await page.getByRole('alert').filter({hasText:'renewal worklist changed'}).waitFor()
        assert.equal((await h.state()).pipeline.leads.filter(lead => lead.personId===pack.personId && lead.nextAction==='Review mat pack renewal with the owner').length,0)
        await capture('changed-source')
        await page.getByLabel('Next action',{exact:true}).fill('Review mat pack renewal with the owner')
        await page.getByLabel('Due at (UTC)',{exact:true}).fill('2099-01-02T15:30')
        const submitted = page.waitForRequest(request => request.method()==='POST' && request.url().includes('renewal.followup.create'))
        await page.getByRole('button',{name:'Create assigned follow-up',exact:true}).click()
        const request = await submitted
        await page.getByRole('heading',{name:'Renewal worklist',exact:true}).waitFor()
        const row = page.locator(`[data-pack-id="${pack.id}"]`)
        await row.getByRole('link').filter({hasText:'inquiry'}).waitFor()
        const state = await h.state(), task = state.pipeline.leads.find(lead => lead.personId===pack.personId && lead.nextAction==='Review mat pack renewal with the owner')
        assert.ok(task); assert.equal(task.ownerId,state.actor.id); assert.equal(task.dueAt,'2099-01-02T15:30:00.000Z')
        const replay = await context.request.post(request.url(),{data:request.postData(),headers:{origin:h.origin,'content-type':'application/x-www-form-urlencoded'}})
        assert.equal(replay.status(),200)
        assert.equal((await h.state()).pipeline.leads.filter(lead => lead.id===task.id).length,1)
        await capture('assigned-task')
        await row.getByRole('link').filter({hasText:'inquiry'}).click()
        await page.getByRole('heading',{name:'Lead follow-up',exact:true}).waitFor()
        assert.equal(await page.getByLabel('Next action',{exact:true}).first().inputValue(),task.nextAction)
        await page.goto(h.origin+'/app/renewals?days=1&lowCredits=0')
        await page.getByText('No packs match these filters.',{exact:true}).waitFor()
        assert.equal(await page.locator('[data-pack-id]').count(),0)
        await capture('empty')
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
