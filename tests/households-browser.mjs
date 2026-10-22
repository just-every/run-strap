import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { session, shot } from './locations-browser.mjs'

// MEM-002 at 1440 and 390: the front desk's household screen, a guardian booking and signing for a participant, and the
// payer's own acceptance. Each screen fits its width and is read through real controls.
export async function householdsBrowser(h, { priya, sam, miaId, noahId, mat, flow, home }) {
  if (process.env.STRAP_PROOF_DIR) await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true })
  process.env.STRAP_PROOF_PREFIX = 'MEM-002'
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const desk = await session(h, h.owner, width, browser)
      try {
        await desk.page.goto(h.origin + '/app/households')
        const panel = desk.page.locator(`#household-${home.id}`)
        const text = await panel.innerText()
        for (const fact of ['Okafor family', 'Priya', 'Mia Okafor', 'Ola Okafor', 'Aunt Ada', width === 1440 ? 'Sam has been asked to become the payer' : 'Payer: Sam']) assert.ok(text.includes(fact), `${fact} in ${JSON.stringify(text.slice(0, 1500))}`)
        await shot(desk.page, width, 'desk-household', 'Okafor family')
      } finally { await desk.context.close() }
      const guardian = await session(h, priya.cookie, width, browser)
      try {
        const page = guardian.page, [child, target] = width === 1440 ? [miaId, mat] : [noahId, flow]
        await page.goto(h.origin + '/app/household')
        const kid = page.locator(`[data-participant-id="${child}"]`)
        await shot(page, width, 'guardian-household', 'Okafor family')
        await kid.locator('select[name="classId"]').selectOption(target.id)
        await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('name=booking.book')), kid.locator('form').filter({ has: page.locator('select[name="classId"]') }).getByRole('button').click()])
        await page.waitForURL(h.origin + '/app/household')
        assert.ok((await h.state()).bookings.some(b => b.personId === child && b.classId === target.id && b.status === 'booked' && b.bookedBy === priya.id), 'the guardian booked the participant through the screen')
        assert.ok((await page.locator(`[data-participant-id="${child}"]`).innerText()).includes('booked'))
        await shot(page, width, 'guardian-booked', 'Okafor family')
      } finally { await guardian.context.close() }
      const payer = await session(h, sam.cookie, width, browser)
      try {
        await payer.page.goto(h.origin + '/app/household')
        if (width === 1440) {
          await shot(payer.page, width, 'payer-request', 'Okafor family')
          await Promise.all([payer.page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('name=household.payer.accept')), payer.page.getByRole('button', { name: 'Accept responsibility as payer', exact: true }).click()])
          await payer.page.waitForURL(h.origin + '/app/household')
          assert.equal((await h.state()).households[0].payer.name, 'Sam', 'the payer accepted through their own screen')
        }
        assert.ok((await payer.page.locator('main').innerText()).includes('Okafor family'))
        await shot(payer.page, width, 'payer-household', 'Okafor family')
      } finally { await payer.context.close() }
    }
  } finally { await browser.close() }
}
