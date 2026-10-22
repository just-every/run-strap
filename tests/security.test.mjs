import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { emailStepUp, enrollTotp, softwarePasskey, totp } from './mfa-helpers.mjs'

const mail = async (h, email) => (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()).results.map(r => JSON.parse(r.message)).find(m => m.to.includes(email))
const operatorId = async (h, cookie) => (await h.send('/auth/session', undefined, cookie)).value.operator.id
const refused = async (h, name, input, cookie, status, error) => {
  const r = await h.send('/api/strap/command', { name, input }, cookie)
  assert.equal(r.status, status, `${name}: ${JSON.stringify(r.value)}`); if (error) assert.equal(r.value.error, error, name)
  return r
}
const get = async (h, path, cookie, status, error) => {
  const r = await h.send(path, undefined, cookie)
  assert.equal(r.status, status, `${path}: ${r.text.slice(0, 200)}`); if (error) assert.equal(r.value.error, error, path)
  return r
}
async function financeUser(h, name = 'Fiona') {
  const fiona = await h.person(name)
  await h.cmd('finance.grant', { id: fiona.id })
  return fiona
}
const verifyTotp = (h, secret, cookie, offset = 1) => h.cmd('mfa.verify', { code: totp(secret, offset) }, cookie)
async function presentPasskey(h, key, cookie, options) {
  const { challenge_id, publicKey } = await h.cmd('mfa.passkey.options', { purpose: 'verify' }, cookie)
  assert.equal(publicKey.userVerification, 'required')
  return h.send('/api/strap/command', { name: 'mfa.passkey.verify', input: { challenge_id, ...key.assertion(publicKey.challenge, options) } }, cookie)
}

