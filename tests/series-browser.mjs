import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

const plus = (date,n) => new Date(Date.parse(date+'T12:00:00Z')+n*86_400_000).toISOString().slice(0,10)
// Run only under the parent's heavy-slot proof. Real browser forms publish,
// book, move one occurrence, move following occurrences and cancel the series.
export async function seriesBrowser(h,{coach,member,startDate}) {
  const browser = await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  const cookie = value => { const n=value.indexOf('='); return {name:value.slice(0,n),value:value.slice(n+1),url:h.origin} }
  try {
    for (const [i,width] of [1440,390].entries()) {
      const context = await browser.newContext({viewport:{width,height:1000}})
      try {
        await context.route(h.origin+'/**',async route=>{
          const path = new URL(route.request().url()).pathname
          if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
          return route.continue()
        })
        const page = await context.newPage(), date = plus(startDate,i*28), title = `Weekly mobility ${width}`
        const as = async value => { await context.clearCookies(); await context.addCookies([cookie(value)]) }
        const shot = async (label,locator) => { await locator.scrollIntoViewIfNeeded(); await locator.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-001-${label}-${width}.png`)}) }
        const submit = async (f,label) => { await Promise.all([page.waitForNavigation(),f.getByRole('button',{name:label,exact:true}).click()]) }
        await as(h.owner); await page.goto(h.origin+'/app/classes#timetable')
        await page.locator('#timetable summary').filter({hasText:'Prepare repeating classes'}).click()
        const create = page.locator('form[action*="name=series.prepare"]')
        await create.getByLabel('First class date',{exact:true}).fill(date)
        await create.getByLabel('Repeat through',{exact:true}).fill(plus(date,14))
        await create.getByLabel('Class name',{exact:true}).fill(title)
        await create.getByLabel('Service',{exact:true}).fill('Yoga')
        await create.getByLabel('Local start time',{exact:true}).fill('08:00')
        await create.getByLabel('Instructor',{exact:true}).selectOption(coach.id)
        await create.getByLabel('Room',{exact:true}).fill(`Movement ${width}`)
        await create.getByLabel('Total capacity',{exact:true}).fill('2')
        await create.getByLabel('Online capacity',{exact:true}).fill('2')
        await shot('prepare-form',create)
        await submit(create,'Preview repeating timetable')
        let state = await h.state(), draft = state.seriesChanges.find(d=>d.status==='draft'&&d.type==='series'&&d.classes[0].title===title)
        assert.ok(draft,'form prepared a real timetable')
        const preview = page.locator(`#series-draft-${draft.id}`)
        assert.ok(await preview.getByText(/Local start stays 08:00/).isVisible())
        await shot('publish-preview',preview)
        await submit(preview,'Approve and publish timetable')
        state = await h.state(); const classes = state.classes.filter(c=>c.seriesId===draft.seriesId).sort((a,b)=>a.seriesIndex-b.seriesIndex)
        assert.equal(classes.length,3)
        await as(member.cookie); await page.goto(h.origin+'/app')
        for (const c of classes.slice(0,2)) {
          const booking = page.locator('form[action*="name=booking.book"]').filter({has:page.locator(`input[name="classId"][value="${c.id}"]`)})
          await submit(booking,'Book')
        }
        await as(h.owner)
        await page.goto(h.origin+`/app/classes?seriesClass=${classes[0].id}#series-change`)
        let edit = page.locator('form[action*="name=series.change.prepare"]')
        await edit.getByLabel('Edit scope',{exact:true}).selectOption('this')
        await edit.getByLabel('Local start time',{exact:true}).fill('10:00')
        await edit.getByLabel('Reason members will see',{exact:true}).fill('Instructor availability')
        await shot('edit-form',edit)
        await submit(edit,'Preview timetable changes')
        state = await h.state(); draft = state.seriesChanges.find(d=>d.status==='draft'&&d.type==='series-change'&&d.classId===classes[0].id)
        let change = page.locator(`#series-draft-${draft.id}`)
        assert.ok(await change.getByText(member.name,{exact:false}).isVisible())
        await shot('occurrence-impact',change)
        await submit(change,'Approve changes and notify members')
        await page.goto(h.origin+`/app/classes?seriesClass=${classes[1].id}#series-change`)
        edit = page.locator('form[action*="name=series.change.prepare"]')
        await edit.getByLabel('Edit scope',{exact:true}).selectOption('future')
        await edit.getByLabel('Local start time',{exact:true}).fill('11:00')
        await edit.getByLabel('Reason members will see',{exact:true}).fill('New weekly teaching hours')
        await submit(edit,'Preview timetable changes')
        state = await h.state(); draft = state.seriesChanges.find(d=>d.status==='draft'&&d.type==='series-change'&&d.classId===classes[1].id)
        change = page.locator(`#series-draft-${draft.id}`)
        assert.equal(draft.impact.classes.length,2)
        await shot('future-impact',change)
        await submit(change,'Approve changes and notify members')
        await page.goto(h.origin+`/app/classes?seriesClass=${classes[1].id}#series-change`)
        const cancel = page.locator('form[action*="name=series.cancel.prepare"]')
        await cancel.getByLabel('Cancellation scope',{exact:true}).selectOption('series')
        await cancel.getByLabel('Cancellation reason',{exact:true}).fill('Studio holiday')
        await shot('cancellation-form',cancel)
        await submit(cancel,'Preview scoped cancellation')
        state = await h.state(); const cancellation = state.seriesCancellations.find(d=>d.status==='draft'&&d.classId===classes[1].id)
        assert.equal(cancellation.impact.classes.length,3); assert.equal(cancellation.impact.creditsReturned,2); assert.equal(cancellation.impact.emails,1)
        const closure = page.locator('#timetable details').filter({has:page.locator(`input[name="id"][value="${cancellation.id}"]`)})
        await shot('cancellation-impact',closure)
        await submit(closure,'Confirm scoped cancellation')
        state = await h.state(); assert.ok(classes.every(c=>state.classes.find(x=>x.id===c.id).status==='cancelled'))
        await as(member.cookie); await page.goto(h.origin+'/app')
        const notices = page.locator('section').filter({has:page.getByRole('heading',{name:'Notices',exact:true})})
        assert.ok(await notices.getByText(/Studio holiday/).first().isVisible())
        assert.ok(await notices.getByText(/Instructor availability|Class changed/).first().isVisible())
        await shot('member-notices',notices)
        assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),'member page fits viewport')
        // The inherited single-class closure door must describe an unpaid visit honestly too.
        const walkin = await h.person(`Walkin${width}`)
        await h.cmd('waiver.acknowledge',{id:(await h.state()).waiver.id},walkin.cookie)
        const start = `${date}T22:00:00.000Z`, end = `${date}T23:00:00.000Z`
        const d = new Date(date+'T12:00:00Z'), week = plus(date,-((d.getUTCDay()+6)%7))
        const legacy = (await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[{title:`Desk mobility ${width}`,service:'Yoga',room:`Desk ${width}`,start,end,instructorId:coach.id,capacity:2}]})).id})).classes[0]
        const visit = await h.cmd('booking.desk',{classId:legacy.id,personId:walkin.id,pay:'unpaid',channel:'desk'})
        const close = await h.cmd('closure.prepare',{scope:'class',classId:legacy.id,reason:'Room repair'})
        assert.equal(close.impact.creditsReturned,0)
        await as(h.owner); await page.goto(h.origin+'/app/classes#closures')
        await shot('unpaid-closure',page.locator('#closures'))
        await submit(page.locator('#closures'),'Confirm and notify members')
        state = await h.state()
        assert.equal(state.bookings.find(b=>b.id===visit.id).status,'cancelled')
        assert.equal(state.packCreditEvents.filter(e=>e.bookingId===visit.id).length,0)

      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
