import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './harness.mjs'

test('demo opens a lived-in studio, approves real work and silently simulates an invitation', async () => {
  const h = await harness({ entry: 'tests/demo-worker.ts', auth: { RER_DEMO: '1' } })
  try {
    const state = await h.state()
    assert.ok(state.classes.some(c => Date.parse(c.start) > Date.now()))
    assert.ok(state.bookings.some(b => b.status === 'waitlisted'))
    assert.ok(state.bookings.some(b => b.checkedInAt))
    assert.ok(state.people.some(p => !p.active))
    assert.ok(state.packs.some(p => Date.parse(p.expiresAt) < Date.now()))
    const page = await h.send('/app', undefined, h.owner)
    assert.equal(page.status, 200)
    assert.ok(!page.text.includes('href="/app/mail"'))
    assert.ok(!page.text.includes('id="rer-demo-bar"'))
    const draft = state.drafts.find(d => d.status === 'draft' && d.type === 'reminder')
    await h.cmd('reminder.approve', { id: draft.id })
    const person = state.people.find(p => p.role === 'member' && p.active)
    await h.cmd('person.invite', { id: person.id })
    const invitations = await h.db.prepare('SELECT email FROM oa_operators WHERE email=?').bind(person.email).all()
    assert.equal(invitations.results.length, 1)
    const outbox = await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()
    assert.equal(outbox.n, 0)
    assert.equal((await h.send('/app/mail', undefined, h.owner)).status, 404)
  } finally { await h.close() }
})