test('SEC-004: a finance user is refused the revenue report before enrolling, then signs in with an authenticator app, a passkey and a recovery code (each recovery code works once)', () => run(async h => {
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const fiona = await financeUser(h)
  // Before enrollment: refused at the report, its downloads and its page; nothing else opens for finance either.
  await get(h, '/api/strap/reports/revenue', fiona.cookie, 403, 'mfa_enrollment_required')
  await get(h, '/api/strap/reports/revenue.csv', fiona.cookie, 403, 'mfa_enrollment_required')
  const pageHold = await h.send('/app/revenue', undefined, fiona.cookie)
  assert.equal(pageHold.status, 403); assert.equal(pageHold.headers.get('x-strap-refusal'), 'mfa_enrollment_required'); assert.match(pageHold.text, /Confirm your email/)
  for (const path of ['/api/strap/state', '/api/strap/reports/attendance', '/api/strap/teaching-pay', '/app/people', '/app/integrations']) await get(h, path, fiona.cookie, 403, 'finance_reports_only')
  for (const [name, input] of [['person.save', { name: 'Eve', email: 'eve@studio.example', role: 'member', active: true }], ['booking.cancel', { id: 'x' }], ['integration.create', { label: 'x' }], ['finance.grant', { id: fiona.id }]]) await refused(h, name, input, fiona.cookie, 403, 'finance_reports_only')
  // An authenticator app: enroll (the session is then checked), recovery codes shown once.
  const app = await enrollTotp(h, fiona.cookie)
  assert.equal(app.recoveryCodes.length, 10)
  assert.equal((await get(h, '/api/strap/reports/revenue', fiona.cookie, 200)).value.totals.grossSalesCents, 0)
  assert.equal((await get(h, '/api/strap/reports/revenue.xlsx', fiona.cookie, 200)).status, 200)
  await get(h, '/api/strap/reports/attendance', fiona.cookie, 403, 'finance_reports_only')
  // Signing in again is a new session: held at the factor until one is presented. The same code is never accepted twice.
  const second = await h.signIn(fiona.email)
  await get(h, '/api/strap/reports/revenue', second, 403, 'mfa_required')
  await refused(h, 'mfa.verify', { code: '000000' }, second, 403, 'mfa_code_invalid')
  await verifyTotp(h, app.secret, second)
  await get(h, '/api/strap/reports/revenue', second, 200)
  await refused(h, 'mfa.verify', { code: totp(app.secret, 1) }, await h.signIn(fiona.email), 403, 'mfa_code_invalid')
  // A passkey is added beside it (this session has presented the app) and then signs in on its own.
  const key = softwarePasskey(h.origin)
  const unverified = await h.cmd('mfa.passkey.options', { purpose: 'register' }, second)
  assert.equal(unverified.publicKey.authenticatorSelection.userVerification, 'required')
  await refused(h, 'mfa.passkey.register', { challenge_id: unverified.challenge_id, ...key.registration(unverified.publicKey.challenge, { flags: 0x41 }) }, second, 403, 'passkey_user_not_verified')
  const options = await h.cmd('mfa.passkey.options', { purpose: 'register' }, second)
  const added = await h.cmd('mfa.passkey.register', { challenge_id: options.challenge_id, label: 'Laptop', ...key.registration(options.publicKey.challenge) }, second)
  assert.equal(added.recovery_codes, null, 'working recovery codes are kept, not replaced')
  const third = await h.signIn(fiona.email)
  await get(h, '/api/strap/reports/revenue', third, 403, 'mfa_required')
  assert.equal((await presentPasskey(h, key, third, { flags: 0x01 })).status, 403, 'user presence alone cannot sign in')
  const other = softwarePasskey(h.origin)
  assert.equal((await presentPasskey(h, key, third, { key: other.privateKey })).status, 403, 'a signature from another key is refused')
  assert.equal((await presentPasskey(h, key, third, { counter: 0, rpHash: Buffer.alloc(32) })).status, 403, 'another relying party is refused')
  assert.equal((await presentPasskey(h, key, third)).status, 200)
  await get(h, '/api/strap/reports/revenue', third, 200)
  assert.equal((await presentPasskey(h, key, third, { counter: 1 })).status, 403, 'a replayed signature counter is refused')
  // A recovery code works once: the second use, from a fresh session, is refused.
  const raced = [await h.signIn(fiona.email), await h.signIn(fiona.email)]
  const attempts = await Promise.all(raced.map(cookie => h.send('/api/strap/command', { name: 'mfa.verify', input: { code: app.recoveryCodes[1] } }, cookie)))
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 403], 'concurrent recovery consumption admits exactly one session')
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM st_mfa_sessions WHERE session_id IN (SELECT id FROM oa_sessions WHERE operator_id=?) AND method='recovery'").bind(await operatorId(h, fiona.cookie)).first()).n, 1)
  const fourth = raced[attempts.findIndex(r => r.status === 200)], fifth = raced[attempts.findIndex(r => r.status === 403)]
  await get(h, '/api/strap/reports/revenue', fourth, 200)
  await get(h, '/api/strap/reports/revenue', fifth, 403, 'mfa_required')
  const code = app.recoveryCodes[0]
  await h.cmd('mfa.verify', { code }, fourth)
  await get(h, '/api/strap/reports/revenue', fourth, 200)
  await refused(h, 'mfa.verify', { code }, fifth, 403, 'mfa_code_invalid')
  await get(h, '/api/strap/reports/revenue', fifth, 403, 'mfa_required')
  assert.equal((await get(h, '/api/strap/mfa', fourth, 200)).value.recoveryCodesLeft, 8)
  // Five wrong codes pause the person: the right one is refused until the pause ends.
  for (let i = 0; i < 4; i++) await refused(h, 'mfa.verify', { code: '111111' }, fifth, 403, 'mfa_code_invalid')
  await refused(h, 'mfa.verify', { code: totp(app.secret, -1) }, fifth, 429, 'mfa_locked')
  const pauses = (await get(h, '/api/strap/staff-history?auditCommand=mfa.refused', h.owner, 200)).value.rows
  assert.ok(pauses.some(r => r.after.pausedUntil > Date.now()), 'the pause is audited explicitly')
  // Revoking the grant returns the person to a member identity at once.
  await h.cmd('finance.revoke', { id: fiona.id })
  await get(h, '/api/strap/reports/revenue', fourth, 403, 'owner_required')
}))

