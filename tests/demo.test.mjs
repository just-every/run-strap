import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './harness.mjs'

test('demo opens a lived-in studio, approves real work and silently simulates an invitation', async () => {
  const h = await harness({ entry: 'tests/demo-worker.ts', auth: { RER_DEMO: '1' } })
  try {
    const state = await h.state()
    const page = await h.send('/app', undefined, h.owner)
    assert.equal(page.status, 200)
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
