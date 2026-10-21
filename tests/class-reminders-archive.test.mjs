import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { harness } from './harness.mjs'

const exec = promisify(execFile), minute = 60_000
const at = minutes => new Date(Date.now() + minutes * minute).toISOString()
const weekOf = instant => {
  const d = new Date(instant)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)).toISOString().slice(0, 10)
}
async function checkout(root) {
  await mkdir(root)
  for (const name of ['package.json','pnpm-lock.yaml','OPERATIONS.json','RUN-LOCALLY.md','ACCEPTANCE.md','SEED-COMMAND-CONTRACT.md','OPERATIONS.md','.node-version','wrangler.jsonc','deploy.json','rer-setup.json','scripts','src','migrations']) {
    await cp(name, join(root, name), { recursive: true })
  }
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir')
}
async function archive(root, args) {
  const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }
  delete env.RER_LOCAL_OPERATION
  delete env.RER_LOCAL_STATE_PATH
  await exec(process.execPath, [resolve('node_modules/@runeditrun/rer/global/rer.mjs'), ...args, '--no-queue'], { cwd: root, env, maxBuffer: 2e6 })
}
const setup = async (h, cookie) => assert.equal((await h.mf.dispatchFetch(h.origin + '/setup', {
  method: 'POST', headers: { origin: h.origin, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual',
})).status, 303)
const tick = async h => (await h.mf.getWorker()).scheduled({ cron: '* * * * *' })
const reminders = async h => (await h.db.prepare("SELECT * FROM st_notice_deliveries WHERE source_kind='reminder' ORDER BY created_at,id").all()).results
async function records(h, owner) {
  const response = await h.send('/api/strap/exit.json', undefined, owner)
  assert.equal(response.status, 200, response.text)
  return response.value.tables.st_records
    .filter(row => ['classReminderRule','classReminderRuleEvent','classReminder','reminderTask','reminderTaskEvent'].includes(row.kind) || row.kind.startsWith('message'))
    .map(row => ({ kind: row.kind, data: JSON.parse(row.data) })).sort((a, b) => a.data.id.localeCompare(b.data.id))
}
async function publish(h, owner, coach, title, minutes) {
  const start = at(minutes)
  const draft = await h.cmd('classes.prepare', { week: weekOf(start), classes: [{
    title, service: 'Mat', room: 'Main studio', start, end: new Date(Date.parse(start) + 20 * minute).toISOString(), capacity: 8, instructorId: coach.id,
  }] }, owner)
  return (await h.cmd('classes.publish', { id: draft.id }, owner)).classes[0]
}

test('MSG-003 / MOVE-011: native restore retains reminder identities and follow-up, never replays dispatch and pauses new reminders until explicit owner reconnection', { timeout: 240_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'strap-reminder-restore-'))
  const source = join(temporary, 'source'), restored = join(temporary, 'restored'), file = join(temporary, 'studio.rer')
  let h
  try {
    await checkout(source)
    await checkout(restored)
    await exec(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', 'foundation', '--local'], {
      cwd: source, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 2e6,
    })
    h = await harness({ root: source })
    await setup(h, h.owner)
    await h.cmd('studio.save', { location: 'Brooklyn Studio', timeZone: 'America/New_York' })
    const member = await h.person('Ana'), quiet = await h.person('Ben'), coach = await h.person('Maya', 'instructor')
    await h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: member.id, credits: 5, amountCents: 10000, expiresAt: '2099-12-31T00:00:00Z' })).id })
    await h.cmd('mail.templates.save', { prefix: 'Brooklyn class day.', suffix: 'Contact the studio for help.', requestId: 'restore-reminder-template' })
    await h.cmd('mail.preference.save', { optedOut: true, requestId: 'restore-ben-choice' }, quiet.cookie)
    await h.cmd('mail.preference.save', { optedOut: false, requestId: 'restore-ana-choice' }, member.cookie)
    await h.cmd('reminder.rule.save', { service: '', enabled: true, leadMinutes: 180, revision: 0, requestId: 'restore-reminder-rule' })
    const firstClass = await publish(h, h.owner, coach, 'Source Mat', 30)
    const firstBooking = await h.cmd('booking.book', { classId: firstClass.id }, member.cookie)
    await tick(h)
    const originalDeliveries = await reminders(h)
    assert.equal(originalDeliveries.length, 1)
    assert.equal(originalDeliveries[0].status, 'not_configured', 'source records unavailable email honestly')
    assert.equal((await h.state()).reminderTasks.length, 1)
    assert.equal((await h.state()).reminderTasks[0].deliveryId, originalDeliveries[0].id)
    assert.equal((await h.state(member.cookie)).notices.filter(n => n.reminderId && n.bookingId === firstBooking.id).length, 1)
    const originalRecords = await records(h, h.owner)
    assert.equal(originalRecords.filter(row => row.kind === 'classReminder').length, 1)
    const identity = { auth: h.auth, owner: h.owner }, oldMemberCookie = member.cookie
    await h.close(); h = null
    await archive(source, ['export', '--output', file])
    await archive(restored, ['import', '--input', file, '--yes'])
    h = await harness({ root: restored, ...identity })
    assert.equal((await h.send('/api/strap/state', undefined, identity.owner)).status, 401)
    assert.equal((await h.send('/api/strap/state', undefined, oldMemberCookie)).status, 401, 'member sessions do not travel')
    const owner = await h.signIn(h.auth.OWNER_EMAIL)
    await setup(h, owner); await h.enroll(owner)
    const memberCookie = await h.signIn(member.email)
    assert.equal((await h.send('/app', undefined, memberCookie)).status, 200, 'member recovers only through native sign-in')
    assert.equal((await h.state(memberCookie)).messagePreference.optedOut, false)
    assert.deepEqual(await records(h, owner), originalRecords, 'rules, issued reminders, tasks, templates and member choices survive exactly')
    assert.deepEqual(await reminders(h), originalDeliveries, 'provider outcomes and dispatch identities survive exactly')
    await tick(h)
    await tick(h)
    assert.deepEqual(await reminders(h), originalDeliveries, 'restored Cron never replays the old reminder')
    assert.deepEqual(await records(h, owner), originalRecords, 'restored Cron creates no duplicate reminder or task')

    const pausedClass = await publish(h, owner, coach, 'Restored Mat', 90)
    const pausedBooking = await h.cmd('booking.book', { classId: pausedClass.id }, memberCookie)
    await tick(h)
    await tick(h)
    const pausedDeliveries = await reminders(h), paused = pausedDeliveries.find(row => row.id !== originalDeliveries[0].id)
    assert.equal(pausedDeliveries.length, 2)
    assert.equal(paused.status, 'paused')
    assert.equal(paused.attempted_at, null, 'restored reminder has no dispatch authority')
    const pausedState = await h.state(owner)
    assert.equal(pausedState.reminderTasks.length, 2)
    assert.equal(pausedState.reminderTasks.filter(task => task.deliveryId === paused.id && task.deliveryStatus === 'paused').length, 1)
    assert.equal((await h.state(memberCookie)).notices.filter(n => n.reminderId && n.bookingId === pausedBooking.id).length, 1, 'paused email keeps the member in-app reminder')

    await h.cmd('mail.connect', {}, owner)
    const reconnectedClass = await publish(h, owner, coach, 'Reconnected Mat', 150)
    await h.cmd('booking.book', { classId: reconnectedClass.id }, memberCookie)
    await tick(h)
    await tick(h)
    const finalDeliveries = await reminders(h)
    assert.equal(finalDeliveries.length, 3)
    assert.deepEqual(finalDeliveries.find(row => row.id === paused.id), paused, 'reconnection never releases or retries the old paused dispatch')
    assert.deepEqual(finalDeliveries.find(row => row.id === originalDeliveries[0].id), originalDeliveries[0])
    assert.equal(finalDeliveries.find(row => row.id !== paused.id && row.id !== originalDeliveries[0].id).status, 'not_configured', 'new work follows the reconnected installation configuration')
    assert.equal((await h.state(owner)).reminderTasks.length, 3, 'each unavailable delivery retains one follow-up only')
    const outbox = (await h.db.prepare('SELECT message FROM rer_mail_development_outbox').all()).results.map(row => JSON.parse(row.message))
    assert.ok(outbox.length > 0)
    assert.ok(outbox.every(mail => mail.text.includes('/auth/confirm?token=')), 'only fresh native access email was emitted; studio reminders were never sent')
  } finally {
    if (h) await h.close()
    await rm(temporary, { recursive: true, force: true })
  }
})
