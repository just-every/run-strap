import assert from 'node:assert/strict'
import axe from 'axe-core'

export async function auditPage(page, label) {
  await page.evaluate(axe.source)
  const result = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }))
  assert.deepEqual(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), [], label)
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
