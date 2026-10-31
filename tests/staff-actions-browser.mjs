import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

const cookieInto=async(context,cookie,origin)=>{const i=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,i),value:cookie.slice(i+1),url:origin}])}
const open=async(page,label)=>{const summary=page.locator('summary').filter({hasText:new RegExp(`^${label}$`)}).first();await summary.click();return summary.locator('..')}

// The existing scheduling Verify invokes this populated audit screen at desktop.
// A proof run also captures the same changed screen on a phone.
export async function studioAuditBrowser(h,{staff,query,drawer}) {
  const proof=process.env.STRAP_PROOF_DIR
  if(proof)await mkdir(proof,{recursive:true})
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {
    for(const width of proof ? [1440,390] : [1440]) {
      const context=await browser.newContext({viewport:{width,height:1000}})
      await assets(context,h);await cookieInto(context,h.owner,h.origin)
      const page=await context.newPage()
      await page.goto(h.origin+'/app/people?'+query+'#staff-actions')
      const panel=page.locator('#staff-actions')
      if(width===1440) {
        assert.equal(await panel.locator('[data-staff-command]').count(),2)
        assert.ok(await panel.getByText(drawer?'Correct drawer count':'Staff access revoked',{exact:false}).first().isVisible())
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
        const expected=(await h.send('/api/strap/staff-history?'+query,undefined,h.owner)).value.rows
        await panel.locator('details.more summary').last().click()
        assert.match(await panel.innerText(),drawer?/\$165\.00/:/front-desk/)
        if(drawer)assert.match(await panel.innerText(),/\$170\.00/)
        const download=page.waitForEvent('download');await panel.getByRole('link',{name:'Download staff history CSV',exact:true}).click()
        const stream=await(await download).createReadStream(),parts=[];for await(const part of stream)parts.push(part)
        const {parseCsv}=await import('./report-downloads.mjs'),[columns,...data]=parseCsv(Buffer.concat(parts).toString())
        assert.deepEqual(data.map(row=>row[columns.indexOf('id')]),expected.map(row=>row.id))
        const jsonHref=await panel.getByRole('link',{name:'Open staff history JSON',exact:true}).getAttribute('href')
        assert.deepEqual((await h.send(jsonHref,undefined,h.owner)).value.rows,expected)
      }
      if(proof)await panel.screenshot({path:join(proof,`SEC-002-${drawer?'drawer':'access'}-history-${width}.png`)})
      await context.close()
    }
  } finally {await browser.close()}
}
async function assets(context,h) {
  await context.route(h.origin+'/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
    return route.continue()
  })
}
async function linkCookie(h,email) {
  const mail=(await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()).results.map(r=>JSON.parse(r.message)).find(m=>m.to.includes(email))
  const token=new URL(mail.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
  // The member follows this link on a personal device, apart from the staff setup client.
  const response=await h.send('/auth/confirm',{token},'',{'CF-Connecting-IP':'192.0.2.55'});assert.equal(response.status,303,response.text);return response.cookie
}
export async function staffActionsBrowser(h,{ana,ben,publish,historyMember}) {
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {
    let offset=4
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:1000}});await assets(context,h);await cookieInto(context,h.owner,h.origin)
      const page=await context.newPage(),entry=await publish(`Studio mat ${width}`,offset)
      offset+=2
      await h.cmd('spots.save',{room:entry.room??entry.title,spots:['Mat 1','Mat 2'],disabled:[]})
      const w=(await h.state()).waiver
      if(!(await h.state(ben.cookie)).acknowledgements.some(a=>a.waiverId===w.id))await h.cmd('waiver.acknowledge',{id:w.id},ben.cookie)
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(entry.start)),url=h.origin+`/app?day=${day}&class=${entry.id}#roster`
      await page.goto(url)
      const desk=page.locator('#roster form[action*="name=booking.desk"]').filter({has:page.locator('select[name="pay"]')})
      await desk.getByLabel('Member or walk-in profile').selectOption(ana.id)
      await desk.getByLabel('Request channel').selectOption('phone')
      await desk.getByRole('button',{name:'Book at desk',exact:true}).click()
      let s=await h.state(),seat=s.bookings.find(b=>b.classId===entry.id&&b.personId===ana.id&&b.status==='booked')
      assert.ok(seat,await page.locator('main').innerText())
      const spot=await open(page,'Move spot for Ana')
      await spot.getByLabel('New spot').selectOption('Mat 2');await spot.getByRole('button',{name:'Move spot',exact:true}).click()
      assert.equal((await h.state(ana.cookie)).bookings.find(b=>b.id===seat.id).spot,'Mat 2')
      const waiter=await h.cmd('booking.book',{classId:entry.id},ben.cookie)
      await page.reload();const cancel=await open(page,'Cancel for Ana')
      await cancel.getByLabel('Cancellation reason').selectOption('Other')
      await cancel.getByRole('button',{name:'Cancel booking',exact:true}).click()
      await page.getByRole('button',{name:'Accept for member',exact:true}).click()
      assert.equal((await h.state(ben.cookie)).bookings.find(b=>b.id===waiter.id).status,'booked')
      await page.locator('#roster').getByRole('button',{name:'Check in',exact:true}).click()
      assert.equal((await h.state(ben.cookie)).bookings.find(b=>b.id===waiter.id).attendance,'attended')
      await page.locator('#roster').screenshot({path:join(process.env.STRAP_PROOF_DIR,`STAFF-006-roster-outcomes-${width}.png`)})
      await page.goto(h.origin+`/app/people?person=${ana.id}#person`)
      const code=await open(page,'Check-in code and key tag'),before=s.checkinCodes.find(c=>c.personId===ana.id)
      await code.getByRole('button',{name:'Read existing check-in code',exact:true}).click()
      assert.equal((await h.state()).checkinCodes.find(c=>c.personId===ana.id).code,before.code)
      await open(page,'Check-in code and key tag')
      const replace=await open(page,'Replace a lost code or key tag')
      await replace.getByLabel('Reason for replacing the code').fill('Lost key tag, replacement requested by phone')
      await page.locator('#person').screenshot({path:join(process.env.STRAP_PROOF_DIR,`STAFF-006-profile-code-${width}.png`)})
      await replace.getByRole('button',{name:'Issue a new code (the old one stops working)',exact:true}).click()
      assert.equal((await h.state()).checkinCodes.find(c=>c.personId===ana.id).codeRevision,before.codeRevision+1)
      const freshNotice=(await h.state(ana.cookie)).notices.find(n=>n.bookingId===seat.id&&!n.dismissedAt)
      await open(page,'Member notices')
      const mark=page.locator('form[action*="name=notice.dismiss.staff"]').filter({has:page.locator(`input[name="id"][value="${freshNotice.id}"]`)})
      await mark.getByLabel('Request channel').selectOption('phone');await mark.getByRole('button',{name:'Mark read for this member',exact:true}).click()
      assert.ok((await h.state(ana.cookie)).notices.find(n=>n.id===freshNotice.id).dismissedByStaff)
      const notices=await open(page,'Member notices')
      await notices.screenshot({path:join(process.env.STRAP_PROOF_DIR,`STAFF-006-owner-notices-${width}.png`)})
      const waiver=await h.cmd('waiver.publish',{text:`Studio waiver ${width}: the member reads and acknowledges their own limits.`})
      await page.reload();const launch=await open(page,'Member waiver link')
      await launch.getByRole('button',{name:'Request a waiver sign-in link',exact:true}).click()
      await open(page,'Member waiver link')
      await page.locator('#person').screenshot({path:join(process.env.STRAP_PROOF_DIR,`STAFF-006-waiver-request-${width}.png`)})
      const audit=page.locator('#staff-actions');await audit.locator('summary').first().click()
      await audit.screenshot({path:join(process.env.STRAP_PROOF_DIR,`STAFF-006-audit-${width}.png`)})
      // SEC-002: exercise the existing history panel's new controls and real download at both widths.
      await page.goto(h.origin+`/app/people?person=${historyMember.id}#staff-actions`)
      let historyPanel=page.locator('#staff-actions')
      await historyPanel.getByLabel('Action right',{exact:true}).selectOption('member-record')
      await historyPanel.getByLabel('Action channel',{exact:true}).selectOption('phone')
      await historyPanel.getByLabel('Action command',{exact:true}).selectOption('profile.save.staff')
      await historyPanel.getByRole('button',{name:'Filter staff actions',exact:true}).click()
      historyPanel=page.locator('#staff-actions')
      assert.equal(await historyPanel.locator('[data-staff-command]').count(),1)
      await historyPanel.locator('summary').first().click()
      assert.match(await historyPanel.innerText(),/615.*555.*0197/)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'staff history does not overflow')
      await historyPanel.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SEC-002-filtered-history-${width}.png`)})
      const pendingDownload=page.waitForEvent('download')
      await historyPanel.getByRole('link',{name:'Download staff history CSV',exact:true}).click()
      const downloaded=await pendingDownload,stream=await downloaded.createReadStream(),chunks=[]
      for await(const chunk of stream)chunks.push(chunk)
      const {parseCsv}=await import('./report-downloads.mjs'),[keys,...values]=parseCsv(Buffer.concat(chunks).toString())
      assert.equal(values.length,1)
      assert.equal(JSON.parse(values[0][keys.indexOf('after')]).phone,'6155550197')
      await historyPanel.getByLabel('Action channel',{exact:true}).selectOption('inbox')
      await historyPanel.getByRole('button',{name:'Filter staff actions',exact:true}).click()
      historyPanel=page.locator('#staff-actions')
      assert.equal(await historyPanel.locator('[data-staff-command]').count(),0)
      await historyPanel.getByText('No staff actions recorded.',{exact:true}).waitFor()
      await historyPanel.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SEC-002-empty-history-${width}.png`)})
      const memberContext=await browser.newContext({viewport:{width,height:1000}});await assets(memberContext,h);await cookieInto(memberContext,await linkCookie(h,ana.email),h.origin)
      const memberPage=await memberContext.newPage();await memberPage.goto(h.origin+'/app#waiver')
      await memberPage.locator('#waiver').screenshot({path:join(process.env.STRAP_PROOF_DIR,`STAFF-006-member-waiver-${width}.png`)})
      await memberPage.getByRole('button',{name:'I acknowledge this waiver version',exact:true}).click()
      assert.ok((await h.state(ana.cookie)).acknowledgements.some(a=>a.waiverId===waiver.id))
      const history=await open(memberPage,'Read notice history')
      assert.ok(await history.getByText('Marked read by staff',{exact:false}).first().isVisible())
      await history.screenshot({path:join(process.env.STRAP_PROOF_DIR,`STAFF-006-member-read-history-${width}.png`)})
      await memberContext.close();await context.close()
    }
  } finally {await browser.close()}
}

// STAFF-006 / MOVE-011: restored mail stays visibly paused on the real profile.
export async function pausedWaiverBrowser(h,personId,cookie) {
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:1000}});await assets(context,h);await cookieInto(context,cookie,h.origin)
      const page=await context.newPage();await page.goto(h.origin+'/app/people?person='+personId+'#person')
      const launch=await open(page,'Member waiver link')
      assert.ok(await launch.getByRole('link',{name:'Review and reconnect in Studio'}).isVisible())
      assert.equal(await launch.getByRole('button',{name:'Request a waiver sign-in link',exact:true}).count(),0)
      await page.locator('#person').screenshot({path:join(process.env.STRAP_PROOF_DIR,`STAFF-006-restored-paused-${width}.png`)})
      await context.close()
    }
  } finally {await browser.close()}
}
