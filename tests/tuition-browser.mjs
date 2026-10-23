import assert from 'node:assert/strict'
import { readFile,mkdir } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function familyTuitionBrowser(h,{plan,payer,a,b,household,initial,nextMonth}) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000}})
    try{
      const year=width===1440?'2098':'2097'
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const sign=async cookie=>{await page.goto('about:blank');await context.clearCookies();const at=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:h.origin}])}
      const page=await context.newPage()
      const capture=async name=>{await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`);if(process.env.STRAP_PROOF_DIR){await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MEM-003-${name}-${width}.png`),fullPage:true})}}
      await sign(h.owner)
      await page.goto(h.origin+'/app/tuition?household='+household.id)
      await page.getByRole('heading',{name:'Family tuition',exact:true}).waitFor()
      await page.getByLabel('Tuition name',{exact:true}).fill('Next term sibling tuition '+width)
      await page.getByLabel('First month',{exact:true}).fill(year+'-01')
      await page.getByLabel('End month (exclusive)',{exact:true}).fill(year+'-03')
      await page.getByLabel('Eligible class service',{exact:true}).fill('Mat tuition')
      await page.getByLabel('Enroll '+a.name,{exact:true}).check();await page.getByLabel('Enroll '+b.name,{exact:true}).check()
      await capture('owner-schedule')
      await page.getByRole('button',{name:'Save tuition schedule',exact:true}).click()
      await page.getByRole('heading',{name:'Next term sibling tuition '+width,exact:true}).waitFor()
      const saved=(await h.state()).familyTuition.plans.find(p=>p.name==='Next term sibling tuition '+width)
      const panel=page.locator('section.panel').filter({has:page.getByRole('heading',{name:saved.name,exact:true})})
      await panel.getByLabel('Billing month',{exact:true}).fill(year+'-01');await panel.getByRole('button',{name:'Preview monthly tuition',exact:true}).click()
      const preview=(await h.state()).familyTuition.previews.find(p=>p.planId===saved.id)
      await capture('owner-preview')
      await sign(payer.cookie);await page.goto(h.origin+'/app/tuition#bill-'+preview.id)
      const bill=page.locator('#bill-'+preview.id)
      await bill.getByText('Total $180.00',{exact:true}).waitFor();await capture('payer-acceptance')
      await bill.getByRole('button',{name:'Accept exact monthly bill',exact:true}).click()
      await page.getByRole('heading',{name:saved.name+' · billed '+year+'-01',exact:true}).waitFor();await capture('payer-billed')
      await sign(h.owner);await page.goto(h.origin+'/app/tuition')
      const schedule=page.locator('section.panel').filter({has:page.getByRole('heading',{name:saved.name,exact:true})})
      await schedule.getByText('Withdraw a participant from future months',{exact:true}).click()
      await schedule.getByLabel('Participant',{exact:true}).selectOption(b.id)
      await schedule.getByLabel('First month without tuition',{exact:true}).fill(year+'-02')
      await schedule.getByLabel('Member’s withdrawal request',{exact:true}).fill('Member phone request to end next month')
      await capture('withdrawal')
      await schedule.getByRole('button',{name:'Withdraw future tuition',exact:true}).click()
      const changed=page.locator('section.panel').filter({has:page.getByRole('heading',{name:saved.name,exact:true})})
      await changed.getByLabel('Billing month',{exact:true}).fill(year+'-02');await changed.getByRole('button',{name:'Preview monthly tuition',exact:true}).click()
      const next=(await h.state()).familyTuition.previews.find(p=>p.planId===saved.id&&p.month===year+'-02')
      await page.locator('#bill-'+next.id).getByText('Total $100.00',{exact:true}).waitFor();await capture('recalculated-next-bill');await page.goto(h.origin+'/app/people?person='+payer.id);await page.getByRole('heading',{name:'Staff action history',exact:true}).waitFor();await capture('staff-audit')
      await sign(payer.cookie);await page.goto(h.origin+'/app/packs');await page.getByText('synthetic-strap-tuition-receipt',{exact:false}).first().waitFor();await capture('external-receipt')
    }finally{await context.close()}
  }}finally{await browser.close()}
}
