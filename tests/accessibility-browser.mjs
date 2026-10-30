import assert from 'node:assert/strict'
import axe from 'axe-core'
import { join } from 'node:path'

export async function auditPage(page, label) {
  await page.evaluate(axe.source)
  const result = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }))
  assert.deepEqual(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), [], label)
  const missingTooltips = await page.locator('button,a,summary,[role=button]').evaluateAll(controls => controls.filter(control => control.checkVisibility() && !control.innerText.trim() && control.querySelector('svg,img') && !control.querySelector('[role=tooltip]')).map(control => control.tagName))
  assert.deepEqual(missingTooltips, [], label + ' icon controls have tooltips')
  console.log(`PROBE APP-005 axe: ${label} -> zero WCAG 2.2 AA violations`)
}

export async function keyboardFields(page, form, labels) {
  const first = form.getByLabel(labels[0], { exact: false })
  await first.focus()
  for (let i = 0; i < labels.length; i++) {
    const field = form.getByLabel(labels[i], { exact: false })
    assert.equal(await field.evaluate(el => el === document.activeElement), true, `keyboard reaches ${labels[i]} in order`)
    assert.equal(await field.evaluate(el => { const s = getComputedStyle(el); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 }), true, `${labels[i]} has visible focus`)
    await page.keyboard.press('Tab')
  }
  assert.equal(await form.getByRole('button', { name: /Save/ }).evaluate(el => el === document.activeElement), true, 'save follows the profile fields')
}

// Follow each role's actual navigation and expose collapsed configuration controls.
// The seeded member, pack, profile history and class remain present during audits.
export async function auditNavigation(page, origin, role, proofDirectory) {
  await page.goto(origin + '/app')
  const paths = await page.locator('.sidebar > .nav a, .sidebar > a.location').evaluateAll(links => [...new Set(links.map(link => link.getAttribute('href')))])
  assert.ok(paths.length, role + ' navigation has pages')
  for (const path of paths) {
    const response = await page.goto(origin + path)
    if (response.status() === 403) {
      await page.getByRole('alert').waitFor()
      assert.equal(await page.getByRole('link', { name: 'Back to available pages' }).getAttribute('href'), '/app', role + ' gets a safe permission refusal')
    } else assert.equal(response.status(), 200, role + ' can open ' + path)
    await page.locator('main details').evaluateAll(items => items.forEach(item => { item.open = true }))
    await auditPage(page, role + ' navigation ' + path + ' with expanded controls')
    if (role === 'owner' && ['/app/packs', '/app/security'].includes(path) || role === 'instructor' && path === '/app' || role === 'manager' && path === '/app/time-clock') {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.screenshot({ path: join(proofDirectory, `APP-005-${role}-${path.split('/').at(-1) || 'today'}-${width}.png`), fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
  }
  return paths
}

export async function readRecovery(h, page, member, proofDirectory) {
  const before = await h.state()
  await h.db.prepare('ALTER TABLE ik_jobs RENAME TO synthetic_strap_unavailable_jobs').run()
  try {
    const response = await page.goto(h.origin + '/app/people?person=' + member.id)
    assert.equal(response.status(), 503)
    const alert = page.getByRole('alert')
    await alert.waitFor()
    assert.equal(await alert.evaluate(el => el === document.activeElement), true, 'failed read is announced and focused')
    assert.equal(await page.locator('[data-app-notice][role=status]').count(), 0, 'a failed read shows no saved status')
    await auditPage(page, 'unavailable studio read with recovery link')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: join(proofDirectory, `APP-005-read-recovery-${width}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    const responseToSave = await h.mf.dispatchFetch(h.origin + '/app/action?name=profile.save.staff&returnTo=' + encodeURIComponent('/app/people?person=' + member.id), {
      method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ personId: member.id, name: 'Unconfirmed change', channel: 'phone', requestId: 'synthetic-strap-unavailable-save' }),
    })
    assert.equal(responseToSave.status, 503)
    const html = await responseToSave.text()
    assert.match(html, /action may have completed/)
    assert.ok(!html.includes('role="status"') && !html.includes('synthetic_strap_unavailable_jobs'), 'no false success or internal failure details')
  } finally {
    await h.db.prepare('ALTER TABLE synthetic_strap_unavailable_jobs RENAME TO ik_jobs').run()
  }
  await page.getByRole('link', { name: 'Load current record' }).focus()
  await page.keyboard.press('Enter')
  assert.equal(new URL(page.url()).pathname, '/app/people')
  assert.equal(new URL(page.url()).searchParams.get('person'), member.id)
  assert.equal((await h.state()).version, before.version, 'read recovery does not replay the failed action')
  assert.equal((await h.state()).people.find(p => p.id === member.id).name, member.name)
  console.log('PROBE APP-005 failed read: unavailable People and save result -> announced 503, explicit current-record GET, no automatic replay or false success')
}
