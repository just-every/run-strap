import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function studioBrowser(h) {
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
        const at = h.owner.indexOf('=')
        await context.addCookies([{name:h.owner.slice(0,at),value:h.owner.slice(at+1),url:h.origin}])
        const page = await context.newPage()
        const capture = async name => {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`)
          if (proof) await page.locator('section').filter({has:page.getByRole('heading',{name:'Studio settings',exact:true})}).screenshot({path:join(proof,`STUDIO-001-${name}-${width}.png`)})
        }
        await page.goto(h.origin+'/app/studio')
        const saved = (await h.state()).studio
        assert.equal(await page.getByLabel('Legal studio name',{exact:true}).inputValue(),saved.legalName)
        assert.equal(await page.getByLabel('Street address',{exact:true}).inputValue(),saved.address.line1)
        await capture('loaded')
        await page.getByLabel('Legal studio name',{exact:true}).fill('Willow Movement & Yoga LLC')
        await page.getByLabel('Suite or unit',{exact:true}).fill('Suite 4')
        await page.getByLabel('Monday opens',{exact:true}).fill('05:30')
        await page.getByLabel('Monday closes',{exact:true}).fill('20:30')
        await page.getByLabel('Sunday opens',{exact:true}).fill('09:00')
        await page.getByLabel('Sunday closes',{exact:true}).fill('12:00')
        await page.getByRole('button',{name:'Save studio',exact:true}).click()
        await page.waitForURL(h.origin+'/app/studio')
        await page.reload()
        const current = (await h.state()).studio
        assert.equal(current.legalName,'Willow Movement & Yoga LLC')
        assert.equal(current.address.line2,'Suite 4')
        assert.deepEqual(current.businessHours.find(row => row.day===1),{day:1,opens:'05:30',closes:'20:30'})
        assert.deepEqual(current.businessHours.find(row => row.day===7),{day:7,opens:'09:00',closes:'12:00'})
        assert.equal(await page.getByLabel('Receipt details',{exact:true}).inputValue(),saved.receiptDetails)
        await capture('saved')
        await page.getByLabel('City',{exact:true}).fill('')
        await page.getByRole('button',{name:'Save studio',exact:true}).click()
        await page.getByRole('alert').waitFor()
        assert.deepEqual((await h.state()).studio,current,'failed browser save preserves committed settings')
        await capture('refused')
        for (const label of ['Legal studio name','Street address','Suite or unit','City','State or territory code','ZIP code','Receipt details',
          ...['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].flatMap(day => [day+' opens',day+' closes'])]) await page.getByLabel(label,{exact:true}).fill('')
        await page.getByRole('button',{name:'Save studio',exact:true}).click()
        await page.waitForURL(h.origin+'/app/studio')
        await page.reload()
        const cleared = (await h.state()).studio
        assert.deepEqual([cleared.legalName,cleared.address,cleared.receiptDetails,cleared.businessHours],[null,null,null,[]])
        await capture('cleared')
        await h.cmd('studio.save',current)
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