test('SEC-004: owners are held at reports, pay, exports, staff access and provider connections until they enroll; another owner resets a factor and the audit shows it', () => run(async h => {
  await h.confirmSetup(h.owner)
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const first = await operatorId(h, h.owner)
  // A second owner has not enrolled: ordinary work opens, every privileged door is refused and shows no pay or provider data.
  const confirm = async (email, cookie = '') => {
    const m = await mail(h, email), token = new URL(m.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
    return (await h.send('/auth/confirm', { token }, cookie)).cookie
  }
  assert.equal((await h.send('/auth/step-up', { action: 'owner:transfer' }, h.owner)).status, 202)
  await confirm(h.auth.OWNER_EMAIL, h.owner)
  assert.equal((await h.send('/auth/invite', { email: 'second@studio.example', displayName: 'Second Owner', role: 'owner' }, h.owner)).status, 202)
  const second = await confirm('second@studio.example'), secondId = await operatorId(h, second)
  const member = await h.person('Stafftarget')
  const inactive = await h.cmd('person.save', { name: 'Inactive', email: 'inactive@studio.example', role: 'member', active: false })
  const invited = await h.send('/auth/invite', { email: 'pending@studio.example', displayName: 'Pending', role: 'member' }, h.owner)
  assert.equal(invited.status, 202)
  const pendingId = (await h.db.prepare("SELECT id FROM oa_operators WHERE email='pending@studio.example'").first()).id
  const staffId = await operatorId(h, member.cookie)
  const teacher = await h.cmd('person.save', { name: 'synthetic-strap-4', email: 'synthetic-strap-4@studio.example', role: 'instructor', active: true })
  const timetable = await h.cmd('classes.prepare', { week: '2099-11-02', classes: [{ title: 'synthetic-strap-5', room: 'Studio', start: '2099-11-02T10:00:00Z', end: '2099-11-02T11:00:00Z', capacity: 4, instructorId: teacher.id }] })
  const earned = (await h.cmd('classes.publish', { id: timetable.id })).classes[0]
  const closure = await h.cmd('closure.prepare', { scope: 'class', classId: earned.id, reason: 'Studio closed' })
  await h.cmd('closure.confirm', { id: closure.id, impact: closure.impact.key })
  const waiver = await h.cmd('waiver.publish', { text: 'synthetic-strap-7' })
  const adjustment = { classId: earned.id, instructorId: teacher.id, amountCents: 350, reason: 'Agreed setup time', requestId: 'synthetic-strap-3' }
  const before = async () => (await h.db.batch((await h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(r => h.db.prepare(`SELECT * FROM ${r.name} ORDER BY rowid`)))).map(r => r.results)
  const unchanged = async (act, label) => { const saved = await before(); await act(); assert.deepEqual(await before(), saved, label + ': nothing written (including auth mail, audit and rate counters)') }
  const held = await h.state(second)
  assert.deepEqual([held.teachingPay, held.integrations, held.agentKeys, held.memberMail], [null, [], [], null])
  assert.equal((await get(h, '/api/strap/mfa', second, 200)).value.required, true)
  for (const path of ['/api/strap/staff-history', '/api/strap/staff-history.csv', '/api/strap/reports/revenue', '/api/strap/reports/revenue.csv', '/api/strap/reports/attendance.xlsx', '/api/strap/teaching-pay', '/api/strap/teaching-pay.csv', '/api/strap/exit.json', '/api/strap/preferences.json']) await unchanged(() => get(h, path, second, 403, 'mfa_enrollment_required'), path)
  for (const page of ['/app/revenue', '/app/teaching-pay', '/app/integrations', '/app/agent']) await unchanged(async () => { const r = await h.send(page, undefined, second); assert.equal(r.status, 403, page); assert.equal(r.headers.get('x-strap-refusal'), 'mfa_enrollment_required') }, page)
  assert.equal((await h.send('/app/people', undefined, second)).status, 200)
  for (const [name, input] of [['agent.create', { label: 'Assistant' }], ['integration.create', { label: 'Door' }], ['kiosk.pair', { label: 'Desk' }], ['pay.rule.save', {}], ['pay.adjust', adjustment], ['mail.connect', {}], ['finance.grant', { id: 'x' }], ['mfa.reset', { operatorId: first }]]) await unchanged(() => refused(h, name, input, second, 403, 'mfa_enrollment_required'), name)
  const staffChanges = [
    ['person.invite', { id: member.id }],
    ['person.save', { ...member, role: 'instructor' }],
    ['person.save', { ...member, active: false }],
    ['person.save', { ...inactive, active: true }],
    ['waiver.launch', { personId: member.id, waiverId: waiver.id, channel: 'desk', requestId: 'synthetic-strap-8' }],
  ]
  for (const [name, input] of staffChanges) await unchanged(() => refused(h, name, input, second, 403, 'mfa_enrollment_required'), name)
  for (const [path, input] of [
    ['/auth/invite', { email: 'refused@studio.example', displayName: 'Refused', role: 'member' }],
    ['/auth/operator/role', { operatorId: staffId, role: 'admin' }],
    ['/auth/operator/status', { operatorId: staffId, status: 'inactive' }],
    ['/auth/operator/status', { operatorId: staffId, status: 'active' }],
    ['/auth/invite/cancel', { operatorId: pendingId }],
  ]) await unchanged(async () => { const r = await h.send(path, input, second); assert.equal(r.status, 403); assert.equal(r.value.error, 'mfa_enrollment_required') }, path)
  // Forms take the same guard, including parsed role and activation changes.
  for (const [name, input] of [
    ['person.save', { id: member.id, name: member.name, email: member.email, role: 'instructor', active: 'true' }],
    ['person.invite', { id: member.id }],
    ['pay.adjust', { ...adjustment, adjustment: '3.50' }],
    ['integration.create', { label: 'synthetic-strap-6', 'sc_roster:read': 'true', location: 'studio' }],
  ]) await unchanged(async () => {
    const form = await h.mf.dispatchFetch(h.origin + `/app/action?name=${name}&returnTo=%2Fapp%2Fpeople`, { method: 'POST', headers: { origin: h.origin, cookie: second, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(input).toString() })
    assert.equal(form.status, 403); assert.equal(form.headers.get('x-strap-refusal'), 'mfa_enrollment_required')
    assert.match(await form.text(), /mfa enrollment required/)
  }, name + ' form')
  assert.equal((await h.state()).people.find(p => p.id === member.id).role, 'member')
  // First enrollment needs Base's fresh email proof; neither starting method writes before that proof.
  await h.db.prepare('UPDATE oa_sessions SET created_at=? WHERE operator_id=?').bind(Date.now() - 660_000, secondId).run()
  await unchanged(() => refused(h, 'mfa.totp.start', {}, second, 403, 'step_up_required'), 'first TOTP step-up')
  await unchanged(() => refused(h, 'mfa.passkey.options', { purpose: 'register' }, second, 403, 'step_up_required'), 'first passkey step-up')
  await emailStepUp(h, second)
  const enrolled = await enrollTotp(h, second)
  await get(h, '/api/strap/preferences.json?personId='+member.id, second, 200)
  await unchanged(() => refused(h, 'mfa.remove', { factor: enrolled.factor }, second, 409, 'mfa_last_factor_required'), 'owner last factor')
  // A pending app does not count as a working second factor.
  await h.cmd('mfa.totp.start', { label: 'Not confirmed' }, second)
  await unchanged(() => refused(h, 'mfa.remove', { factor: enrolled.factor }, second, 409, 'mfa_last_factor_required'), 'pending factor')
  for (const [name, input] of staffChanges.slice(1, 2)) assert.equal((await h.cmd(name, input, second)).role, 'instructor')
  assert.equal((await h.send('/auth/operator/role', { operatorId: staffId, role: 'admin' }, second)).status, 200)

  await get(h, '/api/strap/teaching-pay', second, 200)
  assert.equal((await h.cmd('pay.adjust', adjustment, second)).amountCents, 350)
  // The enrolling owner resets nobody's factors but another owner's: never their own.
  await refused(h, 'mfa.reset', { operatorId: secondId }, second, 403, 'another_owner_required')
  const fresh = await h.signIn(h.auth.OWNER_EMAIL)
  await refused(h, 'mfa.reset', { operatorId: secondId }, fresh, 403, 'mfa_required')
  await h.db.prepare('UPDATE oa_step_up_challenges SET consumed_at=1 WHERE consumed_at IS NOT NULL').run()
  await unchanged(() => refused(h, 'mfa.reset', { operatorId: secondId, reason: 'Lost phone' }, h.owner, 403, 'step_up_required'), 'reset step-up')
  await emailStepUp(h, h.owner, 'delete')
  await unchanged(() => refused(h, 'mfa.reset', { operatorId: secondId, reason: '  ' }, h.owner, 400, 'invalid_reason'), 'reset reason')
  const reset = await h.cmd('mfa.reset', { operatorId: secondId, reason: 'Lost phone' })
  assert.equal(reset.factors_removed, 2)
  assert.equal((await h.send('/api/strap/state', undefined, second)).status, 401, 'the reset person is signed out everywhere')
  const again = await h.signIn('second@studio.example')
  await get(h, '/api/strap/teaching-pay', again, 403, 'mfa_enrollment_required')
  await refused(h, 'mfa.verify', { code: enrolled.recoveryCodes[0] }, again, 409, 'mfa_enrollment_required')
  // The audit record: who reset whom, when and why; filterable, exportable, owner only.
  const audit = (await get(h, '/api/strap/staff-history?auditCommand=mfa.reset', h.owner, 200)).value.rows
  assert.equal(audit.length, 1)
  assert.deepEqual([audit[0].command, audit[0].actorId, audit[0].personId, audit[0].reason, audit[0].after.actor, audit[0].after.subject, audit[0].after.factorsRemoved], ['mfa.reset', first, secondId, 'Lost phone', h.auth.OWNER_EMAIL, 'second@studio.example', 2])
  assert.match((await get(h, '/api/strap/staff-history.csv?auditCommand=mfa.reset', h.owner, 200)).text, /mfa\.reset/)
  assert.equal((await get(h, '/api/strap/staff-history?auditCommand=mfa.enroll', h.owner, 200)).value.rows.length >= 2, true, 'enrollments are audited too')
  const ana = await h.person('Ana')
  await get(h, '/api/strap/staff-history', ana.cookie, 403)
}))

test('SEC-004: a member opts in, and every later session is held at every door until a factor is presented; with no MFA key a passkey still enrolls', () => run(async h => {
  const ana = await h.person('Ana')
  assert.equal((await get(h, '/api/strap/mfa', ana.cookie, 200)).value.required, false)
  const app = await enrollTotp(h, ana.cookie)
  const next = await h.signIn(ana.email)
  await get(h, '/api/strap/state', next, 403, 'mfa_required')
  await refused(h, 'booking.cancel', { id: 'x' }, next, 403, 'mfa_required')
  await verifyTotp(h, app.secret, next)
  await get(h, '/api/strap/state', next, 200)
  const renewed = await h.cmd('mfa.recovery.renew', {}, next)
  assert.equal(renewed.recovery_codes.length, 10)
  await refused(h, 'mfa.verify', { code: app.recoveryCodes[0] }, ana.cookie, 403, 'mfa_code_invalid')
  await h.cmd('mfa.verify', { code: renewed.recovery_codes[0] }, ana.cookie)
  const events = (await get(h, '/api/strap/staff-history', h.owner, 200)).value.rows
  const memberOperator = await operatorId(h, ana.cookie)
  assert.ok(events.some(r => r.command === 'mfa.recovery_renewed' && r.personId === memberOperator))
  for (const value of [app.secret, ...renewed.recovery_codes]) assert.ok(!JSON.stringify(events).includes(value), 'audit never includes a secret or recovery code')
  // Removing the only factor needs a checked session and ends every session of the person.
  await refused(h, 'mfa.remove', { factor: app.factor }, await h.signIn(ana.email), 403, 'mfa_required')
  assert.equal((await h.cmd('mfa.remove', { factor: app.factor }, next)).removed, true)
  assert.equal((await h.send('/api/strap/state', undefined, ana.cookie)).status, 401)
  // The owner's own authenticator becomes unreadable when the key changes: they are back at enrollment with the reason.
  await h.db.prepare("UPDATE st_mfa_factors SET sealed_secret='v1.AAAA.AAAA' WHERE kind='totp'").run()
  const view = (await get(h, '/api/strap/mfa', h.owner, 200)).value
  assert.equal(view.reason, 'mfa_key_changed'); assert.match(view.reasonText, /enroll a factor again/i)
  await get(h, '/api/strap/teaching-pay', h.owner, 403, 'mfa_enrollment_required')
}))

test('SEC-004: without an MFA key authenticator apps are refused and a passkey alone opens the privileged doors', () => run(async h => {
  await refused(h, 'mfa.totp.start', {}, h.owner, 403, 'step_up_required')
  await emailStepUp(h, h.owner)
  await refused(h, 'mfa.totp.start', {}, h.owner, 409, 'mfa_key_missing')
  await get(h, '/api/strap/teaching-pay', h.owner, 403, 'mfa_enrollment_required')
  const key = softwarePasskey(h.origin), options = await h.cmd('mfa.passkey.options', { purpose: 'register' })
  assert.equal(options.publicKey.timeout, 300_000)
  await h.db.prepare('UPDATE st_mfa_challenges SET expires_at=? WHERE id=?').bind(Date.now() - 1, options.challenge_id).run()
  await refused(h, 'mfa.passkey.register', { challenge_id: options.challenge_id, ...key.registration(options.publicKey.challenge) }, h.owner, 409, 'passkey_challenge_expired')
  const active = await h.cmd('mfa.passkey.options', { purpose: 'register' })
  const added = await h.cmd('mfa.passkey.register', { challenge_id: active.challenge_id, ...key.registration(active.publicKey.challenge) })
  assert.equal(added.recovery_codes.length, 10)
  await get(h, '/api/strap/teaching-pay', h.owner, 200)
  await refused(h, 'mfa.passkey.register', { challenge_id: active.challenge_id, ...key.registration(active.publicKey.challenge) }, h.owner, 409, 'passkey_challenge_expired')
  await refused(h, 'mfa.remove', { factor: added.factor }, h.owner, 409, 'mfa_last_factor_required')
  const replacement = softwarePasskey(h.origin), next = await h.cmd('mfa.passkey.options', { purpose: 'register' })
  await h.cmd('mfa.passkey.register', { challenge_id: next.challenge_id, ...replacement.registration(next.publicKey.challenge) })
  assert.equal((await h.cmd('mfa.remove', { factor: added.factor })).removed, true, 'an owner may remove a factor beside another working one')
  assert.equal((await h.send('/auth/session', undefined, h.owner)).status, 401)
  const signedIn = await h.signIn(h.auth.OWNER_EMAIL)
  assert.equal((await presentPasskey(h, replacement, signedIn)).status, 200)
  await get(h, '/api/strap/teaching-pay', signedIn, 200)
}, { mfa: false, auth: { MFA_KEY: '' } }))

test('SEC-004: the security screens work in a real browser with a passkey at 1440 and 390', () => run(async h => {
  if (!process.env.STRAP_PROOF_DIR && !process.env.CI) return
  await h.confirmSetup(h.owner)
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const finance = {}, member = {}
  for (const width of [1440, 390]) {
    finance[width] = await financeUser(h, 'Fiona' + width); member[width] = await h.person('Mara' + width)
  }
  await (await import('./security-browser.mjs')).securityBrowser(h, { finance, member, nextSession: person => h.signIn(person.email) })
}, { hostname: 'localhost' }))
