import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { session } from './locations-browser.mjs'
const shot=async(page,width,name)=>{
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`)
  if(process.env.STRAP_PROOF_DIR)await page.screenshot({path:process.env.STRAP_PROOF_DIR+`/PLAN-009-${name}-${width}.png`,fullPage:true})
}
async function post(page,form,button) {
  if(await form.locator('select[name="channel"]').count())await form.locator('select[name="channel"]').selectOption('phone')
  await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/app/action')),form.getByRole('button',{name:button,exact:true}).click()]);await page.waitForURL('**/app/courses')
  assert.equal(await page.locator('[role="alert"]').count(),0)
}
export async function coursesBrowser(h,{desk,second,course}) {
  if(process.env.STRAP_PROOF_DIR)await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  const browser=await chromium.launch({headless:true,...(process.env.STRAP_CHROMIUM?{executablePath:process.env.STRAP_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {
    for(const width of [1440,390]) {
      const staff=await session(h,desk.cookie,width,browser),payer=await session(h,second.cookie,width,browser),owner=await session(h,h.owner,width,browser)
      try {
        await staff.page.goto(h.origin+'/app/courses')
        if(width===1440) {
          const form=staff.page.locator('#course-'+course.id+' form');await form.locator('select[name="personId"]').selectOption(second.id);await post(staff.page,form,'Preview enrollment')
        }
        const preview=(await h.state()).courseTuition.previews.find(p=>p.personId===second.id && p.courseId===course.id)
        assert.ok(preview);await shot(staff.page,width,'phone-enrollment-preview')
        await payer.page.goto(h.origin+'/app/courses');await shot(payer.page,width,'payer-review')
        if(width===390) {
          await post(staff.page,staff.page.locator('#review-'+preview.id+' form'),'Launch payer review')
          await post(payer.page,payer.page.locator('#review-'+preview.id+' form'),'Accept exact course tuition')
          await staff.page.reload();await post(staff.page,staff.page.locator('#review-'+preview.id+' form').filter({has:staff.page.getByRole('button',{name:'Confirm enrollment',exact:true})}),'Confirm enrollment')
          assert.equal((await h.state()).courseTuition.enrollments.find(e=>e.personId===second.id).amountCents,60000)
        }
        await staff.page.reload();await shot(staff.page,width,'phone-roster')
        await payer.page.goto(h.origin+'/app/courses');await shot(payer.page,width,'payer-tuition')
        await owner.page.goto(h.origin+'/app/courses');await shot(owner.page,width,'owner-courses')
        await owner.page.goto(h.origin+'/app/people');assert.ok((await owner.page.locator('#staff-actions').innerText()).includes('Confirm course enrollment'));await shot(owner.page,width,'course-staff-history')
        const iconControls=await staff.page.locator('button,a').evaluateAll(nodes=>nodes.filter(n=>!n.textContent.trim()&&n.querySelector('svg')).map(n=>({label:n.getAttribute('aria-label'),tooltip:!!n.querySelector('[role="tooltip"]')})))
        assert.ok(iconControls.every(c=>c.label&&c.tooltip),'icon-only controls have accessible tooltips')
      } finally {await staff.context.close();await payer.context.close();await owner.context.close()}
    }
  } finally {await browser.close()}
}
export async function courseWithdrawalBrowser(h,{desk,enrollment}) {
  const browser=await chromium.launch({headless:true,...(process.env.STRAP_CHROMIUM?{executablePath:process.env.STRAP_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {
    for(const width of [1440,390]) {
      const staff=await session(h,desk.cookie,width,browser)
      try {
        await staff.page.goto(h.origin+'/app/courses')
        if(width===1440) {
          const section=staff.page.locator('#enrollment-'+enrollment.id);await section.getByText('Withdraw from course',{exact:true}).click()
          const form=section.locator('form').filter({has:staff.page.getByRole('button',{name:'Preview withdrawal',exact:true})});await form.locator('[name="reason"]').fill('Phoned-in withdrawal');await post(staff.page,form,'Preview withdrawal')
        }
        const preview=(await h.state()).courseTuition.withdrawals.find(p=>p.enrollmentId===enrollment.id&&p.status==='preview')
        assert.equal(preview.creditCents,30000,'the overdue installment and deposit stay owed')
        await shot(staff.page,width,'phone-withdrawal-preview')
        if(width===390) {
          await post(staff.page,staff.page.locator('#withdraw-'+preview.id+' form'),'Confirm withdrawal')
          assert.equal((await h.state()).courseTuition.enrollments.find(e=>e.id===enrollment.id).status,'withdrawn');await shot(staff.page,width,'phone-withdrawn')
          await staff.page.setViewportSize({width:1440,height:1000});await staff.page.reload();await shot(staff.page,1440,'phone-withdrawn')
        }
      } finally {await staff.context.close()}
    }
  } finally {await browser.close()}
}
